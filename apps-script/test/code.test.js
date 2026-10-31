/**
 * Behavioural tests for apps-script/Code.gs.
 * Run: node apps-script/test/code.test.js
 *
 * Code.gs is executed through apps-script/test/appsscript-stub.js (a tiny
 * Apps Script stand-in) using payloads shaped like the ones each page on the
 * site really sends – including the legacy id-only names that v1 rejected.
 */
const assert = require('assert');
const { loadCode } = require('./appsscript-stub');

const TOKEN = '32bb90901d4b2c3323c1bb87cb08940f341040813634abc0';
const base = { token: TOKEN, page: 'test.html' };
let checks = 0;
const results = [];

function eq(actual, expected, message) {
  checks++;
  assert.deepStrictEqual(actual, expected, message + ' (got ' + JSON.stringify(actual) + ')');
}
function ok(value, message) { checks++; assert.ok(value, message); }
function row(svc, index) {
  const headers = svc.sheet().rows[0].map(h => String(h));
  const values = svc.sheet().rows[index];
  const out = {};
  headers.forEach((h, i) => { out[h] = values[i] === undefined ? '' : values[i]; });
  return out;
}
function test(name, fn) {
  try { fn(); results.push('PASS  ' + name); }
  catch (err) { results.push('FAIL  ' + name + ' :: ' + err.message); }
}

/* ---------------------------------------------------------------- */

test('health check reports v3', () => {
  const health = loadCode().doGet();
  eq(health.ok, true, 'ok');
  eq(health.version, 3, 'version');
});

test('v1 sheet is migrated in place, old rows kept', () => {
  const v1 = ['Timestamp', 'Reference', 'Form', 'Name', 'Email', 'Phone',
              'Company', 'Message', 'Page', 'Payload JSON'];
  const svc = loadCode({ Leads: [v1, ['2026-10-30', 'ORD-261030-1111', 'Order', 'Old Lead',
                             'old@example.com', '0710000000', 'Old Co', 'hi', 'x.html', '{}']] });
  const res = svc.doPost(Object.assign({}, base, {
    id: 'migrate-1', formType: 'Director Session', directorName: 'New Lead',
    directorEmail: 'new@example.com', directorIdea: 'Hello'
  }));
  eq(res.ok, true, 'accepted');
  const headers = svc.sheet().rows[0].map(String);
  ok(headers.indexOf('Status') !== -1, 'Status column added');
  ok(headers.indexOf('Service / Interest') !== -1, 'Service column added');
  ok(headers.indexOf('Source ID') !== -1, 'Source ID column added');
  eq(row(svc, 1)['Name'], 'Old Lead', 'old row untouched');
  eq(row(svc, 1)['Reference'], 'ORD-261030-1111', 'old reference untouched');
  eq(row(svc, 2)['Name'], 'New Lead', 'new row name');
  eq(row(svc, 2)['Status'], 'New', 'status default');
  eq(row(svc, 2)['Source ID'], 'migrate-1', 'source id');
  ok(svc.sheet().validation, 'status dropdown installed');
});

test('business-partners director form (id-only field names)', () => {
  const svc = loadCode();
  const res = svc.doPost(Object.assign({}, base, {
    id: 'dir-1', formType: 'Director Session', directorName: 'Thabo Mokoena',
    directorEmail: 'thabo@example.co.za', directorPhone: '0721234567',
    directorIdea: 'I want to start a cross-border logistics company',
    sessionDate: '2026-11-20', sessionTime: '09:00 \u2013 10:00'
  }));
  eq(res.ok, true, 'accepted');
  const r = row(svc, 1);
  eq(r['Name'], 'Thabo Mokoena', 'name');
  eq(r['Email'], 'thabo@example.co.za', 'email');
  eq(r['Phone'], '0721234567', 'phone');
  eq(r['Message'], 'I want to start a cross-border logistics company', 'message');
  eq(r['Preferred Date'], '2026-11-20', 'preferred date');
  eq(r['Form'], 'Director Session', 'form');
  eq(r['Reference'].slice(0, 4), 'DIR-', 'reference prefix');
});

test('strategic-growth questionnaire (business* names + checkbox arrays)', () => {
  const svc = loadCode();
  const res = svc.doPost(Object.assign({}, base, {
    id: 'growth-1', formType: 'Growth Consultation', businessName: 'Lindi Traders',
    businessEmail: 'lindi@example.co.za', businessPhone: '0821112222',
    turnover: 'R1m \u2013 R5m', employees: '12',
    'Which areas of your business need strategic intervention? (tick all that apply)':
      ['Diversification', 'Scaling Operations'],
    painPoints: 'Stock control is manual', growthGoals: 'Open a second branch',
    appointmentDate: '2026-12-01', appointmentTime: '10:00 \u2013 11:00'
  }));
  eq(res.ok, true, 'accepted');
  const r = row(svc, 1);
  eq(r['Name'], 'Lindi Traders', 'name');
  eq(r['Email'], 'lindi@example.co.za', 'email');
  eq(r['Message'], 'Stock control is manual', 'pain points become the message');
  eq(r['Preferred Date'], '2026-12-01', 'preferred date');
  ok(String(r['Payload JSON']).indexOf('Scaling Operations') !== -1, 'checkbox answers kept');
  const mail = svc.mail[0];
  ok(mail.body.indexOf('Scaling Operations') !== -1, 'checkbox answers in team email');
  eq(mail.replyTo, 'lindi@example.co.za', 'team email replies to the lead');
});

test('liquor + spaza forms (placeholder-only fields, no name/id)', () => {
  const svc = loadCode();
  const liquor = svc.doPost(Object.assign({}, base, {
    id: 'liq-1', formType: 'Liquor Licence',
    fields: {
      'Full name': 'Lindi Nkosi', 'Phone number': '0821112222',
      'Email address': 'lindi@example.co.za',
      'What type of licence do you need?': 'tavern',
      'Tell me about your business (location, type, size)': 'Tavern in Soweto, 6 staff'
    }
  }));
  eq(liquor.ok, true, 'accepted');
  const r = row(svc, 1);
  eq(r['Name'], 'Lindi Nkosi', 'name');
  eq(r['Email'], 'lindi@example.co.za', 'email');
  eq(r['Phone'], '0821112222', 'phone');
  eq(r['Service / Interest'], 'tavern', 'licence type lands in Service');
  eq(r['Message'], 'Tavern in Soweto, 6 staff', 'textarea lands in Message');

  const spaza = svc.doPost(Object.assign({}, base, {
    id: 'spz-1', formType: 'Spaza Compliance',
    fields: {
      'Full name': 'Sipho Dlamini', 'Phone number': '083 555 1212',
      'Tell me about your spaza shop (location, current documents, urgent needs)': 'Alexandra, needs zoning'
    }
  }));
  eq(spaza.ok, true, 'accepted without email');
  const s = row(svc, 2);
  eq(s['Name'], 'Sipho Dlamini', 'name');
  eq(s['Email'], '', 'email optional');
  eq(s['Message'], 'Alexandra, needs zoning', 'message');
  eq(svc.mail.length, 3, 'two emails for the liquor lead, one for the spaza lead');
  eq(svc.mail[1].to, 'lindi@example.co.za', 'liquor customer receipt');
  eq(svc.mail[2].to, 'mv.malusii@gmail.com', 'spaza: team only, no receipt');
});

test('order-documents payload (legacy rich keys)', () => {
  const svc = loadCode();
  const res = svc.doPost(Object.assign({}, base, {
    id: 'ord-1', formType: 'Order', name: 'Kabelo M', email: 'kabelo@example.co.za',
    phone: '0729998888', company: 'Kabelo Builders', companyType: 'Pty Ltd',
    proposedNames: ['Kabelo Trading', 'KM Projects'], includeFDS: true,
    includeRoadmap: true, industryForDocs: 'Construction', bundle: 'startup',
    personalServices: ['UIF Application', 'Artist Profile'], advancedDocs: [],
    total: 'R2 550', notes: 'Need it before month end', page: 'order-documents.html'
  }));
  eq(res.ok, true, 'accepted');
  const r = row(svc, 1);
  eq(r['Name'], 'Kabelo M', 'name');
  eq(r['Email'], 'kabelo@example.co.za', 'email');
  eq(r['Company'], 'Kabelo Builders', 'company');
  eq(r['Industry'], 'Construction', 'industry');
  eq(r['Amount'], 'R2 550', 'amount');
  eq(r['Service / Interest'], 'startup', 'bundle');
  eq(r['Message'], 'Need it before month end', 'notes');
  ok(String(r['Payload JSON']).indexOf('Kabelo Trading') !== -1, 'proposed names kept');
  eq(svc.mail[0].replyTo, 'kabelo@example.co.za', 'reply-to lead');
  eq(svc.mail[1].to, 'kabelo@example.co.za', 'customer receipt sent');
});

test('spam + validation guards still hold', () => {
  const svc = loadCode();
  const honeypot = svc.doPost(Object.assign({}, base, { id: 'hp-1', name: 'Bot', _hp: 'gotcha' }));
  eq(honeypot.ok, true, 'honeypot pretends success');
  eq(svc.sheet() ? svc.sheet().rows.length : 0, 0, 'honeypot writes nothing');

  const badToken = svc.doPost({ token: 'nope', id: 'tok-1', name: 'X', email: 'x@y.co.za' });
  eq(badToken.ok, false, 'bad token rejected');
  eq(badToken.error, 'unauthorised', 'unauthorised error');

  const empty = svc.doPost(Object.assign({}, base, { id: 'empty-1', formType: 'General' }));
  eq(empty.ok, false, 'empty payload rejected');
  ok(/contact details/.test(empty.error), 'clear error message');

  const badEmail = svc.doPost(Object.assign({}, base, { id: 'bad-1', name: 'Ann', email: 'not-an-email' }));
  eq(badEmail.error, 'valid email required', 'bad email rejected');
});

test('duplicate submits are idempotent and email is throttled', () => {
  const svc = loadCode();
  const payload = Object.assign({}, base, { id: 'dupe-1', name: 'Ann Smith', email: 'ann@example.co.za' });
  eq(svc.doPost(payload).ok, true, 'first accepted');
  const dupe = svc.doPost(payload);
  eq(dupe.duplicate, true, 'duplicate detected');
  eq(svc.sheet().rows.length, 2, 'only the header + one lead row');

  for (let i = 0; i < 4; i++) {
    eq(svc.doPost({ token: TOKEN, id: 'thr-' + i, name: 'Ann Smith', email: 'ann@example.co.za' }).ok, true, 'within throttle');
  }
  const throttled = svc.doPost({ token: TOKEN, id: 'thr-9', name: 'Ann Smith', email: 'ann@example.co.za' });
  eq(throttled.ok, false, 'sixth submission blocked');
  eq(throttled.error, 'too many submissions', 'throttle error');
});

test('owner helpers: sendTestLead + migrateSheet', () => {
  const svc = loadCode();
  const reference = svc.run('sendTestLead');
  ok(/^TES-\d{6}-\d{4}$/.test(reference), 'reference format: ' + reference);
  const r = row(svc, 1);
  eq(r['Email'], 'mv.malusii@gmail.com', 'test lead uses canonical email, not businessEmail');
  eq(r['Amount'], 'R1 750', 'amount picked up');
  ok(Array.isArray(svc.run('migrateSheet')), 'migrateSheet returns headers');
});

/* ---------------------------------------------------------------- */

const failures = results.filter(line => line.indexOf('FAIL') === 0);
results.forEach(line => console.log(line));
console.log('\n' + results.length + ' tests, ' + checks + ' assertions, ' + failures.length + ' failures');
if (failures.length) { failures.forEach(f => console.log(f)); process.exit(1); }
console.log('ALL TESTS PASSED');
