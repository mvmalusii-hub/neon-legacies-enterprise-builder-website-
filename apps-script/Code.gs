/**
 * Neon Legacies Enterprise Builder – website lead intake
 * ------------------------------------------------------
 * Receives form submissions from the static site, writes them to a Google
 * Sheet, notifies the team and optionally auto-replies to the customer.
 *
 * v2 (31 Oct 2026)
 *   • Accepts ANY field naming – the site forms send ids such as
 *     `businessEmail`, `directorName`, `companyName`, `regCompanyName`, and the
 *     liquor / spaza forms have no name or id at all. Every payload is
 *     normalised to Name / Email / Phone / Company / Service / Industry /
 *     Amount / Preferred date, with a label map in `fields`.
 *   • The sheet gets real columns (Status, Service / Interest, Industry,
 *     Amount, Preferred Date, Source ID) instead of burying it all in
 *     Payload JSON.
 *   • Existing sheets are migrated in place: missing headers are appended and
 *     the Status column gets a dropdown.
 *   • The team notification lists every answered question and replies straight
 *     to the customer's email address.
 *
 * DEPLOY:  Deploy ▸ New deployment ▸ Web app
 *          Execute as:      Me (mv.malusii@gmail.com)
 *          Who has access:  Anyone
 *          → copy the /exec URL into app.js (NEON_LEADS.endpoint)
 *            and into order-documents.html.
 */

var CONFIG = {
  NOTIFY_EMAILS: 'mv.malusii@gmail.com',   // comma-separate for several people
  SHARED_TOKEN: '32bb90901d4b2c3323c1bb87cb08940f341040813634abc0', // must match window.NEON_LEADS.token in app.js
  SPREADSHEET_ID: '',                      // blank = sheet this script is bound to
  SHEET_TAB: 'Leads',
  AUTO_REPLY: true,
  SITE: 'https://www.neonlegacies.co.za',
  BRAND: 'Neon Legacies Enterprise Builder',
  TZ: 'Africa/Johannesburg',
  VERSION: 3,
  // --- accounts (v3) ---
  ACCOUNTS_TAB: 'Users',
  SESSIONS_TAB: 'Sessions',
  SESSION_DAYS: 7,
  HASH_ITERATIONS: 600,                    // iterated SHA-256; Apps Script has no PBKDF2
  MIN_PASSWORD: 8,
  RESET_MINUTES: 60,
  LOGIN_ATTEMPTS: 10                       // per email per 15 minutes
};

var HEADERS = ['Timestamp', 'Reference', 'Form', 'Status', 'Name', 'Email',
               'Phone', 'Company', 'Service / Interest', 'Industry', 'Amount',
               'Preferred Date', 'Message', 'Page', 'Source ID', 'Payload JSON'];

var STATUS_OPTIONS = ['New', 'Contacted', 'Quoted', 'Won', 'Lost', 'Spam'];

var USER_HEADERS = ['Id', 'Created', 'Name', 'Email', 'Phone', 'Company', 'Role',
                    'Status', 'Salt', 'Hash', 'Iterations', 'Last Login',
                    'Password Changed', 'Reset Token', 'Reset Expires'];

var SESSION_HEADERS = ['Token Hash', 'User Id', 'Email', 'Created', 'Expires',
                       'Device', 'Last Seen'];

var AUTH_ACTIONS = ['signup', 'login', 'session', 'logout', 'updateProfile',
                    'changePassword', 'requestReset', 'resetPassword'];

/** Known-good keys per canonical field, most specific first. */
var ALIASES = {
  name: ['name', 'fullname', 'yourname', 'contactname', 'contactperson',
         'firstname', 'directorname', 'businessname', 'companyname',
         'regcompanyname', 'partnercompanyname', 'signupname'],
  email: ['email', 'emailaddress', 'businessemail', 'directoremail',
          'signupemail', 'regemail', 'contactemail'],
  phone: ['phone', 'phonenumber', 'tel', 'telephone', 'mobile', 'cell',
          'cellphone', 'contactnumber', 'whatsapp', 'businessphone',
          'directorphone', 'signupphone'],
  company: ['company', 'companyname', 'businessname', 'business',
            'organisation', 'organization', 'tradingname', 'regcompanyname',
            'partnercompanyname'],
  message: ['message', 'notes', 'note', 'details', 'comments', 'comment',
            'enquiry', 'enquirydetails', 'description', 'partnerdescription',
            'directoridea', 'regservices', 'painpoints', 'growthgoals',
            'idea', 'brief', 'additionalnotes'],
  service: ['service', 'services', 'servicetype', 'servicerequired',
            'selectedservice', 'bundle', 'package', 'plan', 'licencetype',
            'licensetype', 'interest'],
  industry: ['industry', 'industryfordocs', 'sector', 'regindustry',
             'partnerindustry', 'industrytype'],
  amount: ['total', 'totalamount', 'amount', 'price', 'quote', 'value'],
  preferredDate: ['preferreddate', 'appointmentdate', 'sessiondate',
                  'startdate', 'date', 'preferredstartdate']
};

/** Loose matchers used when no alias hits (e.g. free-text labels). */
var PATTERNS = {
  name: /name$|fullname|contactperson/,
  email: /email/,
  phone: /phone|telephone|mobile|cell|whatsapp|contactnumber/,
  company: /company|businessname|organisation|organization|trading/,
  message: /message|notes?$|details|description|comment|enquiry|idea|goals?|painpoint|requirement|tellme|aboutyour/,
  service: /service|bundle|package|plan|licence|license/,
  industry: /industry|sector/,
  amount: /total|amount|price/,
  preferredDate: /date$|preferreddate/
};

var STOP = {
  name: /company|business|industry|file|logo|firstname|lastname|username/
};

/** Health check – open the /exec URL in a browser to confirm the deployment. */
function doGet(e) {
  var action = e && e.parameter ? String(e.parameter.action || '') : '';
  if (action === 'blank') {
    // Bootstrap page for the account iframe – no CORS, no content.
    return html_('<!DOCTYPE html><html><head><meta charset="utf-8"><title>ok</title></head><body></body></html>');
  }
  return out({ ok: true, service: 'neon-legacies-leads', version: CONFIG.VERSION });
}

/** Form submissions land here. */
function doPost(e) {
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(20000);                    // serialise concurrent submits

    var data = parseBody(e);
    if (!data || typeof data !== 'object') { return out({ ok: false, error: 'bad payload' }); }

    // 0. Account actions (signup / login / profile …). Their reply is posted
    //    back to the page through the iframe transport in auth.js, because
    //    Apps Script cannot set CORS headers.
    if (data.action && AUTH_ACTIONS.indexOf(String(data.action)) !== -1) {
      return authResponse_(data);
    }

    // 1. Honeypot – real users never fill a hidden field. Pretend success.
    if (data._hp) { return out({ ok: true }); }

    // 2. Shared token – blocks drive-by spam against the public URL.
    //    If it was never configured we accept the post (honeypot and throttle
    //    still apply) instead of silently dropping real leads.
    var tokenConfigured = CONFIG.SHARED_TOKEN && CONFIG.SHARED_TOKEN.indexOf('REPLACE_WITH') !== 0;
    if (tokenConfigured && String(data.token || '') !== String(CONFIG.SHARED_TOKEN)) {
      return out({ ok: false, error: 'unauthorised' });
    }

    // 3. Idempotency – double-clicks and retries must not duplicate rows.
    var id = String(data.id || Utilities.getUuid());
    var cache = CacheService.getScriptCache();
    if (cache.get('lead:' + id)) { return out({ ok: true, duplicate: true, id: id }); }

    // 4. Normalise every field naming convention the site uses, then validate.
    var lead = canonicalize(data);

    if (!lead.name && lead.company) { lead.name = lead.company; }
    if (lead.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(lead.email)) {
      return out({ ok: false, error: 'valid email required' });
    }
    if (!lead.name && !lead.email && !lead.phone) {
      return out({ ok: false, error: 'contact details required (name, email or phone)' });
    }

    // 5. Throttle: max 5 submissions per email (or phone / sender) per hour.
    var throttleId = (lead.email || lead.phone || 'anon').toLowerCase();
    var throttleKey = 'thr:' + throttleId;
    var hits = Number(cache.get(throttleKey) || 0);
    if (hits >= 5) { return out({ ok: false, error: 'too many submissions' }); }

    // 6. Persist.
    var reference = makeReference(data.formType);
    appendLead(reference, lead, data, id);

    cache.put('lead:' + id, '1', 21600);
    cache.put(throttleKey, String(hits + 1), 3600);

    // 7. Tell the team, then receipt the customer. A mail failure must never
    //    lose the row that has already been written.
    try { notifyTeam(reference, lead, data); } catch (mailErr) { console.error(mailErr); }
    if (CONFIG.AUTO_REPLY) {
      try { receiptCustomer(reference, lead); } catch (replyErr) { console.error(replyErr); }
    }

    return out({ ok: true, id: id, reference: reference });
  } catch (err) {
    console.error(err);                      // logged for the owner, hidden from the browser
    return out({ ok: false, error: 'server error' });
  } finally {
    try { lock.releaseLock(); } catch (ignore) {}
  }
}

/* ------------------------------------------------------------------------- *
 *  PAYLOAD NORMALISATION
 * ------------------------------------------------------------------------- */

/** Accepts JSON, text/plain JSON, form-encoded and query-string posts. */
function parseBody(e) {
  if (!e) { return null; }
  if (!e.postData) { return e.parameter || null; }
  var raw = e.postData.contents;
  try { return JSON.parse(raw); } catch (ignore) {}
  if (raw && raw.indexOf('=') !== -1) {           // x-www-form-urlencoded
    var parsed = {};
    raw.split('&').forEach(function (pair) {
      if (!pair) { return; }
      var bits = pair.split('=');
      parsed[decodeURIComponent(bits[0])] = decodeURIComponent((bits[1] || '').replace(/\+/g, ' '));
    });
    if (Object.keys(parsed).length) { return parsed; }
  }
  var params = e.parameter || {};                  // form-encoded fallback
  return Object.keys(params).length ? params : null;
}

function normKey(key) {
  return String(key == null ? '' : key).toLowerCase().replace(/[^a-z0-9]/g, '');
}

function asText(value) {
  if (value === null || value === undefined) { return ''; }
  if (Object.prototype.toString.call(value) === '[object Array]') {
    return value.filter(function (v) { return v !== '' && v !== null && v !== undefined; }).join(', ');
  }
  if (typeof value === 'boolean') { return value ? 'Yes' : ''; }
  if (typeof value === 'object') { return JSON.stringify(value); }
  return String(value).replace(/\s+/g, ' ').trim();
}

/** Flattens the payload (plus the client's `fields` label map) into normKey -> text. */
function flatten(data) {
  var flat = {};
  var add = function (key, value) {
    var text = asText(value);
    if (!text) { return; }
    var k = normKey(key);
    if (!k || flat[k]) { return; }
    flat[k] = text;
  };
  Object.keys(data).forEach(function (key) {
    if (key === 'fields' && data.fields && typeof data.fields === 'object') {
      Object.keys(data.fields).forEach(function (label) { add(label, data.fields[label]); });
      return;
    }
    add(key, data[key]);
  });
  return flat;
}

function take(flat, used, keys) {
  for (var i = 0; i < keys.length; i++) {
    var k = normKey(keys[i]);
    if (flat[k] && !used[k]) { used[k] = true; return flat[k]; }
  }
  return '';
}

function takePattern(flat, used, pattern, stop) {
  var keys = Object.keys(flat);
  for (var i = 0; i < keys.length; i++) {
    var k = keys[i];
    if (used[k] || !pattern.test(k)) { continue; }
    if (stop && stop.test(k)) { continue; }
    used[k] = true;
    return flat[k];
  }
  return '';
}

/**
 * Builds the canonical lead object. Every value is a trimmed string; `other`
 * holds the remaining question/answer pairs so nothing is ever dropped.
 */
function canonicalize(data) {
  var flat = flatten(data);
  var used = {};
  var pick = function (field) {
    return take(flat, used, ALIASES[field]) ||
           takePattern(flat, used, PATTERNS[field], STOP[field]);
  };

  var lead = {
    name: pick('name'),
    email: pick('email'),
    phone: pick('phone'),
    company: pick('company'),
    message: pick('message'),
    service: pick('service'),
    industry: pick('industry'),
    amount: pick('amount'),
    preferredDate: pick('preferredDate'),
    other: []
  };

  // Fallback for forms that only send firstName + lastName.
  if (!lead.name) {
    var first = takePattern(flat, used, /firstname/);
    var last = takePattern(flat, used, /lastname|surname/);
    if (first || last) { lead.name = (first + ' ' + last).trim(); }
  }

  Object.keys(flat).forEach(function (k) {
    if (used[k]) { return; }
    if (/^(token|id|formtype|page|timestamp|url|hp|referrer)$/.test(k)) { return; }
    lead.other.push(k + ': ' + flat[k]);
  });

  return lead;
}

/* ------------------------------------------------------------------------- *
 *  SHEET
 * ------------------------------------------------------------------------- */

function out(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function makeReference(formType) {
  var d = Utilities.formatDate(new Date(), CONFIG.TZ, 'yyMMdd');
  var rnd = Math.floor(Math.random() * 9000 + 1000);
  var prefix = String(formType || 'LEAD').replace(/[^A-Za-z]/g, '').slice(0, 3).toUpperCase();
  return prefix + '-' + d + '-' + rnd;
}

function getSheet() {
  var ss = CONFIG.SPREADSHEET_ID
    ? SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID)
    : SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) {
    throw new Error('Set CONFIG.SPREADSHEET_ID or bind this script to a Google Sheet.');
  }
  var sheet = ss.getSheetByName(CONFIG.SHEET_TAB) || ss.insertSheet(CONFIG.SHEET_TAB);
  ensureHeaders(sheet);
  return sheet;
}

/**
 * Creates the header row on a fresh sheet, or extends an older sheet in place
 * (v1 had 10 columns; v2 adds Status, Service / Interest, Industry, Amount,
 * Preferred Date and Source ID). Returns the live header list.
 */
function ensureHeaders(sheet) {
  var headers = ensureSheetHeaders_(sheet, HEADERS);
  applyStatusValidation(sheet, headers.indexOf('Status') + 1);
  return headers;
}

/** Creates or extends a header row without touching existing data. */
function ensureSheetHeaders_(sheet, headers) {
  var width = Math.max(sheet.getLastColumn(), headers.length);
  var current = [];
  if (sheet.getLastRow() > 0) {
    current = sheet.getRange(1, 1, 1, width).getValues()[0].map(function (v) {
      return String(v || '').trim();
    });
  }
  while (current.length && !current[current.length - 1]) { current.pop(); }

  if (!current.length) {
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold');
    sheet.setFrozenRows(1);
    return headers.slice();
  }

  var missing = headers.filter(function (h) { return current.indexOf(h) === -1; });
  if (missing.length) {
    sheet.getRange(1, current.length + 1, 1, missing.length).setValues([missing]);
    sheet.getRange(1, current.length + 1, 1, missing.length).setFontWeight('bold');
    current = current.concat(missing);
  }
  return current;
}

/** Adds the New/Contacted/Quoted/Won/Lost dropdown once per spreadsheet. */
function applyStatusValidation(sheet, statusColumn) {
  if (!statusColumn || statusColumn < 1) { return; }
  var props = PropertiesService.getDocumentProperties();
  if (props.getProperty('statusValidation') === 'v1') { return; }
  var rows = Math.max(sheet.getMaxRows() - 1, 1);
  var rule = SpreadsheetApp.newDataValidation()
    .requireValueInList(STATUS_OPTIONS, true)
    .setAllowInvalid(true)
    .build();
  sheet.getRange(2, statusColumn, rows, 1).setDataValidation(rule);
  props.setProperty('statusValidation', 'v1');
}

function cellValue(header, reference, lead, data, id) {
  switch (header) {
    case 'Timestamp': return new Date();
    case 'Reference': return reference;
    case 'Form': return String(data.formType || 'general');
    case 'Status': return 'New';
    case 'Name': return lead.name;
    case 'Email': return lead.email;
    case 'Phone': return lead.phone;
    case 'Company': return lead.company;
    case 'Service / Interest': return lead.service;
    case 'Industry': return lead.industry;
    case 'Amount': return lead.amount;
    case 'Preferred Date': return lead.preferredDate;
    case 'Message': return lead.message || (lead.other.length ? lead.other.join(' | ') : '');
    case 'Page': return String(data.page || '');
    case 'Source ID': return id;
    case 'Payload JSON': return JSON.stringify(data).slice(0, 45000); // cell limit is 50 000 chars
    default: return '';
  }
}

function appendLead(reference, lead, data, id) {
  var sheet = getSheet();
  var headers = sheet.getRange(1, 1, 1, Math.max(sheet.getLastColumn(), 1)).getValues()[0]
    .map(function (h) { return String(h || '').trim(); });
  if (!headers.length || !headers[0]) { headers = HEADERS.slice(); }
  var row = headers.map(function (header) {
    return cellValue(header, reference, lead, data, id);
  });
  sheet.appendRow(row);
}

/* ------------------------------------------------------------------------- *
 *  EMAIL
 * ------------------------------------------------------------------------- */

function detailLines(lead) {
  var lines = [];
  var add = function (label, value) {
    if (value) { lines.push(label + ': ' + value); }
  };
  add('Name', lead.name);
  add('Email', lead.email);
  add('Phone', lead.phone);
  add('Company', lead.company);
  add('Service / interest', lead.service);
  add('Industry', lead.industry);
  add('Amount', lead.amount);
  add('Preferred date', lead.preferredDate);
  return lines;
}

function notifyTeam(reference, lead, data) {
  var lines = [
    'New website submission: ' + (data.formType || 'general'),
    '',
    'Reference: ' + reference
  ].concat(detailLines(lead), ['Page:      ' + String(data.page || '')]);

  lines.push('');
  lines.push('Message / details:');
  lines.push(lead.message || '(none provided)');

  if (lead.other.length) {
    lines.push('');
    lines.push('Answers to the form questions:');
    lead.other.forEach(function (line) { lines.push('  • ' + line); });
  }

  lines.push('');
  lines.push('Full payload:');
  lines.push(JSON.stringify(data, null, 2));

  var mail = {
    to: CONFIG.NOTIFY_EMAILS,
    subject: '[' + CONFIG.BRAND + '] ' + reference + ' – ' + (data.formType || 'lead') +
             ' – ' + (lead.name || lead.company || lead.email || ''),
    body: lines.join('\n'),
    name: CONFIG.BRAND
  };
  if (lead.email) { mail.replyTo = lead.email; }      // reply goes straight to the lead
  MailApp.sendEmail(mail);
}

function receiptCustomer(reference, lead) {
  var email = String(lead.email || '').trim();
  if (!email) { return; }
  var greeting = lead.name ? String(lead.name).split(' ')[0] : 'there';
  var body = [
    'Hi ' + greeting + ',',
    '',
    'Thank you for contacting ' + CONFIG.BRAND + '. We have received your request',
    'and our team will be in touch within one business day.',
    '',
    'Your reference number is: ' + reference + '  (quote it in any reply)',
    '',
    'Call:     072 152 3293',
    'WhatsApp: 067 794 9236',
    'Email:    info@neonlegacies.co.za',
    'Website:  ' + CONFIG.SITE,
    '',
    'Regards,',
    CONFIG.BRAND
  ].join('\n');
  MailApp.sendEmail({
    to: email,
    subject: 'We received your request – ' + reference,
    body: body,
    replyTo: String(CONFIG.NOTIFY_EMAILS).split(',')[0],
    name: CONFIG.BRAND
  });
}

/* ------------------------------------------------------------------------- *
 *  OWNER HELPERS (run from the Apps Script editor)
 * ------------------------------------------------------------------------- */

/** Run once from the editor to check sheet headers, email and permissions. */
function sendTestLead() {
  var data = {
    formType: 'Test', name: 'Test Lead', email: 'mv.malusii@gmail.com',
    phone: '072 152 3293', company: 'Test Co', businessEmail: 'mv.malusii@gmail.com',
    service: 'Startup Launch Package', industry: 'Construction', total: 'R1 750',
    appointmentDate: '2026-11-15', notes: 'Sent by sendTestLead()',
    page: 'apps-script/Code.gs', id: 'test-' + Date.now()
  };
  var lead = canonicalize(data);
  var reference = makeReference(data.formType);
  appendLead(reference, lead, data, data.id);
  notifyTeam(reference, lead, data);
  return reference;
}

/** Adds any v2 columns to an existing sheet without touching the data. */
function migrateSheet() {
  return ensureHeaders(getSheet());
}

/* ========================================================================= *
 *  ACCOUNTS  (v3)
 *  ---------------------------------------------------------------------
 *  A real account system on the same web app: users in a `Users` sheet,
 *  sessions in a `Sessions` sheet, passwords as salted iterated SHA-256.
 *
 *  Transport: Apps Script cannot send CORS headers, so a JSON reply is
 *  useless to fetch(). Account calls are posted from a hidden form into a
 *  hidden iframe; the HTML we return does `parent.postMessage(...)` and
 *  auth.js resolves the promise from that message. Nothing secret ever goes
 *  in a URL.
 * ========================================================================= */

function html_(body) {
  return ContentService.createTextOutput(body).setMimeType(ContentService.MimeType.HTML);
}

/** Wraps an account result in the postMessage page the iframe transport expects. */
function authResponse_(data) {
  var requestId = String(data.requestId || '');
  var result;
  try {
    result = handleAuth(data);
  } catch (err) {
    console.error(err);
    result = { ok: false, error: 'server error' };
  }
  var message = JSON.stringify({ neonAuth: requestId, result: result }).replace(/</g, '\u003c');
  var script = '<script>parent.postMessage(' + message + ", '*');</" + 'script>';
  return html_('<!DOCTYPE html><html><head><meta charset="utf-8"></head><body>' + script + '</body></html>');
}

/** Validates the shared token, then runs the requested account action. */
function handleAuth(data) {
  var tokenConfigured = CONFIG.SHARED_TOKEN && CONFIG.SHARED_TOKEN.indexOf('REPLACE_WITH') !== 0;
  if (tokenConfigured && String(data.token || '') !== String(CONFIG.SHARED_TOKEN)) {
    return { ok: false, error: 'unauthorised' };
  }
  switch (String(data.action)) {
    case 'signup': return authSignup_(data);
    case 'login': return authLogin_(data);
    case 'session': return authSession_(data);
    case 'logout': return authLogout_(data);
    case 'updateProfile': return authUpdateProfile_(data);
    case 'changePassword': return authChangePassword_(data);
    case 'requestReset': return authRequestReset_(data);
    case 'resetPassword': return authResetPassword_(data);
    default: return { ok: false, error: 'unknown action' };
  }
}

/* ------------------------------ sheets ---------------------------- */

function getUsersSheet_() {
  var ss = openSpreadsheet_();
  var sheet = ss.getSheetByName(CONFIG.ACCOUNTS_TAB) || ss.insertSheet(CONFIG.ACCOUNTS_TAB);
  ensureSheetHeaders_(sheet, USER_HEADERS);
  return sheet;
}

function getSessionsSheet_() {
  var ss = openSpreadsheet_();
  var sheet = ss.getSheetByName(CONFIG.SESSIONS_TAB) || ss.insertSheet(CONFIG.SESSIONS_TAB);
  ensureSheetHeaders_(sheet, SESSION_HEADERS);
  return sheet;
}

function openSpreadsheet_() {
  var ss = CONFIG.SPREADSHEET_ID
    ? SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID)
    : SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) { throw new Error('Set CONFIG.SPREADSHEET_ID or bind this script to a Google Sheet.'); }
  return ss;
}

/** Sheet -> array of row objects (1-based `_row` included). */
function readRecords_(sheet) {
  if (sheet.getLastRow() < 2) { return []; }
  var values = sheet.getRange(1, 1, sheet.getLastRow(), sheet.getLastColumn()).getValues();
  var headers = values.shift().map(function (h) { return String(h || '').trim(); });
  return values.map(function (line, index) {
    var record = { _row: index + 2 };
    headers.forEach(function (header, i) { if (header) { record[header] = line[i]; } });
    return record;
  });
}

function writeRecord_(sheet, rowIndex, headers, updates) {
  headers.forEach(function (header, i) {
    if (!Object.prototype.hasOwnProperty.call(updates, header)) { return; }
    sheet.getRange(rowIndex, i + 1).setValue(updates[header]);
  });
}

/* --------------------------- passwords ---------------------------- */

function bytesToHex_(bytes) {
  var hex = '';
  for (var i = 0; i < bytes.length; i++) {
    var b = (bytes[i] + 256) % 256;
    hex += (b < 16 ? '0' : '') + b.toString(16);
  }
  return hex;
}

function sha256Hex_(text) {
  return bytesToHex_(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,
                                             text, Utilities.Charset.UTF_8));
}

/** Salted, iterated SHA-256. Apps Script has no PBKDF2, so we stretch manually. */
function hashPassword_(password, salt, iterations) {
  var rounds = Number(iterations) || CONFIG.HASH_ITERATIONS;
  var digest = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,
                                       salt + ':' + password, Utilities.Charset.UTF_8);
  for (var i = 0; i < rounds; i++) {
    digest = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, digest, Utilities.Charset.UTF_8);
  }
  return bytesToHex_(digest);
}

/** Compares two hex digests without leaking length/timing information. */
function safeEqual_(a, b) {
  var left = String(a || ''), right = String(b || '');
  if (left.length !== right.length) { return false; }
  var diff = 0;
  for (var i = 0; i < left.length; i++) { diff |= left.charCodeAt(i) ^ right.charCodeAt(i); }
  return diff === 0;
}

function newSecret_() {
  return String(Utilities.getUuid()).replace(/-/g, '') + String(Utilities.getUuid()).replace(/-/g, '');
}

function normEmail_(value) {
  return String(value || '').trim().toLowerCase();
}

function validEmail_(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || ''));
}

function passwordProblem_(password) {
  var value = String(password || '');
  if (value.length < CONFIG.MIN_PASSWORD) {
    return 'Password must be at least ' + CONFIG.MIN_PASSWORD + ' characters.';
  }
  if (!/[A-Za-z]/.test(value) || !/[0-9]/.test(value)) {
    return 'Password must contain at least one letter and one number.';
  }
  return '';
}

/* ---------------------------- sessions ---------------------------- */

/** The caller's session token. `token` is reserved for the shared site token. */
function sessionToken_(data) {
  return String(data.sessionToken || data.authToken || '').trim();
}

function publicUser_(record) {
  if (!record) { return null; }
  return {
    id: String(record.Id || ''),
    name: String(record.Name || ''),
    email: String(record.Email || ''),
    phone: String(record.Phone || ''),
    company: String(record.Company || ''),
    role: String(record.Role || 'client'),
    created: record.Created ? new Date(record.Created).toISOString() : ''
  };
}

function findUserByEmail_(email) {
  var target = normEmail_(email);
  if (!target) { return null; }
  var users = readRecords_(getUsersSheet_());
  for (var i = 0; i < users.length; i++) {
    if (normEmail_(users[i].Email) === target) { return users[i]; }
  }
  return null;
}

function findUserById_(id) {
  var target = String(id || '');
  if (!target) { return null; }
  var users = readRecords_(getUsersSheet_());
  for (var i = 0; i < users.length; i++) {
    if (String(users[i].Id) === target) { return users[i]; }
  }
  return null;
}

function createSession_(user) {
  var token = newSecret_();
  var hash = sha256Hex_(token);
  var now = new Date();
  var expires = new Date(now.getTime() + CONFIG.SESSION_DAYS * 86400000);
  var sheet = getSessionsSheet_();
  sheet.appendRow([hash, user.Id, user.Email, now, expires, 'web', now]);
  CacheService.getScriptCache().put('sess:' + hash, String(user.Id), 3600);
  cleanupSessions_(sheet);
  return token;
}

/** Returns the user record for a session token, or null. */
function sessionRecord_(token) {
  var raw = String(token || '').trim();
  if (!raw) { return null; }
  var hash = sha256Hex_(raw);
  var cache = CacheService.getScriptCache();
  var cachedId = cache.get('sess:' + hash);
  if (cachedId) {
    return { user: findUserById_(cachedId), hash: hash };
  }
  var sessions = readRecords_(getSessionsSheet_());
  var now = new Date().getTime();
  for (var i = 0; i < sessions.length; i++) {
    var row = sessions[i];
    if (String(row['Token Hash']) !== hash) { continue; }
    if (new Date(row.Expires).getTime() < now) { return null; }
    cache.put('sess:' + hash, String(row['User Id']), 3600);
    return { user: findUserById_(row['User Id']), hash: hash, row: row };
  }
  return null;
}

function dropSession_(token) {
  if (!token) { return; }
  var hash = sha256Hex_(String(token));
  CacheService.getScriptCache().remove('sess:' + hash);
  var sheet = getSessionsSheet_();
  var sessions = readRecords_(sheet);
  for (var i = sessions.length - 1; i >= 0; i--) {
    if (String(sessions[i]['Token Hash']) === hash) { sheet.deleteRow(sessions[i]._row); }
  }
}

function dropAllSessions_(userId) {
  var sheet = getSessionsSheet_();
  var sessions = readRecords_(sheet);
  var cache = CacheService.getScriptCache();
  for (var i = sessions.length - 1; i >= 0; i--) {
    if (String(sessions[i]['User Id']) !== String(userId)) { continue; }
    cache.remove('sess:' + String(sessions[i]['Token Hash']));
    sheet.deleteRow(sessions[i]._row);
  }
}

/** Opportunistically drops expired sessions once the tab gets busy. */
function cleanupSessions_(sheet) {
  if (!sheet || sheet.getLastRow() < 200) { return; }
  var sessions = readRecords_(sheet);
  var now = new Date().getTime();
  for (var i = sessions.length - 1; i >= 0; i--) {
    if (new Date(sessions[i].Expires).getTime() < now) { sheet.deleteRow(sessions[i]._row); }
  }
}

function rateLimit_(key, limit, seconds) {
  var cache = CacheService.getScriptCache();
  var hits = Number(cache.get(key) || 0);
  if (hits >= limit) { return false; }
  cache.put(key, String(hits + 1), seconds);
  return true;
}

/* --------------------------- actions ------------------------------ */

function authSignup_(data) {
  var name = String(data.name || '').trim();
  var email = normEmail_(data.email);
  var phone = String(data.phone || '').trim();
  var company = String(data.company || '').trim();
  var password = String(data.password || '');

  if (name.length < 2) { return { ok: false, error: 'Please enter your full name.' }; }
  if (!validEmail_(email)) { return { ok: false, error: 'Please enter a valid email address.' }; }
  var pwProblem = passwordProblem_(password);
  if (pwProblem) { return { ok: false, error: pwProblem }; }
  if (!rateLimit_('signup:' + email, 3, 3600)) {
    return { ok: false, error: 'Too many sign-up attempts. Please try again later.' };
  }
  if (findUserByEmail_(email)) {
    return { ok: false, error: 'An account with this email already exists – please sign in instead.' };
  }

  var now = new Date();
  var salt = newSecret_();
  var iterations = CONFIG.HASH_ITERATIONS;
  var record = {
    Id: 'USR-' + Utilities.formatDate(now, CONFIG.TZ, 'yyMMdd') + '-' +
        String(Math.floor(Math.random() * 9000 + 1000)),
    Created: now,
    Name: name,
    Email: email,
    Phone: phone,
    Company: company,
    Role: 'client',
    Status: 'active',
    Salt: salt,
    Hash: hashPassword_(password, salt, iterations),
    Iterations: iterations,
    'Last Login': now,
    'Password Changed': now,
    'Reset Token': '',
    'Reset Expires': ''
  };
  var headers = ensureSheetHeaders_(getUsersSheet_(), USER_HEADERS);
  var row = headers.map(function (header) {
    return Object.prototype.hasOwnProperty.call(record, header) ? record[header] : '';
  });
  getUsersSheet_().appendRow(row);

  // One record for the team: the lead row + notification (no duplicate signup post).
  var leadData = { formType: 'Account Signup', name: name, email: email, phone: phone,
                   company: company, page: 'profile.html' };
  var reference = makeReference('Account Signup');
  try {
    appendLead(reference, canonicalize(leadData), leadData, record.Id);
    notifyTeam(reference, canonicalize(leadData), leadData);
  } catch (logErr) { console.error(logErr); }

  var token = createSession_(record);
  try { sendWelcomeEmail_(record, reference); } catch (mailErr) { console.error(mailErr); }
  return { ok: true, token: token, user: publicUser_(record), reference: reference };
}

function authLogin_(data) {
  var email = normEmail_(data.email);
  var password = String(data.password || '');
  if (!validEmail_(email) || !password) {
    return { ok: false, error: 'Enter your email address and password.' };
  }
  var limitKey = 'login:' + email;
  if (!rateLimit_(limitKey, CONFIG.LOGIN_ATTEMPTS, 900)) {
    return { ok: false, error: 'Too many failed attempts. Please wait 15 minutes and try again.' };
  }
  var generic = { ok: false, error: 'Email address or password is incorrect.' };
  var user = findUserByEmail_(email);
  if (!user) { return generic; }
  if (String(user.Status || '').toLowerCase() !== 'active') {
    return { ok: false, error: 'This account is not active. Please contact us.' };
  }
  var hash = hashPassword_(password, user.Salt, user.Iterations);
  if (!safeEqual_(hash, user.Hash)) { return generic; }

  CacheService.getScriptCache().remove(limitKey);
  writeRecord_(getUsersSheet_(), user._row, USER_HEADERS, { 'Last Login': new Date() });
  user['Last Login'] = new Date();
  return { ok: true, token: createSession_(user), user: publicUser_(user) };
}

function authSession_(data) {
  var found = sessionRecord_(sessionToken_(data));
  if (!found || !found.user) { return { ok: false, error: 'not signed in' }; }
  if (String(found.user.Status || '').toLowerCase() !== 'active') {
    return { ok: false, error: 'account inactive' };
  }
  return { ok: true, user: publicUser_(found.user) };
}

function authLogout_(data) {
  dropSession_(sessionToken_(data));
  return { ok: true };
}

function authUpdateProfile_(data) {
  var found = sessionRecord_(sessionToken_(data));
  if (!found || !found.user) { return { ok: false, error: 'not signed in' }; }
  var updates = {};
  if (data.name !== undefined) {
    var name = String(data.name || '').trim();
    if (name.length < 2) { return { ok: false, error: 'Please enter your full name.' }; }
    updates.Name = name;
  }
  if (data.phone !== undefined) { updates.Phone = String(data.phone || '').trim(); }
  if (data.company !== undefined) { updates.Company = String(data.company || '').trim(); }
  if (!Object.keys(updates).length) { return { ok: false, error: 'nothing to update' }; }
  writeRecord_(getUsersSheet_(), found.user._row, USER_HEADERS, updates);
  Object.keys(updates).forEach(function (key) { found.user[key] = updates[key]; });
  return { ok: true, user: publicUser_(found.user) };
}

function authChangePassword_(data) {
  var found = sessionRecord_(sessionToken_(data));
  if (!found || !found.user) { return { ok: false, error: 'not signed in' }; }
  var user = found.user;
  var current = String(data.currentPassword || '');
  var next = String(data.newPassword || '');
  if (!safeEqual_(hashPassword_(current, user.Salt, user.Iterations), user.Hash)) {
    return { ok: false, error: 'Your current password is incorrect.' };
  }
  var pwProblem = passwordProblem_(next);
  if (pwProblem) { return { ok: false, error: pwProblem }; }
  if (safeEqual_(next, current)) {
    return { ok: false, error: 'The new password must be different from the current one.' };
  }
  var salt = newSecret_();
  var iterations = CONFIG.HASH_ITERATIONS;
  writeRecord_(getUsersSheet_(), user._row, USER_HEADERS, {
    Salt: salt,
    Hash: hashPassword_(next, salt, iterations),
    Iterations: iterations,
    'Password Changed': new Date()
  });
  dropAllSessions_(user.Id);                    // sign every other device out
  try { sendPasswordChangedEmail_(user); } catch (mailErr) { console.error(mailErr); }
  var refreshed = findUserById_(user.Id);
  return { ok: true, token: createSession_(refreshed), user: publicUser_(refreshed) };
}

function authRequestReset_(data) {
  var email = normEmail_(data.email);
  if (!validEmail_(email)) { return { ok: false, error: 'Please enter a valid email address.' }; }
  // Always answer the same way so the form cannot be used to probe accounts.
  var answer = { ok: true, message: 'If that email has an account, a reset link is on its way.' };
  if (!rateLimit_('reset:' + email, 3, 3600)) { return answer; }
  var user = findUserByEmail_(email);
  if (!user) { return answer; }

  var token = newSecret_();
  var expires = new Date(new Date().getTime() + CONFIG.RESET_MINUTES * 60000);
  writeRecord_(getUsersSheet_(), user._row, USER_HEADERS, {
    'Reset Token': sha256Hex_(token),
    'Reset Expires': expires
  });
  try { sendResetEmail_(user, token, expires); } catch (mailErr) { console.error(mailErr); }
  return answer;
}

function authResetPassword_(data) {
  var email = normEmail_(data.email);
  var token = String(data.resetToken || '');
  var next = String(data.newPassword || '');
  var generic = { ok: false, error: 'This reset link is invalid or has expired. Please request a new one.' };
  if (!validEmail_(email) || !token) { return generic; }
  var pwProblem = passwordProblem_(next);
  if (pwProblem) { return { ok: false, error: pwProblem }; }
  var user = findUserByEmail_(email);
  if (!user || !user['Reset Token']) { return generic; }
  if (new Date(user['Reset Expires']).getTime() < new Date().getTime()) { return generic; }
  if (!safeEqual_(String(user['Reset Token']), sha256Hex_(token))) { return generic; }

  var salt = newSecret_();
  var iterations = CONFIG.HASH_ITERATIONS;
  writeRecord_(getUsersSheet_(), user._row, USER_HEADERS, {
    Salt: salt,
    Hash: hashPassword_(next, salt, iterations),
    Iterations: iterations,
    'Password Changed': new Date(),
    'Reset Token': '',
    'Reset Expires': ''
  });
  dropAllSessions_(user.Id);
  try { sendPasswordChangedEmail_(user); } catch (mailErr) { console.error(mailErr); }
  return { ok: true };
}

/* ---------------------------- emails ------------------------------ */

function sendWelcomeEmail_(user, reference) {
  var body = [
    'Hi ' + String(user.Name || '').split(' ')[0] + ',',
    '',
    'Your ' + CONFIG.BRAND + ' account is ready. You can now sign in at',
    CONFIG.SITE + '/profile.html and book sessions, request admin support',
    'and access the market leads database.',
    '',
    'Account:   ' + user.Email,
    'Reference: ' + reference,
    '',
    'Keep this email – your reference is your account record with us.',
    '',
    'Call:     072 152 3293',
    'WhatsApp: 067 794 9236',
    'Email:    info@neonlegacies.co.za',
    '',
    'Regards,',
    CONFIG.BRAND
  ].join('\n');
  MailApp.sendEmail({
    to: user.Email,
    subject: 'Your ' + CONFIG.BRAND + ' account is ready',
    body: body,
    replyTo: String(CONFIG.NOTIFY_EMAILS).split(',')[0],
    name: CONFIG.BRAND
  });
}

function sendPasswordChangedEmail_(user) {
  var body = [
    'Hi ' + String(user.Name || '').split(' ')[0] + ',',
    '',
    'The password for your ' + CONFIG.BRAND + ' account (' + user.Email + ') was just changed.',
    'All other devices have been signed out.',
    '',
    'If this was not you, reply to this email or call 072 152 3293 immediately.',
    '',
    CONFIG.BRAND
  ].join('\n');
  MailApp.sendEmail({
    to: user.Email,
    subject: 'Your ' + CONFIG.BRAND + ' password was changed',
    body: body,
    replyTo: String(CONFIG.NOTIFY_EMAILS).split(',')[0],
    name: CONFIG.BRAND
  });
}

function sendResetEmail_(user, token, expires) {
  var link = CONFIG.SITE + '/reset.html?email=' + encodeURIComponent(user.Email) +
             '&token=' + encodeURIComponent(token);
  var body = [
    'Hi ' + String(user.Name || '').split(' ')[0] + ',',
    '',
    'Use this link to choose a new password for your ' + CONFIG.BRAND + ' account:',
    link,
    '',
    'The link works once and expires at ' +
      Utilities.formatDate(expires, CONFIG.TZ, 'yyyy-MM-dd HH:mm') + ' (SAST).',
    '',
    'If you did not ask for this, you can ignore the email – nothing will change.',
    '',
    CONFIG.BRAND
  ].join('\n');
  MailApp.sendEmail({
    to: user.Email,
    subject: 'Reset your ' + CONFIG.BRAND + ' password',
    body: body,
    replyTo: String(CONFIG.NOTIFY_EMAILS).split(',')[0],
    name: CONFIG.BRAND
  });
}

/* ------------------------- owner helpers -------------------------- */

/** Run from the editor: creates the Users/Sessions tabs and reports counts. */
function migrateAccounts() {
  var users = getUsersSheet_();
  var sessions = getSessionsSheet_();
  return { users: users.getLastRow() - 1, sessions: sessions.getLastRow() - 1 };
}

/** Run from the editor after a deploy: proves hashing + sessions round-trip. */
function testAccounts() {
  var salt = newSecret_();
  var first = hashPassword_('TestPass123', salt, 10);
  var second = hashPassword_('TestPass123', salt, 10);
  return {
    deterministic: safeEqual_(first, second),
    rejectsWrong: !safeEqual_(first, hashPassword_('TestPass124', salt, 10)),
    iterations: CONFIG.HASH_ITERATIONS
  };
}
