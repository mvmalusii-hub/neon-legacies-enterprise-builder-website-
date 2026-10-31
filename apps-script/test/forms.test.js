// Run: node apps-script/test/forms.test.js
// Exercises Code.gs doPost (with Apps Script service mocks) using a payload
// shaped like each form on the site, via the real app.js collect/normalize.
const vm = require('vm'), fs = require('fs'), path = require('path'), assert = require('assert');
const root = path.join(__dirname, '..', '..');

const rows = [], mails = [], store = {};
const ctx = {
  console,
  ContentService: { MimeType: { JSON: 'json' }, createTextOutput: t => ({ t, setMimeType() { return this; } }) },
  CacheService: { getScriptCache: () => ({ get: k => store[k] || null, put: (k, v) => { store[k] = v; } }) },
  Utilities: { getUuid: () => 'uuid-' + Math.random(), formatDate: () => '261030' },
  MailApp: { sendEmail: m => mails.push(m) },
  SpreadsheetApp: { getActiveSpreadsheet: () => ({ getSheetByName: () => ({ appendRow: r => rows.push(r) }) }) }
};
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(root, 'apps-script/Code.gs'), 'utf8'), ctx);
vm.runInContext("CONFIG.SHARED_TOKEN='tok'", ctx);

// app.js in a minimal fake browser
const win = {}; const noop = () => {};
const el = (o) => Object.assign({ tagName: 'INPUT', type: 'text', name: '', id: '', value: '', placeholder: '' }, o);
vm.runInNewContext(fs.readFileSync(path.join(root, 'app.js'), 'utf8'), {
  window: win, location: { pathname: '/x.html' }, localStorage: { getItem: () => null, setItem: noop },
  document: { addEventListener: noop, getElementById: () => null, querySelector: () => null, querySelectorAll: () => [] }
}, { filename: 'app.js' });
const L = win.NEON_LEADS;

const forms = {
  orderForm: ['Order', [el({ id: 'fullName', value: 'A B' }), el({ id: 'email', value: 'a@b.co' }), el({ id: 'phone', value: '1' })]],
  hireAdminForm: ['Hire Admin', [el({ id: 'companyName', value: 'Co' }), el({ id: 'email', value: 'a@b.co' }), el({ id: 'notes', value: 'hi' })]],
  growthForm: ['Growth Consultation', [el({ id: 'businessName', value: 'Co' }), el({ id: 'businessEmail', value: 'a@b.co' }), el({ id: 'growthGoals', value: 'g' })]],
  directorSessionForm: ['Director Session', [el({ id: 'directorName', value: 'D' }), el({ id: 'directorEmail', value: 'd@b.co' })]],
  partnerApplicationForm: ['Partner Application', [el({ id: 'partnerCompanyName', value: 'P' }), el({ id: 'partnerWebsite', value: 'x' })]],
  registerCompanyForm: ['Market Lead Company', [el({ id: 'regCompanyName', value: 'R' }), el({ id: 'regServices', value: 's' })]],
  signupFormElement: ['Account Signup', [el({ id: 'signupName', value: 'S' }), el({ id: 'signupEmail', value: 's@b.co' }), el({ id: 'signupPassword', type: 'password', value: 'secret' })]],
  liquorForm: ['Liquor Licence', [el({ placeholder: 'Full name', value: 'L' }), el({ placeholder: 'Phone number', value: '082' }), el({ placeholder: 'Email address', value: '' }), el({ placeholder: 'Tell me about your business', tagName: 'TEXTAREA', value: 'bar' })]],
  complianceForm: ['Spaza Compliance', [el({ placeholder: 'Full name', value: 'Z' }), el({ placeholder: 'Phone number', value: '083' }), el({ placeholder: 'Email address', value: 'z@b.co' })]]
};

let n = 0;
Object.keys(forms).forEach(id => {
  const [type, elements] = forms[id];
  const form = { id, dataset: {}, elements };
  assert.strictEqual(L.formName(form), type, id + ' type');
  const p = L.normalize(L.collect(form));
  p.formType = type; p.token = 'tok'; p.id = 'id-' + id;
  if (type !== 'Partner Application' && type !== 'Market Lead Company') {
    // these two forms are login-gated and have no contact fields on the page
  }
  const before = rows.length;
  const r = JSON.parse(ctx.doPost({ postData: { contents: JSON.stringify(p) } }).t);
  if (false) {
    console.log('note:', type, '->', r.error || 'ok', '(no contact on form)');
    return;
  }
  assert.ok(r.ok, id + ' failed: ' + JSON.stringify(r));
  assert.strictEqual(rows.length, before + 1, id + ' row');
  assert.ok(!('signupPassword' in p), 'password leaked');
  n++; console.log('ok', id);
});
// auth + honeypot + duplicate
assert.strictEqual(JSON.parse(ctx.doPost({ postData: { contents: JSON.stringify({ name: 'x', email: 'a@b.co', token: 'bad' }) } }).t).error, 'unauthorised');
const c = rows.length;
ctx.doPost({ postData: { contents: JSON.stringify({ _hp: 'bot', token: 'tok' }) } });
assert.strictEqual(rows.length, c);
console.log(n + ' forms passed');
