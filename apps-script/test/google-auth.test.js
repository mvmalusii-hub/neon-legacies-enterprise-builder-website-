'use strict';
/**
 * Google Sign-in – end-to-end tests.
 *
 *   node apps-script/test/google-auth.test.js
 *
 * The suite runs the REAL apps-script/Code.gs (through an Apps Script
 * stub) and the REAL auth.js / app.js (through a small fake DOM), so it
 * covers the whole path: Google's button → ID token → verification →
 * session → gated pages → backend audit row.
 */
const dom = require('./dom-stub');
const backend = require('./appsscript-stub');

const CLIENT_ID = '1234567890-abcdefghijklmnop.apps.googleusercontent.com';
const SHARED_TOKEN = 'REPLACE_WITH_A_LONG_RANDOM_STRING';   // matches Code.gs CONFIG

/* ------------------------------------------------------------------ */
/* tiny test framework                                                 */
/* ------------------------------------------------------------------ */
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

/* ------------------------------------------------------------------ */
/* ID token helpers                                                    */
/* ------------------------------------------------------------------ */
function b64url(value) {
    return Buffer.from(JSON.stringify(value)).toString('base64')
        .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function makeJwt(payload, header) {
    return b64url(header || { alg: 'RS256', typ: 'JWT', kid: 'abc123' }) +
        '.' + b64url(payload) + '.c2lnbmF0dXJl';
}

function claims(overrides) {
    const now = Math.floor(Date.now() / 1000);
    return Object.assign({
        iss: 'https://accounts.google.com',
        azp: CLIENT_ID,
        aud: CLIENT_ID,
        sub: '104687291827364518273',
        email: 'thabo.mokoena@gmail.com',
        email_verified: true,
        name: 'Thabo Mokoena',
        given_name: 'Thabo',
        family_name: 'Mokoena',
        picture: 'https://lh3.googleusercontent.com/a/ACg8ocI=photo',
        locale: 'en-ZA',
        iat: now,
        exp: now + 3600
    }, overrides || {});
}

/**
 * Google's tokeninfo answers with the verified claims of the token it was
 * asked about – so the stub decodes the token in the URL and echoes it.
 * A token Google cannot parse is refused, exactly like a bad signature.
 */
function echoToken(url) {
    const token = decodeURIComponent(String(url).split('id_token=')[1] || '');
    const parts = token.split('.');
    if (parts.length !== 3) { return { code: 400, body: '{"error":"invalid_token"}' }; }
    try {
        const json = Buffer.from(parts[1].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
        return { code: 200, body: JSON.stringify(JSON.parse(json)) };
    } catch (err) {
        return { code: 400, body: '{"error":"invalid_token"}' };
    }
}

/** Backend whose tokeninfo endpoint answers like Google would. */
function makeBackend(answer) {
    const app = backend.loadCode({
        tokenInfo: function (url) {
            if (url.indexOf('https://oauth2.googleapis.com/tokeninfo?id_token=') !== 0) {
                return { code: 404, body: '{"error":"unexpected url"}' };
            }
            if (!answer) { return echoToken(url); }   // Google vouches for this token
            return typeof answer === 'function' ? answer(url) : answer;
        }
    });
    // The repo ships with a placeholder; the owner pastes the real id in.
    app.sandbox.GOOGLE.CLIENT_ID = CLIENT_ID;
    return app;
}

/** Lets queued microtasks (GIS init, promise chains) run. */
function settle() {
    return new Promise(function (resolve) { setTimeout(resolve, 0); });
}

function googleLoginPayload(credential, overrides) {
    return Object.assign({
        action: 'googleLogin',
        formType: 'Google Sign-in',
        name: 'Thabo Mokoena',
        email: 'thabo.mokoena@gmail.com',
        page: 'profile.html',
        credential: credential,
        token: SHARED_TOKEN,
        id: 'glogin-test-' + Math.random().toString(36).slice(2, 8)
    }, overrides || {});
}

function loginRows(app) {
    return app.state.sheets.Logins ? app.state.sheets.Logins.rows.slice(1) : [];
}

/* ------------------------------------------------------------------ */
/* 1. Backend: Code.gs verifies the token before it trusts anything    */
/* ------------------------------------------------------------------ */
async function backendTests() {
    console.log('\nBackend (apps-script/Code.gs)');

    await test('a verified Google token is accepted and recorded', async () => {
        const app = makeBackend();
        const reply = app.post(googleLoginPayload(makeJwt(claims())));
        eq(reply.ok, true, 'sign-in should succeed');
        eq(reply.user.email, 'thabo.mokoena@gmail.com', 'reply carries the Google email');
        eq(reply.user.sub, '104687291827364518273', 'reply carries the Google account id');
        eq(reply.session.days, 7, 'session length is published');
        const rows = loginRows(app);
        eq(rows.length, 1, 'one Logins row written');
        eq(rows[0][1], '104687291827364518273', 'Logins row has the Google id');
        eq(rows[0][3], 'thabo.mokoena@gmail.com', 'Logins row has the email');
        eq(rows[0][5], 'profile.html', 'Logins row has the page');
        eq(app.state.mails.length, 1, 'team told about the new account');
        assert(/New Google sign-in/.test(app.state.mails[0].subject), 'mail subject says Google sign-in');
        eq(app.state.fetches.length, 1, 'Google tokeninfo was consulted');
    });

    await test('a token issued for another site is rejected', async () => {
        const app = makeBackend();
        const reply = app.post(googleLoginPayload(makeJwt(claims({ aud: 'someone-elses-client-id' }))));
        eq(reply.ok, false, 'must be rejected');
        eq(reply.error, 'wrong audience', 'reason is wrong audience');
        eq(loginRows(app).length, 0, 'nothing recorded');
        eq(app.state.mails.length, 0, 'no mail sent');
    });

    await test('an expired token is rejected', async () => {
        const app = makeBackend();
        const expired = claims({ exp: Math.floor(Date.now() / 1000) - 60 });
        const reply = app.post(googleLoginPayload(makeJwt(expired)));
        eq(reply.ok, false, 'must be rejected');
        eq(reply.error, 'token expired', 'reason is expiry');
        eq(loginRows(app).length, 0, 'nothing recorded');
    });

    await test('an unverified email address is rejected', async () => {
        const app = makeBackend();
        const reply = app.post(googleLoginPayload(makeJwt(claims({ email_verified: false }))));
        eq(reply.ok, false, 'must be rejected');
        eq(reply.error, 'email not verified', 'reason is unverified email');
    });

    await test('a token Google does not vouch for is rejected', async () => {
        const app = makeBackend({ code: 400, body: '{"error":"invalid_token"}' });
        const reply = app.post(googleLoginPayload(makeJwt(claims())));
        eq(reply.ok, false, 'must be rejected');
        eq(reply.error, 'Google rejected the token', 'reason is Google rejection');
        eq(loginRows(app).length, 0, 'nothing recorded');
    });

    await test('a forged token from a non-Google issuer is rejected', async () => {
        const app = makeBackend();
        const reply = app.post(googleLoginPayload(makeJwt(claims({ iss: 'https://evil.example.com' }))));
        eq(reply.ok, false, 'must be rejected');
        eq(reply.error, 'wrong issuer', 'reason is wrong issuer');
        eq(loginRows(app).length, 0, 'nothing recorded');
    });

    await test('replaying the same token does not duplicate the row', async () => {
        const app = makeBackend();
        const token = makeJwt(claims({ iat: 1700000000 }));
        const first = app.post(googleLoginPayload(token));
        const second = app.post(googleLoginPayload(token));
        eq(first.ok, true, 'first sign-in accepted');
        eq(second.ok, true, 'replay is not an error');
        eq(second.duplicate, true, 'replay is flagged as a duplicate');
        eq(loginRows(app).length, 1, 'still only one Logins row');
        eq(app.state.mails.length, 1, 'team only emailed once');
    });

    await test('sign-ins are throttled per Google account', async () => {
        const app = makeBackend();
        let last = null;
        for (let i = 0; i < 22; i++) {
            last = app.post(googleLoginPayload(makeJwt(claims({ iat: 1700000000 + i }))));
        }
        eq(last.ok, false, 'eventually refused');
        eq(last.error, 'too many sign-ins', 'reason is throttling');
        eq(loginRows(app).length, 20, 'only 20 rows written');
    });

    await test('the shared token still guards the endpoint', async () => {
        const app = makeBackend();
        const reply = app.post(googleLoginPayload(makeJwt(claims()), { token: 'wrong-token' }));
        eq(reply.ok, false, 'must be rejected');
        eq(reply.error, 'unauthorised', 'reason is unauthorised');
        eq(loginRows(app).length, 0, 'nothing recorded');
    });

    await test('an unconfigured GOOGLE.CLIENT_ID refuses every sign-in', async () => {
        const app = backend.loadCode({
            tokenInfo: function () { return { code: 200, body: JSON.stringify(claims()) }; }
        });
        const reply = app.post(googleLoginPayload(makeJwt(claims())));
        eq(reply.ok, false, 'must be rejected');
        eq(reply.error, 'GOOGLE.CLIENT_ID not configured', 'says exactly what is missing');
        eq(app.state.fetches.length, 0, 'Google was not even called');
    });

    await test('ordinary leads still work (no regression)', async () => {
        const app = makeBackend();
        const reply = app.post({
            formType: 'Order', name: 'Sipho N.', email: 'sipho@example.co.za',
            message: 'Need a COIDA letter', token: SHARED_TOKEN
        });
        eq(reply.ok, true, 'lead accepted');
        assert(/^ORD-/.test(reply.reference), 'reference looks like ORD-…');
        const rows = app.state.sheets.Leads.rows.slice(1);
        eq(rows.length, 1, 'one Leads row');
        eq(rows[0][3], 'Sipho N.', 'lead name stored');
        eq(app.state.sheets.Logins, undefined, 'no Logins tab for a lead');
    });
}

/* ------------------------------------------------------------------ */
/* 2. Client: the real auth.js / app.js in a fake browser              */
/* ------------------------------------------------------------------ */

/** fetch() that answers the tokeninfo call the way Google would. */
function makeFetch(win, answer) {
    return function (url, opts) {
        win.fetchCalls.push({ url: String(url), opts: opts || {} });
        if (String(url).indexOf('https://oauth2.googleapis.com/tokeninfo?id_token=') === 0) {
            const result = typeof answer === 'function'
                ? answer(String(url))
                : (answer || echoToken(String(url)));
            let parsed = {};
            try { parsed = JSON.parse(result.body); } catch (e) { parsed = {}; }
            return Promise.resolve({
                ok: result.code === 200,
                status: result.code,
                json: function () { return Promise.resolve(parsed); }
            });
        }
        return Promise.resolve({ ok: false, status: 404, json: function () { return Promise.resolve({}); } });
    };
}

/** The profile page: Google card, tabs, both forms, sidebar. */
function makeProfilePage(options) {
    options = options || {};
    const doc = dom.makeDocument();

    dom.addElement(doc, 'div', null, 'sidebar-header');
    const accountPanel = dom.addElement(doc, 'div', 'accountPanel', 'form-card account-panel hidden');
    const googleCard = dom.addElement(doc, 'div', null, 'form-card google-card');
    const container = dom.addElement(doc, 'div', 'googleSignInContainer', 'google-signin-container');
    const authMessage = dom.addElement(doc, 'div', 'authMessage', 'message');
    googleCard.appendChild(container);
    googleCard.appendChild(authMessage);

    const tabs = dom.addElement(doc, 'div', null, 'tab-container');
    const loginTab = dom.addElement(doc, 'button', 'loginTab', 'tab-btn active');
    const signupTab = dom.addElement(doc, 'button', 'signupTab', 'tab-btn');
    tabs.appendChild(loginTab);
    tabs.appendChild(signupTab);

    const loginCard = dom.addElement(doc, 'div', 'loginForm', 'form-card');
    const loginForm = dom.addElement(doc, 'form', 'loginFormElement');
    const loginEmail = dom.addElement(doc, 'input', 'loginEmail');
    loginEmail.value = '';
    dom.addElement(doc, 'input', 'loginPassword');
    dom.addElement(doc, 'button', 'googleLoginBtn', 'btn google-btn');
    const loginMessage = dom.addElement(doc, 'div', 'loginMessage', 'message');
    loginCard.appendChild(loginForm);

    const signupCard = dom.addElement(doc, 'div', 'signupForm', 'form-card hidden');
    dom.addElement(doc, 'form', 'signupFormElement');

    const googleState = {};
    const google = dom.makeGoogleMock(doc, googleState);
    const win = dom.makeWindow(doc, {
        google: google,
        fetch: function (url, opts) { return makeFetch(win, options.tokenInfo)(url, opts); }
    });

    dom.loadScript(win, 'auth.js');
    win.NEON_AUTH.googleClientId = options.unconfigured
        ? 'REPLACE_WITH_GOOGLE_OAUTH_CLIENT_ID.apps.googleusercontent.com'
        : CLIENT_ID;
    if (options.app) { dom.loadScript(win, 'app.js'); }
    doc.fireDomReady();

    return {
        doc: doc, win: win, googleState: googleState,
        accountPanel: accountPanel, googleCard: googleCard, container: container,
        authMessage: authMessage, tabs: tabs, loginTab: loginTab, signupTab: signupTab,
        loginCard: loginCard, signupCard: signupCard, loginMessage: loginMessage,
        loginEmail: loginEmail
    };
}

/** A session as auth.js would have left it in localStorage. */
function liveSession(overrides) {
    return Object.assign({
        provider: 'google',
        sub: '104687291827364518273',
        email: 'thabo.mokoena@gmail.com',
        name: 'Thabo Mokoena',
        givenName: 'Thabo',
        familyName: 'Mokoena',
        picture: '',
        signedInAt: Date.now(),
        expiresAt: Date.now() + 86400000
    }, overrides || {});
}

/** A gated page (strategic-growth style) with app.js loaded. */
function makeGatedPage(options) {
    options = options || {};
    const doc = dom.makeDocument();
    dom.addElement(doc, 'div', null, 'sidebar-header');
    const warning = dom.addElement(doc, 'div', 'loginWarning', 'login-warning hidden');
    warning.innerHTML = '⚠️ You are not logged in. <a href="profile.html">Sign in with Google</a> to book a consultation.';
    const form = dom.addElement(doc, 'form', 'growthForm');
    const date = dom.addElement(doc, 'input', 'appointmentDate');
    const message = dom.addElement(doc, 'div', 'submitMessage', 'message');

    const googleState = {};
    const win = dom.makeWindow(doc, {
        google: dom.makeGoogleMock(doc, googleState),
        fetch: function (url, opts) { return makeFetch(win, options.tokenInfo)(url, opts); }
    });
    if (options.session) {
        win.localStorage.setItem('neonAuthSession', JSON.stringify(options.session));
    }

    dom.loadScript(win, 'auth.js');
    win.NEON_AUTH.googleClientId = CLIENT_ID;
    dom.loadScript(win, 'app.js');
    doc.fireDomReady();
    return { doc: doc, win: win, warning: warning, form: form, date: date, message: message };
}

/** The business hub page (comments) with app.js loaded. */
function makeHubPage(options) {
    options = options || {};
    const doc = dom.makeDocument();
    dom.addElement(doc, 'div', null, 'sidebar-header');
    const warning = dom.addElement(doc, 'div', 'loginWarning', 'login-warning hidden');
    const commentArea = dom.addElement(doc, 'div', 'commentArea');
    const commentList = dom.addElement(doc, 'div', 'commentList');
    const newComment = dom.addElement(doc, 'textarea', 'newComment');
    const postBtn = dom.addElement(doc, 'button', 'postCommentBtn', 'btn');
    commentArea.appendChild(commentList);
    commentArea.appendChild(newComment);
    commentArea.appendChild(postBtn);

    const googleState = {};
    const win = dom.makeWindow(doc, {
        google: dom.makeGoogleMock(doc, googleState),
        fetch: function (url, opts) { return makeFetch(win, options.tokenInfo)(url, opts); }
    });
    if (options.session) {
        win.localStorage.setItem('neonAuthSession', JSON.stringify(options.session));
    }

    dom.loadScript(win, 'auth.js');
    win.NEON_AUTH.googleClientId = CLIENT_ID;
    dom.loadScript(win, 'app.js');
    doc.fireDomReady();
    return {
        doc: doc, win: win, warning: warning, commentArea: commentArea,
        commentList: commentList, newComment: newComment, postBtn: postBtn
    };
}

async function clientTests() {
    console.log('\nClient (auth.js + app.js)');

    await test('Google renders its own button on the profile page', async () => {
        const page = makeProfilePage();
        await settle();                       // GIS initialisation is async
        eq(page.googleState.initializeCalls, 1, 'GIS initialised');
        eq(page.googleState.config.client_id, CLIENT_ID, 'GIS given our client id');
        eq(typeof page.googleState.config.callback, 'function', 'GIS given a callback');
        eq(page.googleState.rendered.length, 1, 'official button rendered');
        assert(page.doc.getElementById('gsiRenderedButton'), 'button is inside the container');
        eq(page.doc.getElementById('googleLoginBtn').style.display, 'none', 'look-alike button hidden');
    });

    await test('a verified Google credential creates the session and the UI', async () => {
        const page = makeProfilePage();
        const session = await page.win.NEON_AUTH.handleCredential({ credential: makeJwt(claims()) });
        eq(session.email, 'thabo.mokoena@gmail.com', 'session email');
        eq(session.provider, 'google', 'provider recorded');
        eq(page.win.NEON_AUTH.isLoggedIn(), true, 'signed in');
        assert(page.win.localStorage.getItem('neonAuthSession'), 'session persisted');
        eq(page.win.localStorage.getItem('userEmail'), 'thabo.mokoena@gmail.com', 'legacy key written');
        eq(page.win.fetchCalls.length, 1, 'Google asked to verify the token');
        assert(page.win.fetchCalls[0].url.indexOf('tokeninfo?id_token=') > 0, 'tokeninfo was called');

        assert(!page.accountPanel.classList.contains('hidden'), 'account panel shown');
        assert(page.accountPanel.innerHTML.indexOf('thabo.mokoena@gmail.com') !== -1, 'panel shows the email');
        assert(page.accountPanel.innerHTML.indexOf('Thabo Mokoena') !== -1, 'panel shows the name');
        assert(page.tabs.classList.contains('hidden'), 'login tabs hidden while signed in');
        assert(page.googleCard.classList.contains('hidden'), 'Google card hidden while signed in');
        const chip = page.doc.getElementById('neonAuthChip');
        assert(chip, 'sidebar chip created');
        assert(chip.innerHTML.indexOf('Thabo Mokoena') !== -1, 'chip names the visitor');
    });

    await test('a token Google rejects creates no session', async () => {
        const page = makeProfilePage({ tokenInfo: { code: 400, body: '{"error":"invalid_token"}' } });
        let error = null;
        try {
            await page.win.NEON_AUTH.handleCredential({ credential: makeJwt(claims()) });
        } catch (err) { error = err; }
        assert(error, 'sign-in must fail');
        eq(page.win.NEON_AUTH.isLoggedIn(), false, 'no session');
        eq(page.win.localStorage.getItem('neonAuthSession'), null, 'nothing stored');
        assert(page.authMessage.innerHTML.indexOf('Google rejected this sign-in') !== -1,
            'visitor told why: ' + page.authMessage.innerHTML);
        assert(page.accountPanel.classList.contains('hidden'), 'account panel stays hidden');
    });

    await test('a token minted for another site is refused without calling Google', async () => {
        const page = makeProfilePage();
        let error = null;
        try {
            await page.win.NEON_AUTH.handleCredential({
                credential: makeJwt(claims({ aud: 'another-sites-client-id' }))
            });
        } catch (err) { error = err; }
        assert(error && /different site/.test(error.message), 'audience refused: ' + (error && error.message));
        eq(page.win.fetchCalls.length, 0, 'no network call needed');
        eq(page.win.NEON_AUTH.isLoggedIn(), false, 'no session');
    });

    await test('a malformed credential is refused', async () => {
        const page = makeProfilePage();
        let error = null;
        try {
            await page.win.NEON_AUTH.handleCredential({ credential: 'not-a-real-jwt' });
        } catch (err) { error = err; }
        assert(error && /not a valid Google token/.test(error.message), 'malformed refused');
        eq(page.win.NEON_AUTH.isLoggedIn(), false, 'no session');
    });

    await test('the token and Google must describe the same account', async () => {
        const page = makeProfilePage({
            tokenInfo: { code: 200, body: JSON.stringify(claims({ sub: '999999999999999999999' })) }
        });
        let error = null;
        try {
            await page.win.NEON_AUTH.handleCredential({ credential: makeJwt(claims()) });
        } catch (err) { error = err; }
        assert(error && /different account/.test(error.message), 'mismatch caught: ' + (error && error.message));
        eq(page.win.NEON_AUTH.isLoggedIn(), false, 'no session');
    });

    await test('an expired stored session is dropped', async () => {
        const page = makeProfilePage();
        page.win.localStorage.setItem('neonAuthSession',
            JSON.stringify(liveSession({ expiresAt: Date.now() - 1000 })));
        eq(page.win.NEON_AUTH.isLoggedIn(), false, 'expired session ignored');
        eq(page.win.localStorage.getItem('neonAuthSession'), null, 'expired session removed');
        assert(page.accountPanel.classList.contains('hidden'), 'panel stays hidden');
    });

    await test('a hand-written session without a Google token is not honoured', async () => {
        const page = makeProfilePage();
        page.win.localStorage.setItem('neonAuthSession',
            JSON.stringify({ email: 'me@example.com', name: 'Me' }));
        eq(page.win.NEON_AUTH.isLoggedIn(), false, 'junk session ignored');
        eq(page.win.localStorage.getItem('neonAuthSession'), null, 'junk session removed');
    });

    await test('signing out clears the session, the UI and Google auto-select', async () => {
        const page = makeProfilePage();
        await page.win.NEON_AUTH.handleCredential({ credential: makeJwt(claims()) });
        const events = [];
        page.win.NEON_AUTH.onChange(function (event) { events.push(event.type); });

        page.win.NEON_AUTH.logout();

        eq(page.win.NEON_AUTH.isLoggedIn(), false, 'signed out');
        eq(page.win.localStorage.getItem('neonAuthSession'), null, 'session removed');
        eq(page.win.localStorage.getItem('userEmail'), null, 'legacy key removed');
        eq(page.googleState.autoSelectDisabled, 1, 'Google auto-select disabled');
        assert(events.indexOf('signout') !== -1, 'signout event fired');
        assert(page.accountPanel.classList.contains('hidden'), 'account panel hidden again');
        assert(!page.tabs.classList.contains('hidden'), 'login tabs are back');
        assert(!page.googleCard.classList.contains('hidden'), 'Google card is back');
        const chip = page.doc.getElementById('neonAuthChip');
        assert(chip && !chip.parentNode, 'chip removed from the sidebar');
    });

    await test('a gated page unlocks for a signed-in visitor', async () => {
        const page = makeGatedPage({ session: liveSession() });
        assert(page.warning.classList.contains('hidden'), 'login warning hidden');
        page.date.value = '2027-01-15';
        page.form.submit();
        assert(/request has been received/.test(page.message.innerHTML),
            'form accepted: ' + page.message.innerHTML);
    });

    await test('a gated page stays locked when nobody is signed in', async () => {
        const page = makeGatedPage();
        assert(!page.warning.classList.contains('hidden'), 'login warning shown');
        page.date.value = '2027-01-15';
        page.form.submit();
        assert(/log in/.test(page.message.innerHTML),
            'visitor sent to sign in: ' + page.message.innerHTML);
        assert(/Sign in with Google/.test(page.warning.innerHTML),
            'warning points at Google sign-in');
    });

    await test('business hub comments carry the signed-in Google name', async () => {
        const page = makeHubPage({ session: liveSession() });
        assert(page.warning.classList.contains('hidden'), 'login warning hidden');
        assert(!page.commentArea.classList.contains('hidden'), 'comment area open');
        page.newComment.value = 'Anyone know a good COIDA agent?';
        page.postBtn.click();
        const stored = JSON.parse(page.win.localStorage.getItem('hubComments') || '[]');
        assert(stored.length > 0, 'comment stored');
        const newest = stored[stored.length - 1];
        eq(newest.text, 'Anyone know a good COIDA agent?', 'the new comment is there');
        eq(newest.author, 'Thabo Mokoena', 'attributed to the Google account');
    });

    await test('business hub stays closed to signed-out visitors', async () => {
        const page = makeHubPage();
        assert(page.commentArea.classList.contains('hidden'), 'comment area closed');
        page.newComment.value = 'Let me in';
        page.postBtn.click();
        eq(page.win.localStorage.getItem('hubComments'), null, 'nothing posted');
        eq(page.win.alerts.length, 1, 'visitor told to sign in');
    });

    await test('without a client id the button explains instead of pretending', async () => {
        const page = makeProfilePage({ unconfigured: true });
        eq(page.googleState.initializeCalls, 0, 'GIS never initialised');
        eq(page.googleState.rendered.length, 0, 'no button rendered');
        page.doc.getElementById('googleLoginBtn').click();
        eq(page.win.alerts.length, 0, 'no alert() pop-up');
        assert(/not switched on yet/.test(page.authMessage.innerHTML),
            'explains what is missing: ' + page.authMessage.innerHTML);
        eq(page.win.NEON_AUTH.isLoggedIn(), false, 'nobody signed in');
    });

    await test('Google profile text cannot inject markup', async () => {
        const hostile = '<img src=x onerror=alert(1)>';
        const page = makeProfilePage({
            tokenInfo: {
                code: 200,
                body: JSON.stringify(claims({ name: hostile, picture: '' }))
            }
        });
        await page.win.NEON_AUTH.handleCredential({
            credential: makeJwt(claims({ name: hostile, picture: '' }))
        });
        const html = page.accountPanel.innerHTML;
        assert(html.indexOf('<img src=x') === -1, 'no live markup: ' + html);
        assert(html.indexOf('&lt;img src=x onerror=alert(1)&gt;') !== -1, 'shown escaped');
        assert(html.indexOf('account-avatar-initials') !== -1, 'initials avatar used');
        eq(page.win.alerts.length, 0, 'nothing executed');
    });

    await test('app.js still runs on pages that do not load auth.js', async () => {
        const doc = dom.makeDocument();
        const warning = dom.addElement(doc, 'div', 'loginWarning', 'login-warning hidden');
        const form = dom.addElement(doc, 'form', 'growthForm');
        const date = dom.addElement(doc, 'input', 'appointmentDate');
        const message = dom.addElement(doc, 'div', 'submitMessage', 'message');
        const win = dom.makeWindow(doc, {});

        dom.loadScript(win, 'app.js');        // index.html and friends have no auth.js
        doc.fireDomReady();

        eq(typeof win.NEON_AUTH, 'undefined', 'no auth module on this page');
        assert(!warning.classList.contains('hidden'), 'gating stays locked');
        date.value = '2027-01-15';
        form.submit();
        assert(/log in/.test(message.innerHTML), 'visitor still sent to sign in');
    });
}

/* ------------------------------------------------------------------ */
/* 3. The browser report and the backend agree                         */
/* ------------------------------------------------------------------ */
async function integrationTests() {
    console.log('\nClient → backend');

    await test('the sign-in the browser reports is accepted by Code.gs', async () => {
        const app = makeBackend();
        const page = makeProfilePage({ app: true });
        let sent = null;
        page.win.NEON_LEADS.send = function (payload) {
            sent = payload;
            return Promise.resolve({ ok: true });
        };

        const credential = makeJwt(claims());
        await page.win.NEON_AUTH.handleCredential({ credential: credential });

        assert(sent, 'sign-in reported to the backend');
        eq(sent.action, 'googleLogin', 'action is googleLogin');
        eq(sent.credential, credential, 'token passed on for re-verification');
        eq(sent.email, 'thabo.mokoena@gmail.com', 'email included');
        eq(sent.token, page.win.NEON_LEADS.token, 'shared token included');

        const reply = app.post(sent);
        eq(reply.ok, true, 'backend accepts what the browser sent');
        eq(loginRows(app).length, 1, 'Logins row written');
    });
}

/* ------------------------------------------------------------------ */
/* 4. The shipped pages are actually wired to auth.js                  */
/* ------------------------------------------------------------------ */
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..', '..');
const GATED_PAGES = [
    'business-hub.html', 'business-partners.html', 'hire-admin.html',
    'international.html', 'market-leads.html', 'partners.html',
    'referral.html', 'strategic-growth.html'
];

function read(file) {
    return fs.readFileSync(path.join(ROOT, file), 'utf8');
}

async function wiringTests() {
    console.log('\nPage wiring');

    await test('profile.html has the Google button, the account card and auth.js', async () => {
        const html = read('profile.html');
        assert(/id="googleSignInContainer"/.test(html), 'Google button container present');
        assert(/id="accountPanel"/.test(html), 'account panel present');
        assert(/id="authMessage"/.test(html), 'auth message area present');
        assert(/id="googleLoginBtn"/.test(html), 'fallback button kept');
        assert(/<script src="auth\.js"><\/script>\s*\n\s*<script src="app\.js"><\/script>/.test(html),
            'auth.js loads before app.js');
        assert(/<meta name="viewport"/.test(html), 'viewport meta present');
    });

    await test('every gated page loads auth.js and points at Google sign-in', async () => {
        GATED_PAGES.forEach(function (page) {
            const html = read(page);
            assert(html.indexOf('<script src="auth.js"></script>') !== -1,
                page + ' loads auth.js');
            assert(html.indexOf('app.js') > html.indexOf('auth.js'),
                page + ' loads auth.js before app.js');
            assert(/Sign in with Google<\/a>/.test(html),
                page + ' warning says Sign in with Google');
            assert(/Please log in or create a profile/.test(html) === false,
                page + ' no longer uses the old wording');
        });
    });

    await test('logout.html ends the Google session', async () => {
        const html = read('logout.html');
        assert(html.indexOf('<script src="auth.js"></script>') !== -1, 'auth.js loaded');
        assert(/NEON_AUTH\.logout\(\)/.test(html), 'session ended through auth.js');
        assert(/neonAuthSession/.test(html), 'session key swept as a fallback');
    });

    await test('no page still promises that OAuth is coming later', async () => {
        const files = fs.readdirSync(ROOT).filter(function (f) { return /\.html$|^app\.js$/.test(f); });
        files.forEach(function (file) {
            const text = read(file);
            assert(/will be integrated later using OAuth/.test(text) === false,
                file + ' has no OAuth placeholder');
            assert(/Login successful \(demo\)/.test(text) === false,
                file + ' has no demo login');
        });
        const app = read('app.js');
        assert(/isLoggedIn = false/.test(app) === false, 'no hard-coded logged-out flag');
        assert(/function authed\(\)/.test(app), 'app.js asks auth.js for the session');
        eq((app.match(/const isLoggedIn = authed\(\);/g) || []).length, 8,
            'all eight gated sections read the real session');
    });

    await test('Code.gs and auth.js agree on where the client id goes', async () => {
        const code = read('apps-script/Code.gs');
        const auth = read('auth.js');
        assert(/CLIENT_ID: 'REPLACE_WITH_GOOGLE_OAUTH_CLIENT_ID\.apps\.googleusercontent\.com'/.test(code),
            'Code.gs has the placeholder client id');
        assert(/googleClientId: 'REPLACE_WITH_GOOGLE_OAUTH_CLIENT_ID\.apps\.googleusercontent\.com'/.test(auth),
            'auth.js has the same placeholder');
        assert(/action=googleLogin|action === 'googleLogin'/.test(code), 'Code.gs handles googleLogin');
        assert(/action: 'googleLogin'/.test(auth), 'auth.js sends googleLogin');
        assert(/oauth2\.googleapis\.com\/tokeninfo/.test(code) &&
               /oauth2\.googleapis\.com\/tokeninfo/.test(auth),
            'both sides verify with Google');
    });
}

/* ------------------------------------------------------------------ */
(async function main() {
    console.log('Google Sign-in tests – real Code.gs, real auth.js, real app.js');
    await backendTests();
    await clientTests();
    await integrationTests();
    await wiringTests();

    console.log('\n' + tests + ' tests, ' + assertions + ' assertions');
    if (failures.length) {
        console.log('\nFAILURES (' + failures.length + '):');
        failures.forEach(function (failure) { console.log('  - ' + failure); });
        process.exit(1);
    }
    console.log('All green.');
})();
