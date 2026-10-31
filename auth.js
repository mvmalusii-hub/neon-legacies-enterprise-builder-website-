// ============================================================
//  NEON AUTH – real accounts on the Neon Legacies Apps Script
//  -----------------------------------------------------------
//  Signup, sign-in, sessions, profile edits, password change and
//  password reset all run on the same web app as the lead intake.
//
//  Why an iframe: Apps Script cannot send CORS headers, so fetch()
//  can never read its reply. The web app answers account calls with a
//  tiny HTML page that does parent.postMessage(JSON), so no secret
//  ever has to travel in a URL.
//
//  Load order: app.js (defines window.NEON_LEADS) then auth.js.
// ============================================================
(function (window, document) {
    'use strict';

    var STORAGE_KEY = 'neonAuth';
    var FRAME_ID = 'neonAuthFrame';
    var MAX_AGE_MS = 8 * 24 * 60 * 60 * 1000;      // server sessions last 7 days
    var TIMEOUT_MS = 25000;

    var pending = {};
    var listeners = [];
    var state = { token: '', user: null, remember: true };
    var readyPromise = null;

    /* --------------------------- config --------------------------- */

    function endpoint() {
        var leads = window.NEON_LEADS || {};
        var value = String(leads.endpoint || '').trim();
        if (value.indexOf('https://script.google.com/') === 0) { return value; }
        if (/^[A-Za-z0-9_-]{20,}$/.test(value)) {
            return 'https://script.google.com/macros/s/' + value + '/exec';
        }
        return '';
    }

    function siteToken() {
        return (window.NEON_LEADS && window.NEON_LEADS.token) || '';
    }

    function isKnownOrigin(origin) {
        if (!origin) { return false; }
        return /^https:\/\/([a-z0-9-]+\.)*(google\.com|googleusercontent\.com)$/i.test(origin);
    }

    /* ------------------------- transport -------------------------- */

    // The Apps Script reply arrives here and releases the waiting promise.
    window.addEventListener('message', function (event) {
        if (event && event.origin && !isKnownOrigin(event.origin)) { return; }
        var data = event && event.data;
        if (typeof data === 'string') {
            try { data = JSON.parse(data); } catch (err) { return; }
        }
        if (!data || !data.neonAuth || !pending[data.neonAuth]) { return; }
        var entry = pending[data.neonAuth];
        delete pending[data.neonAuth];
        clearTimeout(entry.timer);
        entry.resolve(data.result || { ok: false, error: 'empty reply' });
    });

    function ensureFrame() {
        if (readyPromise) { return readyPromise; }
        var url = endpoint();
        if (!url) { readyPromise = Promise.resolve(false); return readyPromise; }

        var frame = document.getElementById(FRAME_ID);
        if (!frame) {
            frame = document.createElement('iframe');
            frame.id = FRAME_ID;
            frame.name = FRAME_ID;
            frame.setAttribute('title', 'Account');
            frame.setAttribute('aria-hidden', 'true');
            frame.style.cssText = 'position:absolute;width:0;height:0;border:0;left:-9999px;top:-9999px;';
            if (document.body) { document.body.appendChild(frame); }
        }

        readyPromise = new Promise(function (resolve) {
            var done = false;
            var timer = null;
            var finish = function () {
                if (done) { return; }
                done = true;
                if (timer) { clearTimeout(timer); }
                resolve(true);
            };
            frame.addEventListener('load', finish);
            // The bootstrap page proves the deployment is reachable.
            frame.src = url + (url.indexOf('?') === -1 ? '?' : '&') + 'action=blank';
            timer = setTimeout(finish, 4000);
        });
        return readyPromise;
    }

    /** POSTs one account action into the hidden iframe and resolves with its JSON. */
    function call(action, params) {
        var url = endpoint();
        if (!url) {
            return Promise.resolve({ ok: false, error: 'Accounts are not connected yet.', offline: true });
        }
        return ensureFrame().then(function () {
            return new Promise(function (resolve) {
                var requestId = 'r' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
                var form = document.createElement('form');
                form.method = 'POST';
                form.action = url;
                form.target = FRAME_ID;
                form.acceptCharset = 'UTF-8';
                form.style.display = 'none';

                var fields = { action: action, token: siteToken(), requestId: requestId };
                Object.keys(params || {}).forEach(function (key) { fields[key] = params[key]; });
                Object.keys(fields).forEach(function (key) {
                    var input = document.createElement('input');
                    input.type = 'hidden';
                    input.name = key;
                    input.value = fields[key] == null ? '' : String(fields[key]);
                    form.appendChild(input);
                });

                if (document.body) { document.body.appendChild(form); }
                pending[requestId] = {
                    resolve: resolve,
                    timer: setTimeout(function () {
                        delete pending[requestId];
                        resolve({ ok: false, error: 'No reply from the server. Check your connection and try again.', network: true });
                    }, TIMEOUT_MS)
                };
                form.submit();
                setTimeout(function () { if (form.parentNode) { form.parentNode.removeChild(form); } }, 0);
            });
        });
    }

    /* --------------------------- state ---------------------------- */

    function notify() {
        var snapshot = state.user ? Object.assign({}, state.user) : null;
        listeners.forEach(function (fn) {
            try { fn(snapshot, api); } catch (err) { /* a broken listener must not break sign-in */ }
        });
        try {
            document.dispatchEvent(new CustomEvent('neon:auth', { detail: { user: snapshot } }));
        } catch (err) { /* CustomEvent unsupported */ }
    }

    function persist(token, user, remember) {
        state.token = token || '';
        state.user = user || null;
        state.remember = remember !== false;
        try {
            var store = state.remember ? window.localStorage : window.sessionStorage;
            var other = state.remember ? window.sessionStorage : window.localStorage;
            if (other && other.removeItem) { other.removeItem(STORAGE_KEY); }
            if (token) {
                store.setItem(STORAGE_KEY, JSON.stringify({
                    token: token, user: state.user, savedAt: Date.now()
                }));
            } else {
                store.removeItem(STORAGE_KEY);
            }
        } catch (err) { /* private mode: stay signed in for this page only */ }
        notify();
    }

    function restore() {
        var raw = null;
        try {
            raw = window.localStorage.getItem(STORAGE_KEY) || window.sessionStorage.getItem(STORAGE_KEY);
        } catch (err) { return false; }
        if (!raw) { return false; }
        var saved;
        try { saved = JSON.parse(raw); } catch (err) { return false; }
        if (!saved || !saved.token) { return false; }
        if (saved.savedAt && Date.now() - saved.savedAt > MAX_AGE_MS) { persist('', null); return false; }
        state.token = saved.token;
        state.user = saved.user || null;
        state.remember = true;
        return true;
    }

    function clear() {
        persist('', null, state.remember);
    }

    /* ---------------------------- api ----------------------------- */

    var api = {
        /** Cached user (kept in step with the server by refresh()). */
        user: function () { return state.user ? Object.assign({}, state.user) : null; },
        token: function () { return state.token; },
        isLoggedIn: function () { return !!(state.user && state.token); },
        isConfigured: function () { return endpoint().length > 0; },

        /** Registers a callback that receives (user|null) whenever auth changes. */
        onChange: function (fn) {
            if (typeof fn !== 'function') { return function () {}; }
            listeners.push(fn);
            return function () {
                listeners = listeners.filter(function (other) { return other !== fn; });
            };
        },

        signup: function (data) {
            var payload = data || {};
            return call('signup', {
                name: payload.name || '', email: payload.email || '',
                phone: payload.phone || '', company: payload.company || '',
                password: payload.password || ''
            }).then(function (res) {
                if (res && res.ok) { persist(res.token, res.user, payload.remember); }
                return res;
            });
        },

        login: function (data) {
            var payload = data || {};
            return call('login', {
                email: payload.email || '', password: payload.password || ''
            }).then(function (res) {
                if (res && res.ok) { persist(res.token, res.user, payload.remember); }
                return res;
            });
        },

        /** Asks the server whether the stored session is still valid. */
        refresh: function () {
            if (!state.token) { return Promise.resolve(null); }
            return call('session', { sessionToken: state.token }).then(function (res) {
                if (res && res.ok && res.user) {
                    persist(state.token, res.user, state.remember);
                    return res.user;
                }
                clear();
                return null;
            });
        },

        logout: function () {
            var token = state.token;
            clear();
            if (!token) { return Promise.resolve({ ok: true }); }
            return call('logout', { sessionToken: token });
        },

        updateProfile: function (data) {
            var payload = data || {};
            return call('updateProfile', {
                sessionToken: state.token,
                name: payload.name, phone: payload.phone, company: payload.company
            }).then(function (res) {
                if (res && res.ok && res.user) { persist(state.token, res.user, state.remember); }
                return res;
            });
        },

        changePassword: function (data) {
            var payload = data || {};
            return call('changePassword', {
                sessionToken: state.token,
                currentPassword: payload.currentPassword || '',
                newPassword: payload.newPassword || ''
            }).then(function (res) {
                if (res && res.ok && res.token) { persist(res.token, res.user, state.remember); }
                return res;
            });
        },

        requestReset: function (email) {
            return call('requestReset', { email: email || '' });
        },

        resetPassword: function (data) {
            var payload = data || {};
            return call('resetPassword', {
                email: payload.email || '',
                resetToken: payload.resetToken || '',
                newPassword: payload.newPassword || ''
            }).then(function (res) {
                if (res && res.ok) { clear(); }
                return res;
            });
        },

        /** Sends the visitor to the profile page unless a session exists. */
        requireUser: function (redirect) {
            if (this.isLoggedIn()) { return this.user(); }
            var target = redirect || 'profile.html?next=' + encodeURIComponent(location.pathname.split('/').pop() || 'index.html');
            location.href = target;
            return null;
        },

        /** Reads the stored session, then checks it against the server. */
        init: function () {
            restore();
            notify();
            return api.refresh();
        }
    };

    window.NEON_AUTH = api;

    // Kick off on load so every page agrees with the server about the session.
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', function () { api.init(); });
    } else {
        setTimeout(function () { api.init(); }, 0);
    }
})(window, document);
