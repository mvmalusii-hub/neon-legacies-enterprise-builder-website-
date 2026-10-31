// ============================================================
//  NEON AUTH – "Sign in with Google" (Google Identity Services)
//  ------------------------------------------------------------
//  This site is static (GitHub Pages) and has no login server, so
//  authentication works like this:
//
//    1. Google Identity Services (GIS) renders the official
//       "Sign in with Google" button and hands back an ID token –
//       a JWT signed by Google.
//    2. auth.js decodes that JWT and then asks Google itself to
//       confirm it (https://oauth2.googleapis.com/tokeninfo).
//       Only a token Google vouches for – issued to THIS client id,
//       still unexpired, with a verified email address – creates a
//       session. A token that was edited, replayed from another
//       site or has expired is rejected.
//    3. The sign-in is reported to the Apps Script web app
//       (action: 'googleLogin'). Code.gs verifies the same token a
//       second time server-side and writes the sign-in to the
//       Logins tab, so the team can see who created an account.
//    4. The session is cached in localStorage, which is what the
//       gated pages (partners, international, strategic growth,
//       business partners, market leads, business hub, hire admin,
//       referral) read to unlock their forms.
//
//  TO GO LIVE (about 5 minutes):
//    1. Open https://console.cloud.google.com/apis/credentials
//       → Create credentials ▸ OAuth client ID ▸ Web application.
//    2. Authorised JavaScript origins:
//         https://www.neonlegacies.co.za
//         http://localhost:8000        (for local testing)
//    3. Paste the client id into googleClientId below.
//    4. Put the same client id into Code.gs (GOOGLE.CLIENT_ID).
//  Until then the button says exactly what is missing instead of
//  pretending to sign anybody in.
// ============================================================
(function (window, document) {
    'use strict';

    var NEON_AUTH = {
        // OAuth 2.0 client ID (type: Web application).
        googleClientId: 'REPLACE_WITH_GOOGLE_OAUTH_CLIENT_ID.apps.googleusercontent.com',

        gsiUrl: 'https://accounts.google.com/gsi/client',
        tokenInfoUrl: 'https://oauth2.googleapis.com/tokeninfo?id_token=',
        validIssuers: ['https://accounts.google.com', 'accounts.google.com'],

        sessionKey: 'neonAuthSession',   // localStorage
        sessionDays: 7,                  // local session lifetime
        buttonContainerId: 'googleSignInContainer',
        fallbackButtonId: 'googleLoginBtn',
        accountPanelId: 'accountPanel',
        googleCardClass: 'google-card',
        messageId: 'authMessage',
        fallbackMessageId: 'loginMessage',

        _listeners: [],
        _gsiPromise: null,
        _initialised: false,
        _google: null,
        _user: null,

        /* -------------------------------------------------------- */
        /* helpers                                                   */
        /* -------------------------------------------------------- */

        /** True once a real Google client id has been pasted in. */
        isConfigured: function () {
            return typeof this.googleClientId === 'string' &&
                this.googleClientId.indexOf('REPLACE_WITH') !== 0 &&
                this.googleClientId.length > 20;
        },

        read: function (key) {
            try { return window.localStorage.getItem(key); } catch (e) { return null; }
        },

        write: function (key, value) {
            try { window.localStorage.setItem(key, value); } catch (e) { /* private mode */ }
        },

        remove: function (key) {
            try { window.localStorage.removeItem(key); } catch (e) { /* private mode */ }
        },

        /** Makes Google profile text safe to drop into innerHTML. */
        escapeHtml: function (value) {
            return String(value === null || value === undefined ? '' : value)
                .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
                .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
        },

        /** base64url → JSON, without relying on any library. */
        decodeJwtPart: function (part) {
            var b64 = String(part).replace(/-/g, '+').replace(/_/g, '/');
            while (b64.length % 4) { b64 += '='; }
            var bin;
            try { bin = window.atob(b64); } catch (e) { return null; }
            // JWT payloads are UTF-8; atob hands back bytes as chars.
            var bytes = [];
            for (var i = 0; i < bin.length; i++) { bytes.push(bin.charCodeAt(i)); }
            var json;
            try {
                json = typeof window.TextDecoder === 'function'
                    ? new window.TextDecoder('utf-8').decode(new Uint8Array(bytes))
                    : bin;
            } catch (e) { json = bin; }
            try { return JSON.parse(json); } catch (e) { return null; }
        },

        /** Splits an ID token into {header, payload}. Null if malformed. */
        decodeIdToken: function (credential) {
            if (typeof credential !== 'string') { return null; }
            var parts = credential.split('.');
            if (parts.length !== 3) { return null; }
            var header = this.decodeJwtPart(parts[0]);
            var payload = this.decodeJwtPart(parts[1]);
            if (!header || !payload) { return null; }
            return { header: header, payload: payload };
        },

        /* -------------------------------------------------------- */
        /* session                                                   */
        /* -------------------------------------------------------- */

        /** Reads the cached session; drops it once it has expired. */
        restore: function () {
            if (this._user) { return this._user; }
            var raw = this.read(this.sessionKey);
            if (!raw) { return null; }
            var session = null;
            try { session = JSON.parse(raw); } catch (e) { session = null; }
            if (!session || !session.email || !session.sub || session.provider !== 'google') {
                this.remove(this.sessionKey);
                return null;
            }
            if (!session.expiresAt || Date.now() > Number(session.expiresAt)) {
                this.remove(this.sessionKey);          // session lapsed – sign in again
                return null;
            }
            this._user = session;
            return session;
        },

        getUser: function () { return this.restore(); },

        isLoggedIn: function () { return !!this.restore(); },

        /** Writes a verified session and tells every listener. */
        startSession: function (claims) {
            var now = Date.now();
            var session = {
                provider: 'google',
                sub: String(claims.sub),
                email: String(claims.email),
                name: String(claims.name || claims.email),
                givenName: String(claims.given_name || ''),
                familyName: String(claims.family_name || ''),
                picture: String(claims.picture || ''),
                hd: String(claims.hd || ''),
                signedInAt: now,
                expiresAt: now + (this.sessionDays * 24 * 60 * 60 * 1000)
            };
            this._user = session;
            this.write(this.sessionKey, JSON.stringify(session));
            // Legacy keys that logout.html and older pages already look for.
            this.write('user', session.name);
            this.write('userEmail', session.email);
            this.emit('signin', session);
            return session;
        },

        /** Ends the session, and Google's auto-select memory with it. */
        logout: function () {
            var user = this._user || this.restore();
            this._user = null;
            this.remove(this.sessionKey);
            ['user', 'userEmail', 'profile', 'session', 'authToken'].forEach(function (key) {
                try { window.localStorage.removeItem(key); } catch (e) { /* ignore */ }
            });
            try {
                if (window.google && window.google.accounts && window.google.accounts.id) {
                    window.google.accounts.id.disableAutoSelect();
                }
            } catch (e) { /* GIS not loaded */ }
            this.emit('signout', user);
            return true;
        },

        /** Subscribe to sign-in / sign-out. Returns an unsubscribe fn. */
        onChange: function (callback) {
            if (typeof callback !== 'function') { return function () {}; }
            this._listeners.push(callback);
            var self = this;
            return function () {
                self._listeners = self._listeners.filter(function (fn) { return fn !== callback; });
            };
        },

        emit: function (type, user) {
            this._listeners.slice().forEach(function (fn) {
                try { fn({ type: type, user: user || null }); } catch (e) { /* listener bug */ }
            });
        },

        /** Guard for gated pages: sends the visitor to the profile page. */
        requireUser: function () {
            if (this.isLoggedIn()) { return this.getUser(); }
            try { window.location.href = 'profile.html'; } catch (e) { /* ignore */ }
            return null;
        },

        /* -------------------------------------------------------- */
        /* token verification                                        */
        /* -------------------------------------------------------- */

        /**
         * Checks decoded claims. Returns an error string, or null when
         * the claims look right.
         */
        checkClaims: function (claims) {
            if (!claims || typeof claims !== 'object') { return 'unreadable token'; }
            if (this.validIssuers.indexOf(String(claims.iss)) === -1) {
                return 'token was not issued by Google';
            }
            if (String(claims.aud) !== String(this.googleClientId)) {
                return 'token was issued for a different site';
            }
            var exp = Number(claims.exp || 0);
            if (!exp || exp * 1000 <= Date.now()) {
                return 'token has expired – please sign in again';
            }
            if (!claims.sub) { return 'token has no Google account id'; }
            if (!claims.email) { return 'the Google account has no email address'; }
            var verified = claims.email_verified;
            if (verified !== true && String(verified) !== 'true') {
                return 'the email address on this Google account is not verified';
            }
            return null;
        },

        /**
         * Verifies an ID token. The local decode is only a pre-flight:
         * Google's own tokeninfo endpoint has to accept the token too,
         * which is what proves the signature is genuine.
         * Resolves with the claims, or rejects with an Error.
         */
        verifyIdToken: function (credential) {
            var self = this;
            var decoded = this.decodeIdToken(credential);
            if (!decoded) {
                return Promise.reject(new Error('that sign-in response is not a valid Google token'));
            }
            var localError = this.checkClaims(decoded.payload);
            if (localError) { return Promise.reject(new Error(localError)); }
            if (typeof window.fetch !== 'function') {
                return Promise.reject(new Error('this browser cannot verify the Google token'));
            }
            return window.fetch(this.tokenInfoUrl + encodeURIComponent(credential), { method: 'GET' })
                .then(function (response) {
                    if (!response || !response.ok) {
                        throw new Error('Google rejected this sign-in – please try again');
                    }
                    return response.json();
                })
                .then(function (claims) {
                    var error = self.checkClaims(claims);
                    if (error) { throw new Error(error); }
                    // Google's answer must describe the same account.
                    if (String(claims.sub) !== String(decoded.payload.sub) ||
                        String(claims.email) !== String(decoded.payload.email)) {
                        throw new Error('Google returned a different account than the token claims');
                    }
                    return claims;
                });
        },

        /** GIS callback: {credential: "<ID token>"} → session. */
        handleCredential: function (response) {
            var self = this;
            var credential = response && (response.credential || response.id_token);
            if (!credential) {
                this.showMessage('Google did not return a sign-in token. Please try again.', false);
                return Promise.reject(new Error('no credential'));
            }
            this.showMessage('Checking your Google account…', null);
            return this.verifyIdToken(credential)
                .then(function (claims) {
                    var session = self.startSession(claims);
                    self.reportSignIn(session, credential);
                    self.showMessage('Signed in as ' + session.email + '.', true);
                    self.render();
                    return session;
                })
                .catch(function (err) {
                    var text = (err && err.message) ? err.message : 'Google sign-in failed';
                    self.showMessage(text, false);
                    throw err;
                });
        },

        /**
         * Tells the Apps Script backend about the sign-in. Code.gs
         * verifies the same token again and writes the Logins row.
         * The POST is no-cors (Apps Script sends no CORS headers), so
         * the browser never reads the reply – verification against
         * Google already happened in verifyIdToken().
         */
        reportSignIn: function (session, credential) {
            var leads = window.NEON_LEADS;
            if (!leads || typeof leads.send !== 'function') { return Promise.resolve({ skipped: true }); }
            var payload = {
                action: 'googleLogin',
                formType: 'Google Sign-in',
                name: session.name,
                email: session.email,
                phone: '',
                company: '',
                message: 'Signed in with Google (account id ' + session.sub + ')',
                googleSub: session.sub,
                picture: session.picture,
                page: (window.location.pathname.split('/').pop() || 'index.html'),
                timestamp: new Date().toISOString(),
                credential: credential,
                token: leads.token,
                id: 'glogin-' + session.sub + '-' + Date.now()
            };
            return leads.send(payload);
        },

        /** Writes into #loginMessage. ok=true green, false red, null neutral. */
        showMessage: function (text, ok) {
            var box = document.getElementById(this.messageId) ||
                document.getElementById(this.fallbackMessageId);
            if (!box) { return; }
            var colour = ok === null ? '#475569' : (ok ? 'green' : 'red');
            box.innerHTML = '<span style="color:' + colour + ';">' + this.escapeHtml(text) + '</span>';
        },

        /* -------------------------------------------------------- */
        /* Google Identity Services                                  */
        /* -------------------------------------------------------- */

        /** Loads GIS once. Resolves with window.google. */
        loadGoogle: function () {
            var self = this;
            if (window.google && window.google.accounts && window.google.accounts.id) {
                return Promise.resolve(window.google);
            }
            if (this._gsiPromise) { return this._gsiPromise; }
            this._gsiPromise = new Promise(function (resolve, reject) {
                var script = document.createElement('script');
                script.src = self.gsiUrl;
                script.async = true;
                script.defer = true;
                script.onload = function () {
                    if (window.google && window.google.accounts && window.google.accounts.id) {
                        resolve(window.google);
                    } else {
                        reject(new Error('Google sign-in script loaded but is unavailable'));
                    }
                };
                script.onerror = function () {
                    self._gsiPromise = null;
                    reject(new Error('could not reach Google sign-in – check your connection'));
                };
                (document.head || document.body || document.documentElement).appendChild(script);
            });
            return this._gsiPromise;
        },

        /** Initialises GIS and renders the official button. */
        initGoogle: function () {
            var self = this;
            if (this._google) { return Promise.resolve(this._google); }   // already done
            if (this._initialised || !this.isConfigured()) { return Promise.resolve(null); }
            this._initialised = true;
            return this.loadGoogle()
                .then(function (google) {
                    google.accounts.id.initialize({
                        client_id: self.googleClientId,
                        callback: function (response) { self.handleCredential(response); },
                        auto_select: false,
                        cancel_on_tap_outside: true,
                        use_fedcm_for_prompt: true
                    });
                    var container = document.getElementById(self.buttonContainerId);
                    if (container) {
                        container.innerHTML = '';
                        google.accounts.id.renderButton(container, {
                            theme: 'outline',
                            size: 'large',
                            shape: 'pill',
                            text: 'signin_with',
                            logo_alignment: 'left',
                            width: '300'
                        });
                        // Google's own button is on screen now – drop our look-alike.
                        var lookalike = document.getElementById(self.fallbackButtonId);
                        if (lookalike) { lookalike.style.display = 'none'; }
                    }
                    self._google = google;
                    return google;
                })
                .catch(function (err) {
                    self._initialised = false;      // allow a retry on the next click
                    var message = (err && err.message) ? err.message : 'Google sign-in is unavailable';
                    self.showMessage(message, false);
                    return null;
                });
        },

        /**
         * Fallback button: asks Google for the One Tap prompt. Used when
         * the official button could not be rendered, and by logout.html.
         */
        signIn: function () {
            var self = this;
            if (!this.isConfigured()) {
                this.showMessage('Google sign-in is not switched on yet – the site owner still has to add the Google OAuth client id to auth.js.', false);
                return Promise.resolve(null);
            }
            return this.initGoogle().then(function (google) {
                if (!google) { return null; }
                return new Promise(function (resolve) {
                    google.accounts.id.prompt(function (moment) {
                        if (moment && (moment.isSkippedMoment() || moment.isNotDisplayed())) {
                            self.showMessage('Google blocked the pop-up. Use the "Sign in with Google" button above, or allow pop-ups for this site.', false);
                        }
                        resolve(moment || null);
                    });
                });
            });
        },

        /* -------------------------------------------------------- */
        /* page UI                                                   */
        /* -------------------------------------------------------- */

        /** Re-paints every auth-aware widget on the page. */
        render: function () {
            this.renderAccountPanel();
            this.renderAuthChip();
        },

        /** Which profile.html tab is showing? */
        signupTabActive: function () {
            var tab = document.getElementById('signupTab');
            return !!(tab && tab.classList.contains('active'));
        },

        /** profile.html: signed-in account card, or the sign-in forms. */
        renderAccountPanel: function () {
            var panel = document.getElementById(this.accountPanelId);
            if (!panel) { return; }
            var user = this.restore();
            var tabs = document.querySelector('.tab-container');
            var loginCard = document.getElementById('loginForm');
            var signupCard = document.getElementById('signupForm');
            var googleCard = document.querySelector('.' + this.googleCardClass);
            var self = this;

            if (!user) {
                panel.classList.add('hidden');
                panel.innerHTML = '';
                if (tabs) { tabs.classList.remove('hidden'); }
                if (googleCard) { googleCard.classList.remove('hidden'); }
                // Hand the two cards back to whichever tab is active.
                var signupActive = this.signupTabActive();
                if (loginCard) {
                    loginCard.classList.remove('hidden');
                    loginCard.style.display = signupActive ? 'none' : 'block';
                }
                if (signupCard) {
                    if (signupActive) { signupCard.classList.remove('hidden'); }
                    else { signupCard.classList.add('hidden'); }
                    signupCard.style.display = signupActive ? 'block' : 'none';
                }
                return;
            }

            if (tabs) { tabs.classList.add('hidden'); }
            if (googleCard) { googleCard.classList.add('hidden'); }
            if (signupCard) { signupCard.classList.add('hidden'); signupCard.style.display = 'none'; }
            if (loginCard) { loginCard.classList.add('hidden'); loginCard.style.display = 'none'; }

            var initials = String(user.name || user.email).trim().charAt(0).toUpperCase() || 'N';
            var avatar = user.picture
                ? '<img class="account-avatar" src="' + this.escapeHtml(user.picture) +
                  '" alt="" referrerpolicy="no-referrer">'
                : '<span class="account-avatar account-avatar-initials">' +
                  this.escapeHtml(initials) + '</span>';

            panel.innerHTML =
                '<div class="account-row">' + avatar +
                    '<div class="account-who">' +
                        '<h3>' + this.escapeHtml(user.name) + '</h3>' +
                        '<p><i class="fab fa-google"></i> ' + this.escapeHtml(user.email) + '</p>' +
                        '<p class="account-meta">Signed in with Google · session ends ' +
                            this.escapeHtml(new Date(user.expiresAt).toLocaleDateString()) + '</p>' +
                    '</div>' +
                '</div>' +
                '<div class="account-actions">' +
                    '<a class="btn btn-sm" href="business-hub.html">Open Business Hub →</a>' +
                    '<button type="button" class="btn btn-sm btn-outline" id="signOutBtn">' +
                        '<i class="fas fa-sign-out-alt"></i> Sign out</button>' +
                '</div>';

            panel.classList.remove('hidden');
            var signOut = document.getElementById('signOutBtn');
            if (signOut) {
                signOut.addEventListener('click', function () { self.signOut(); });
            }
        },

        /** Sidebar chip: shows who is signed in on every page. */
        renderAuthChip: function () {
            var host = document.querySelector('.sidebar-header');
            if (!host) { return; }
            var chip = document.getElementById('neonAuthChip');
            var user = this.restore();

            if (!user) {
                if (chip && chip.parentNode) { chip.parentNode.removeChild(chip); }
                return;
            }
            if (!chip) {
                chip = document.createElement('div');
                chip.id = 'neonAuthChip';
                chip.className = 'auth-chip';
                host.appendChild(chip);
            }
            var self = this;
            chip.innerHTML =
                '<i class="fas fa-user-check"></i> ' + this.escapeHtml(user.name) +
                '<a href="logout.html" id="neonAuthChipOut" title="Sign out">Sign out</a>';
            var link = document.getElementById('neonAuthChipOut');
            if (link) {
                link.addEventListener('click', function (e) {
                    e.preventDefault();
                    self.signOut();
                });
            }
        },

        /** Ends the session and shows the signed-out page. */
        signOut: function () {
            this.logout();
            try { window.location.href = 'logout.html'; } catch (e) { this.render(); }
        },

        /** Wires the buttons on this page and paints the auth widgets. */
        boot: function () {
            var self = this;
            this.restore();

            var fallback = document.getElementById(this.fallbackButtonId);
            if (fallback && !fallback.dataset.neonBound) {
                fallback.dataset.neonBound = 'true';
                fallback.addEventListener('click', function (e) {
                    e.preventDefault();
                    self.signIn();
                });
            }

            Array.prototype.forEach.call(
                document.querySelectorAll('[data-neon-signout]'),
                function (btn) {
                    if (btn.dataset.neonBound) { return; }
                    btn.dataset.neonBound = 'true';
                    btn.addEventListener('click', function (e) {
                        e.preventDefault();
                        self.signOut();
                    });
                }
            );

            this.onChange(function () { self.render(); });
            this.render();

            var container = document.getElementById(this.buttonContainerId);
            if (container && this.isConfigured()) {
                this.initGoogle();
            } else if (container && !this.isLoggedIn()) {
                container.innerHTML = '<p class="auth-setup">Google sign-in is not switched on yet. ' +
                    'Add the OAuth client id to <code>auth.js</code> to enable it.</p>';
            }
        }
    };

    // Publish first, so anything that runs during boot can find it.
    window.NEON_AUTH = NEON_AUTH;

    // Restore any existing session as soon as the script is parsed, so the
    // gating on every page is already correct on first paint.
    NEON_AUTH.restore();

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', function () { NEON_AUTH.boot(); });
    } else {
        NEON_AUTH.boot();
    }
})(window, document);
