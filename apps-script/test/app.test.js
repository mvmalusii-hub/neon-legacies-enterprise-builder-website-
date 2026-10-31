/**
 * Behavioural tests for the site-wide form hook in app.js.
 * Run: node apps-script/test/app.test.js
 *
 * A very small fake DOM stands in for the browser, with the field layouts of the
 * real pages, and every captured payload is then POSTed into the real Code.gs
 * (via the Apps Script stub) to prove a submission reaches the sheet with the
 * Name / Email / Phone columns filled.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { loadCode } = require('./appsscript-stub');

let checks = 0;
const results = [];
function eq(actual, expected, message) {
  checks++;
  assert.deepStrictEqual(actual, expected, message + ' (got ' + JSON.stringify(actual) + ')');
}
function ok(value, message) { checks++; assert.ok(value, message); }
function test(name, fn) {
  try { fn(); results.push('PASS  ' + name); }
  catch (err) { results.push('FAIL  ' + name + ' :: ' + err.message); }
}

/* ------------------------- fake DOM ------------------------------ */

function makeElement(spec, form) {
  const el = {
    tagName: (spec.tag || 'INPUT').toUpperCase(),
    type: spec.type || 'text',
    id: spec.id || '',
    name: spec.name || '',
    value: spec.value === undefined ? '' : spec.value,
    checked: !!spec.checked,
    options: spec.options || [],
    form: form,
    getAttribute: attr => {
      if (attr === 'placeholder') { return spec.placeholder || ''; }
      if (attr === 'aria-label') { return spec.ariaLabel || ''; }
      return null;
    },
    closest: selector => {
      if (!spec.group && !spec.label) { return null; }
      if (selector === 'label') { return spec.label ? { textContent: spec.label } : null; }
      return {
        querySelector: sel => {
          if (sel === 'legend') { return null; }
          if (sel.indexOf('label') === 0 && spec.group) {
            return { textContent: spec.group, contains: () => false };
          }
          return null;
        }
      };
    }
  };
  return el;
}

function makeForm(id, specs) {
  const form = { id: id, tagName: 'FORM', dataset: {}, elements: [] };
  form.elements = specs.map(spec => makeElement(spec, form));
  form.querySelector = selector => {
    const match = /^label\[for="(.+)"\]$/.exec(selector);
    if (!match) { return null; }
    const spec = specs.find(s => s.id === match[1] && s.label);
    return spec ? { textContent: spec.label } : null;
  };
  return form;
}

function loadApp(options) {
  const opts = options || {};
  const sent = [];
  const stored = {};
  const docListeners = {};
  const sandbox = {
    console, JSON, Date, Math, String, Number, Object, Array, Promise, RegExp, Error,
    setTimeout,
    window: {},
    location: { pathname: '/strategic-growth.html' },
    localStorage: {
      getItem: k => (k in stored ? stored[k] : null),
      setItem: (k, v) => { stored[k] = String(v); },
      removeItem: k => { delete stored[k]; }
    },
    fetch: (url, options) => { sent.push(JSON.parse(options.body)); return Promise.resolve(); },
    document: {
      addEventListener: (type, fn) => { (docListeners[type] = docListeners[type] || []).push(fn); },
      querySelectorAll: () => []
    }
  };
  if (opts.user || opts.submitLead) {
    sandbox.NEON_AUTH = {
      isLoggedIn: () => !!opts.user,
      user: () => (opts.user ? Object.assign({}, opts.user) : null)
    };
    if (opts.submitLead) { sandbox.NEON_AUTH.submitLead = opts.submitLead; }
  }
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', '..', 'app.js'), 'utf8'), sandbox, { filename: 'app.js' });
  return {
    leads: sandbox.window.NEON_LEADS,
    sent,
    stored,
    submitEvent: form => {
      const handlers = docListeners.submit || [];
      let allowed = true;
      handlers.forEach(fn => fn({ target: form, preventDefault() { allowed = false; } }));
      return allowed;
    }
  };
}

function payloadFor(id, specs) {
  const app = loadApp();
  const form = makeForm(id, specs);
  const collected = app.leads.collect(form);
  const lead = app.leads.normalise(collected.values, collected.fields);
  app.leads.submit(form);
  return { app, form, collected, lead, sent: app.sent };
}

function sheetRow(payload) {
  const svc = loadCode();
  const res = svc.doPost(payload);
  const headers = svc.sheet().rows[0].map(String);
  const values = svc.sheet().rows[1] || [];
  const out = { res };
  headers.forEach((h, i) => { out[h] = values[i] === undefined ? '' : values[i]; });
  return out;
}

/* ------------------------- page fixtures ------------------------- */

const directorForm = [
  { id: 'directorName', label: 'Your name / Company name', value: 'Thabo Mokoena' },
  { id: 'directorEmail', type: 'email', label: 'Email address', value: 'thabo@example.co.za' },
  { id: 'directorPhone', type: 'tel', label: 'Phone number', value: '0721234567' },
  { id: 'directorIdea', tag: 'textarea', label: 'Brief description of your business / venture idea', value: 'Cross-border logistics' },
  { id: 'sessionDate', type: 'date', label: 'Preferred date (sessions are at least 14 days in advance)', value: '2026-11-20' },
  { id: 'sessionTime', tag: 'select', label: 'Preferred time (SAST)', value: '09:00 \u2013 10:00' },
  { type: 'submit', value: 'Send' }
];

const liquorForm = [
  { placeholder: 'Full name', value: 'Lindi Nkosi' },
  { type: 'tel', placeholder: 'Phone number', value: '0821112222' },
  { type: 'email', placeholder: 'Email address', value: 'lindi@example.co.za' },
  { tag: 'select',
    options: [{ value: '', textContent: 'What type of licence do you need?' },
              { value: 'tavern', textContent: 'Tavern / Shebeen' }],
    value: 'tavern' },
  { tag: 'textarea', placeholder: 'Tell me about your business (location, type, size)', value: 'Tavern in Soweto' },
  { type: 'submit', value: 'Send' }
];

const growthForm = [
  { id: 'businessName', label: 'Your name / Company name', value: 'Lindi Traders' },
  { id: 'businessEmail', type: 'email', label: 'Email address', value: 'lindi@example.co.za' },
  { id: 'businessPhone', type: 'tel', label: 'Phone number', value: '0821112222' },
  { type: 'checkbox', value: 'Diversification', checked: true, label: 'Diversification',
    group: 'Which areas of your business need strategic intervention? (tick all that apply)' },
  { type: 'checkbox', value: 'Scaling Operations', checked: true, label: 'Scaling Operations',
    group: 'Which areas of your business need strategic intervention? (tick all that apply)' },
  { type: 'checkbox', value: 'Mass Production', checked: false, label: 'Mass Production',
    group: 'Which areas of your business need strategic intervention? (tick all that apply)' },
  { id: 'turnover', tag: 'select', label: 'Current annual turnover (approx.)', value: 'R1m \u2013 R5m' },
  { id: 'employees', type: 'number', label: 'Number of employees', value: '12' },
  { id: 'painPoints', tag: 'textarea', label: 'What are your biggest operational pain points?', value: 'Stock control is manual' },
  { id: 'growthGoals', tag: 'textarea', label: 'What specific growth goals do you have for the next 12 months?', value: 'Open a second branch' },
  { id: 'growthFile', type: 'file', label: 'Upload supporting documents' },
  { id: 'appointmentDate', type: 'date', label: 'Preferred date (sessions are scheduled at least 7 days in advance)', value: '2026-12-01' },
  { id: 'appointmentTime', tag: 'select', label: 'Preferred time (SAST)', value: '10:00 \u2013 11:00' },
  { type: 'submit', value: 'Send' }
];

const hireAdminForm = [
  { id: 'companyName', label: 'Your name / Company name', value: 'Bright Admin Co' },
  { id: 'email', type: 'email', label: 'Email address', value: 'owner@bright.co.za' },
  { id: 'phone', type: 'tel', label: 'Phone number', value: '0734445555' },
  { type: 'radio', name: 'contractLength', value: '2 years', checked: true, label: '2 Years Contract' },
  { id: 'staffCount', type: 'number', label: 'Number of admin staff required', value: '3' },
  { id: 'workArrangement', tag: 'select', label: 'Work arrangement', value: 'hybrid' },
  { type: 'checkbox', value: 'Compliance Filing', checked: true, label: 'Compliance Filing',
    group: 'Services Required' },
  { type: 'checkbox', value: 'Bookkeeping', checked: true, label: 'Bookkeeping',
    group: 'Services Required' },
  { id: 'hasTeam', tag: 'select', label: 'Do you currently have an internal admin team?', value: 'partial' },
  { id: 'startDate', type: 'date', label: 'When do you need the service to start?', value: '2026-11-05' },
  { id: 'notes', tag: 'textarea', label: 'Additional notes / special requirements', value: 'We use Google Drive' },
  { id: 'uploadFile', type: 'file', label: 'Upload existing filing structure or policies' }
];

const signupForm = [
  { id: 'signupName', label: 'Full name', value: 'Naledi Khumalo' },
  { id: 'signupEmail', type: 'email', label: 'Email address', value: 'naledi@example.co.za' },
  { id: 'signupPhone', type: 'tel', label: 'Phone number', value: '072 152 3293' },
  { id: 'signupPassword', type: 'password', label: 'Create password', value: 'sup3rSecret!' },
  { id: 'signupConfirmPassword', type: 'password', label: 'Confirm password', value: 'sup3rSecret!' }
];

/* ----------------------------- tests ----------------------------- */

test('director session form maps id-only fields to name/email/phone/message', () => {
  const out = payloadFor('directorSessionForm', directorForm);
  eq(out.lead.name, 'Thabo Mokoena', 'name');
  eq(out.lead.email, 'thabo@example.co.za', 'email');
  eq(out.lead.phone, '0721234567', 'phone');
  eq(out.lead.message, 'Cross-border logistics', 'message');
  eq(out.lead.preferredDate, '2026-11-20', 'preferred date');
  eq(out.sent.length, 1, 'exactly one POST');
  eq(out.sent[0].formType, 'Director Session', 'form type');
  eq(out.sent[0].page, 'strategic-growth.html', 'page name');

  const r = sheetRow(out.sent[0]);
  eq(r.res.ok, true, 'server accepted the payload');
  eq(r['Name'], 'Thabo Mokoena', 'sheet name');
  eq(r['Email'], 'thabo@example.co.za', 'sheet email');
  eq(r['Preferred Date'], '2026-11-20', 'sheet preferred date');
});

test('liquor form (placeholders only) is captured, not dropped', () => {
  const out = payloadFor('liquorForm', liquorForm);
  eq(out.lead.name, 'Lindi Nkosi', 'name');
  eq(out.lead.email, 'lindi@example.co.za', 'email');
  eq(out.lead.phone, '0821112222', 'phone');
  eq(out.lead.service, 'tavern', 'licence type as service');
  eq(out.lead.message, 'Tavern in Soweto', 'message');
  ok(out.collected.fields['What type of licence do you need?'] === 'tavern', 'select prompt used as label');

  const r = sheetRow(out.sent[0]);
  eq(r.res.ok, true, 'server accepted');
  eq(r['Name'], 'Lindi Nkosi', 'sheet name');
  eq(r['Service / Interest'], 'tavern', 'sheet service');
});

test('growth questionnaire keeps checkbox groups and long answers', () => {
  const out = payloadFor('growthForm', growthForm);
  eq(out.lead.name, 'Lindi Traders', 'name');
  eq(out.lead.email, 'lindi@example.co.za', 'email');
  eq(out.lead.message, 'Stock control is manual', 'message');
  eq(out.lead.preferredDate, '2026-12-01', 'preferred date');
  ok(!('growthFile' in out.collected.values), 'file inputs skipped');

  const question = 'Which areas of your business need strategic intervention? (tick all that apply)';
  eq(JSON.stringify(out.collected.values[question]), JSON.stringify(['Diversification', 'Scaling Operations']), 'checked answers only');
  eq(out.collected.fields[question], 'Diversification, Scaling Operations', 'readable answer');

  const r = sheetRow(out.sent[0]);
  eq(r.res.ok, true, 'server accepted');
  ok(String(r['Payload JSON']).indexOf('Scaling Operations') !== -1, 'answers survive in the sheet');
});

test('hire-admin form keeps radios, staff count, dates and services', () => {
  const out = payloadFor('hireAdminForm', hireAdminForm);
  eq(out.lead.name, 'Bright Admin Co', 'name / company');
  eq(out.lead.email, 'owner@bright.co.za', 'email');
  eq(out.lead.phone, '0734445555', 'phone');
  eq(out.lead.message, 'We use Google Drive', 'notes');
  eq(out.lead.preferredDate, '2026-11-05', 'start date');
  eq(out.collected.values.contractLength, '2 years', 'radio value');
  eq(out.collected.fields['Services Required'], 'Compliance Filing, Bookkeeping', 'checkbox group');
  ok(!('uploadFile' in out.collected.values), 'resume/file input skipped');

  const r = sheetRow(out.sent[0]);
  eq(r.res.ok, true, 'server accepted');
  eq(r['Phone'], '0734445555', 'sheet phone');
});

test('signup form never sends passwords', () => {
  const out = payloadFor('signupFormElement', signupForm);
  eq(out.lead.name, 'Naledi Khumalo', 'name');
  eq(out.lead.email, 'naledi@example.co.za', 'email');
  const body = JSON.stringify(out.sent[0]);
  ok(body.indexOf('sup3rSecret') === -1, 'passwords stripped');
  ok(body.toLowerCase().indexOf('password') === -1, 'password fields absent');
});

test('a form with no contact details is not posted', () => {
  const app = loadApp();
  const form = makeForm('complianceForm', [{ placeholder: 'Full name', value: '' }]);
  app.leads.submit(form);
  eq(app.sent.length, 0, 'nothing sent');
});

test('gated forms only become leads for signed-in visitors', () => {
  const signedOut = loadApp();
  const form = makeForm('growthForm', growthForm);
  form.dataset.requiresAuth = 'true';
  signedOut.submitEvent(form);
  eq(signedOut.sent.length, 0, 'nothing captured while signed out');

  const signedIn = loadApp({ user: { id: 'USR-1', name: 'Lindi Nkosi', email: 'lindi@example.co.za', phone: '0821112222', company: 'Nkosi Trading' } });
  signedIn.submitEvent(form);
  eq(signedIn.sent.length, 1, 'captured once signed in');
  eq(signedIn.sent[0].accountId, 'USR-1', 'payload carries the account id');
  eq(signedIn.sent[0].accountEmail, 'lindi@example.co.za', 'payload carries the account email');
  eq(signedIn.sent[0].name, 'Lindi Traders', 'typed values win over the account');
});

/* -------------------- transport preference ------------------------ */

function asyncTest(name, fn) {
  return Promise.resolve().then(fn).then(
    () => { results.push('PASS  ' + name); },
    err => { results.push('FAIL  ' + name + ' :: ' + err.message); }
  );
}

(async function run() {
  await asyncTest('leads go through the readable transport when it is available', async () => {
    const app = loadApp({ submitLead: () => Promise.resolve({ ok: true, reference: 'HIR-261031-1234' }) });
    const form = makeForm('hireAdminForm', hireAdminForm);
    const res = await app.leads.submit(form);
    eq(res.reference, 'HIR-261031-1234', 'server reference handed back');
    eq(app.sent.length, 0, 'no blind no-cors fetch');
    eq(app.stored.neonLeadQueue, undefined, 'nothing queued when accepted');
  });

  await asyncTest('a lead the server never answered is queued instead of lost', async () => {
    const app = loadApp({ submitLead: () => Promise.resolve({ ok: false, network: true }) });
    const form = makeForm('growthForm', growthForm);
    await app.leads.submit(form);
    const queue = JSON.parse(app.stored.neonLeadQueue || '[]');
    eq(queue.length, 1, 'payload kept for the next visit');
    eq(queue[0].formType, 'Growth Consultation', 'the right form');
  });

  await asyncTest('without the transport it falls back to the old POST', async () => {
    const app = loadApp();
    const form = makeForm('growthForm', growthForm);
    await app.leads.submit(form);
    eq(app.sent.length, 1, 'legacy no-cors POST still works');
  });

  const failures = results.filter(line => line.indexOf('FAIL') === 0);
  results.forEach(line => console.log(line));
  console.log('\n' + results.length + ' tests, ' + checks + ' assertions, ' + failures.length + ' failures');
  if (failures.length) { process.exit(1); }
  console.log('ALL TESTS PASSED');
})();
