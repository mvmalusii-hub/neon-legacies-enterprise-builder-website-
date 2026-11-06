'use strict';
/**
 * Cloudflare Worker (login security headers) – tests.
 *
 *   node apps-script/test/cloudflare-worker.test.js
 *
 * Runs the real cloudflare/security-headers.worker.js against a stubbed
 * origin, and guards the headers that Google sign-in depends on.
 */
let tests = 0;
let assertions = 0;
const failures = [];

function assert(condition, message) {
    assertions += 1;
    if (!condition) { failures.push(message); }
}

function eq(actual, expected, message) {
    assertions += 1;
    if (actual !== expected) {
        failures.push(message + ' (expected ' + JSON.stringify(expected) +
            ', got ' + JSON.stringify(actual) + ')');
    }
}

async function test(name, fn) {
    tests += 1;
    const before = failures.length;
    try {
        await fn();
    } catch (err) {
        failures.push(name + ' threw: ' + (err && err.message ? err.message : err));
    }
    console.log((failures.length === before ? '  ok   ' : '  FAIL ') + name);
}

function htmlReply() {
    return new Response('<!DOCTYPE html><html><body>hi</body></html>', {
        status: 200,
        headers: { 'content-type': 'text/html; charset=utf-8' }
    });
}

/** What GitHub Pages would answer, unless a test says otherwise. */
let originReply = htmlReply;

globalThis.fetch = async function () { return originReply(); };

function page(path) {
    return new Request('https://www.neonlegacies.co.za' + path, { method: 'GET' });
}

(async function main() {
    const worker = (await import('../../cloudflare/security-headers.worker.js')).default;
    console.log('Cloudflare Worker – real security-headers.worker.js\n');

    await test('HTML pages get a CSP that allows the whole Google login flow', async () => {
        const response = await worker.fetch(page('/profile.html'));
        eq(response.status, 200, 'passes the origin status through');
        const csp = response.headers.get('Content-Security-Policy') || '';
        assert(csp.length > 0, 'a CSP is set');
        assert(/script-src[^;]*https:\/\/accounts\.google\.com/.test(csp),
            'allows Google Identity Services');
        assert(/script-src[^;]*https:\/\/script\.google\.com/.test(csp),
            'allows the Auth.gs JSONP session check');
        assert(/connect-src[^;]*https:\/\/oauth2\.googleapis\.com/.test(csp),
            'allows ID-token verification');
        assert(/img-src[^;]*https:\/\/lh3\.googleusercontent\.com/.test(csp),
            'allows Google profile photos');
        assert(/frame-src[^;]*https:\/\/accounts\.google\.com/.test(csp),
            'allows the Google iframe');
        assert(csp.indexOf("'unsafe-eval'") === -1, 'never allows eval');
        assert(/object-src 'none'/.test(csp), 'blocks plugins');
        assert(/frame-ancestors 'self'/.test(csp), 'no click-jacking from other sites');
        assert(/upgrade-insecure-requests/.test(csp), 'upgrades insecure subresources');
        eq(response.headers.get('Content-Security-Policy-Report-Only'), null,
            'enforced, not report-only, by default');
    });

    await test('HTML pages get HSTS, nosniff, referrer and popup-safe COOP', async () => {
        const response = await worker.fetch(page('/index.html'));
        eq(response.headers.get('X-Content-Type-Options'), 'nosniff', 'nosniff');
        eq(response.headers.get('Referrer-Policy'), 'strict-origin-when-cross-origin',
            'referrer policy keeps the domain, drops the path');
        eq(response.headers.get('X-Frame-Options'), 'SAMEORIGIN', 'X-Frame-Options');
        eq(response.headers.get('Cross-Origin-Opener-Policy'), 'same-origin-allow-popups',
            "COOP keeps Google's popup able to talk to the page");
        assert(/max-age=31536000/.test(
            String(response.headers.get('Strict-Transport-Security'))), 'HSTS for a year');
        assert(/geolocation=\(\)/.test(
            String(response.headers.get('Permissions-Policy'))),
            'sensitive browser features off');
    });

    await test('assets get the transport headers but no CSP', async () => {
        originReply = function () {
            return new Response('window.NEON_AUTH = {};', {
                status: 200,
                headers: { 'content-type': 'application/javascript' }
            });
        };
        const response = await worker.fetch(page('/auth.js'));
        eq(response.headers.get('Content-Security-Policy'), null, 'no CSP on JS');
        eq(response.headers.get('X-Content-Type-Options'), 'nosniff', 'still nosniff');
        assert(response.headers.get('Strict-Transport-Security'), 'still HSTS');
        originReply = htmlReply;
    });

    await test('paths that should never be public are blocked', async () => {
        const blocked = ['/.git/config', '/.GIT/HEAD', '/.env', '/.DS_Store',
            '/apps-script/test/google-auth.test.js', '/auth.js.map'];
        for (const path of blocked) {
            const response = await worker.fetch(page(path));
            eq(response.status, 404, path + ' is blocked');
            eq(await response.text(), 'Not found', path + ' leaks nothing');
        }
        const traversal = await worker.fetch(page('/%2e%2e%2f%2e%2e%2fetc%2fpasswd'));
        eq(traversal.status, 404, 'encoded traversal blocked');
        const real = await worker.fetch(page('/profile.html'));
        eq(real.status, 200, 'normal pages still work');
    });

    await test('a 304 keeps its headers and has no body', async () => {
        originReply = function () {
            return new Response(null, { status: 304, headers: { etag: '"abc"' } });
        };
        const response = await worker.fetch(page('/main.css'));
        eq(response.status, 304, '304 passed through');
        eq(await response.text(), '', 'no body on a 304');
        eq(response.headers.get('etag'), '"abc"', 'origin headers preserved');
        eq(response.headers.get('X-Content-Type-Options'), 'nosniff',
            'security headers still added');
        originReply = htmlReply;
    });

    await test('plain http (before the redirect) does not get HSTS', async () => {
        const response = await worker.fetch(
            new Request('http://www.neonlegacies.co.za/index.html'));
        eq(response.headers.get('Strict-Transport-Security'), null,
            'HSTS only over https');
    });

    console.log('\n' + tests + ' tests, ' + assertions + ' assertions');
    if (failures.length) {
        console.log('\nFAILURES (' + failures.length + '):');
        failures.forEach(function (failure) { console.log('  - ' + failure); });
        process.exit(1);
    }
    console.log('All green.');
})();
