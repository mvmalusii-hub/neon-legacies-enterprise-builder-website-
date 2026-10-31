'use strict';
/**
 * Loads the REAL apps-script/Code.gs into a sandbox with the Apps Script
 * services stubbed out, so the tests exercise the code that gets deployed
 * rather than a re-implementation of it.
 *
 *   const backend = require('./appsscript-stub').loadCode();
 *   const reply = backend.call('doPost', { postData: { contents: '...' } });
 *   backend.state.sheets.Logins.rows   // what was written
 *   backend.state.mails                // what MailApp sent
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const CODE_PATH = path.join(__dirname, '..', 'Code.gs');

function loadCode(options) {
    options = options || {};
    const state = {
        sheets: {},
        mails: [],
        fetches: [],
        cache: new Map(),
        locks: 0
    };

    // Google's answer for an ID token. Tests replace this.
    state.tokenInfo = options.tokenInfo || function (url) {
        return { code: 400, body: '{"error":"invalid_token"}' };
    };

    function makeSheet(name) {
        return {
            name: name,
            rows: [],
            frozenRows: 0,
            appendRow: function (row) { this.rows.push(row); return this; },
            getRange: function () { return { setFontWeight: function () { return this; } }; },
            setFrozenRows: function (n) { this.frozenRows = n; },
            getLastRow: function () { return this.rows.length; },
            getDataRange: function () { return { getValues: function () { return this.rows; } }; }
        };
    }

    const spreadsheet = {
        id: options.spreadsheetId || 'stub-spreadsheet',
        getSheetByName: function (name) { return state.sheets[name] || null; },
        insertSheet: function (name) {
            state.sheets[name] = makeSheet(name);
            return state.sheets[name];
        },
        getSheets: function () {
            return Object.keys(state.sheets).map(function (k) { return state.sheets[k]; });
        }
    };

    const sandbox = {
        console: { error: function () {}, log: function () {}, info: function () {}, warn: function () {} },

        SpreadsheetApp: {
            openById: function () { return spreadsheet; },
            getActiveSpreadsheet: function () { return spreadsheet; }
        },

        CacheService: {
            getScriptCache: function () {
                return {
                    get: function (key) {
                        return state.cache.has(key) ? state.cache.get(key) : null;
                    },
                    put: function (key, value) { state.cache.set(key, String(value)); },
                    remove: function (key) { state.cache.delete(key); }
                };
            }
        },

        MailApp: {
            sendEmail: function (message) { state.mails.push(message); },
            getRemainingDailyQuota: function () { return 100; }
        },

        UrlFetchApp: {
            fetch: function (url, opts) {
                state.fetches.push({ url: String(url), opts: opts || {} });
                const result = state.tokenInfo(String(url), opts || {});
                return {
                    getResponseCode: function () { return result.code; },
                    getContentText: function () { return result.body; }
                };
            }
        },

        ContentService: {
            MimeType: { JSON: 'application/json', TEXT: 'text/plain' },
            createTextOutput: function (text) {
                return {
                    text: String(text),
                    mimeType: null,
                    setMimeType: function (type) { this.mimeType = type; return this; },
                    getContent: function () { return this.text; }
                };
            }
        },

        Utilities: {
            getUuid: function () {
                return 'uuid-' + Math.random().toString(36).slice(2, 10);
            },
            formatDate: function (date, tz, format) {
                const d = date instanceof Date ? date : new Date(date);
                const yy = String(d.getFullYear()).slice(2);
                const mm = String(d.getMonth() + 1).padStart(2, '0');
                const dd = String(d.getDate()).padStart(2, '0');
                return String(format).replace('yy', yy).replace('MM', mm).replace('dd', dd);
            },
            computeDigest: function () { return []; }
        },

        LockService: {
            getScriptLock: function () {
                return {
                    tryLock: function () { state.locks += 1; return true; },
                    releaseLock: function () { state.locks -= 1; }
                };
            }
        }
    };

    vm.createContext(sandbox);
    const source = fs.readFileSync(CODE_PATH, 'utf8');
    vm.runInContext(source, sandbox, { filename: 'Code.gs' });

    return {
        sandbox: sandbox,
        state: state,
        spreadsheet: spreadsheet,
        /** Runs a Code.gs function and parses the JSON reply. */
        call: function (name, arg) {
            if (typeof sandbox[name] !== 'function') {
                throw new Error('Code.gs has no function called ' + name);
            }
            const reply = sandbox[name](arg);
            if (!reply || typeof reply.text !== 'string') { return reply; }
            try { return JSON.parse(reply.text); } catch (e) { return reply.text; }
        },
        /** Builds the event object Apps Script hands to doPost. */
        post: function (payload) {
            return this.call('doPost', {
                postData: { contents: JSON.stringify(payload), type: 'application/json' },
                parameter: {}
            });
        }
    };
}

/* ------------------------------------------------------------------ */
/* apps-script/Auth.gs – Google login with no OAuth client             */
/* ------------------------------------------------------------------ */
const AUTH_PATH = path.join(__dirname, '..', 'Auth.gs');

function loadAuth(options) {
    options = options || {};
    const crypto = require('crypto');
    const state = {
        properties: new Map(),
        html: [],
        locks: 0,
        // Who Google says is running the script (the visiting user).
        signedInAs: options.email === undefined ? 'thabo.mokoena@gmail.com' : options.email
    };

    function propertiesApi() {
        return {
            getProperty: function (key) {
                return state.properties.has(key) ? state.properties.get(key) : null;
            },
            setProperty: function (key, value) { state.properties.set(key, String(value)); },
            deleteProperty: function (key) { state.properties.delete(key); },
            getKeys: function () { return Array.from(state.properties.keys()); },
            deleteAllProperties: function () { state.properties.clear(); }
        };
    }

    const sandbox = {
        console: { error: function () {}, log: function () {}, info: function () {}, warn: function () {} },

        Session: {
            getActiveUser: function () {
                return { getEmail: function () { return state.signedInAs || ''; } };
            },
            getEffectiveUser: function () {
                return { getEmail: function () { return 'owner@example.com'; } };
            }
        },

        PropertiesService: {
            getScriptProperties: propertiesApi,
            getUserProperties: propertiesApi
        },

        LockService: {
            getScriptLock: function () {
                return {
                    tryLock: function () { state.locks += 1; return true; },
                    waitLock: function () { state.locks += 1; },
                    releaseLock: function () { state.locks -= 1; }
                };
            }
        },

        Utilities: {
            DigestAlgorithm: { SHA_256: 'SHA_256', MD5: 'MD5' },
            getUuid: function () {
                return crypto.randomBytes(16).toString('hex').replace(/(.{8})(.{4})(.{4})(.{4})(.{12})/, '$1-$2-$3-$4-$5');
            },
            base64EncodeWebSafe: function (value) {
                return Buffer.from(String(value), 'utf8').toString('base64')
                    .replace(/\+/g, '-').replace(/\//g, '_');
            },
            computeDigest: function (algorithm, value) {
                return Array.from(crypto.createHash('sha256').update(String(value)).digest());
            }
        },

        ContentService: {
            MimeType: { JSON: 'application/json', TEXT: 'text/plain' },
            createTextOutput: function (text) {
                return {
                    text: String(text),
                    mimeType: null,
                    setMimeType: function (type) { this.mimeType = type; return this; },
                    getContent: function () { return this.text; }
                };
            }
        },

        HtmlService: {
            XFrameOptionsMode: { ALLOWALL: 'ALLOWALL', DEFAULT: 'DEFAULT' },
            createHtmlOutput: function (html) {
                const output = {
                    html: String(html),
                    title: '',
                    xframe: null,
                    setTitle: function (value) { this.title = value; return this; },
                    setXFrameOptionsMode: function (mode) { this.xframe = mode; return this; },
                    getContent: function () { return this.html; }
                };
                state.html.push(output);
                return output;
            }
        }
    };

    vm.createContext(sandbox);
    vm.runInContext(fs.readFileSync(AUTH_PATH, 'utf8'), sandbox, { filename: 'Auth.gs' });

    return {
        sandbox: sandbox,
        state: state,
        /** Runs doGet and returns the raw output object. */
        get: function (params) { return sandbox.doGet({ parameter: params || {} }); },
        /** Runs doGet and parses a JSON reply. */
        json: function (params) {
            const output = this.get(params);
            try { return JSON.parse(output.text); } catch (e) { return output.text; }
        },
        /** Runs doGet and unwraps a JSONP reply. */
        jsonp: function (params, callback) {
            const name = callback || 'cb';
            const output = this.get(Object.assign({ callback: name }, params || {}));
            const match = /^[^(]*\(([\s\S]*)\);?$/.exec(output.text);
            return match ? JSON.parse(match[1]) : null;
        },
        /** Runs doGet and returns the rendered HTML page. */
        html: function (params) {
            const output = this.get(params);
            return output.getContent ? output.getContent() : output.text;
        }
    };
}

module.exports = {
    loadCode: loadCode,
    loadAuth: loadAuth,
    CODE_PATH: CODE_PATH,
    AUTH_PATH: AUTH_PATH
};

