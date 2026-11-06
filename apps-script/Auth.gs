/**
 * Neon Legacies Enterprise Builder – "Sign in with Google" WITHOUT an
 * OAuth client id (no Google Cloud Console needed).
 * -------------------------------------------------------------------------
 * How it authenticates: the web app is deployed to run as *the person
 * visiting it*, with access restricted to Google accounts. Google therefore
 * signs the visitor in before this code runs, and Session.getActiveUser()
 * returns that person's Google address. We mint a random session token,
 * keep it in the script's own properties and send the visitor back to the
 * site with it – auth.js then reads the session from here.
 *
 * This file deliberately uses NO services that need permission
 * (no SpreadsheetApp, no MailApp, no Drive, no UrlFetchApp), so a visitor
 * never sees a consent screen – only Google's own sign-in.
 *
 * DEPLOY (3 minutes):
 *   1. https://script.google.com → New project → paste this file → Save.
 *   2. Deploy ▸ New deployment ▸ Web app
 *        Execute as:     User accessing the web app   ← this is what makes
 *                                                       it THEIR Google account
 *        Who has access: Anyone with Google account
 *   3. Copy the /exec URL into auth.js → NEON_AUTH.authEndpoint
 *      (or paste it into the setup panel on profile.html).
 *
 * CHECK: open the /exec URL in a browser while signed in to Google – you
 * should see {"ok":true,"service":"neon-legacies-google-auth",...}.
 */

var AUTH = {
  SITE: 'https://www.neonlegacies.co.za',
  HOME_PAGE: '/profile.html',
  /** Only these origins may receive a session token – no open redirects. */
  ALLOWED_ORIGINS: [
    'https://www.neonlegacies.co.za',
    'https://neonlegacies.co.za',
    'https://mvmalusii-hub.github.io',   // GitHub Pages preview domain
    'http://localhost:8000',
    'http://localhost:8123'
  ],
  SESSION_DAYS: 7,
  SESSION_PREFIX: 'gsess:',
  MAX_STORED_SESSIONS: 4000,
  BRAND: 'Neon Legacies Enterprise Builder'
};

/** Web app entry point. */
function doGet(e) {
  var params = (e && e.parameter) || {};
  var action = String(params.action || 'health');
  try {
    if (action === 'login') { return loginPage(params); }
    if (action === 'session') { return jsonp(sessionInfo(params), params.callback); }
    if (action === 'signout') { return jsonp(signOut(params), params.callback); }
    return jsonOut({
      ok: true,
      service: 'neon-legacies-google-auth',
      version: 1,
      signedInAs: googleEmail() || null,
      actions: ['login', 'session', 'signout']
    });
  } catch (err) {
    console.error(err);
    return jsonOut({ ok: false, error: 'server error' });
  }
}

/* ------------------------------------------------------------------ */
/* login: Google has already authenticated the visitor                 */
/* ------------------------------------------------------------------ */

function loginPage(params) {
  var email = googleEmail();
  var target = safeReturnUrl(params['return']);

  if (!email) {
    // Deployment is wrong (Execute as: Me) or Google gave us nobody.
    return htmlOut(errorPage(
      'We could not read your Google account.',
      'This web app must be deployed with <b>Execute as: User accessing the ' +
      'web app</b> and <b>Who has access: Anyone with Google account</b>. ' +
      'Fix that in Deploy &#9656; Manage deployments, then sign in again.'));
  }

  var token = randomToken();
  var name = nameFromEmail(email);
  storeSession(token, { email: email, name: name });

  var fragment = '#nl_auth=' + encodeURIComponent(token) +
    '&nl_email=' + encodeURIComponent(email) +
    '&nl_name=' + encodeURIComponent(name) +
    '&nl_method=apps-script';

  return htmlOut(continuePage(email, target + fragment));
}

/** The Google address of the person running this script. */
function googleEmail() {
  try {
    var user = Session.getActiveUser();
    var email = user ? String(user.getEmail() || '') : '';
    return email || '';
  } catch (err) {
    return '';
  }
}

/** "thabo.mokoena@gmail.com" → "Thabo Mokoena" (Google gives us no name). */
function nameFromEmail(email) {
  var local = String(email).split('@')[0]
    .replace(/[._\-+]+/g, ' ')
    .replace(/\b\w/g, function (c) { return c.toUpperCase(); });
  return local || String(email);
}

/** Refuses any return URL that is not one of ours. */
function safeReturnUrl(value) {
  var fallback = AUTH.SITE + AUTH.HOME_PAGE;
  value = String(value || '');
  if (!value) { return fallback; }
  var match = /^(https?:\/\/[^\/?#]+)/.exec(value);
  var origin = match ? match[1] : '';
  if (!origin || AUTH.ALLOWED_ORIGINS.indexOf(origin) === -1) { return fallback; }
  if (/[#<>"]/.test(value) || /^\s*javascript:/i.test(value)) { return fallback; }
  return value;
}

/** 64 characters of randomness, URL-safe. */
function randomToken() {
  var raw = '';
  for (var i = 0; i < 4; i++) { raw += Utilities.getUuid().replace(/-/g, ''); }
  return Utilities.base64EncodeWebSafe(raw).replace(/=+$/, '').slice(0, 64);
}

/* ------------------------------------------------------------------ */
/* session store – script properties, no permissions required          */
/* ------------------------------------------------------------------ */

function tokenHash(token) {
  var digest = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(token));
  var hex = '';
  for (var i = 0; i < digest.length; i++) {
    var value = digest[i] < 0 ? digest[i] + 256 : digest[i];
    hex += ('0' + value.toString(16)).slice(-2);
  }
  return hex;
}

function storeSession(token, record) {
  var lock = LockService.getScriptLock();
  try { lock.waitLock(5000); } catch (err) { /* carry on – worst case a lost row */ }
  try {
    var props = PropertiesService.getScriptProperties();
    pruneSessions(props);
    record.exp = Date.now() + AUTH.SESSION_DAYS * 24 * 60 * 60 * 1000;
    props.setProperty(AUTH.SESSION_PREFIX + tokenHash(token), JSON.stringify(record));
  } finally {
    try { lock.releaseLock(); } catch (err) { /* ignore */ }
  }
  return record;
}

function readSession(token) {
  if (!token) { return null; }
  var props = PropertiesService.getScriptProperties();
  var key = AUTH.SESSION_PREFIX + tokenHash(token);
  var raw = props.getProperty(key);
  if (!raw) { return null; }
  var record = null;
  try { record = JSON.parse(raw); } catch (err) { record = null; }
  if (!record || !record.email) { return null; }
  if (!record.exp || Date.now() > Number(record.exp)) {
    props.deleteProperty(key);
    return null;
  }
  return record;
}

function deleteSession(token) {
  if (!token) { return false; }
  PropertiesService.getScriptProperties()
    .deleteProperty(AUTH.SESSION_PREFIX + tokenHash(token));
  return true;
}

/** Keeps the property store inside its budget by dropping dead sessions. */
function pruneSessions(props) {
  var keys = props.getKeys() || [];
  var sessionKeys = keys.filter(function (key) {
    return key.indexOf(AUTH.SESSION_PREFIX) === 0;
  });
  if (sessionKeys.length < AUTH.MAX_STORED_SESSIONS) { return; }
  var now = Date.now();
  sessionKeys.forEach(function (key) {
    var raw = props.getProperty(key);
    var record = null;
    try { record = JSON.parse(raw); } catch (err) { record = null; }
    if (!record || !record.exp || now > Number(record.exp)) { props.deleteProperty(key); }
  });
}

/* ------------------------------------------------------------------ */
/* actions the site calls over JSONP (Apps Script sends no CORS heads) */
/* ------------------------------------------------------------------ */

/** Is this session token still good? Returns the account it belongs to. */
function sessionInfo(params) {
  var token = String(params.token || '');
  var record = readSession(token);
  if (!record) { return { ok: false, error: 'unknown or expired session' }; }
  return {
    ok: true,
    user: {
      email: String(record.email),
      name: String(record.name || nameFromEmail(record.email)),
      provider: 'google',
      method: 'apps-script'
    },
    session: { expiresAt: new Date(Number(record.exp)).toISOString() }
  };
}

/** Ends a session on the server as well as in the browser. */
function signOut(params) {
  var token = String(params.token || '');
  deleteSession(token);
  return { ok: true, signedOut: true };
}

/* ------------------------------------------------------------------ */
/* output helpers                                                      */
/* ------------------------------------------------------------------ */

function jsonOut(object) {
  return ContentService.createTextOutput(JSON.stringify(object))
    .setMimeType(ContentService.MimeType.JSON);
}

/**
 * JSONP: a <script> tag is not subject to CORS, so the site can read these
 * answers even though Apps Script cannot send CORS headers.
 */
function jsonp(object, callback) {
  var name = String(callback || '').replace(/[^A-Za-z0-9_.$]/g, '').slice(0, 60);
  if (!name) { return jsonOut(object); }
  return ContentService
    .createTextOutput('/**/' + name + '(' + JSON.stringify(object) + ');')
    .setMimeType(ContentService.MimeType.TEXT);
}

function htmlOut(bodyHtml) {
  return HtmlService.createHtmlOutput(bodyHtml)
    .setTitle(AUTH.BRAND + ' – Google sign-in')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function pageShell(inner) {
  return [
    '<!DOCTYPE html><html lang="en"><head><meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    '<style>',
    'body{margin:0;font-family:"Segoe UI",Tahoma,Geneva,Verdana,sans-serif;',
    'background:#f8fafc;color:#1e293b;line-height:1.6;}',
    '.card{max-width:560px;margin:70px auto;padding:36px;background:#fff;',
    'border-radius:16px;box-shadow:0 10px 30px rgba(15,23,42,.08);text-align:center;}',
    '.icon{width:46px;height:46px;border-radius:12px;background:#fbbf24;color:#0f172a;',
    'font-weight:700;display:flex;align-items:center;justify-content:center;',
    'font-size:1.4rem;margin:0 auto 18px;}',
    'h1{font-size:1.35rem;color:#0f172a;margin:0 0 10px;}',
    'p{color:#475569;margin:0 0 22px;font-size:.95rem;}',
    'a.btn{display:inline-block;background:#0f172a;color:#fff;padding:13px 28px;',
    'border-radius:999px;text-decoration:none;font-weight:600;}',
    'a.btn:hover{background:#fbbf24;color:#0f172a;}',
    '.fine{font-size:.78rem;color:#94a3b8;margin-top:20px;}',
    '</style></head><body><div class="card">',
    '<div class="icon">NL</div>',
    inner,
    '</div></body></html>'
  ].join('');
}

/** "You are signed in – go back to the site" (top window, one click). */
function continuePage(email, target) {
  return pageShell([
    '<h1>Signed in with Google</h1>',
    '<p>You are signed in as <b>' + escapeHtml(email) + '</b>. Continue back to ',
    escapeHtml(AUTH.BRAND) + ' to open the member areas.</p>',
    '<a class="btn" id="continueLink" target="_top" href="' + escapeAttr(target) + '">',
    'Continue to ' + escapeHtml(AUTH.BRAND) + ' →</a>',
    '<p class="fine">Your session lasts 7 days on this device.</p>',
    '<script>',
    // HtmlService pages run inside a sandbox iframe: ask the top window to
    // move; if the sandbox refuses, the button above still does the job.
    'var t=' + JSON.stringify(target) + ';',
    'try{window.top.location.replace(t);}catch(a){',
    'try{window.parent.location.replace(t);}catch(b){',
    'var l=document.getElementById("continueLink");',
    'if(l&&typeof l.click==="function"){l.click();}}}',
    '</script>'
  ].join(''));
}

function errorPage(title, detail) {
  return pageShell([
    '<h1>' + escapeHtml(title) + '</h1>',
    '<p>' + detail + '</p>',
    '<a class="btn" target="_top" href="' + escapeAttr(AUTH.SITE + AUTH.HOME_PAGE) + '">',
    'Back to the site</a>'
  ].join(''));
}

function escapeHtml(value) {
  return String(value === null || value === undefined ? '' : value)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function escapeAttr(value) {
  return escapeHtml(value);
}
