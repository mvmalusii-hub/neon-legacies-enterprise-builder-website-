/**
 * Neon Legacies Enterprise Builder – Cloudflare Worker
 * ====================================================
 * GitHub Pages cannot send its own response headers, so this Worker sits in
 * front of www.neonlegacies.co.za and adds the ones that matter for a login:
 * CSP, HSTS, nosniff, a tight Referrer-Policy and a COOP value that keeps
 * Google's sign-in popup working.
 *
 * The Content-Security-Policy is written for THIS site. Every third party
 * here is deliberate:
 *   accounts.google.com        Google Identity Services (gsi/client + iframe)
 *   script.google.com          Auth.gs JSONP session checks (login route B)
 *   oauth2.googleapis.com      ID-token verification (login route A)
 *   lh3.googleusercontent.com  Google profile photos (login route A)
 *   cdnjs.cloudflare.com       Font Awesome
 *   fonts.googleapis.com / fonts.gstatic.com  Google Fonts
 *   www.youtube.com            the one embedded video
 * 'unsafe-inline' is required because the pages use inline <script> blocks
 * and inline style="" attributes, which a static host cannot give nonces.
 *
 * DEPLOY: Cloudflare dashboard ▸ Workers & Pages ▸ Create ▸ Worker
 *         → paste this file → Deploy
 *         → Workers Routes: www.neonlegacies.co.za/* (zone neonlegacies.co.za)
 */

const CONFIG = {
  /** Paths that should never be public, even though the repo publishes them. */
  BLOCKED: [
    /^\/\.git(\/|$)/,
    /^\/\.env/,
    /^\/\.ds_store$/,
    /^\/apps-script\/test(\/|$)/,
    /\.map$/,
    /(^|\/)\.\.(\/|$)/
  ],
  /** Send CSP in report-only mode first if you want to watch for breakage. */
  CSP_REPORT_ONLY: false,
  HSTS: 'max-age=31536000; includeSubDomains',
  HSTS_PRELOAD: false,
  /** Only add the CSP to HTML – JS/CSS/images do not need it. */
  CSP_HTML_ONLY: true
};

const CSP = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "frame-ancestors 'self'",
  "form-action 'self' https://script.google.com",
  "script-src 'self' 'unsafe-inline' https://accounts.google.com https://script.google.com https://cdnjs.cloudflare.com",
  "style-src 'self' 'unsafe-inline' https://cdnjs.cloudflare.com https://fonts.googleapis.com",
  "font-src 'self' data: https://cdnjs.cloudflare.com https://fonts.gstatic.com",
  "img-src 'self' data: https://lh3.googleusercontent.com https://*.googleusercontent.com",
  "frame-src 'self' https://accounts.google.com https://www.youtube.com https://www.youtube-nocookie.com",
  "connect-src 'self' https://oauth2.googleapis.com https://accounts.google.com",
  "manifest-src 'self'",
  "worker-src 'self'",
  "upgrade-insecure-requests"
].join('; ');

/** True when a path must not be served at all. */
function isBlocked(pathname) {
    let path = String(pathname || '/');
    try { path = decodeURIComponent(path); } catch (err) { /* keep raw */ }
    path = path.toLowerCase();
    return CONFIG.BLOCKED.some(function (pattern) { return pattern.test(path); });
}

function isHtml(response) {
    const type = (response.headers.get('content-type') || '').toLowerCase();
    return type.indexOf('text/html') !== -1;
}

/** The headers every response should carry. */
function securityHeaders(response, requestUrl) {
    const headers = new Headers(response ? response.headers : undefined);
    headers.set('X-Content-Type-Options', 'nosniff');
    headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
    headers.set('X-Frame-Options', 'SAMEORIGIN');
    headers.set('Permissions-Policy',
        'geolocation=(), camera=(), microphone=(), payment=(), usb=()');
    // Google's sign-in popup needs to keep its opener; "same-origin" breaks it.
    headers.set('Cross-Origin-Opener-Policy', 'same-origin-allow-popups');
    headers.set('Cross-Origin-Resource-Policy', 'same-origin');

    let secure = true;
    try { secure = new URL(String(requestUrl)).protocol === 'https:'; } catch (err) { secure = true; }
    if (secure) {
        headers.set('Strict-Transport-Security',
            CONFIG.HSTS_PRELOAD ? CONFIG.HSTS + '; preload' : CONFIG.HSTS);
    }

    const wantsCsp = !CONFIG.CSP_HTML_ONLY || !response || isHtml(response);
    if (wantsCsp) {
        headers.set(
            CONFIG.CSP_REPORT_ONLY
                ? 'Content-Security-Policy-Report-Only'
                : 'Content-Security-Policy',
            CSP
        );
    }
    return headers;
}

export default {
    async fetch(request) {
        const url = new URL(request.url);

        if (isBlocked(url.pathname)) {
            return new Response('Not found', {
                status: 404,
                headers: {
                    'content-type': 'text/plain; charset=utf-8',
                    'X-Content-Type-Options': 'nosniff',
                    'Cache-Control': 'no-store'
                }
            });
        }

        const origin = await fetch(request);
        const headers = securityHeaders(origin, url.href);

        // 304s and 204s must not carry a body.
        if (origin.status === 304 || origin.status === 204) {
            return new Response(null, {
                status: origin.status,
                statusText: origin.statusText,
                headers
            });
        }

        return new Response(origin.body, {
            status: origin.status,
            statusText: origin.statusText,
            headers
        });
    },

    // Exported for the tests.
    _internals: { isBlocked, securityHeaders, CSP, CONFIG }
};
