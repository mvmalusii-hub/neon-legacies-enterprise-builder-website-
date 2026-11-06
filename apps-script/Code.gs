/**
 * Neon Legacies Enterprise Builder – website lead intake + Google Sign-in
 * ----------------------------------------------------------------------
 * Receives form submissions from the static site, writes them to a Google
 * Sheet, notifies the team and optionally auto-replies to the customer.
 * It also verifies Google ID tokens (action=googleLogin) and records every
 * Google sign-in in the Logins tab – see auth.js on the site.
 *
 * DEPLOY:  Deploy ▸ New deployment ▸ Web app
 *          Execute as:      Me (mv.malusii@gmail.com)
 *          Who has access:  Anyone
 *          → copy the /exec URL into app.js (NEON_LEADS.endpoint)
 *            and into order-documents.html.
 *
 * GOOGLE SIGN-IN: put the OAuth 2.0 "Web application" client id into
 *          GOOGLE.CLIENT_ID below AND into auth.js (NEON_AUTH.googleClientId).
 *          Both must match, or every token is rejected as "wrong audience".
 */

var CONFIG = {
  NOTIFY_EMAILS: 'mv.malusii@gmail.com',   // comma-separate for several people
  SHARED_TOKEN: '32bb90901d4b2c3323c1bb87cb08940f341040813634abc0', // must match window.NEON_LEADS.token in app.js
  SPREADSHEET_ID: '',                      // blank = sheet this script is bound to
  SHEET_TAB: 'Leads',
  AUTO_REPLY: true,
  SITE: 'https://www.neonlegacies.co.za',
  BRAND: 'Neon Legacies Enterprise Builder'
};

var HEADERS = ['Timestamp', 'Reference', 'Form', 'Name', 'Email', 'Phone',
               'Company', 'Message', 'Page', 'Payload JSON'];

/**
 * Google Sign-in (see auth.js on the site).
 * CLIENT_ID must be the SAME OAuth 2.0 "Web application" client id that
 * auth.js uses, otherwise every token is rejected as "wrong audience".
 */
var GOOGLE = {
  CLIENT_ID: 'REPLACE_WITH_GOOGLE_OAUTH_CLIENT_ID.apps.googleusercontent.com',
  TOKEN_INFO: 'https://oauth2.googleapis.com/tokeninfo?id_token=',
  ISSUERS: ['https://accounts.google.com', 'accounts.google.com'],
  SESSION_DAYS: 7,
  LOGINS_TAB: 'Logins',
  MAX_SIGNINS_PER_HOUR: 20,
  NOTIFY_NEW_ACCOUNT: true
};

var LOGIN_HEADERS = ['Timestamp', 'Google ID', 'Name', 'Email', 'Domain',
                     'Page', 'Session expires', 'Account JSON'];

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
    //    If it was never configured we accept the post (honeypot and throttle
    //    still apply) instead of silently dropping real leads.
    var tokenConfigured = CONFIG.SHARED_TOKEN && CONFIG.SHARED_TOKEN.indexOf('REPLACE_WITH') !== 0;
    if (tokenConfigured && String(data.token || '') !== String(CONFIG.SHARED_TOKEN)) {
      return out({ ok: false, error: 'unauthorised' });
    }

    // 2b. Google Sign-in runs its own pipeline: the ID token is verified
    //     against Google again here, then written to the Logins tab.
    if (String(data.action || '') === 'googleLogin') { return googleLogin(data); }

    // 3. Idempotency – double-clicks and retries must not duplicate rows.
    var id = String(data.id || Utilities.getUuid());
    var cache = CacheService.getScriptCache();
    if (cache.get('lead:' + id)) { return out({ ok: true, duplicate: true, id: id }); }

    // 4. Minimal validation.
    var name = String(data.name || '').trim();
    var email = String(data.email || '').trim();
    if (!name) { return out({ ok: false, error: 'name required' }); }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return out({ ok: false, error: 'valid email required' });
    }

    // 5. Throttle: max 5 submissions per email address per hour.
    var throttleKey = 'thr:' + email.toLowerCase();
    var hits = Number(cache.get(throttleKey) || 0);
    if (hits >= 5) { return out({ ok: false, error: 'too many submissions' }); }

    // 6. Persist.
    var reference = makeReference(data.formType);
    appendLead(reference, data, id);

    cache.put('lead:' + id, '1', 21600);
    cache.put(throttleKey, String(hits + 1), 3600);

    // 7. Tell the team, then receipt the customer.
    notifyTeam(reference, data);
    if (CONFIG.AUTO_REPLY) { receiptCustomer(reference, data); }

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

/* ------------------------------------------------------------------ */
/* Google Sign-in                                                      */
/* ------------------------------------------------------------------ */

/**
 * Asks Google whether an ID token is genuine. This is the server-side
 * twin of the check auth.js does in the browser: signature, issuer,
 * audience (our client id), expiry and a verified email address.
 * Returns { ok: true, claims: {...} } or { ok: false, error: '...' }.
 */
function verifyGoogleToken(credential) {
  credential = String(credential || '').trim();
  if (!credential) { return { ok: false, error: 'credential required' }; }
  if (!GOOGLE.CLIENT_ID || GOOGLE.CLIENT_ID.indexOf('REPLACE_WITH') === 0) {
    return { ok: false, error: 'GOOGLE.CLIENT_ID not configured' };
  }

  var response;
  try {
    response = UrlFetchApp.fetch(GOOGLE.TOKEN_INFO + encodeURIComponent(credential),
                                 { muteHttpExceptions: true });
  } catch (err) {
    console.error(err);
    return { ok: false, error: 'could not reach Google' };
  }
  if (response.getResponseCode() !== 200) {
    return { ok: false, error: 'Google rejected the token' };   // bad signature / expired
  }

  var claims;
  try { claims = JSON.parse(response.getContentText()); } catch (err) { claims = null; }
  if (!claims || typeof claims !== 'object') {
    return { ok: false, error: 'unreadable Google response' };
  }
  if (GOOGLE.ISSUERS.indexOf(String(claims.iss)) === -1) {
    return { ok: false, error: 'wrong issuer' };
  }
  if (String(claims.aud) !== String(GOOGLE.CLIENT_ID)) {
    return { ok: false, error: 'wrong audience' };              // token for another site
  }
  if (!claims.sub) { return { ok: false, error: 'no google id' }; }
  var exp = Number(claims.exp || 0);
  if (!exp || exp * 1000 <= Date.now()) { return { ok: false, error: 'token expired' }; }
  if (!claims.email) { return { ok: false, error: 'no email' }; }
  if (claims.email_verified !== true && String(claims.email_verified) !== 'true') {
    return { ok: false, error: 'email not verified' };
  }
  return { ok: true, claims: claims };
}

/**
 * Handles action=googleLogin from auth.js. The browser cannot read this
 * reply (Apps Script sends no CORS headers), but the Logins tab and the
 * team email are the audit trail, and curl can read it while testing.
 */
function googleLogin(data) {
  var verified = verifyGoogleToken(data ? data.credential : '');
  if (!verified.ok) { return out({ ok: false, error: verified.error }); }
  var claims = verified.claims;
  var cache = CacheService.getScriptCache();

  // Idempotency: the same token (sub + iat) is only ever recorded once.
  var stamp = 'glogin:' + claims.sub + ':' + String(claims.iat || '');
  if (cache.get(stamp)) {
    return out({ ok: true, duplicate: true, email: claims.email });
  }

  var throttleKey = 'gthr:' + claims.sub;
  var hits = Number(cache.get(throttleKey) || 0);
  if (hits >= GOOGLE.MAX_SIGNINS_PER_HOUR) {
    return out({ ok: false, error: 'too many sign-ins' });
  }

  var expiresAt = new Date(Date.now() + GOOGLE.SESSION_DAYS * 24 * 60 * 60 * 1000);
  appendLogin(claims, data, expiresAt);

  cache.put(stamp, '1', 21600);
  cache.put(throttleKey, String(hits + 1), 3600);

  // Mail quota is precious: only tell the team about an account we have
  // not seen in the last 7 days.
  if (GOOGLE.NOTIFY_NEW_ACCOUNT && !cache.get('gseen:' + claims.sub)) {
    cache.put('gseen:' + claims.sub, '1', 604800);
    try { notifyNewGoogleAccount(claims); } catch (mailErr) { console.error(mailErr); }
  }

  return out({
    ok: true,
    user: {
      sub: String(claims.sub),
      name: String(claims.name || ''),
      email: String(claims.email),
      picture: String(claims.picture || '')
    },
    session: { days: GOOGLE.SESSION_DAYS, expiresAt: expiresAt.toISOString() }
  });
}

/** Creates the Logins tab (with headers) the first time it is needed. */
function getLoginsSheet() {
  var ss = CONFIG.SPREADSHEET_ID
    ? SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID)
    : SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) {
    throw new Error('Set CONFIG.SPREADSHEET_ID or bind this script to a Google Sheet.');
  }
  var sheet = ss.getSheetByName(GOOGLE.LOGINS_TAB);
  if (!sheet) {
    sheet = ss.insertSheet(GOOGLE.LOGINS_TAB);
    sheet.appendRow(LOGIN_HEADERS);
    sheet.getRange(1, 1, 1, LOGIN_HEADERS.length).setFontWeight('bold');
    sheet.setFrozenRows(1);
  }
  return sheet;
}

/** One row per verified Google sign-in. */
function appendLogin(claims, data, expiresAt) {
  var sheet = getLoginsSheet();
  var account = {
    sub: String(claims.sub),
    name: String(claims.name || ''),
    given_name: String(claims.given_name || ''),
    family_name: String(claims.family_name || ''),
    email: String(claims.email || ''),
    picture: String(claims.picture || ''),
    hd: String(claims.hd || ''),
    locale: String(claims.locale || '')
  };
  sheet.appendRow([
    new Date(),
    account.sub,
    account.name,
    account.email,
    account.hd,
    String((data && data.page) || ''),
    expiresAt,
    JSON.stringify(account)
  ]);
}

/** First sign-in from a Google account → tell the team somebody joined. */
function notifyNewGoogleAccount(claims) {
  var body = [
    'Somebody signed in to the website with a Google account.',
    '',
    'Name:    ' + String(claims.name || ''),
    'Email:   ' + String(claims.email || ''),
    'Google id: ' + String(claims.sub || ''),
    'Domain:  ' + String(claims.hd || '(consumer Gmail)'),
    '',
    'They now have access to the gated pages (business hub, market leads,',
    'referrals, partner applications). The Logins tab of the leads sheet',
    'lists every sign-in.',
    '',
    CONFIG.SITE
  ].join('\n');
  MailApp.sendEmail({
    to: CONFIG.NOTIFY_EMAILS,
    subject: '[' + CONFIG.BRAND + '] New Google sign-in – ' + String(claims.name || claims.email || ''),
    body: body,
    name: CONFIG.BRAND
  });
}
