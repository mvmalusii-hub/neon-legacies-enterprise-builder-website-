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
  VERSION: 2
};

var HEADERS = ['Timestamp', 'Reference', 'Form', 'Status', 'Name', 'Email',
               'Phone', 'Company', 'Service / Interest', 'Industry', 'Amount',
               'Preferred Date', 'Message', 'Page', 'Source ID', 'Payload JSON'];

var STATUS_OPTIONS = ['New', 'Contacted', 'Quoted', 'Won', 'Lost', 'Spam'];

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
  name: /(^|_)name$|fullname|contactperson/,
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
function doGet() {
  return out({ ok: true, service: 'neon-legacies-leads', version: CONFIG.VERSION });
}

/** Form submissions land here. */
function doPost(e) {
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(20000);                    // serialise concurrent submits

    var data = parseBody(e);
    if (!data || typeof data !== 'object') { return out({ ok: false, error: 'bad payload' }); }

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
  var width = Math.max(sheet.getLastColumn(), HEADERS.length);
  var current = [];
  if (sheet.getLastRow() > 0) {
    current = sheet.getRange(1, 1, 1, width).getValues()[0].map(function (v) {
      return String(v || '').trim();
    });
  }
  while (current.length && !current[current.length - 1]) { current.pop(); }

  if (!current.length) {
    sheet.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]);
    sheet.getRange(1, 1, 1, HEADERS.length).setFontWeight('bold');
    sheet.setFrozenRows(1);
    applyStatusValidation(sheet, HEADERS.indexOf('Status') + 1);
    return HEADERS.slice();
  }

  var missing = HEADERS.filter(function (h) { return current.indexOf(h) === -1; });
  if (missing.length) {
    sheet.getRange(1, current.length + 1, 1, missing.length).setValues([missing]);
    sheet.getRange(1, current.length + 1, 1, missing.length).setFontWeight('bold');
    current = current.concat(missing);
  }

  applyStatusValidation(sheet, current.indexOf('Status') + 1);
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
