/**
 * Neon Legacies Enterprise Builder – website lead intake
 * ------------------------------------------------------
 * Receives form submissions from the static site, writes them to a Google
 * Sheet, notifies the team and optionally auto-replies to the customer.
 *
 * DEPLOY:  Deploy ▸ New deployment ▸ Web app
 *          Execute as:      Me (mv.malusii@gmail.com)
 *          Who has access:  Anyone
 *          → copy the /exec URL into app.js (NEON_LEADS.endpoint)
 *            and into order-documents.html.
 */

var CONFIG = {
  NOTIFY_EMAILS: 'mv.malusii@gmail.com',   // comma-separate for several people
  SHARED_TOKEN: 'REPLACE_WITH_A_LONG_RANDOM_STRING', // must match app.js
  SPREADSHEET_ID: '',                      // blank = sheet this script is bound to
  SHEET_TAB: 'Leads',
  AUTO_REPLY: true,
  SITE: 'https://www.neonlegacies.co.za',
  BRAND: 'Neon Legacies Enterprise Builder'
};

var HEADERS = ['Timestamp', 'Reference', 'Form', 'Name', 'Email', 'Phone',
               'Company', 'Message', 'Page', 'Payload JSON'];

/** Health check – open the /exec URL in a browser to confirm the deployment. */
function doGet() {
  return ContentService
    .createTextOutput(JSON.stringify({ ok: true, service: 'neon-legacies-leads', version: 1 }))
    .setMimeType(ContentService.MimeType.JSON);
}

/** Form submissions land here. */
function doPost(e) {
  try {
    var data = parseBody(e);
    if (!data || typeof data !== 'object') { return out({ ok: false, error: 'bad payload' }); }

    // 1. Honeypot – real users never fill a hidden field. Pretend success.
    if (data._hp) { return out({ ok: true }); }

    // 2. Shared token – blocks drive-by spam against the public URL.
    if (String(data.token || '') !== String(CONFIG.SHARED_TOKEN)) {
      return out({ ok: false, error: 'unauthorised' });
    }

    // 3. Idempotency – double-clicks and retries must not duplicate rows.
    var id = String(data.id || Utilities.getUuid());
    var cache = CacheService.getScriptCache();
    if (cache.get('lead:' + id)) { return out({ ok: true, duplicate: true, id: id }); }

    // 4. Minimal validation.
    var name = String(data.name || data.company || '').trim();
    data.name = name;
    var email = String(data.email || '').trim();
    if (!name) { return out({ ok: false, error: 'name required' }); }
    var phone = String(data.phone || '').trim();
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return out({ ok: false, error: 'valid email required' });
    }

    // 5. Throttle: max 5 submissions per email address per hour.
    var throttleKey = 'thr:' + (email || phone || name + ':' + data.formType).toLowerCase();
    var hits = Number(cache.get(throttleKey) || 0);
    if (hits >= 5) { return out({ ok: false, error: 'too many submissions' }); }

    // 6. Persist.
    var reference = makeReference(data.formType);
    appendLead(reference, data, id);

    cache.put('lead:' + id, '1', 21600);
    cache.put(throttleKey, String(hits + 1), 3600);

    // 7. Tell the team, then receipt the customer.
    notifyTeam(reference, data);
    if (CONFIG.AUTO_REPLY && email) { receiptCustomer(reference, data); }

    return out({ ok: true, id: id, reference: reference });
  } catch (err) {
    console.error(err);                      // logged for the owner, hidden from the browser
    return out({ ok: false, error: 'server error' });
  }
}

/* ------------------------------------------------------------------ */
/* helpers                                                             */
/* ------------------------------------------------------------------ */

function parseBody(e) {
  if (!e) { return null; }
  if (!e.postData) { return e.parameter || null; }
  var raw = e.postData.contents;
  try { return JSON.parse(raw); } catch (ignore) {}
  var params = e.parameter || {};                      // form-encoded fallback
  return Object.keys(params).length ? params : null;
}

function out(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function makeReference(formType) {
  var d = Utilities.formatDate(new Date(), 'Africa/Johannesburg', 'yyMMdd');
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
  var sheet = ss.getSheetByName(CONFIG.SHEET_TAB);
  if (!sheet) {
    sheet = ss.insertSheet(CONFIG.SHEET_TAB);
    sheet.appendRow(HEADERS);
    sheet.getRange(1, 1, 1, HEADERS.length).setFontWeight('bold');
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function appendLead(reference, data, id) {
  var sheet = getSheet();
  sheet.appendRow([
    new Date(),
    reference,
    String(data.formType || 'general'),
    String(data.name || ''),
    String(data.email || ''),
    String(data.phone || ''),
    String(data.company || ''),
    String(data.message || data.notes || ''),
    String(data.page || ''),
    JSON.stringify(data).slice(0, 45000)          // Sheets cell limit is 50 000 chars
  ]);
}

function notifyTeam(reference, data) {
  var lines = [
    'New website submission: ' + (data.formType || 'general'),
    '',
    'Reference: ' + reference,
    'Name:      ' + (data.name || ''),
    'Email:     ' + (data.email || ''),
    'Phone:     ' + (data.phone || ''),
    'Company:   ' + (data.company || ''),
    'Page:      ' + (data.page || ''),
    '',
    'Message / details:',
    String(data.message || data.notes || data.details || '(none provided)'),
    '',
    'Full payload:',
    JSON.stringify(data, null, 2)
  ];
  MailApp.sendEmail({
    to: CONFIG.NOTIFY_EMAILS,
    subject: '[' + CONFIG.BRAND + '] ' + reference + ' – ' + (data.formType || 'lead') + ' – ' + (data.name || ''),
    body: lines.join('\n'),
    name: CONFIG.BRAND
  });
}

function receiptCustomer(reference, data) {
  var email = String(data.email || '').trim();
  if (!email) { return; }
  var body = [
    'Hi ' + String(data.name || '').split(' ')[0] + ',',
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
