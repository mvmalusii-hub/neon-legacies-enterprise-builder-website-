// ============================================================
//  NEON AUTH – "Sign in with Google"
//  ------------------------------------------------------------
//  This site is static (GitHub Pages) and has no login server, so
//  there are two ways to authenticate a Google account. auth.js
//  picks whichever one is configured (method()):
//
//  OPTION A – Google Identity Services (an OAuth client id)
//    1. GIS renders the official "Sign in with Google" button and
//       hands back an ID token – a JWT signed by Google.
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
//
//  OPTION B – apps-script/Auth.gs (NO Google Cloud Console needed)
//    1. The visitor is sent to that web app, which is deployed to
//       run as *the person visiting it* with access limited to
//       Google accounts – so Google signs them in first.
//    2. The script reads Session.getActiveUser().getEmail(), mints
//       a random session token, stores it in its own properties and
//       sends the visitor back with #nl_auth=<token>&nl_email=…
//    3. auth.js reads that fragment, starts the session and
//       re-checks the token with the script over JSONP (a <script>
//       tag, because Apps Script cannot send CORS headers).
//
//  Either way the session is cached in localStorage, which is what
//  the gated pages (partners, international, strategic growth,
//  business partners, market leads, business hub, hire admin,
//  referral) read to unlock their forms.
//
//  TO GO LIVE – OPTION B (3 minutes, no Google Cloud Console):
//    1. https://script.google.com → New project → paste Auth.gs.
//    2. Deploy ▸ New deployment ▸ Web app
//         Execute as:     User accessing the web app
//         Who has access: Anyone with Google account
//    3. Paste the /exec URL into authEndpoint below – or into the
//       "Set up Google sign-in" panel on profile.html to test it
//       on this device first.
//
//  TO GO LIVE – OPTION A (about 5 minutes):
//    1. Open https://console.cloud.google.com/apis/credentials
//       → Create credentials ▸ OAuth client ID ▸ Web application.
//    2. Authorised JavaScript origins:
//         https://www.neonlegacies.co.za
//         http://localhost:8000        (for local testing)
//    3. Paste the client id into googleClientId below.
//    4. Put the same client id into Code.gs (GOOGLE.CLIENT_ID).
//  Until one of them is set, the page says exactly what is missing
//  instead of pretending to sign anybody in.
// ============================================================
(function (window, document) {
    'use strict';

    var NEON_AUTH = {
        // OPTION A – OAuth 2.0 client ID (type: Web application).
        // Best experience (Google's own button, name + photo), but someone has
        // to create it in Google Cloud Console first.
        googleClientId: 'REPLACE_WITH_GOOGLE_OAUTH_CLIENT_ID.apps.googleusercontent.com',

        // OPTION B – the Apps Script web app in apps-script/Auth.gs.
        // Needs NO Google Cloud Console: deploy it as "Execute as: User
        // accessing the web app" + "Anyone with Google account" and paste the
        // /exec URL here. Google still signs the visitor in; the script reads
        // their address and hands the site a session token.
        //
        // LIVE DEPLOYMENT (set by the owner): Auth.gs deployed 2026-10-31.
        // Health check: open this URL while signed in to Google –
        //   {"ok":true,"service":"neon-legacies-google-auth","signedInAs":"you@…"}
        // If signedInAs is missing, switch Deploy ▸ Manage deployments to
        // "Execute as: User accessing the web app".
        authEndpoint: 'https://script.google.com/macros/s/AKfycbw3GlRo78arwKPDMQEUFJPwpSRCHNUC9PKyLkALxT0/exec',

        // The owner can paste either credential into the page itself
        // (profile.html ▸ "Site owner") to test before committing it here.
        overridesKey: 'neonGoogleAuthConfig',

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
        _jsonpCount: 0,

        /* -------------------------------------------------------- */
        /* configuration                                             */
        /* -------------------------------------------------------- */

        readOverrides: function () {
            var raw = this.read(this.overridesKey);
            if (!raw) { return {}; }
            try { return JSON.parse(raw) || {}; } catch (e) { return {}; }
        },

        /** Saves credentials pasted into the page, for testing without a deploy. */
        saveOverrides: function (values) {
            var current = this.readOverrides();
            Object.keys(values || {}).forEach(function (key) {
                var value = String(values[key] || '').trim();
                if (value) { current[key] = value; } else { delete current[key]; }
            });
            this.write(this.overridesKey, JSON.stringify(current));
            this._initialised = false;
            this._google = null;
            this._gsiPromise = null;
            this.render();
            return current;
        },

        /** The client id in force: pasted-in override first, then the file. */
        clientId: function () {
            return this.readOverrides().clientId || this.googleClientId;
        },

        /** The Apps Script auth URL in force. */
        endpoint: function () {
            return this.readOverrides().endpoint || this.authEndpoint;
        },

        /** True once a real Google client id is available. */
        isConfigured: function () {
            var id = this.clientId();
            return typeof id === 'string' &&
                id.indexOf('REPLACE_WITH') !== 0 &&
                /^[0-9]+-[A-Za-z0-9_.-]+\.apps\.googleusercontent\.com$/.test(id);
        },

        /** True once the Apps Script login URL is available. */
        isEndpointConfigured: function () {
            var url = this.endpoint();
            return typeof url === 'string' &&
                url.indexOf('https://script.google.com/') === 0;
        },

        /** Which Google path this page can use right now. */
        method: function () {
            if (this.isConfigured()) { return 'identity-services'; }
            if (this.isEndpointConfigured()) { return 'apps-script'; }
            return 'none';
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
                method: String(claims.method || 'identity-services'),
                sub: String(claims.sub),
                email: String(claims.email),
                name: String(claims.name || claims.email),
                givenName: String(claims.given_name || ''),
                familyName: String(claims.family_name || ''),
                picture: String(claims.picture || ''),
                hd: String(claims.hd || ''),
                token: String(claims.token || ''),   // Apps Script session token
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
            var token = user && user.token;
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
            // Kill the server-side session too, so the token cannot be reused.
            if (token && this.isEndpointConfigured()) {
                this.jsonp(this.endpoint(), { action: 'signout', token: token })
                    .catch(function () { /* offline – the local session is already gone */ });
            }
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
        /* Apps Script Google login (apps-script/Auth.gs)            */
        /* -------------------------------------------------------- */

        /** Sends the visitor to Google. They come back with #nl_auth=… */
        beginAppsScriptLogin: function () {
            var back = '';
            try { back = window.location.href.split('#')[0]; } catch (e) { back = ''; }
            var endpoint = this.endpoint();
            var url = endpoint + (endpoint.indexOf('?') === -1 ? '?' : '&') +
                'action=login&return=' + encodeURIComponent(back);
            this.showMessage('Taking you to Google to sign in…', null);
            try {
                window.location.href = url;
            } catch (e) {
                this.showMessage('Could not open Google sign-in. Check the Apps Script URL.', false);
            }
            return url;
        },

        /** Reads #nl_auth=…&nl_email=… left by Auth.gs and starts the session. */
        consumeReturnHash: function () {
            var hash = '';
            try { hash = String(window.location.hash || ''); } catch (e) { return null; }
            if (hash.indexOf('nl_auth=') === -1) { return null; }
            var params = this.parseHash(hash.replace(/^#/, ''));
            var token = params.nl_auth;
            if (!token) { this.stripHash(); return null; }

            this.stripHash();                  // keep the token out of the address bar
            var email = params.nl_email || '';
            if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
                this.showMessage('Google did not return an email address for this account.', false);
                return null;
            }
            var session = this.startSession({
                method: 'apps-script',
                sub: 'apps-script:' + email,
                email: email,
                name: params.nl_name || email,
                token: token
            });
            this.showMessage('Signed in as ' + session.email + '.', true);
            this.render();
            this.verifyServerSession(token);   // if the server disagrees, it signs us out
            return session;
        },

        parseHash: function (text) {
            var out = {};
            String(text || '').split('&').forEach(function (pair) {
                if (!pair) { return; }
                var index = pair.indexOf('=');
                var key = index === -1 ? pair : pair.slice(0, index);
                var value = index === -1 ? '' : pair.slice(index + 1);
                try {
                    out[decodeURIComponent(key)] =
                        decodeURIComponent(value.replace(/\+/g, ' '));
                } catch (e) { out[key] = value; }
            });
            return out;
        },

        stripHash: function () {
            try {
                if (window.history && window.history.replaceState) {
                    window.history.replaceState(null, '',
                        window.location.pathname + window.location.search);
                } else {
                    window.location.hash = '';
                }
            } catch (e) { /* file:// or a locked-down browser */ }
        },

        /** Asks Auth.gs whether this session token is still valid. */
        verifyServerSession: function (token) {
            var self = this;
            if (!token || !this.isEndpointConfigured()) { return Promise.resolve(null); }
            return this.jsonp(this.endpoint(), { action: 'session', token: token })
                .then(function (reply) {
                    if (!reply || !reply.ok || !reply.user) {
                        self.logout();
                        self.showMessage(
                            'That Google session is no longer valid – please sign in again.', false);
                        return null;
                    }
                    var current = self.restore();
                    if (current && current.token === token) {
                        // The server's copy of the account is the truth.
                        current.email = String(reply.user.email || current.email);
                        current.name = String(reply.user.name || current.name);
                        self._user = current;
                        self.write(self.sessionKey, JSON.stringify(current));
                    }
                    return reply.user;
                })
                .catch(function () {
                    return null;    // offline – keep the local session, try again next load
                });
        },

        /**
         * Reads an answer from Apps Script. Apps Script cannot send CORS
         * headers, so we use JSONP: a <script> tag is not blocked by CORS.
         */
        jsonp: function (url, params) {
            var self = this;
            return new Promise(function (resolve, reject) {
                self._jsonpCount += 1;
                var name = '__neonAuthCb' + self._jsonpCount + '_' + Date.now();
                var script = document.createElement('script');
                var finished = false;

                function finish(value, error) {
                    if (finished) { return; }
                    finished = true;
                    clearTimeout(timer);
                    try { delete window[name]; } catch (e) { window[name] = undefined; }
                    if (script.parentNode) { script.parentNode.removeChild(script); }
                    if (error) { reject(error); } else { resolve(value); }
                }

                var timer = setTimeout(function () {
                    finish(null, new Error('the sign-in service did not answer'));
                }, 15000);

                window[name] = function (value) { finish(value, null); };

                var query = Object.keys(params || {}).map(function (key) {
                    return encodeURIComponent(key) + '=' + encodeURIComponent(params[key]);
                }).join('&');
                script.src = url + (url.indexOf('?') === -1 ? '?' : '&') + query +
                    '&callback=' + encodeURIComponent(name);
                script.async = true;
                script.onerror = function () {
                    finish(null, new Error('could not reach the sign-in service'));
                };
                (document.head || document.body || document.documentElement).appendChild(script);
            });
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
            if (String(claims.aud) !== String(this.clientId())) {
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
                        client_id: self.clientId(),
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
         * The one entry point every button calls. It picks whichever Google
         * path is configured: Google Identity Services when there is an OAuth
         * client id, otherwise the Apps Script login (apps-script/Auth.gs).
         */
        signIn: function () {
            var method = this.method();
            if (method === 'identity-services') { return this.promptGoogle(); }
            if (method === 'apps-script') {
                this.beginAppsScriptLogin();
                return Promise.resolve(null);
            }
            this.showMessage('Google sign-in is not switched on yet. Site owner: open ' +
                '"Set up Google sign-in" below and paste the Apps Script URL or the ' +
                'OAuth client id.', false);
            this.renderSetup();
            return Promise.resolve(null);
        },

        /** Google Identity Services: One Tap, with plain-language failures. */
        promptGoogle: function () {
            var self = this;
            return this.initGoogle().then(function (google) {
                if (!google) { return null; }
                return new Promise(function (resolve) {
                    google.accounts.id.prompt(function (moment) {
                        if (moment && (moment.isSkippedMoment() || moment.isNotDisplayed())) {
                            self.showMessage(self.promptReason(moment), false);
                        }
                        resolve(moment || null);
                    });
                });
            });
        },

        /** Turns Google's prompt refusals into the exact fix. */
        promptReason: function (moment) {
            var reason = '';
            try {
                if (moment.isNotDisplayed && moment.isNotDisplayed()) {
                    reason = String(moment.getNotDisplayedReason ?
                        moment.getNotDisplayedReason() : '');
                } else if (moment.isSkippedMoment && moment.isSkippedMoment()) {
                    reason = String(moment.getSkippedReason ? moment.getSkippedReason() : '');
                }
            } catch (e) { reason = ''; }

            var origin = this.origin();
            var fixes = {
                unregistered_origin: 'Google does not recognise this address. Add ' + origin +
                    ' under "Authorised JavaScript origins" for the OAuth client in Google ' +
                    'Cloud Console, then sign in again.',
                secure_http_required: 'Google only signs people in over https (or localhost).' +
                    ' Open the site at its https address.',
                opt_out_or_no_session: 'Google has no session for you here. Use the ' +
                    '"Sign in with Google" button, or allow third-party cookies for this site.',
                suppressed_by_user: 'You dismissed Google One Tap earlier. Use the ' +
                    '"Sign in with Google" button instead.',
                browser_not_supported: 'This browser is not supported by Google sign-in. ' +
                    'Try Chrome, Edge, Firefox or Safari.',
                invalid_client: 'The OAuth client id is wrong or has been deleted. ' +
                    'Check NEON_AUTH.googleClientId in auth.js.',
                popup_closed: 'The Google window closed before you finished. Try again ' +
                    'and pick your Google account.'
            };
            return fixes[reason] ||
                'Google would not show the sign-in prompt' + (reason ? ' (' + reason + ')' : '') +
                '. Use the "Sign in with Google" button, and check that ' + origin +
                ' is listed under Authorised JavaScript origins.';
        },

        origin: function () {
            try {
                return window.location.origin ||
                    (window.location.protocol + '//' + window.location.host);
            } catch (e) { return 'this address'; }
        },

        /* -------------------------------------------------------- */
        /* page UI                                                   */
        /* -------------------------------------------------------- */

        /** Re-paints every auth-aware widget on the page. */
        render: function () {
            this.renderAccountPanel();
            this.renderAuthChip();
            this.renderGoogleButton();
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
            // A Google login that has just come back wins over anything stored.
            var fresh = this.consumeReturnHash();
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

            // A session stored from a previous visit is re-checked against
            // the server, so a token signed out elsewhere stops working here.
            // (A login that just came back was already checked above.)
            if (!fresh) {
                var user = this.restore();
                if (user && user.token && user.method === 'apps-script') {
                    this.verifyServerSession(user.token);
                }
            }
        },

        /** Puts the right Google control into #googleSignInContainer. */
        renderGoogleButton: function () {
            var container = document.getElementById(this.buttonContainerId);
            if (!container || this.isLoggedIn()) { return; }
            var method = this.method();
            var self = this;
            // Re-painting must not throw the owner's setup panel away.
            var panel = document.getElementById('neonAuthSetup');

            if (method === 'identity-services') {
                this.initGoogle();          // Google draws and owns its button
                return;
            }
            if (method === 'apps-script') {
                container.innerHTML =
                    '<button type="button" class="btn google-btn" id="neonGoogleGo">' +
                    '<i class="fab fa-google"></i> Sign in with Google</button>' +
                    '<p class="auth-setup">Google will ask which account to use, then bring ' +
                    'you straight back here.</p>';
                if (panel) { container.appendChild(panel); }
                var go = document.getElementById('neonGoogleGo');
                if (go) {
                    go.addEventListener('click', function (e) {
                        e.preventDefault();
                        self.signIn();
                    });
                }
                return;
            }
            container.innerHTML = '<p class="auth-setup">Google sign-in is not switched on ' +
                'yet, so nobody can open the member areas.</p>';
            if (panel) { container.appendChild(panel); } else { this.renderSetup(); }
        },

        /**
         * Site-owner panel. Google sign-in needs exactly one credential; this
         * lets the owner paste it in the browser and test it immediately,
         * before committing it to auth.js / Code.gs.
         */
        renderSetup: function () {
            var container = document.getElementById(this.buttonContainerId);
            if (!container || document.getElementById('neonAuthSetup')) { return; }
            var self = this;
            var saved = this.readOverrides();
            var origin = this.escapeHtml(this.origin());
            var panel = document.createElement('details');
            panel.id = 'neonAuthSetup';
            panel.className = 'auth-setup-panel';
            panel.innerHTML =
                '<summary>Set up Google sign-in (site owner)</summary>' +
                '<p class="auth-setup">Either route works. The Apps Script one needs no ' +
                'Google Cloud Console at all.</p>' +
                '<ol class="auth-setup-steps">' +
                '<li><b>Easiest:</b> deploy <code>apps-script/Auth.gs</code> as a web app ' +
                '(Execute as: <i>User accessing the web app</i>; Who has access: <i>Anyone ' +
                'with Google account</i>) and paste its <code>/exec</code> URL below.</li>' +
                '<li><b>Nicer button:</b> create an OAuth client id (Web application) with ' +
                '<code>' + origin + '</code> as an authorised JavaScript origin and paste ' +
                'it below.</li>' +
                '</ol>' +
                '<label class="auth-setup-label" for="neonAuthSetupEndpoint">' +
                'Apps Script /exec URL</label>' +
                '<input type="url" id="neonAuthSetupEndpoint" ' +
                'placeholder="https://script.google.com/macros/s/…/exec" ' +
                'value="' + this.escapeHtml(saved.endpoint || '') + '">' +
                '<label class="auth-setup-label" for="neonAuthSetupClientId">' +
                'OAuth client id</label>' +
                '<input type="text" id="neonAuthSetupClientId" ' +
                'placeholder="1234-abc.apps.googleusercontent.com" ' +
                'value="' + this.escapeHtml(saved.clientId || '') + '">' +
                '<button type="button" class="btn btn-sm" id="neonAuthSetupSave">' +
                'Save on this device &amp; test</button>' +
                '<button type="button" class="btn btn-sm btn-outline" id="neonAuthSetupTest">' +
                'Test connection</button>' +
                '<p class="auth-setup" id="neonAuthSetupStatus">' +
                this.escapeHtml(this.statusLine()) + '</p>';
            container.appendChild(panel);

            var save = document.getElementById('neonAuthSetupSave');
            if (save) {
                save.addEventListener('click', function () {
                    var endpoint = document.getElementById('neonAuthSetupEndpoint');
                    var clientId = document.getElementById('neonAuthSetupClientId');
                    self.saveOverrides({
                        endpoint: endpoint ? endpoint.value : '',
                        clientId: clientId ? clientId.value : ''
                    });
                    var status = document.getElementById('neonAuthSetupStatus');
                    if (status) { status.textContent = self.statusLine(); }
                    self.showMessage('Saved on this device – press "Sign in with Google" to ' +
                        'test it, then commit the same value to auth.js.', true);
                    self.renderGoogleButton();
                });
            }

            var testBtn = document.getElementById('neonAuthSetupTest');
            if (testBtn) {
                testBtn.addEventListener('click', function () {
                    var endpoint = document.getElementById('neonAuthSetupEndpoint');
                    var clientId = document.getElementById('neonAuthSetupClientId');
                    self.saveOverrides({
                        endpoint: endpoint ? endpoint.value : '',
                        clientId: clientId ? clientId.value : ''
                    });
                    var status = document.getElementById('neonAuthSetupStatus');
                    if (status) { status.textContent = 'Testing the sign-in service…'; }
                    self.checkEndpoint().then(function (report) {
                        var box = document.getElementById('neonAuthSetupStatus');
                        if (!box) { return; }
                        if (report.ok) {
                            box.textContent = '✔ Service reachable. Google sees: ' +
                                (report.signedInAs || 'a signed-in visitor') + '.';
                            self.showMessage('Connection works – press "Sign in with Google".', true);
                        } else {
                            box.textContent = '✖ ' + (report.error || 'unreachable') +
                                ' – check the URL: it must end in /exec and come from ' +
                                'Deploy ▸ Manage deployments ▸ Web app.';
                            self.showMessage('Could not reach the sign-in service: ' +
                                (report.error || 'unreachable'), false);
                        }
                    });
                });
            }
        },

        /**
         * Probes the Apps Script URL over JSONP and reports what Google says.
         * The site owner uses this from the setup panel before going live.
         */
        checkEndpoint: function () {
            var self = this;
            if (!this.isEndpointConfigured()) {
                return Promise.resolve({ ok: false, error: 'no Apps Script URL set' });
            }
            return this.jsonp(this.endpoint(), { action: 'health' })
                .then(function (reply) {
                    if (reply && reply.ok && reply.service === 'neon-legacies-google-auth') {
                        return { ok: true, signedInAs: reply.signedInAs || null };
                    }
                    return { ok: false, error: (reply && reply.error) || 'unexpected answer' };
                })
                .catch(function (err) {
                    return {
                        ok: false,
                        error: (err && err.message) ? err.message : 'unreachable'
                    };
                });
        },

        /** One-line diagnosis: what is configured and what is still missing. */
        statusLine: function () {
            var method = this.method();
            if (method === 'identity-services') {
                return 'Ready: Google Identity Services (OAuth client id set). Origin: ' +
                    this.origin();
            }
            if (method === 'apps-script') {
                return 'Ready: Apps Script Google login. Origin: ' + this.origin();
            }
            var saved = this.readOverrides();
            if (saved.clientId) {
                return 'The OAuth client id is not a real Google client id – it must look ' +
                    'like 1234567890-xxxx.apps.googleusercontent.com (create it under ' +
                    'console.cloud.google.com/apis/credentials). Origin: ' + this.origin();
            }
            return 'Not ready: no OAuth client id and no Apps Script URL. Origin: ' +
                this.origin();
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
