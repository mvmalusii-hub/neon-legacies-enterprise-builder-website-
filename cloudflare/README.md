# Login security with Cloudflare

## 0. If Cloudflare says "invalid domain"

Cloudflare's **Add a site** box wants the *registrable domain only*. These are
all rejected:

| Typed | Result |
|---|---|
| `https://www.neonlegacies.co.za/` | invalid – no scheme, no path, no trailing slash |
| `www.neonlegacies.co.za` | invalid – `www` is a DNS record, not a zone |
| `neonlegacies.co.za ` (trailing space / line break from copy-paste) | invalid |
| `Neon Legacies Enterprise Builder` | invalid |

Type exactly:

```
neonlegacies.co.za
```

Two more things that produce the same error:

- **Using the wrong screen.** *Workers & Pages ▸ your Worker ▸ Custom Domains*
  needs the zone to exist first. Add the zone with **Add a site** (top-right of
  the dashboard), then attach the Worker with **Triggers ▸ Add route**
  (`www.neonlegacies.co.za/*`), not a custom domain.
- **The zone is already in another Cloudflare account** (an old developer's).
  The dashboard then refuses to add it; remove it from that account or ask
  Cloudflare support to release it.

### Verified state of this domain (checked 2026-10-31)

| Record | Value |
|---|---|
| `neonlegacies.co.za` NS | `ns1.anycast-ns.com`, `ns2.anycast-ns.net`, `ns3.anycast-ns.com`, `ns4.anycast-ns.net` → **Domains.co.za** |
| `neonlegacies.co.za` SOA | `dns-admin.domains.co.za` |
| `www` CNAME | `mvmalusii-hub.github.io` → `185.199.108–111.153` (GitHub Pages) |
| apex `A` | **none** – the bare domain does not resolve today |

The nameserver change therefore happens at **Domains.co.za**:
*Manage domain ▸ Nameservers ▸ Use custom nameservers* → paste the two
`*.ns.cloudflare.com` names Cloudflare shows for the new zone. `.co.za` usually
propagates within a few hours (allow up to 24).

While you are there, check **DNSSEC**. If Domains.co.za has DS records enabled,
switch DNSSEC on in Cloudflare *before* the nameservers change, otherwise the
domain returns `SERVFAIL` after the move.

The site is static (GitHub Pages) and authentication happens in
`apps-script/Auth.gs` (Google account login) or Google Identity Services.
GitHub Pages **cannot send response headers**, so Cloudflare is what gives the
login page a real security posture: TLS policy, HSTS, a Content-Security-Policy
that only allows the Google origins we actually use, bot/rate protection and
blocking of files that should never be public.

Everything here is in `security-headers.worker.js` (tested by
`apps-script/test/cloudflare-worker.test.js`).

## Proof that the integration is really live (three commands)

```bash
# 1. Cloudflare must own the zone
curl -s 'https://dns.google/resolve?name=neonlegacies.co.za&type=NS' | grep -o '[a-z0-9.-]*\.ns\.cloudflare\.com'
#    expected: two results, e.g. ana.ns.cloudflare.com / bob.ns.cloudflare.com

# 2. Traffic must arrive via Cloudflare
curl -sI https://www.neonlegacies.co.za/profile.html | grep -i '^server:'
#    expected: server: cloudflare      (NOT server: GitHub.com)

# 3. Headers + blocked paths
./cloudflare/verify.sh
#    expected: 13 checks passed
```

All three must agree. If (2) still says `GitHub.com`, the nameservers have not
been switched yet, no matter what the dashboard shows.

**Measured 2026-10-31 (before the migration):** zone NS = `*.anycast-ns.com`
(Domains.co.za), `server: GitHub.com`, `verify.sh` = 5 passed / 8 failed. That
is the "not yet integrated" baseline to compare against.

## What protects what

| Threat | Layer |
|---|---|
| Bot hammering the login page | Cloudflare rate limit + Bot Fight Mode |
| Replaying a stolen session token | `Auth.gs`: token stored as SHA-256, 7-day expiry, revoked on sign-out, re-checked on every visit |
| Forged session token | 64 random characters, origin allowlist on the return URL, JSONP re-check |
| XSS on the sign-in page | CSP (this Worker) + HTML escaping in `auth.js` |
| Downgrade / MITM | TLS 1.2–1.3, `Full (strict)`, HSTS |
| Clickjacking the login page | `frame-ancestors 'self'` + `X-Frame-Options: SAMEORIGIN` |
| Leftover repo files (`.git`, test sources) | blocked by the Worker |

Cloudflare **cannot** protect the Apps Script deployment itself – it lives on
`script.google.com`. Its own guards are the ones above.

## 1. DNS (proxied)

| Type | Name | Content | Proxy |
|---|---|---|---|
| CNAME | `www` | `mvmalusii-hub.github.io` | **Proxied** (orange) |
| A | `@` | `185.199.108.153` | Proxied |
| A | `@` | `185.199.109.153` | Proxied |
| A | `@` | `185.199.110.153` | Proxied |
| A | `@` | `185.199.111.153` | Proxied |

Keep the repo `CNAME` file and *Settings ▸ Pages ▸ Custom domain* as
`www.neonlegacies.co.za`. GitHub's certificate only covers `www`, so add a
**Redirect Rule** (Rules ▸ Redirect Rules) for the apex:

- If: `http.host eq "neonlegacies.co.za"`
- Then: dynamic redirect **301** to `concat("https://www.neonlegacies.co.za", http.request.uri.path)`

## 2. SSL/TLS

- SSL/TLS ▸ Overview → **Full (strict)** — never *Flexible* (GitHub redirects
  to https, which loops with Flexible).
- Edge Certificates → **Always Use HTTPS: On**, **Automatic HTTPS Rewrites: On**,
  **Minimum TLS Version: 1.2**, TLS 1.3: On.
- Leave Cloudflare's own *HSTS* toggle **off**: the Worker sends HSTS, and two
  different HSTS headers are hard to reason about.

## 3. The Worker (security headers)

1. Workers & Pages ▸ **Create ▸ Worker**, name it `neon-security-headers`.
2. Paste the whole of `cloudflare/security-headers.worker.js` → **Deploy**.
3. Worker ▸ Settings ▸ **Triggers ▸ Add route**:
   `www.neonlegacies.co.za/*` on zone `neonlegacies.co.za`.
4. Verify:

```bash
curl -sI https://www.neonlegacies.co.za/profile.html \
  | grep -i -E 'content-security-policy|strict-transport|x-content-type|referrer|permissions|cross-origin'
curl -s -o /dev/null -w '%{http_code}\n' https://www.neonlegacies.co.za/.git/config   # 404
```

**If the login page misbehaves**, set `CSP_REPORT_ONLY: true` in the Worker and
redeploy — the policy is then reported, not enforced, so nothing is blocked
while you read the console messages. Switch it back once the console is clean.

## 4. Caching rules (a stale `auth.js` breaks sign-in)

Caching ▸ Cache Rules — create these in order:

1. `http.request.uri.path eq "/auth.js"` → **Bypass cache**
   (the login logic must never be a day old).
2. `http.request.uri.path contains ".html"` → **Bypass cache**
   (pages embed the session-gating markup).
3. `http.request.uri.path matches "^/(main\\.css|.*\\.(png|ico|svg|woff2?))$"` →
   **Cache eligible**, Edge TTL 1 month, Browser TTL 1 day.

`auth.js` is fingerprinted only by its Git commit, so rule 1 is the important
one: after you deploy a fix, the old copy must not survive at the edge.

## 5. WAF, bots and rate limiting

**Security ▸ Bots** → *Bot Fight Mode*: **On**.
If a real visitor ever gets challenged in a loop on the login page, add a WAF
skip rule for `http.request.uri.path in {"/profile.html" "/auth.js"}`.

**Security ▸ WAF ▸ Custom rules** (free plan allows 5):

| # | Name | Expression | Action |
|---|---|---|---|
| 1 | `static-no-writes` | `http.request.method in {"POST" "PUT" "PATCH" "DELETE"}` | Block |
| 2 | `hide-repo-paths` | `http.request.uri.path contains ".git/" or http.request.uri.path contains ".env"` | Block |
| 3 | `hide-test-sources` | `starts_with(http.request.uri.path, "/apps-script/test/")` | Block |

Rule 1 is safe because nothing posts to our own domain — the forms POST to
`script.google.com` (a different host), and the login is a GET redirect.

**Security ▸ WAF ▸ Rate limiting rules** (free plan allows 1):

- Name: `login-page`
- If incoming requests match:
  `http.request.uri.path eq "/profile.html" or http.request.uri.path eq "/auth.js"`
- Rate: **30 requests per 1 minute**, counting by **IP**
- Action: **Block**, duration **1 minute**, response code **429**

## 6. Do NOT switch these on

| Setting | Why not |
|---|---|
| **Cloudflare Access** on the site | It replaces Google login with Cloudflare's own identity provider — every visitor would need a Cloudflare account, and the member areas would never open. Access is for internal tools, not public member login. |
| **Rocket Loader** | It defers and reorders scripts, which breaks `auth.js`, the JSONP session check and Google Identity Services. |
| **SSL/TLS: Flexible** | GitHub Pages redirects http→https, so Flexible loops (`ERR_TOO_MANY_REDIRECTS`). |
| **Auto Minify (JS)** | `auth.js` is served as-is; minification has broken Apps Script JSONP callbacks in the wild. |
| **Email obfuscation** | Rewrites the contact addresses in the footer into Cloudflare-looking ones — confusing for a business site. |
| **Proxying `script.google.com`** | You can't; it's Google's zone. The login endpoint keeps its own guards. |

## 7. Verify the login still works (the only test that matters)

1. Open <https://www.neonlegacies.co.za/profile.html> in a private window.
2. DevTools ▸ Console → reload: there must be **no** *"Refused to load/execute"*
   messages (those are CSP blocks).
3. Click **Sign in with Google** → pick an account → *Continue to Neon
   Legacies…* → you land back signed in, with the account card showing your
   email.
4. Sign out → the session disappears and the member areas lock again.

If step 3 fails only *after* Cloudflare was switched on, the usual causes are,
in order: CSP blocking `script.google.com` (should not happen — it is allowed),
Bot Fight Mode challenging the redirect back, or a cached `auth.js` (rule 4.1).

## 8. Rollback (30 seconds, no data loss)

- **Keep the site up, drop the headers:** delete the Worker route
  (Worker ▸ Settings ▸ Triggers). Headers stop immediately, the site is
  untouched.
- **Remove Cloudflare from the path entirely:** set the DNS records to
  *DNS only* (grey cloud). GitHub Pages then serves directly again, as it does
  today.
- Nothing in this folder changes the site's code, so no redeploy of the site is
  needed for either rollback.
