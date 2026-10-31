/**
 * Profile-page UI test: app.js handlers -> auth.js -> Code.gs, with profile.html's
 * real element ids. Proves the tabs, sign-up, sign-in, account panel, password
 * change and sign-out actually talk to the backend.
 * Run: node apps-script/test/profile-ui.test.js
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { loadCode } = require('./appsscript-stub');

const ROOT = path.join(__dirname, '..', '..');
const ENDPOINT = 'https://script.google.com/macros/s/AKfycbzM082roGPD0iDJy8XgmSdFATcPS8Ma5b2Y7XtAAEiO/exec';
const TOKEN = '32bb90901d4b2c3323c1bb87cb08940f341040813634abc0';

let checks = 0;
const results = [];
async function test(name, fn) {
  try { await fn(); results.push('PASS  ' + name); }
  catch (err) { results.push('FAIL  ' + name + ' :: ' + err.message); }
}
function eq(actual, expected, message) {
  checks++;
  assert.deepStrictEqual(actual, expected, message + ' (got ' + JSON.stringify(actual) + ')');
}
function ok(value, message) { checks++; assert.ok(value, message); }

/* --------------------------- fake DOM ---------------------------- */

function classList(node) {
  const set = new Set();
  return {
    add: c => set.add(c),
    remove: c => set.delete(c),
    contains: c => set.has(c),
    toggle: (c, force) => {
      const on = force === undefined ? !set.has(c) : !!force;
      if (on) { set.add(c); } else { set.delete(c); }
      return on;
    },
    _set: set
  };
}

function makeDom() {
  const ids = {};
  const body = create('body');
  const listeners = {};

  function create(tag) {
    const node = {
      tagName: tag.toUpperCase(),
      children: [],
      _listeners: {},
      classList: classList(),
      dataset: {},
      style: {},
      attrs: {},
      value: '',
      checked: false,
      disabled: false,
      textContent: '',
      innerHTML: '',
      parentNode: null,
      addEventListener(type, fn) { (this._listeners[type] = this._listeners[type] || []).push(fn); },
      removeEventListener(type, fn) {
        this._listeners[type] = (this._listeners[type] || []).filter(f => f !== fn);
      },
      dispatch(type, event) {
        (this._listeners[type] || []).forEach(fn => fn(Object.assign({ target: this, preventDefault() {} }, event || {})));
      },
      appendChild(child) { this.children.push(child); child.parentNode = this; return child; },
      removeChild(child) { this.children = this.children.filter(c => c !== child); child.parentNode = null; },
      setAttribute(key, value) { this.attrs[key] = value; },
      getAttribute(key) { return this.attrs[key] === undefined ? null : this.attrs[key]; },
      hasAttribute(key) { return key in this.attrs; },
      removeAttribute(key) { delete this.attrs[key]; },
      querySelector(selector) {
        if (selector === 'button[type="submit"]') {
          return this.children.find(c => c.tagName === 'BUTTON') || null;
        }
        return null;
      },
      querySelectorAll() { return []; },
      closest() { return null; },
      contains() { return false; },
      reset() { this.value = ''; },
      submit() {}
    };
    Object.defineProperty(node, 'src', {
      get() { return this._src || ''; },
      set(value) { this._src = value; setTimeout(() => this.dispatch('load'), 0); }
    });
    Object.defineProperty(node, 'id', {
      get() { return this._id || ''; },
      set(value) { this._id = value; ids[value] = this; }
    });
    return node;
  }

  const document = {
    readyState: 'complete',
    body,
    head: create('head'),
    getElementById: id => ids[id] || null,
    createElement: create,
    addEventListener(type, fn) { (listeners[type] = listeners[type] || []).push(fn); },
    dispatchEvent(event) { (listeners[event.type] || []).forEach(fn => fn(event)); return true; },
    querySelectorAll: () => []
  };

  return { document, body, ids, create, listeners };
}

function buildProfilePage() {
  const dom = makeDom();
  const { document, ids } = dom;

  ['loginTab', 'signupTab', 'loginForm', 'signupForm', 'authForms', 'accountPanel',
   'forgotPanel', 'loginEmail', 'loginPassword', 'loginRemember', 'loginMessage',
   'signupName', 'signupEmail', 'signupPhone', 'signupCompany', 'signupPassword',
   'signupConfirmPassword', 'signupMessage', 'forgotEmail', 'forgotMessage',
   'accountName', 'accountEmail', 'accountMeta', 'accountFullName', 'accountPhone',
   'accountCompany', 'accountProfileMessage', 'accountCurrentPassword',
   'accountNewPassword', 'accountPasswordMessage', 'accountSignOutBtn',
   'googleLoginBtn', 'forgotPasswordLink', 'backToLoginLink'
  ].forEach(id => { document.createElement('div').id = id; });
  ids.loginTab.classList.add('active');          // class="tab-btn active" in profile.html

  ['loginFormElement', 'signupFormElement', 'forgotPasswordForm',
   'accountProfileForm', 'accountPasswordForm'].forEach(id => {
    const form = document.createElement('form');
    form.id = id;
    const button = document.createElement('button');
    button.tagName = 'BUTTON';
    form.appendChild(button);
    dom.body.appendChild(form);
  });

  return dom;
}

function makeStorage() {
  const data = new Map();
  return {
    getItem: k => (data.has(k) ? data.get(k) : null),
    setItem: (k, v) => data.set(k, String(v)),
    removeItem: k => data.delete(k),
    clear: () => data.clear()
  };
}

function loadPage(svc, storage) {
  const dom = buildProfilePage();
  const messageHandlers = [];
  const requested = [];

  // Transport: a form submit inside the hidden iframe calls the web app.
  dom.ids.loginFormElement.submit = () => {};
  const window = {
    NEON_LEADS: { endpoint: ENDPOINT, token: TOKEN },
    localStorage: storage || makeStorage(),
    sessionStorage: makeStorage(),
    location: { pathname: '/profile.html', search: '', href: 'profile.html' },
    addEventListener: (type, fn) => { if (type === 'message') { messageHandlers.push(fn); } },
    alert: () => {}
  };

  const sandbox = {
    window, document: dom.document, console, JSON, Date, Math, String, Number, Object,
    Array, Promise, RegExp, Error, setTimeout, clearTimeout, encodeURIComponent,
    decodeURIComponent, location: window.location, alert: window.alert,
    localStorage: window.localStorage, sessionStorage: window.sessionStorage,
    CustomEvent: class CustomEvent { constructor(type, init) { this.type = type; this.detail = (init || {}).detail; } }
  };
  sandbox.window.window = sandbox;
  sandbox.window.document = dom.document;
  sandbox.window.NEON_AUTH = null;
  vm.createContext(sandbox);

  // app.js first (defines NEON_LEADS), then auth.js.
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8'), sandbox, { filename: 'app.js' });
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'auth.js'), 'utf8'), sandbox, { filename: 'auth.js' });

  // Every form created by auth.js posts through the web app.
  const originalCreate = dom.document.createElement;
  dom.document.createElement = tag => {
    const node = originalCreate(tag);
    if (tag === 'form') {
      node.submit = () => {
        const fields = {};
        node.children.forEach(child => { if (child.tagName === 'INPUT' && child.name) { fields[child.name] = child.value; } });
        requested.push(fields.action);
        const response = svc.postRaw(fields);
        const match = /postMessage\((\{.*?\}), '\*'\)/.exec(response.body);
        if (!match) { throw new Error('no postMessage reply'); }
        const message = JSON.parse(match[1].replace(/\\u003c/g, '<'));
        messageHandlers.forEach(fn => fn({ origin: 'https://script.google.com', data: JSON.stringify(message) }));
      };
    }
    return node;
  };

  // Fire DOMContentLoaded so app.js wires the profile handlers.
  dom.document.readyState = 'complete';
  (dom.listeners.DOMContentLoaded || []).forEach(fn => fn());

  return { dom, sandbox, window, requested, ids: dom.ids };
}

async function tick() {
  for (let i = 0; i < 6; i++) { await new Promise(resolve => setTimeout(resolve, 0)); }
}

/* ----------------------------- tests ----------------------------- */

(async function run() {
  await test('the page boots with the sign-in form and no account panel', async () => {
    const page = loadPage(loadCode());
    ok(page.ids.loginTab.classList.contains('active'), 'login tab active');
    ok(page.ids.accountPanel.classList.contains('hidden'), 'account panel hidden');
    ok(!page.ids.authForms.classList.contains('hidden'), 'auth forms visible');
  });

  await test('sign-up validates, creates the account and shows the panel', async () => {
    const page = loadPage(loadCode());
    const form = page.ids.signupFormElement;

    page.ids.signupName.value = 'Lindi Nkosi';
    page.ids.signupEmail.value = 'lindi@example.co.za';
    page.ids.signupPhone.value = '0821112222';
    page.ids.signupCompany.value = 'Nkosi Trading';
    page.ids.signupPassword.value = 'weak';
    page.ids.signupConfirmPassword.value = 'weak';
    form.dispatch('submit');
    await tick();
    ok(/at least 8 characters/.test(page.ids.signupMessage.innerHTML), 'weak password explained before sending');
    eq(page.requested.length, 0, 'nothing sent yet');

    page.ids.signupPassword.value = 'StrongPass1';
    page.ids.signupConfirmPassword.value = 'Different1';
    form.dispatch('submit');
    await tick();
    ok(/do not match/.test(page.ids.signupMessage.innerHTML), 'mismatch caught locally');

    page.ids.signupConfirmPassword.value = 'StrongPass1';
    form.dispatch('submit');
    await tick();
    eq(page.requested[0], 'signup', 'signup posted to the backend');
    ok(page.window.NEON_AUTH.isLoggedIn(), 'signed in after sign-up');
    ok(page.ids.accountPanel.classList.contains('hidden') === false, 'account panel shown');
    ok(page.ids.authForms.classList.contains('hidden'), 'auth forms hidden');
    eq(page.ids.accountName.textContent, 'Lindi Nkosi', 'name rendered');
    eq(page.ids.accountEmail.textContent, 'lindi@example.co.za', 'email rendered');
    ok(/Nkosi Trading/.test(page.ids.accountMeta.textContent), 'company shown');
  });

  await test('sign-in with a wrong password explains itself and stays signed out', async () => {
    const svc = loadCode();
    const setup = loadPage(svc);
    setup.ids.signupName.value = 'Lindi Nkosi';
    setup.ids.signupEmail.value = 'lindi@example.co.za';
    setup.ids.signupPassword.value = 'StrongPass1';
    setup.ids.signupConfirmPassword.value = 'StrongPass1';
    setup.ids.signupFormElement.dispatch('submit');
    await tick();
    await setup.window.NEON_AUTH.logout();

    const page = loadPage(svc);
    page.ids.loginEmail.value = 'lindi@example.co.za';
    page.ids.loginPassword.value = 'WrongPass1';
    page.ids.loginFormElement.dispatch('submit');
    await tick();
    ok(/incorrect/.test(page.ids.loginMessage.innerHTML), 'error shown');
    eq(page.window.NEON_AUTH.isLoggedIn(), false, 'still signed out');

    page.ids.loginPassword.value = 'StrongPass1';
    page.ids.loginFormElement.dispatch('submit');
    await tick();
    ok(page.window.NEON_AUTH.isLoggedIn(), 'signed in');
    ok(!page.ids.accountPanel.classList.contains('hidden'), 'panel visible after sign-in');
  });

  await test('editing details and changing the password work from the panel', async () => {
    const page = loadPage(loadCode());
    page.ids.signupName.value = 'Lindi Nkosi';
    page.ids.signupEmail.value = 'lindi@example.co.za';
    page.ids.signupPassword.value = 'StrongPass1';
    page.ids.signupConfirmPassword.value = 'StrongPass1';
    page.ids.signupFormElement.dispatch('submit');
    await tick();

    page.ids.accountFullName.value = 'Lindi M Nkosi';
    page.ids.accountPhone.value = '083 999 0000';
    page.ids.accountCompany.value = 'Nkosi Holdings';
    page.ids.accountProfileForm.dispatch('submit');
    await tick();
    ok(/saved/.test(page.ids.accountProfileMessage.innerHTML), 'details saved');
    eq(page.window.NEON_AUTH.user().company, 'Nkosi Holdings', 'cache updated');

    page.ids.accountCurrentPassword.value = 'Nope1234';
    page.ids.accountNewPassword.value = 'BrandNew2';
    page.ids.accountPasswordForm.dispatch('submit');
    await tick();
    ok(/incorrect/.test(page.ids.accountPasswordMessage.innerHTML), 'wrong current password reported');

    page.ids.accountCurrentPassword.value = 'StrongPass1';
    page.ids.accountPasswordForm.dispatch('submit');
    await tick();
    ok(/updated/.test(page.ids.accountPasswordMessage.innerHTML), 'password changed');
    ok(page.window.NEON_AUTH.isLoggedIn(), 'new session still valid');
  });

  await test('forgot-password form asks the backend for a reset link', async () => {
    const svc = loadCode();
    const page = loadPage(svc);
    page.ids.signupName.value = 'Lindi Nkosi';
    page.ids.signupEmail.value = 'lindi@example.co.za';
    page.ids.signupPassword.value = 'StrongPass1';
    page.ids.signupConfirmPassword.value = 'StrongPass1';
    page.ids.signupFormElement.dispatch('submit');
    await tick();
    await page.window.NEON_AUTH.logout();

    page.ids.forgotPasswordLink.dispatch('click');
    ok(!page.ids.forgotPanel.classList.contains('hidden'), 'forgot panel opens');
    page.ids.forgotEmail.value = 'lindi@example.co.za';
    page.ids.forgotPasswordForm.dispatch('submit');
    await tick();
    ok(/on its way|reset link/i.test(page.ids.forgotMessage.innerHTML), 'neutral confirmation shown');
    eq(svc.mail.filter(m => /Reset your/.test(m.subject)).length, 1, 'reset email sent');
  });

  await test('sign-out button ends the session', async () => {
    const page = loadPage(loadCode());
    page.ids.signupName.value = 'Lindi Nkosi';
    page.ids.signupEmail.value = 'lindi@example.co.za';
    page.ids.signupPassword.value = 'StrongPass1';
    page.ids.signupConfirmPassword.value = 'StrongPass1';
    page.ids.signupFormElement.dispatch('submit');
    await tick();
    ok(page.window.NEON_AUTH.isLoggedIn(), 'signed in');

    page.ids.accountSignOutBtn.dispatch('click');
    await tick();
    await tick();
    eq(page.window.NEON_AUTH.isLoggedIn(), false, 'signed out');
    eq(page.window.location.href, 'logout.html', 'redirected to the signed-out page');
  });

  const failures = results.filter(line => line.indexOf('FAIL') === 0);
  results.forEach(line => console.log(line));
  console.log('\n' + results.length + ' tests, ' + checks + ' assertions, ' + failures.length + ' failures');
  if (failures.length) { process.exit(1); }
  console.log('ALL TESTS PASSED');
})();
