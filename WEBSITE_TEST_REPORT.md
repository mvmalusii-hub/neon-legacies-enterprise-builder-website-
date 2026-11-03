# Neon Legacies Website — Test Report & Recommendations

**Site:** https://www.neonlegacies.co.za (GitHub Pages behind Cloudflare)
**Date:** 2026-11-03
**Scope:** every front of the site — functional/link integrity, the repo's own
test suites, responsive/mobile, SEO & metadata, security/deployment, and
performance.

---

## 1. How it was tested

| Front | What was run |
|---|---|
| Functional / links | Every `href`/`src` in all 61 HTML pages resolved against the working tree |
| Auth + lead backend | `node apps-script/test/google-auth.test.js` |
| Edge / security headers | `node apps-script/test/cloudflare-worker.test.js`, `bash cloudflare/status.test.sh` |
| Agent layer | `python3 -m unittest discover -s neon_agents/tests` |
| Cache-busting | `bash tools/version-assets.sh --check` |
| Metadata / structure | charset, viewport, title, description, `<h1>`, duplicate ids, `img alt` |
| SEO | `sitemap.xml` vs. the files on disk; duplicate titles |
| Live site | `curl` of `/`, `/profile.html`, `/robots.txt`, `/sitemap.xml` and the excluded paths |

---

## 2. Results after the fixes

| Check | Before | After |
|---|---|---|
| `google-auth.test.js` | **10 tests failing / 18 assertions** | ✅ 50 tests, 387 assertions, all green |
| `cloudflare-worker.test.js` | ✅ 6 tests, 40 assertions | ✅ unchanged |
| `cloudflare/status.test.sh` | ✅ 12/12 | ✅ unchanged |
| `neon_agents` unit tests | ✅ 40 tests | ✅ unchanged |
| `version-assets.sh --check` | ✅ | ✅ `auth.js?v=6f2e76e8bf` on all 10 gated pages |
| Broken local links | **1** | ✅ 0 |
| Pages with `<meta charset>` | 5 / 61 | ✅ 61 / 61 |
| Pages with viewport meta | 5 / 61 | ✅ 61 / 61 |
| Pages with meta description | 58 / 61 | ✅ 61 / 61 |
| Duplicate element ids | 5 pages | ✅ 0 |
| `sitemap.xml` dead entries | 1 | ✅ 0 |
| Canonical link per page | 0 / 61 | ✅ 61 / 61 |
| Pages with exactly one `<h1>` | 13 / 61 | ✅ 61 / 61 |
| Duplicate `<title>`s | 1 pair | ✅ 0 |
| `robots.txt` no-op rules | 2 | ✅ 0 |
| Homepage favicon `<link>` | malformed | ✅ valid |

---

## 3. Defects found and fixed

### 3.1 Dead “Get quote” link (personal-services.html) — **fixed**
The Police Clearance card linked to `href="service=Police-Clearance"`, which
resolves to a non-existent file, so the button went nowhere. Changed to
`order-documents.html?service=Police-Clearance`, matching every other
“Get quote” link on the site.

### 3.2 The Google sign-in test suite was red (10 tests / 18 assertions) — **fixed**
`apps-script/test/google-auth.test.js` hard-coded
`SHARED_TOKEN = 'REPLACE_WITH_A_LONG_RANDOM_STRING'`, but `Code.gs` and
`app.js` ship the live token (`32bb9090…`). Because the tokens no longer
matched, `doPost` answered `unauthorised` before it ever reached
`googleLogin`, so every backend test failed (token verification, replay,
throttling, ordinary leads …). The test now reads the token from the code it
is testing:

```js
const SHARED_TOKEN = backend.loadCode().sandbox.CONFIG.SHARED_TOKEN;
```

so the copy can never drift again. Result: **50 tests, 387 assertions, all green.**

### 3.3 Dead “Order Selected Documents” button on 5 industry pages — **fixed**
`industry-cash-for-scrap`, `industry-cleaning`, `industry-construction`,
`industry-property` and `industry-transport` each gave **two** elements the
same `id="orderSelectedBtn"`. `document.getElementById` returns only the
first, so the bottom call-to-action never received its click handler and did
nothing. The other 21 industry pages already use the correct pattern
(`id="orderSelectedBtnBottom"` + `querySelectorAll('#orderSelectedBtn,
#orderSelectedBtnBottom')`); the five stragglers now match it.

### 3.4 Missing `<meta charset>` and viewport on almost every page — **fixed**
55 pages had no charset declaration and 56 had no viewport meta. `main.css`
contains 17 responsive `@media` breakpoints, so without the viewport tag a
phone renders the desktop layout zoomed out and none of the mobile rules fire.
Both tags were added to all 61 pages.

### 3.5 Missing meta descriptions — **fixed**
Added to `artist-profile-service.html`, `epk-studio.html` and `policies.html`.

### 3.6 `sitemap.xml` out of step with the site — **fixed**
It advertised `floor-plans-one-pager.html`, which does not exist, and omitted
`artist-profile-service.html` and `epk-studio.html`, which do. Corrected.

### 3.7 Malformed favicon `<link>` on the homepage — **fixed**
`index.html` line 9 was missing its opening `<`:
`link rel="icon" … href="/favicon-16x16.png">`. The 16×16 favicon was never
linked. Restored the `<link …>`.

### 3.8 Duplicate `<h1>` on 48 pages — **fixed**
The sidebar brand was an `<h1>` on every page, so 48 pages had two `<h1>`s and
the other 13 had only the brand. The brand is now a `<div class="logo-name">`
(all 61 pages) and the page's own heading was promoted to `<h1>` on the 13
pages that would otherwise have none. CSS was updated so the look is unchanged
(`.logo-text .logo-name` keeps the 1.4 rem bold style; the hero headings gained
an `h1` rule that matches the old `h2` size). **Every page now has exactly one
`<h1>`.**

### 3.9 No canonical links — **fixed**
None of the 61 pages declared a canonical URL. Each now carries
`<link rel="canonical" href="https://www.neonlegacies.co.za/…">` (the homepage
canonicalises to the root).

### 3.10 Duplicate `<title>` on the two EPK pages — **fixed**
`artist-profile-service.html` and `epk-studio.html` shared the identical title
“Unified EPK Studio …”. They are now distinct and descriptive. (Their body
copy is still ~99 % the same — see the note in §4.)

### 3.11 `robots.txt` no-op rules — **fixed**
`Disallow: /admin/` and `/private/` pointed at directories that do not exist;
removed.

---

## 4. Recommendations — status

### Executed in this pass
- **Duplicate `<title>` / near-duplicate pages (Medium)** — the two EPK pages
  now have distinct titles and every page carries a self-canonical link
  (§3.9, §3.10).
- **Duplicate `<h1>` (Low)** — fixed on all 61 pages (§3.8).
- **`robots.txt` no-op rules (Info)** — removed (§3.11).

### Ready to deploy — needs your Cloudflare token (High)
The login page still ships **no** `Content-Security-Policy`,
`Strict-Transport-Security`, `X-Content-Type-Options`, `Referrer-Policy` or
`COOP`: `./cloudflare/verify.sh` reports **8 failed / 6 passed**. The Worker is
written and tested; the deploy is now one command:

```bash
CLOUDFLARE_API_TOKEN=... ./cloudflare/deploy.sh   # npx wrangler deploy + route
./cloudflare/verify.sh                            # the 7 header checks must pass
```

`cloudflare/wrangler.toml` binds `www.neonlegacies.co.za/*`, and
`cloudflare/README.md` §“Deploying the header Worker” documents it. This is the
one recommendation that cannot be finished from inside the repo — it needs
account access. (Good news: `/.git/config`, `/apps-script/Code.gs`,
`/config.yml` and `/README.md` already answer `404`, so repo internals are not
exposed.)

### Still open (owner decisions)
- **Consolidate the two EPK pages (Medium).** `artist-profile-service.html` and
  `epk-studio.html` are still ~99 % identical body copy. Titles and canonicals
  now differ, but the real fix is to keep one and redirect the other (about 50
  pages link the first, 6 link the second). That changes which URL is public, so
  it is left as a content decision.
- **Minification (Low).** `main.css` (50 KB), `app.js` (50 KB), `auth.js`
  (51 KB) and `order-documents.html` (120 KB) are served un-minified; enable
  Cloudflare Auto Minify or add a build step.
- **Analytics (Low).** Google Analytics is still on the README roadmap; it needs
  a GA measurement ID and an extended CSP `connect-src`.

---

## 5. Re-running the checks

```bash
node apps-script/test/google-auth.test.js          # 50 tests / 387 assertions
node apps-script/test/cloudflare-worker.test.js    # 6 tests / 40 assertions
bash cloudflare/status.test.sh                     # 12/12
python3 -m unittest discover -s neon_agents/tests  # 40 tests
bash tools/version-assets.sh --check               # cache-busting is current
```

