/**
 * Behavioural tests for the account system in Code.gs (v3).
 * Run: node apps-script/test/accounts.test.js
 */
const assert = require('assert');
const { loadCode } = require('./appsscript-stub');

const TOKEN = '32bb90901d4b2c3323c1bb87cb08940f341040813634abc0';
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
function rows(svc, name) {
  const sheet = svc.sheet(name);
  if (!sheet || !sheet.rows.length) { return []; }
  const headers = sheet.rows[0].map(String);
  return sheet.rows.slice(1).map(line => {
    const out = {};
    headers.forEach((h, i) => { out[h] = line[i] === undefined ? '' : line[i]; });
    return out;
  });
}
function signup(svc, overrides) {
  return svc.auth('signup', Object.assign({
    token: TOKEN, name: 'Lindi Nkosi', email: 'lindi@example.co.za',
    phone: '0821112222', company: 'Nkosi Trading', password: 'StrongPass1'
  }, overrides || {}));
}

/* ------------------------------------------------------------------ */

test('signup creates a user, a session, a lead row and a welcome email', () => {
  const svc = loadCode();
  const res = signup(svc);
  eq(res.ok, true, 'signup accepted');
  ok(/^[a-f0-9]{64}$/.test(res.token), 'token is 64 hex chars');
  eq(res.user.email, 'lindi@example.co.za', 'user email');
  eq(res.user.name, 'Lindi Nkosi', 'user name');
  eq(res.user.role, 'client', 'default role');
  ok(!('Hash' in res.user) && !('Salt' in res.user), 'never returns salt/hash');

  const users = rows(svc, 'Users');
  eq(users.length, 1, 'one user row');
  eq(users[0].Email, 'lindi@example.co.za', 'email stored lower-case');
  eq(users[0].Status, 'active', 'active by default');
  ok(users[0].Salt.length >= 32, 'salt stored');
  ok(users[0].Hash.length === 64, 'hash stored');
  ok(JSON.stringify(users[0]).indexOf('StrongPass1') === -1, 'no plaintext password anywhere');

  const sessions = rows(svc, 'Sessions');
  eq(sessions.length, 1, 'one session row');
  ok(sessions[0]['Token Hash'] !== res.token, 'session stores a hash, not the token');

  const leads = rows(svc, 'Leads');
  eq(leads.length, 1, 'account signup recorded as a lead');
  eq(leads[0]['Form'], 'Account Signup', 'lead form label');

  eq(svc.mail.length, 2, 'team notification + welcome email');
  eq(svc.mail[1].to, 'lindi@example.co.za', 'welcome email recipient');
});

test('duplicate and weak signups are refused without side effects', () => {
  const svc = loadCode();
  eq(signup(svc).ok, true, 'first signup');
  const dupe = signup(svc, { email: 'LINDI@example.co.za' });
  eq(dupe.ok, false, 'duplicate refused');
  ok(/already exists/.test(dupe.error), 'clear message');
  eq(rows(svc, 'Users').length, 1, 'still one user');

  eq(signup(svc, { email: 'short@example.co.za', password: 'Ab1' }).ok, false, 'short password refused');
  eq(signup(svc, { email: 'nodigit@example.co.za', password: 'PasswordOnly' }).ok, false, 'needs a digit');
  eq(signup(svc, { email: 'bad-email', password: 'StrongPass1' }).ok, false, 'bad email refused');
  eq(signup(svc, { name: 'A', email: 'a@example.co.za' }).ok, false, 'short name refused');
  eq(rows(svc, 'Users').length, 1, 'no partial users created');
});

test('login: right password works, wrong password is generic, throttled', () => {
  const svc = loadCode();
  signup(svc);
  const good = svc.auth('login', { token: TOKEN, email: 'Lindi@Example.co.za', password: 'StrongPass1' });
  eq(good.ok, true, 'case-insensitive login');
  eq(good.user.email, 'lindi@example.co.za', 'user returned');

  const bad = svc.auth('login', { token: TOKEN, email: 'lindi@example.co.za', password: 'WrongPass1' });
  eq(bad.ok, false, 'wrong password refused');
  eq(bad.error, 'Email address or password is incorrect.', 'generic error (no user enumeration)');

  const unknown = svc.auth('login', { token: TOKEN, email: 'nobody@example.co.za', password: 'WrongPass1' });
  eq(unknown.error, bad.error, 'same message for unknown account');

  for (let i = 0; i < 12; i++) {
    svc.auth('login', { token: TOKEN, email: 'lindi@example.co.za', password: 'WrongPass1' });
  }
  const locked = svc.auth('login', { token: TOKEN, email: 'lindi@example.co.za', password: 'StrongPass1' });
  eq(locked.ok, false, 'locked out after repeated failures');
  ok(/Too many failed attempts/.test(locked.error), 'throttle message');
});

test('sessions: resolve the user, reject tampering and logout', () => {
  const svc = loadCode();
  const res = signup(svc);
  const me = svc.auth('session', { token: TOKEN, sessionToken: res.token });
  eq(me.ok, true, 'session resolves');
  eq(me.user.email, res.user.email, 'same user');

  const tampered = svc.auth('session', { token: TOKEN, sessionToken: res.token.slice(0, -2) + 'ff' });
  eq(tampered.ok, false, 'tampered token rejected');

  svc.cache.clear();
  eq(svc.auth('session', { token: TOKEN, sessionToken: res.token }).ok, true, 'works from the sheet too');

  eq(svc.auth('logout', { token: TOKEN, sessionToken: res.token }).ok, true, 'logout ok');
  eq(svc.auth('session', { token: TOKEN, sessionToken: res.token }).ok, false, 'session dead after logout');
  eq(rows(svc, 'Sessions').length, 0, 'session row removed');
});

test('profile update and password change keep sessions honest', () => {
  const svc = loadCode();
  const first = signup(svc);
  const updated = svc.auth('updateProfile', {
    token: TOKEN, sessionToken: first.token, name: 'Lindi M Nkosi',
    phone: '083 999 0000', company: 'Nkosi Holdings'
  });
  eq(updated.ok, true, 'profile updated');
  eq(updated.user.name, 'Lindi M Nkosi', 'new name');
  eq(updated.user.company, 'Nkosi Holdings', 'new company');
  eq(rows(svc, 'Users')[0].Phone, '083 999 0000', 'phone persisted');

  const wrong = svc.auth('changePassword', {
    token: TOKEN, sessionToken: first.token, currentPassword: 'Nope1234', newPassword: 'BrandNew2'
  });
  eq(wrong.ok, false, 'wrong current password refused');

  const second = svc.auth('login', { token: TOKEN, email: 'lindi@example.co.za', password: 'StrongPass1' });
  eq(second.ok, true, 'second device logs in');

  const changed = svc.auth('changePassword', {
    token: TOKEN, sessionToken: first.token, currentPassword: 'StrongPass1', newPassword: 'BrandNew2'
  });
  eq(changed.ok, true, 'password changed');
  ok(changed.token && changed.token !== first.token, 'fresh session issued');
  eq(svc.auth('session', { token: TOKEN, sessionToken: second.token }).ok, false, 'other device signed out');
  eq(svc.auth('session', { token: TOKEN, sessionToken: first.token }).ok, false, 'old token dead');
  eq(svc.auth('session', { token: TOKEN, sessionToken: changed.token }).ok, true, 'new token works');
  eq(svc.auth('login', { token: TOKEN, email: 'lindi@example.co.za', password: 'BrandNew2' }).ok, true, 'new password logs in');
  eq(svc.auth('login', { token: TOKEN, email: 'lindi@example.co.za', password: 'StrongPass1' }).ok, false, 'old password dead');
  const bodies = svc.mail.map(m => m.subject).join(' | ');
  ok(/password was changed/.test(bodies), 'password-change email sent');
});

test('password reset: no account enumeration, single use, new password works', () => {
  const svc = loadCode();
  signup(svc);
  const known = svc.auth('requestReset', { token: TOKEN, email: 'lindi@example.co.za' });
  const unknown = svc.auth('requestReset', { token: TOKEN, email: 'nobody@example.co.za' });
  eq(known.ok, true, 'known email accepted');
  eq(unknown.ok, true, 'unknown email answered the same way');
  eq(known.message, unknown.message, 'identical wording (no enumeration)');

  const resetRow = rows(svc, 'Users')[0];
  ok(resetRow['Reset Token'], 'reset token stored (hashed)');
  eq(svc.mail.filter(m => /Reset your/.test(m.subject)).length, 1, 'one reset email');

  const badToken = svc.auth('resetPassword', {
    token: TOKEN, email: 'lindi@example.co.za', resetToken: 'deadbeef', newPassword: 'Another123'
  });
  eq(badToken.ok, false, 'bogus reset token refused');

  // Pull the real token out of the emailed link and use it.
  const mail = svc.mail.filter(m => /Reset your/.test(m.subject))[0];
  const realToken = /token=([a-f0-9]+)/.exec(mail.body)[1];
  const reset = svc.auth('resetPassword', {
    token: TOKEN, email: 'lindi@example.co.za', resetToken: realToken, newPassword: 'Another123'
  });
  eq(reset.ok, true, 'reset accepted');
  eq(svc.auth('login', { token: TOKEN, email: 'lindi@example.co.za', password: 'Another123' }).ok, true, 'new password works');
  eq(rows(svc, 'Users')[0]['Reset Token'], '', 'reset token cleared');
  const reuse = svc.auth('resetPassword', {
    token: TOKEN, email: 'lindi@example.co.za', resetToken: realToken, newPassword: 'ThirdPass3'
  });
  eq(reuse.ok, false, 'link cannot be used twice');
});

test('account calls need the shared site token and a known action', () => {
  const svc = loadCode();
  const noToken = svc.auth('signup', { name: 'X Y', email: 'x@example.co.za', password: 'StrongPass1' });
  eq(noToken.ok, false, 'refused without the site token');
  eq(noToken.error, 'unauthorised', 'unauthorised error');
  eq(rows(svc, 'Users').length, 0, 'nothing created');

  const health = svc.doGet({});
  eq(health.version, 3, 'health endpoint still reports the version');
  ok(/<html/i.test(svc.doGet({ action: 'blank' })), 'iframe bootstrap page served');
  eq(svc.run('testAccounts').deterministic, true, 'hashing is deterministic per salt');
  eq(svc.run('testAccounts').rejectsWrong, true, 'hashing rejects a different password');
  ok(svc.run('migrateAccounts').users === 0, 'migrateAccounts reports counts');
  eq(svc.sheet('Users').rows[0].slice(0, 3).join(','), 'Id,Created,Name', 'Users headers');
  eq(svc.sheet('Sessions').rows[0].slice(0, 3).join(','), 'Token Hash,User Id,Email', 'Sessions headers');
});

test('diagnose reports the deployment health without leaking data', () => {
  const svc = loadCode();
  signup(svc);
  const report = svc.auth('diagnose', { token: TOKEN });
  eq(report.ok, true, 'healthy');
  eq(report.version, 3, 'version');
  eq(report.tabs.Leads, 1, 'lead rows counted');
  eq(report.tabs.Users, 1, 'account rows counted');
  eq(report.tabs.Sessions, 1, 'session rows counted');
  ok(report.problems.length === 0, 'no problems');
  const payload = JSON.stringify(report);
  ok(payload.indexOf('lindi@example.co.za') === -1, 'no personal data in the health check');
  ok(payload.indexOf('Hash') === -1, 'no password material in the health check');

  const empty = loadCode().auth('diagnose', { token: TOKEN });
  eq(empty.ok, false, 'flags a workbook with no tabs');
  ok(empty.problems.length >= 2, 'lists the missing tabs: ' + empty.problems.join(', '));
});

test('leads sent through the form transport return a real reference', () => {
  const svc = loadCode();
  const result = svc.callEncoded({
    action: 'lead', token: TOKEN, id: 'lead-form-1', formType: 'Hire Admin',
    name: 'Bright Admin Co', email: 'owner@bright.co.za', phone: '0734445555',
    company: 'Bright Admin Co', message: 'We use Google Drive',
    fields: { 'Contract length': '2 years', 'Services Required': 'Compliance Filing, Bookkeeping' }
  });
  eq(result.ok, true, 'lead accepted over the iframe transport');
  ok(/^HIR-\d{6}-\d{4}$/.test(result.reference), 'reference returned: ' + result.reference);

  const row = rows(svc, 'Leads')[0];
  eq(row.Name, 'Bright Admin Co', 'name stored');
  eq(row.Email, 'owner@bright.co.za', 'email stored');
  eq(row.Phone, '0734445555', 'phone stored');
  eq(row.Message, 'We use Google Drive', 'message stored');
  ok(row['Payload JSON'].indexOf('Compliance Filing') !== -1, 'checkbox answers kept');

  const duplicate = svc.callEncoded({ action: 'lead', token: TOKEN, id: 'lead-form-1', name: 'X', email: 'x@y.co' });
  eq(duplicate.duplicate, true, 'retry is idempotent');
  eq(rows(svc, 'Leads').length, 1, 'no duplicate row');

  const spam = svc.callEncoded({ action: 'lead', token: TOKEN, id: 'lead-form-2', name: 'Bot', _hp: 'filled' });
  eq(spam.ok, true, 'honeypot still pretends success');
  eq(rows(svc, 'Leads').length, 1, 'honeypot stored nothing');
});

/* ---------------------------------------------------------------- */

const failures = results.filter(line => line.indexOf('FAIL') === 0);
results.forEach(line => console.log(line));
console.log('\n' + results.length + ' tests, ' + checks + ' assertions, ' + failures.length + ' failures');
if (failures.length) { process.exit(1); }
console.log('ALL TESTS PASSED');
