'use strict';
/**
 * A very small DOM, just enough to run the real auth.js and app.js in
 * Node. It is deliberately dumb: ids are looked up in a registry, and
 * assigning innerHTML registers any id="..." it contains so that code
 * like document.getElementById('signOutBtn') works after a render.
 */
const vm = require('vm');

function makeElement(tagName, doc) {
    const el = {
        tagName: String(tagName || 'div').toUpperCase(),
        _classes: [],
        _attrs: {},
        _html: '',
        style: {},
        dataset: {},
        value: '',
        checked: false,
        files: [],
        textContent: '',
        children: [],
        parentNode: null,
        _listeners: {}
    };

    function syncClasses() {
        el._attrs['class'] = el._classes.join(' ');
    }

    Object.defineProperty(el, 'className', {
        get: function () { return el._classes.join(' '); },
        set: function (value) {
            el._classes = String(value || '').split(/\s+/).filter(Boolean);
            syncClasses();
        }
    });

    Object.defineProperty(el, 'innerHTML', {
        get: function () { return el._html; },
        set: function (html) {
            el._html = String(html);
            el.children = [];
            // Register every element the markup declares, by id and class.
            const pattern = /<(\w+)([^>]*)>/g;
            let match;
            while ((match = pattern.exec(el._html)) !== null) {
                const attrs = match[2] || '';
                const child = makeElement(match[1], doc);
                const idMatch = /\bid="([^"]+)"/.exec(attrs);
                const classMatch = /\bclass="([^"]+)"/.exec(attrs);
                if (classMatch) { child.className = classMatch[1]; }
                if (idMatch) {
                    child.id = idMatch[1];
                    child._attrs.id = idMatch[1];
                    doc._byId.set(child.id, child);
                }
                child.parentNode = el;
                el.children.push(child);
                doc._all.push(child);
            }
        }
    });

    el.classList = {
        add: function (name) {
            if (el._classes.indexOf(name) === -1) { el._classes.push(name); }
            syncClasses();
        },
        remove: function (name) {
            el._classes = el._classes.filter(function (c) { return c !== name; });
            syncClasses();
        },
        contains: function (name) { return el._classes.indexOf(name) !== -1; },
        toggle: function (name, force) {
            const wanted = force === undefined ? !el.classList.contains(name) : !!force;
            if (wanted) { el.classList.add(name); } else { el.classList.remove(name); }
            return wanted;
        }
    };

    Object.defineProperty(el, 'id', {
        configurable: true,
        get: function () { return el._attrs.id || ''; },
        set: function (value) {
            el._attrs.id = String(value);
            if (value) { doc._byId.set(String(value), el); }
        }
    });

    el.addEventListener = function (type, fn) {
        (el._listeners[type] = el._listeners[type] || []).push(fn);
    };
    el.removeEventListener = function (type, fn) {
        el._listeners[type] = (el._listeners[type] || []).filter(function (f) { return f !== fn; });
    };
    el.dispatch = function (type, event) {
        const evt = event || {};
        evt.type = type;
        evt.target = evt.target || el;
        evt.preventDefault = evt.preventDefault || function () {};
        evt.stopPropagation = evt.stopPropagation || function () {};
        (el._listeners[type] || []).slice().forEach(function (fn) { fn(evt); });
        return evt;
    };
    el.click = function () { return el.dispatch('click'); };
    el.submit = function () { return el.dispatch('submit'); };
    el.appendChild = function (child) {
        child.parentNode = el;
        el.children.push(child);
        doc._all.push(child);
        return child;
    };
    el.removeChild = function (child) {
        el.children = el.children.filter(function (c) { return c !== child; });
        child.parentNode = null;
        return child;
    };
    el.contains = function (other) {
        return el === other || el.children.some(function (c) { return c.contains(other); });
    };
    el.setAttribute = function (key, value) {
        if (key === 'id') { el.id = value; return; }
        if (key === 'class') { el.className = value; return; }
        el._attrs[key] = String(value);
    };
    el.getAttribute = function (key) {
        return Object.prototype.hasOwnProperty.call(el._attrs, key) ? el._attrs[key] : null;
    };
    el.select = function () {};
    el.focus = function () {};
    el.remove = function () { if (el.parentNode) { el.parentNode.removeChild(el); } };
    el.querySelector = function (sel) { return queryAll(sel, doc, el)[0] || null; };
    el.querySelectorAll = function (sel) { return queryAll(sel, doc, el); };

    doc._all.push(el);
    return el;
}

function queryAll(selector, doc, scope) {
    const sel = String(selector || '').trim();
    const pool = (scope ? collect(scope) : doc._all).slice();
    if (!sel) { return []; }
    if (sel.charAt(0) === '#') {
        const el = doc._byId.get(sel.slice(1));
        return el ? [el] : [];
    }
    if (sel.charAt(0) === '.') {
        const name = sel.slice(1);
        return pool.filter(function (el) { return el.classList.contains(name); });
    }
    const attr = /^\[([^\]=]+)\]$/.exec(sel);
    if (attr) {
        const key = attr[1];
        return pool.filter(function (el) {
            if (key.indexOf('data-') === 0) {
                const camel = key.slice(5).replace(/-(\w)/g, function (m, c) { return c.toUpperCase(); });
                return Object.prototype.hasOwnProperty.call(el.dataset, camel);
            }
            return el.getAttribute(key) !== null;
        });
    }
    const tag = sel.toUpperCase();
    return pool.filter(function (el) { return el.tagName === tag; });
}

function collect(root) {
    const out = [];
    (function walk(el) {
        el.children.forEach(function (child) { out.push(child); walk(child); });
    })(root);
    return out;
}

function makeDocument() {
    const doc = {
        readyState: 'loading',
        _byId: new Map(),
        _all: [],
        _listeners: {},
        title: ''
    };
    doc.getElementById = function (id) { return doc._byId.get(String(id)) || null; };
    doc.createElement = function (tag) { return makeElement(tag, doc); };
    doc.querySelector = function (sel) { return queryAll(sel, doc)[0] || null; };
    doc.querySelectorAll = function (sel) { return queryAll(sel, doc); };
    doc.addEventListener = function (type, fn) {
        (doc._listeners[type] = doc._listeners[type] || []).push(fn);
    };
    doc.removeEventListener = function (type, fn) {
        doc._listeners[type] = (doc._listeners[type] || []).filter(function (f) { return f !== fn; });
    };
    doc.fireDomReady = function () {
        doc.readyState = 'interactive';
        (doc._listeners.DOMContentLoaded || []).slice().forEach(function (fn) { fn({}); });
    };
    doc.execCommand = function () { return true; };
    Object.defineProperty(doc, 'forms', {
        configurable: true,
        get: function () { return queryAll('form', doc); }
    });
    doc.head = makeElement('head', doc);
    doc.body = makeElement('body', doc);
    doc.documentElement = makeElement('html', doc);
    return doc;
}

/** Adds an element (with id/class) to the document body. */
function addElement(doc, tag, id, className) {
    const el = doc.createElement(tag || 'div');
    if (id) { el.id = id; }
    if (className) { el.className = className; }
    doc.body.appendChild(el);
    return el;
}

/** A stand-in for Google Identity Services (accounts.google.com/gsi/client). */
function makeGoogleMock(doc, state) {
    state = state || {};
    state.initializeCalls = 0;
    state.rendered = [];
    state.promptCalls = 0;
    state.autoSelectDisabled = 0;
    return {
        _state: state,
        accounts: {
            id: {
                initialize: function (config) {
                    state.initializeCalls += 1;
                    state.config = config;
                },
                renderButton: function (container, options) {
                    const button = doc.createElement('div');
                    button.id = 'gsiRenderedButton';
                    button.className = 'gsi-button';
                    container.appendChild(button);
                    state.rendered.push({ container: container, options: options });
                },
                prompt: function (callback) {
                    state.promptCalls += 1;
                    if (typeof callback === 'function') {
                        callback({
                            isSkippedMoment: function () { return !!state.skipPrompt; },
                            isNotDisplayed: function () { return false; },
                            getNotDisplayedReason: function () { return 'test'; }
                        });
                    }
                },
                disableAutoSelect: function () { state.autoSelectDisabled += 1; }
            }
        }
    };
}

/** window + localStorage + fetch, wired to the given document. */
function makeWindow(doc, options) {
    options = options || {};
    const store = new Map();
    const sessionStore = new Map();

    function storage(map) {
        return {
            getItem: function (key) { return map.has(String(key)) ? map.get(String(key)) : null; },
            setItem: function (key, value) { map.set(String(key), String(value)); },
            removeItem: function (key) { map.delete(String(key)); },
            clear: function () { map.clear(); },
            key: function (i) { return Array.from(map.keys())[i] || null; },
            get length() { return map.size; },
            _map: map
        };
    }

    const win = {
        document: doc,
        alerts: [],
        fetchCalls: [],
        location: {
            pathname: options.pathname || '/profile.html',
            href: '',
            replace: function (url) { win.location.href = url; },
            assign: function (url) { win.location.href = url; }
        },
        navigator: { userAgent: 'node-dom-stub', clipboard: null },
        atob: function (value) { return Buffer.from(String(value), 'base64').toString('binary'); },
        btoa: function (value) { return Buffer.from(String(value), 'binary').toString('base64'); },
        TextDecoder: TextDecoder,
        Uint8Array: Uint8Array,
        alert: function (message) { win.alerts.push(String(message)); },
        confirm: function () { return true; },
        setTimeout: setTimeout,
        clearTimeout: clearTimeout,
        setInterval: setInterval,
        clearInterval: clearInterval,
        google: options.google || null
    };

    win.localStorage = storage(store);
    win.sessionStorage = storage(sessionStore);

    win.fetch = options.fetch || function (url, opts) {
        win.fetchCalls.push({ url: String(url), opts: opts || {} });
        return Promise.resolve({
            ok: false,
            status: 404,
            json: function () { return Promise.resolve({}); }
        });
    };

    win.window = win;
    win.self = win;
    win.globalThis = win;
    return win;
}

/** Runs a site script (auth.js / app.js) against the fake window. */
function loadScript(win, file) {
    const fs = require('fs');
    const path = require('path');
    if (!win._context) { vm.createContext(win); win._context = true; }
    const source = fs.readFileSync(path.resolve(__dirname, '..', '..', file), 'utf8');
    vm.runInContext(source, win, { filename: file });
    return win;
}

module.exports = {
    makeDocument: makeDocument,
    makeElement: makeElement,
    addElement: addElement,
    makeWindow: makeWindow,
    makeGoogleMock: makeGoogleMock,
    loadScript: loadScript
};
