/**
 * Static wiring checks: every page that gates on a login must load the account
 * client, and the profile page must expose the ids app.js binds to.
 * Run: node apps-script/test/wiring.test.js
 */
const assert = require('assert');
const vm = require('vm');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..', '..');
let checks = 0;
const results = [];
function ok(value, message) { checks++; assert.ok(value, message); }
function test(name, fn) {
  try { fn(); results.push('PASS  ' + name); }
  catch (err) { results.push('FAIL  ' + name + ' :: ' + err.message); }
}
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const pages = fs.readdirSync(root).filter(f => f.endsWith('.html'));

/* ------------------------------------------------------------------ */

test('every gated page loads auth.js after app.js', () => {
  const gated = pages.filter(page => /login-warning/.test(read(page)));
  ok(gated.length >= 6, 'found the gated pages (' + gated.length + ')');
  gated.forEach(page => {
    const html = read(page);
    ok(html.indexOf('src="auth.js"') !== -1, page + ' loads auth.js');
    ok(html.indexOf('src="app.js"') < html.indexOf('src="auth.js"'), page + ' loads app.js first');
  });
});

test('profile page exposes everything app.js binds to', () => {
  const html = read('profile.html');
  ['loginFormElement', 'signupFormElement', 'accountPanel', 'accountProfileForm',
   'accountPasswordForm', 'accountSignOutBtn', 'forgotPasswordForm',
   'forgotPasswordLink', 'loginRemember', 'signupCompany', 'accountName',
   'accountEmail', 'accountMeta', 'accountFullName', 'accountPhone', 'accountCompany'
  ].forEach(id => ok(html.indexOf('id="' + id + '"') !== -1, 'profile.html has #' + id));
  ok(/<form id="signupFormElement" data-no-lead="true">/.test(html), 'signup does not double-post as a lead');
  ok(html.indexOf('src="auth.js"') !== -1, 'profile loads auth.js');
});

test('account pages load the client', () => {
  ['logout.html', 'reset.html'].forEach(page => {
    ok(read(page).indexOf('src="auth.js"') !== -1, page + ' loads auth.js');
  });
  ok(read('reset.html').indexOf('src="reset.js"') !== -1, 'reset.html loads reset.js');
});

test('no page still pretends the visitor is logged out', () => {
  const app = read('app.js');
  ok(app.indexOf('let isLoggedIn = false') === -1, 'app.js has no hard-coded login flag');
  ok(app.indexOf('Login successful (demo)') === -1, 'app.js has no demo login message');
  ok(app.indexOf('Backend will be connected soon') === -1, 'app.js no longer promises a backend later');
  ok(app.indexOf('window.NEON_AUTH.isLoggedIn()') !== -1, 'app.js asks the real session');
});

test('logout page ends the server session, not just local storage', () => {
  const html = read('logout.html');
  ok(/NEON_AUTH\.logout\(\)/.test(html), 'calls NEON_AUTH.logout()');
  ok(html.indexOf("'neonAuth'") !== -1, 'clears the cached session key too');
});

test('app.js boots on pages that have none of its elements', () => {
  const listeners = {};
  const node = () => ({
    style: {}, classList: { add() {}, remove() {}, toggle() {} },
    addEventListener() {}, appendChild() {}, setAttribute() {},
    getAttribute() { return null; }, querySelector() { return null; },
    querySelectorAll() { return []; }
  });
  const bareDocument = {
    readyState: 'complete', body: node(), head: node(),
    addEventListener: (type, fn) => { (listeners[type] = listeners[type] || []).push(fn); },
    removeEventListener() {}, appendChild() {}, createElement: node,
    getElementById: () => null, querySelector: () => null, querySelectorAll: () => []
  };
  const sandbox = {
    window: {}, document: bareDocument, console, JSON, Date, Math, String, Number,
    Object, Array, Promise, RegExp, Error, setTimeout, clearTimeout,
    location: { pathname: '/logout.html', search: '', href: '' },
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    sessionStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    alert() {}, fetch: () => Promise.resolve()
  };
  sandbox.window = sandbox;
  sandbox.window.document = bareDocument;
  vm.createContext(sandbox);
  vm.runInContext(read('app.js'), sandbox, { filename: 'app.js' });
  (listeners.DOMContentLoaded || []).forEach(fn => fn());
  ok(true, 'no exception while booting');
});

const failures = results.filter(line => line.indexOf('FAIL') === 0);
results.forEach(line => console.log(line));
console.log('\n' + results.length + ' tests, ' + checks + ' assertions, ' + failures.length + ' failures');
if (failures.length) { process.exit(1); }
console.log('ALL WIRING CHECKS PASSED');
