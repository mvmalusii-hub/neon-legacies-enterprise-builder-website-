/**
 * End-to-end tests for auth.js: the real browser module, running against the
 * real Code.gs, with a fake DOM standing in for the iframe transport.
 * Run: node apps-script/test/auth-client.test.js
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { loadCode } = require('./appsscript-stub');

const ENDPOINT = 'https://script.google.com/macros/s/AKfycbzM082roGPD0iDJy8XgmSdFATcPS8Ma5b2Y7XtAAEiO/exec';
const TOKEN = '32bb90901d4b2c3323c1bb87cb08940f341040813634abc0';
const AUTH_SRC = fs.readFileSync(path.join(__dirname, '..', '..', 'auth.js'), 'utf8');

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

/* ------------------------ fake browser --------------------------- */

function makeStorage() {
  const data = new Map();
  return {
    data,
    getItem: k => (data.has(k) ? data.get(k) : null),
    setItem: (k, v) => data.set(k, String(v)),
    removeItem: k => data.delete(k),
    clear: () => data.clear()
  };
}

function createPage(options) {
  const opts = options || {};
  const svc = opts.svc || loadCode();
  const localStorage = opts.localStorage || makeStorage();
  const sessionStorage = opts.sessionStorage || makeStorage();
  const elements = {};
  const messageHandlers = [];
  const documentHandlers = {};
  const transportLog = [];

  const document = {
    readyState: 'complete',
    body: null,
    getElementById: id => elements[id] || null,
    createElement: tag => makeElement(tag, document, transportLog),
    addEventListener: (type, fn) => { (documentHandlers[type] = documentHandlers[type] || []).push(fn); },
    dispatchEvent: event => {
      (documentHandlers[event.type] || []).forEach(fn => fn(event));
      return true;
    },
    querySelectorAll: () => []
  };
  document.body = makeElement('body', document, transportLog);

  const window = {
    NEON_LEADS: { endpoint: opts.endpoint === undefined ? ENDPOINT : opts.endpoint, token: TOKEN },
    localStorage,
    sessionStorage,
    addEventListener: (type, fn) => { if (type === 'message') { messageHandlers.push(fn); } },
    location: { pathname: '/profile.html', href: 'profile.html' }
  };
  window.window = window;
  window.document = document;
  window.CustomEvent = class CustomEvent {
    constructor(type, init) { this.type = type; this.detail = (init || {}).detail; }
  };

  // A form submit posts to the web app; its HTML reply is postMessage'd back.
  function onFormSubmit(form) {
    const fields = {};
    form.children.forEach(child => {
      if (child.tagName === 'INPUT' && child.name) { fields[child.name] = child.value; }
    });
    transportLog.push(fields.action);
    const response = svc.postEncoded(fields);
    const match = /postMessage\((\{.*?\}), '\*'\)/.exec(response.body);
    if (!match) { throw new Error('no postMessage in reply'); }
    const message = JSON.parse(match[1].replace(/\\u003c/g, '<'));
    if (message.neonAuth !== fields.requestId) {
      throw new Error('requestId was not echoed back');
    }
    const event = { origin: 'https://script.google.com', data: JSON.stringify(message) };
    messageHandlers.forEach(fn => fn(event));
  }

  function makeElement(tag, doc, log) {
    const el = {
      tagName: tag.toUpperCase(),
      children: [],
      listeners: {},
      style: {},
      attrs: {},
      value: '',
      type: '',
      name: '',
      appendChild(child) { this.children.push(child); child.parentNode = this; return child; },
      removeChild(child) { this.children = this.children.filter(c => c !== child); child.parentNode = null; },
      addEventListener(type, fn) { (this.listeners[type] = this.listeners[type] || []).push(fn); },
      setAttribute(key, value) { this.attrs[key] = value; },
      submit() {
        if (tag === 'form') { onFormSubmit(this); }
      },
      _fire(type) { (this.listeners[type] || []).forEach(fn => fn()); }
    };
    Object.defineProperty(el, 'id', {
      get() { return this._id || ''; },
      set(value) { this._id = value; elements[value] = this; }
    });
    Object.defineProperty(el, 'src', {
      get() { return this._src || ''; },
      set(value) {
        this._src = value;
        setTimeout(() => el._fire('load'), 0);   // iframe finished loading
      }
    });
    return el;
  }

  const sandbox = {
    window, document, console, JSON, Date, Math, String, Number, Object, Array,
    Promise, RegExp, Error, setTimeout, clearTimeout, encodeURIComponent, decodeURIComponent
  };
  vm.createContext(sandbox);
  vm.runInContext(AUTH_SRC, sandbox, { filename: 'auth.js' });

  return {
    auth: window.NEON_AUTH,
    svc,
    localStorage,
    sessionStorage,
    transportLog,
    location: window.location,
    document
  };
}

function storedAuth(page) {
  const raw = page.localStorage.getItem('neonAuth');
  return raw ? JSON.parse(raw) : null;
}

/* ----------------------------- tests ----------------------------- */

(async function run() {
  await test('signup signs the visitor in and persists the session', async () => {
    const page = createPage();
    const res = await page.auth.signup({
      name: 'Lindi Nkosi', email: 'lindi@example.co.za', phone: '0821112222',
      company: 'Nkosi Trading', password: 'StrongPass1'
    });
    eq(res.ok, true, 'signup ok');
    eq(page.auth.isLoggedIn(), true, 'logged in straight away');
    eq(page.auth.user().email, 'lindi@example.co.za', 'cached user');
    const stored = storedAuth(page);
    ok(stored && stored.token, 'session token stored');
    eq(stored.user.company, 'Nkosi Trading', 'user cached with the token');
    eq(page.transportLog[0], 'signup', 'posted through the iframe transport');
    eq(page.svc.sheet('Users').rows.length, 2, 'server has the user row');
  });

  await test('a new page load restores the session from storage and validates it', async () => {
    const svc = loadCode();
    const first = createPage({ svc });
    await first.auth.signup({ name: 'Lindi Nkosi', email: 'lindi@example.co.za', password: 'StrongPass1' });

    const second = createPage({ svc, localStorage: first.localStorage });
    const user = await second.auth.init();
    eq(user.email, 'lindi@example.co.za', 'session survives a reload');
    eq(second.auth.isLoggedIn(), true, 'still signed in');
  });

  await test('stale stored session is dropped when the server says no', async () => {
    const svc = loadCode();
    const first = createPage({ svc });
    await first.auth.signup({ name: 'Lindi Nkosi', email: 'lindi@example.co.za', password: 'StrongPass1' });
    await first.auth.logout();

    const second = createPage({ svc, localStorage: first.localStorage });
    second.localStorage.setItem('neonAuth', JSON.stringify({ token: 'deadbeef', user: { email: 'x@y.z' }, savedAt: Date.now() }));
    const user = await second.auth.init();
    eq(user, null, 'no user');
    eq(second.auth.isLoggedIn(), false, 'signed out locally');
    eq(storedAuth(second), null, 'storage cleared');
  });

  await test('login, wrong password and logout', async () => {
    const svc = loadCode();
    const setup = createPage({ svc });
    await setup.auth.signup({ name: 'Lindi Nkosi', email: 'lindi@example.co.za', password: 'StrongPass1' });
    await setup.auth.logout();

    const page = createPage({ svc });
    const bad = await page.auth.login({ email: 'lindi@example.co.za', password: 'WrongPass1' });
    eq(bad.ok, false, 'wrong password refused');
    eq(page.auth.isLoggedIn(), false, 'still signed out');

    const good = await page.auth.login({ email: 'lindi@example.co.za', password: 'StrongPass1' });
    eq(good.ok, true, 'login ok');
    eq(page.auth.isLoggedIn(), true, 'signed in');

    await page.auth.logout();
    eq(page.auth.isLoggedIn(), false, 'signed out');
    eq(storedAuth(page), null, 'storage empty');
    const sessions = page.svc.sheet('Sessions').rows.length;
    eq(sessions, 1, 'only the header row is left');
  });

  await test('profile update and password change flow through the API', async () => {
    const page = createPage();
    await page.auth.signup({ name: 'Lindi Nkosi', email: 'lindi@example.co.za', password: 'StrongPass1' });

    const updated = await page.auth.updateProfile({ name: 'Lindi M Nkosi', phone: '083 999 0000', company: 'Nkosi Holdings' });
    eq(updated.ok, true, 'profile updated');
    eq(page.auth.user().name, 'Lindi M Nkosi', 'cache updated');

    const wrong = await page.auth.changePassword({ currentPassword: 'Nope1234', newPassword: 'BrandNew2' });
    eq(wrong.ok, false, 'wrong current password refused');

    const changed = await page.auth.changePassword({ currentPassword: 'StrongPass1', newPassword: 'BrandNew2' });
    eq(changed.ok, true, 'password changed');
    eq(page.auth.isLoggedIn(), true, 'still signed in with the new token');

    const after = await page.auth.refresh();
    eq(after.email, 'lindi@example.co.za', 'new session validates');
    const relogin = await page.auth.login({ email: 'lindi@example.co.za', password: 'BrandNew2' });
    eq(relogin.ok, true, 'new password works');
  });

  await test('password reset from the browser side', async () => {
    const svc = loadCode();
    const page = createPage({ svc });
    await page.auth.signup({ name: 'Lindi Nkosi', email: 'lindi@example.co.za', password: 'StrongPass1' });
    await page.auth.logout();

    const asked = await page.auth.requestReset('lindi@example.co.za');
    eq(asked.ok, true, 'reset requested');
    const mail = svc.mail.filter(m => /Reset your/.test(m.subject))[0];
    const token = /token=([a-f0-9]+)/.exec(mail.body)[1];

    const reset = await page.auth.resetPassword({ email: 'lindi@example.co.za', resetToken: token, newPassword: 'Another123' });
    eq(reset.ok, true, 'reset accepted');
    const login = await page.auth.login({ email: 'lindi@example.co.za', password: 'Another123' });
    eq(login.ok, true, 'new password works in the browser');
  });

  await test('submitLead returns the server reference and stores the lead', async () => {
    const page = createPage();
    const res = await page.auth.submitLead({
      id: 'lead-transport-1', formType: 'Liquor Licence',
      name: 'Lindi Nkosi', phone: '0821112222', email: 'lindi@example.co.za',
      fields: { 'What type of licence do you need?': 'tavern' }
    });
    eq(res.ok, true, 'accepted');
    ok(/^LIQ-\d{6}-\d{4}$/.test(res.reference), 'reference returned: ' + res.reference);

    const sheets = page.svc.sheets;
    const rows = sheets.Leads.rows;
    eq(rows.length, 2, 'header + one lead');
    const headers = rows[0].map(String);
    const lead = {};
    headers.forEach((h, i) => { lead[h] = rows[1][i]; });
    eq(lead.Name, 'Lindi Nkosi', 'name');
    eq(lead.Phone, '0821112222', 'phone');
    eq(lead['Service / Interest'], 'tavern', 'label map decoded server-side');
    eq(page.transportLog[0], 'lead', 'went through the readable transport');
  });

  await test('remember=false uses sessionStorage, not localStorage', async () => {
    const page = createPage();
    await page.auth.signup({ name: 'Lindi Nkosi', email: 'lindi@example.co.za', password: 'StrongPass1', remember: false });
    eq(storedAuth(page), null, 'nothing in localStorage');
    ok(page.sessionStorage.getItem('neonAuth'), 'session kept for this tab only');
  });

  await test('missing endpoint fails politely instead of throwing', async () => {
    const page = createPage({ endpoint: '' });
    const res = await page.auth.login({ email: 'a@b.co', password: 'x' });
    eq(res.ok, false, 'rejected');
    ok(/not connected/i.test(res.error), 'clear message');
    eq(page.auth.isLoggedIn(), false, 'not signed in');
  });

  await test('listeners hear about sign-in and sign-out', async () => {
    const page = createPage();
    const seen = [];
    page.auth.onChange(user => seen.push(user ? user.email : null));
    await page.auth.signup({ name: 'Lindi Nkosi', email: 'lindi@example.co.za', password: 'StrongPass1' });
    await page.auth.logout();
    ok(seen.indexOf('lindi@example.co.za') !== -1, 'sign-in reported');
    eq(seen[seen.length - 1], null, 'sign-out reported');
  });

  const failures = results.filter(line => line.indexOf('FAIL') === 0);
  results.forEach(line => console.log(line));
  console.log('\n' + results.length + ' tests, ' + checks + ' assertions, ' + failures.length + ' failures');
  if (failures.length) { process.exit(1); }
  console.log('ALL TESTS PASSED');
})();
