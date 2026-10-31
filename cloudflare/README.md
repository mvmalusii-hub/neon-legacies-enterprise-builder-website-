# ☁️ Cloudflare integration — Neon Legacies Enterprise Builder

The site is a **static HTML/CSS/JS build** published from GitHub Pages at
`https://www.neonlegacies.co.za`. Cloudflare is integrated in two ways:

| Layer | What it gives you | Where it lives |
| --- | --- | --- |
| **Edge** (DNS proxy, TLS, WAF, caching, redirects, security headers) | Faster loads in South Africa, DDoS/bot protection, canonical `www` redirect, hardening headers GitHub Pages cannot set | Configured in the Cloudflare dashboard — copy-paste values below |
| **Code** (analytics beacon, optional Turnstile, Pages config) | Cookieless traffic analytics, spam-proof forms, optional migration to Cloudflare Pages | `assets/js/cloudflare-analytics.js`, `_headers`, `_redirects`, `wrangler.toml` |

There are two supported deployment paths. **Path A** keeps GitHub Pages as the
origin and puts Cloudflare in front of it (recommended, no migration). **Path B**
moves hosting to Cloudflare Pages (optional, uses the config files already in
this repo).

---

## Path A — Put Cloudflare in front of GitHub Pages (recommended)

### A1. Add the zone

1. Cloudflare dashboard → **Add a site** → `neonlegacies.co.za` → **Free** plan.
2. Cloudflare gives you two nameservers (e.g. `ada.ns.cloudflare.com`).
   Set them as the nameservers at your domain registrar (where `.co.za` was
   bought). Propagation is usually 15–60 minutes.
3. The zone is live when the dashboard shows **Active**.

### A2. DNS records (all **Proxied / orange cloud**)

| Type | Name | Content | Proxy |
| --- | --- | --- | --- |
| CNAME | `www` | `mvmalusii-hub.github.io` | 🟠 Proxied |
| A | `@` (apex) | `185.199.108.153` | 🟠 Proxied |
| A | `@` (apex) | `185.199.109.153` | 🟠 Proxied |
| A | `@` (apex) | `185.199.110.153` | 🟠 Proxied |
| A | `@` (apex) | `185.199.111.153` | 🟠 Proxied |

> The four `185.199.108–111.153` addresses are GitHub Pages' published A
> records. `www.neonlegacies.co.za` must stay the host named in the repo's
> `CNAME` file — GitHub Pages issues its TLS certificate for that name.

### A3. TLS / SSL

**SSL/TLS → Overview →** `Full (strict)` — never `Flexible` (that causes
redirect loops with GitHub Pages).

**SSL/TLS → Edge Certificates:**

- **Always Use HTTPS**: On
- **Automatic HTTPS Rewrites**: On
- **Minimum TLS Version**: TLS 1.2
- **Opportunistic Encryption**: On
- **HSTS**: enable with `Max-Age` = 12 months, *Include subdomains*, *Preload*
  (only after the site has been served over HTTPS for a few days)

### A4. Redirect rules (canonical host)

**Rules → Redirect Rules → Create rule** — three rules, all with
*Status code* `301`, *Preserve query string* = On.

| # | When incoming requests match | Then |
| --- | --- | --- |
| 1 | `http.host eq "legacylaunchpad.co.za"` or `http.host eq "www.legacylaunchpad.co.za"` | Static redirect → `https://www.neonlegacies.co.za` + *Preserve path & query* |
| 2 | `http.host eq "neonlegacies.co.za"` | Dynamic redirect → `concat("https://www.neonlegacies.co.za", http.request.uri.path)` |
| 3 | `lower(http.request.uri.path) eq "/index.html"` | Dynamic redirect → `concat("https://www.neonlegacies.co.za", "/")` |

These replicate `.htaccess`, which GitHub Pages does not execute, and they
mirror `_redirects`.

> GitHub Pages only serves `*.html` paths, so `https://www.neonlegacies.co.za/pricing`
> returns 404 on Path A. All in-site links use the `.html` form, and Path B
> (Cloudflare Pages) serves extensionless URLs natively — so no extra rule is
> needed, and adding `/foo → /foo.html` rules on Pages would create redirect
> loops (see `_redirects`).


### A5. Security headers (Response Header Transform Rules)

GitHub Pages cannot send custom headers. **Rules → Transform Rules → Modify
response header → Create rule**, name it `Site security headers`, *When incoming
requests match* = **All incoming requests**, then add every header below:

| Operation | Header name | Value |
| --- | --- | --- |
| Set static | `X-Content-Type-Options` | `nosniff` |
| Set static | `X-Frame-Options` | `SAMEORIGIN` |
| Set static | `Referrer-Policy` | `strict-origin-when-cross-origin` |
| Set static | `Permissions-Policy` | `geolocation=(), microphone=(), camera=(), payment=(), usb=()` |
| Set static | `Cross-Origin-Opener-Policy` | `same-origin` |
| Set static | `Strict-Transport-Security` | `max-age=31536000; includeSubDomains; preload` |
| Set static | `Content-Security-Policy` | the single line after `Content-Security-Policy:` in [`_headers`](../_headers) |

The CSP in `_headers` is kept in sync with the real origins the site uses —
Font Awesome (`cdnjs.cloudflare.com`), Google Fonts, the Apps Script lead
endpoint (`script.google.com`) and the Cloudflare beacon
(`static.cloudflareinsights.com`). If a new third-party script is added, update
both `_headers` and the Transform Rule.

> ⚠️ The pages use inline `style="…"` attributes and inline handlers in places,
> so the CSP keeps `'unsafe-inline'` for `style-src`/`script-src`. It still
> blocks injected external scripts and `object`/`base` tricks.

### A6. Caching

**Caching → Cache Rules → Create rule**

| Rule | Expression | Action |
| --- | --- | --- |
| HTML revalidation | `(http.request.uri.path.extension in {"html"} or http.request.uri.path eq "/")` | **Bypass cache** |
| Long-lived assets | `starts_with(http.request.uri.path, "/assets/")` | **Eligible for cache**, Edge TTL 1 year, Browser TTL 1 year |
| Site shell | `http.request.uri.path in {"/app.js" "/main.css"}` | **Eligible for cache**, Edge TTL 1 hour |

Also **Caching → Configuration → Brotli: On**.

### A7. Protection

- **Security → Bots → Bot Fight Mode: On**
- **Security → WAF → Managed rules**: enable the *Cloudflare Free Managed
  Ruleset* (blocks known bad IPs / CVEs).
- **Security → Settings → Security Level: Medium**
- Rate limiting (Rules → Rate limiting rules): 20 requests / 1 minute per IP on
  `/` — enough for humans, cheap insurance for form scraping.

### A8. Web Analytics (beacon already wired)

1. **Analytics & Logs → Web Analytics → Add a site** → hostname
   `www.neonlegacies.co.za` → *Enable with JS snippet* (not "automatic", because
   automatic injection and the manual snippet would double-count).
2. Copy the 32-character token.
3. Paste it into `assets/js/cloudflare-analytics.js`:

```js
var CF_ANALYTICS_TOKEN = 'cf_token_here';
```

4. Commit + push — the beacon then loads on all 61 pages.

The beacon is **cookieless** (no consent banner needed under POPIA), and the
loader respects `DNT:1` / Global Privacy Control and an explicit
`neon-cf-analytics-optout` flag in `localStorage`
(`window.NeonCloudflare.optOut()` / `.optIn()`).

### A9. Verification checklist

```bash
# 1. Traffic now flows through Cloudflare (expect cf-ray / server: cloudflare)
curl -sI https://www.neonlegacies.co.za/ | grep -i -E 'cf-ray|server|strict-transport'

# 2. Apex and legacy hosts redirect to the canonical www host
curl -sI https://neonlegacies.co.za/pricing.html | head -3
curl -sI https://legacylaunchpad.co.za/ | head -3

# 3. Beacon loader is present in the markup
curl -s https://www.neonlegacies.co.za/ | grep -i cloudflare-analytics
```

---

## Path B — Host on Cloudflare Pages (optional)

Everything Cloudflare Pages needs is already committed:

- `_headers` — security headers + cache-control per path
- `_redirects` — canonical host + clean-URL redirects
- `wrangler.toml` — project config (`pages_build_output_dir = "."`, no build step)

Local preview (no account needed):

```bash
npx wrangler pages dev . --port 8080
# → http://localhost:8080 serves the site WITH _headers and _redirects applied
```

Deploy:

```bash
npx wrangler pages deploy . --project-name neon-legacies
```

Or let CI do it — `cloudflare/github-workflow/cloudflare-pages.yml` is a ready
workflow that publishes the site on every push to `main` once you add the
`CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` repository secrets:

```bash
mkdir -p .github/workflows
cp cloudflare/github-workflow/cloudflare-pages.yml .github/workflows/
```

Without those secrets the workflow only logs a notice, so GitHub Pages stays the
live origin until you are ready to switch.

Then in the Pages project: **Custom domains →** add `www.neonlegacies.co.za`.
Keep the `CNAME` file in the repo so the GitHub Pages path keeps working if you
ever roll back.

---

## Optional hardening — Cloudflare Turnstile on the lead form

The lead form (`app.js` → `NEON_LEADS`) already uses a honeypot, a shared token,
idempotency keys and per-email throttling. Turnstile adds edge bot protection
without a user-visible captcha.

1. Dashboard → **Turnstile → Add widget** → hostname `www.neonlegacies.co.za`,
   mode *Managed* → copy the **site key** and **secret key**.
2. Add the widget to the page(s) with a lead form, immediately before
   `<script src="app.js"></script>`:

```html
<div class="cf-turnstile" data-sitekey="YOUR_SITE_KEY" data-theme="light"></div>
<script src="https://challenges.cloudflare.com/turnstile/v0/api.js" defer></script>
```

3. Cloudflare injects a hidden `cf-turnstile-response` field. Forward it with
   the rest of the payload — in `app.js`, inside the payload builder:

```js
var turnstile = document.querySelector('[name="cf-turnstile-response"]');
if (turnstile) { payload.cfTurnstileResponse = turnstile.value; }
```

4. Verify it server-side in `apps-script/Code.gs` (after the honeypot check):

```js
var TURNSTILE_SECRET = 'REPLACE_WITH_TURNSTILE_SECRET_KEY';

function verifyTurnstile(token) {
  if (!TURNSTILE_SECRET || TURNSTILE_SECRET.indexOf('REPLACE_WITH') === 0) { return true; }
  if (!token) { return false; }
  var res = UrlFetchApp.fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
    method: 'post',
    payload: { secret: TURNSTILE_SECRET, response: token },
    muteHttpExceptions: true
  });
  try { return JSON.parse(res.getContentText()).success === true; } catch (err) { return false; }
}
```

```js
if (!verifyTurnstile(String(data.cfTurnstileResponse || ''))) {
  return out({ ok: false, error: 'captcha failed' });
}
```

The CSP in `_headers` already allows `challenges.cloudflare.com`, so nothing
else needs changing.

---

## Files added for this integration

| File | Purpose |
| --- | --- |
| `assets/js/cloudflare-analytics.js` | Cookieless Web Analytics beacon loader (privacy-signal aware), included on every page |
| `_headers` | Security + cache headers for Cloudflare Pages / `wrangler pages dev` |
| `_redirects` | Canonical-host and clean-URL 301s for Cloudflare Pages |
| `wrangler.toml` | Cloudflare Pages project config (static, no build step) |
| `cloudflare/github-workflow/cloudflare-pages.yml` | Optional GitHub Actions deploy to Pages (copy into `.github/workflows/`) |
| `404.html` | Branded not-found page — stops Cloudflare Pages serving `index.html` with a 200 for unknown paths |
| `cloudflare/README.md` | This runbook |

Nothing here changes the GitHub Pages deployment: `_headers`, `_redirects` and
`wrangler.toml` are ignored by GitHub Pages, and the analytics file is a no-op
until a token is pasted in.

