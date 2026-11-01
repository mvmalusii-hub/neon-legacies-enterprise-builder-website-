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

### Verified state of this domain (checked 2026-11-01 07:19Z)

| Record | Value |
|---|---|
| `neonlegacies.co.za` NS (registry, 00:23:58Z) | `emma.ns.cloudflare.com`, `norm.ns.cloudflare.com` – clean, exactly two |
| NS via `dns.google` + `cloudflare-dns.com` | both return the two Cloudflare nameservers – **propagated** |
| `www` at Cloudflare | proxied A `104.21.59.250`, `172.67.186.77` (zone `serial=2419003170`) |
| apex at Cloudflare | proxied A `104.21.59.250`, `172.67.186.77` |
| `www.neonlegacies.co.za` | **HTTP 200, `server: cloudflare`**, `cf-cache-status: DYNAMIC` |
| apex | `301 → https://www.neonlegacies.co.za/<same path>` (deep links keep their path) |
| `http://` any host | `301 → https://` |
| TLS at the edge | Let's Encrypt `CN=neonlegacies.co.za`, valid 2026-10-31 → 2027-01-29 |
| `profile.html`, `auth.js`, `main.css`, `sitemap.xml`, `robots.txt` | all 200, no bot challenge (`cf-mitigated` absent) |
| GitHub Pages origin | `cname: www.neonlegacies.co.za`, certificate approved, HTTPS enforced, built from `main` |
| `neonlegacies.co.za` DS | **signed, validating** – registry `DNSSEC: signedDelegation`, `AD=true` from `cloudflare-dns` and `dns.google` on a random (uncacheable) label |
| Security headers | **not yet** – no Worker/Transform rules: `verify.sh` = 6 passed / 8 failed |
| WAF / bots / rate limit | **not yet** – `waf-test.sh` = 2 passed / 5 missing (POST reaches GitHub with 405, `/apps-script/test/*.js` is 200, no 429 in 40 requests) |

So the migration itself is done: registry, resolvers, zone contents and traffic
all agree. What is left is the hardening that the Worker adds (§3), the cache
rules it depends on (§4), WAF/bots (§5) and finally DNSSEC.

History: WHOIS at 00:18:48Z still listed four nameservers (`emma`, `norm`,
`ns3.anycast-ns.com`, `ns4.anycast-ns.net`) – the registrar had *added*
Cloudflare instead of replacing the old pair; by 00:23:58Z that was corrected,
and at 00:40Z the zone was still empty (domain dark for uncached visitors) until
the records were added.

Check it yourself at any time, without `dig`:

```bash
./cloudflare/status.sh          # live verdict: registry, resolvers, zone, DNSSEC, traffic
./cloudflare/status.test.sh     # 12 offline checks of that verdict logic
./cloudflare/verify.sh          # 14 header/path checks (Worker or Transform Rules)
./cloudflare/waf-test.sh        # cache bypass, WAF, bots, rate limit
```

`status.sh` uses two small helpers (`whois.js`, `dnsprobe.js`) because resolver
caches lie about delegation for hours: WHOIS answers from the `.co.za` registry
(the authoritative source) and `dnsprobe.js` asks `emma.ns.cloudflare.com`
directly, so the zone's real contents are visible long before the switch
settles.

## 0b. "Cloudflare Nameservers" + "DNSSEC pending" – what that screen means

The zone exists inside Cloudflare; the dashboard is waiting for the *domain* to
be pointed at it. Three separate jobs must happen, and doing them in the wrong
order is what takes a site down:

1. **Fill the zone** with records – harmless while the zone is pending, fatal
   to skip.
2. **Publish exactly two nameservers** at Domains.co.za – the real switch.
3. **Add the DS record** – only once 1 and 2 are green.

| Panel | What it really means | What to do |
|---|---|---|
| **Cloudflare Nameservers** `emma.ns.cloudflare.com`, `norm.ns.cloudflare.com` | The pair Cloudflare assigned to this zone. The registrar must publish **exactly these two**, replacing the four `anycast-ns` ones. | Paste both at Domains.co.za and clear the other fields (step 2). |
| **DNSSEC – pending, waiting for the DS record** | Cloudflare generated a key pair and a DS record and wants you to hand that DS to the registry. Nothing breaks while the DS is missing. | **Wait** until the nameservers are live, then add the DS (step 3). Do *not* add it now. |
| Red **Cancel Setup** button | Deletes the zone and throws away the assigned nameservers. | Leave it alone. |

### The trap that caught this domain: four nameservers

`./cloudflare/status.sh` reads the registry WHOIS, which on 2026-11-01 returned:

```
Name Server: emma.ns.cloudflare.com
Name Server: norm.ns.cloudflare.com
Name Server: ns3.anycast-ns.com      <- old, must go
Name Server: ns4.anycast-ns.net      <- old, must go
```

The Domains.co.za form has four nameserver fields. Filling fields 1–2 leaves
3–4 untouched, so the registry keeps publishing **both** sets. Every lookup is
then answered by whichever server the resolver picks:

- the Cloudflare pair → zone exists but is **empty**, so `www` is NXDOMAIN;
- the Domains.co.za pair → the old zone, which still answers.

The site therefore works or fails purely on cache timing, which is worse than
either state alone – and DNSSEC can never be enabled while it lasts.

"Saved" at the registrar is not the same as "replaced". Section 1 of
`status.sh` must say *"publishes exactly the two Cloudflare nameservers"*.

### Step 1 – fill the zone first (5 minutes, zero downtime)

A new Cloudflare zone starts **empty**. Create these now, while the zone is
still pending – they are inert until Cloudflare is authoritative, and without
them the site dies the moment the delegation is clean:

| Type | Name | Content | Proxy |
|---|---|---|---|
| CNAME | `www` | `mvmalusii-hub.github.io` | Proxied |
| A | `@` | `185.199.108.153` | Proxied |
| A | `@` | `185.199.109.153` | Proxied |
| A | `@` | `185.199.110.153` | Proxied |
| A | `@` | `185.199.111.153` | Proxied |

Cloudflare imports what it can from the old zone; verify `www` is a **proxied
CNAME** and not a stray A record pointing at a GitHub IP. `status.sh` section 3
asks `emma.ns.cloudflare.com` directly and will say *"www exists in the zone"*
the moment this is right – no waiting for propagation.

### Step 2 – publish only the two Cloudflare nameservers

1. Sign in at **Domains.co.za** → *Manage domain* → `neonlegacies.co.za`.
2. Open **Nameservers** → **Use custom nameservers**.
3. Put the two Cloudflare names in the first two fields and **empty the rest**:

   ```
   emma.ns.cloudflare.com
   norm.ns.cloudflare.com
   ```

   No trailing dot, no `https://`, no `ns1.`/`ns2.` prefix. Leaving anything in
   fields 3–4 is exactly how the four-nameserver state above happened.
4. **Save**, and complete whatever confirmation the registrar shows (some
   Domains.co.za flows need a second "update nameservers" click and an e-mail).

`.co.za` normally switches in 1–6 hours; allow 24. Resolvers that already cached
the old delegation keep it until its TTL expires – `status.sh` prints the
remaining seconds, and that is caching, not a failure. The website stays up the
whole time.

Check section 1 again: it must list two nameservers, both Cloudflare.

### Step 3 – DNSSEC last

Order matters here, and the common advice is backwards:

- The DS record in the `.co.za` registry is a promise that the zone is signed.
  If it is added **before** Cloudflare answers, every validating resolver
  (Google, Cloudflare, most ISPs) receives unsigned answers for a signed
  delegation and returns **SERVFAIL** – the whole domain, e-mail included,
  disappears. On a half-switched delegation it is worse: only the queries that
  land on Cloudflare validate, so failures look random.
- Once `status.sh` sections 1–3 are green, open Cloudflare ▸ **DNS ▸ Settings ▸
  DNSSEC**, copy the **DS Record** (Key Tag, Algorithm 13, Digest Type 2,
  Digest) into Domains.co.za ▸ **DNSSEC** and save. Cloudflare flips the panel
  from *pending* to *active* within about an hour.

DNSSEC is hardening, not a prerequisite: the site is fully served without it.

### How you know it worked (no guessing)

```bash
./cloudflare/status.sh
#   1. Registry delegation  PASS  publishes exactly the two Cloudflare nameservers
#   2. Public resolvers     PASS  both serve the Cloudflare nameservers
#   3. Cloudflare zone      PASS  authoritative, www + apex exist
#   4. DNSSEC               PASS  DS published and Cloudflare answers
#   5. Traffic path         PASS  www is served by Cloudflare
```

Exit code 0 means all five agree; anything else prints the single next click.
Then `./cloudflare/verify.sh` for the headers (14 checks) and Cloudflare ▸
Overview should show the zone as **Active**.

**If section 1 keeps failing after 48 hours**, in this order:

1. Domains.co.za shows *only* the two Cloudflare nameservers – no leftover
   `anycast-ns` entries in fields 3–4.
2. The zone was added as `neonlegacies.co.za`, **not** `www.neonlegacies.co.za`
   – a `www` zone never goes Active.
3. No DS record is sitting at the registrar (step 3) – a stale DS makes lookups
   fail instead of falling back.
4. Ask Domains.co.za support to confirm the delegation was submitted to ZARC;
   the registry is the last hop and the one that overrides everything.

### What is left on this site (2026-11-01 08:05Z)

Done: DNS, DNSSEC, and the published-source leak (fixed in the repo, not with a
WAF rule – see §9). `status.sh` exits 0 with *all 8 checks passed*.

Still to do in the Cloudflare dashboard, in this order:

- [ ] **§3 / §3b Headers** – deploy the Worker or the six Transform Rules. Until
      then `verify.sh` fails 8 of 14 checks and the login page has no CSP.
- [ ] **§4 Cache rule for `auth.js`** – still `HIT` with `max-age=14400` at the
      edge. §4a already defeats the browser half in the repo, so this is now
      only about the edge copy.
- [ ] **§5 WAF rules + rate limit + Bot Fight Mode** – `waf-test.sh` reports what
      is missing: POST reaches GitHub (405), no 429 in 40 requests, no bot
      challenge.

Verify as you go: `./cloudflare/verify.sh` (headers) and
`./cloudflare/waf-test.sh` (cache, WAF, bots, rate limit, leaked sources).

The site is static (GitHub Pages) and authentication happens in
`apps-script/Auth.gs` (Google account login) or Google Identity Services.
GitHub Pages **cannot send response headers**, so Cloudflare is what gives the
login page a real security posture: TLS policy, HSTS, a Content-Security-Policy
that only allows the Google origins we actually use, bot/rate protection and
blocking of files that should never be public.

Everything here is in `security-headers.worker.js` (tested by
`apps-script/test/cloudflare-worker.test.js`).

## Proof that the integration is really live

```bash
# The one command that decides it (registry + resolvers + zone + DNSSEC + site)
./cloudflare/status.sh
#    expected once finished: "all 5 checks passed" (exit 0)

# The registry itself, if you want the raw answer (no cache anywhere)
node cloudflare/whois.js neonlegacies.co.za | grep -E '^(Name Server|DNSSEC)'
#    expected: Name Server: emma.ns.cloudflare.com
#              Name Server: norm.ns.cloudflare.com
#              DNSSEC: signed

# What the Cloudflare zone answers right now, before propagation matters
node cloudflare/dnsprobe.js 108.162.192.112 A www.neonlegacies.co.za
#    expected: the two proxied edge IPs (104.21.59.250, 172.67.186.77).
#    A CNAME answer would mean the record is DNS-only (grey cloud) – proxying
#    is what makes the Worker and the headers possible.

# Traffic must arrive via Cloudflare
curl -sI https://www.neonlegacies.co.za/profile.html | grep -i '^server:'
#    expected: server: cloudflare      (NOT server: GitHub.com)

# Headers + blocked paths
./cloudflare/verify.sh
#    expected: 14 checks passed
```

All five must agree. If `server:` still says `GitHub.com`, the delegation is not
clean, no matter what the dashboard shows.

**Measured 2026-11-01 07:19Z (migration complete, headers pending):** registry =
`emma`, `norm`; both resolvers agree; zone serves proxied A records for `www`
and the apex; `www` = 200 `server: cloudflare`; apex = 301 to `www` on the same
path; `http://` = 301 to `https://`; TLS = Let's Encrypt `CN=neonlegacies.co.za`
until 2027-01-29. `status.sh` = **7 passed / 1 waiting (exit 0)**;
`verify.sh` = 6 passed / 7 failed (the Worker is not deployed yet).

**Measured 2026-11-01 00:40Z (delegation clean, zone still empty):** registry =
`emma`, `norm` only; `www` returns NODATA on `1.1.1.1`, `8.8.8.8` and `9.9.9.9`;
`emma` is authoritative (`serial=2418979269`) but carries no records, so the
domain is dark for anyone without a cached record. `status.sh` = 2 failed /
2 passed / 4 waiting.

**Measured 2026-11-01 00:20Z (registrar change partially applied):** registry =
**four** nameservers (`emma`, `norm`, `ns3.anycast-ns.com`, `ns4.anycast-ns.net`),
`DNSSEC: unsigned`; resolvers still cached the old pair (≈19 700 s left);
`emma` answers SOA but the zone is **empty** (`www` = NXDOMAIN); `server:
GitHub.com`; apex = no A record. `status.sh` = 4 failed / 1 passed / 3 waiting.

**Measured 2026-10-31 (before the migration):** zone NS = `*.anycast-ns.com`
(Domains.co.za), `server: GitHub.com`, `verify.sh` = 5 passed / 8 failed. That
is the "not yet integrated" baseline to compare against.

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

## 3b. No-Worker alternative (doable from a phone)

The Worker only sets **static** headers, and Cloudflare can set static response
headers without any code: **Rules ▸ Transform Rules ▸ Modify Response Header**
(free plan, 10 rules). This has the same effect for this site and needs no
deploy. Use it if pasting a Worker into the mobile dashboard is not practical.

| # | Rule | Expression | Header | Value |
|---|---|---|---|---|
| 1 | `csp-html` | `(http.request.uri.path eq "/" or http.request.uri.path contains ".html")` | Set static → `Content-Security-Policy` | the CSP string from `security-headers.worker.js` (one long value, no line breaks) |
| 2 | `nosniff` | same expression | Set static → `X-Content-Type-Options` | `nosniff` |
| 3 | `referrer` | same expression | Set static → `Referrer-Policy` | `strict-origin-when-cross-origin` |
| 4 | `frame` | same expression | Set static → `X-Frame-Options` | `SAMEORIGIN` |
| 5 | `coop` | same expression | Set static → `Cross-Origin-Opener-Policy` | `same-origin-allow-popups` |
| 6 | `permissions` | same expression | Set static → `Permissions-Policy` | `geolocation=(), camera=(), microphone=(), payment=(), usb=()` |

Two things a Transform Rule cannot do, and they are why the Worker still exists:

- it cannot block a path (`.git/`, `.env`, `/apps-script/test/`) – that is a WAF
  custom rule (§5, rule 2 and 3);
- it cannot choose report-only CSP per environment (`CSP_REPORT_ONLY`).

If you take this route, add §5 rule 2 (`hide-internals`) in the same sitting,
otherwise a file that is not in `_config.yml` stays downloadable and `verify.sh`
keeps failing that check.

The header values are visible in one place, so they cannot drift:
`grep -o "X-Content-Type-Options.*" cloudflare/security-headers.worker.js`.

The CSP value for rule 1, ready to paste (it is the exact string the Worker
sends; tested by `apps-script/test/cloudflare-worker.test.js`):

```
default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'self'; form-action 'self' https://script.google.com; script-src 'self' 'unsafe-inline' https://accounts.google.com https://script.google.com https://cdnjs.cloudflare.com; style-src 'self' 'unsafe-inline' https://cdnjs.cloudflare.com https://fonts.googleapis.com; font-src 'self' data: https://cdnjs.cloudflare.com https://fonts.gstatic.com; img-src 'self' data: https://lh3.googleusercontent.com https://*.googleusercontent.com; frame-src 'self' https://accounts.google.com https://www.youtube.com https://www.youtube-nocookie.com; connect-src 'self' https://oauth2.googleapis.com https://accounts.google.com; manifest-src 'self'; worker-src 'self'; upgrade-insecure-requests
```

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

**Measured 2026-11-01 07:20Z, rule 1 not yet created:**

```
auth.js   cf-cache-status: HIT   cache-control: max-age=14400   age: 41
main.css  cf-cache-status: HIT   cache-control: max-age=14400
app.js    cf-cache-status: MISS  cache-control: max-age=14400
profile.html  cf-cache-status: DYNAMIC
```

GitHub Pages sends `max-age=14400`, so Cloudflare is free to keep `auth.js` for
four hours. Every sign-in fix silently lags by up to 4 h and looks like "it
worked yesterday". `verify.sh` now fails on exactly this:

```
FAIL  auth.js is edge-cached (cf-cache-status: hit, cache-control: max-age=14400)
      Add cache rule 4.1: uri.path eq "/auth.js" -> Bypass cache
```

Purging once (Caching ▸ Configuration ▸ Purge Everything) is not a fix – the
next deploy re-caches it.

### 4a. The browser half of the same problem (already fixed in the repo)

The cache rule only stops **Cloudflare** from holding a stale copy. GitHub Pages
sends `cache-control: max-age=14400`, so a visitor's own browser keeps `auth.js`
for four hours as well. That is why every gated page now loads it as a content
hash:

```html
<script src="auth.js?v=6f2e76e8bf"></script>
```

Change `auth.js`, run the tool, and the URL changes – no cache anywhere can
serve the old copy, rule or no rule:

```bash
./tools/version-assets.sh           # rewrite the 10 gated pages
./tools/version-assets.sh --check   # fail if a page is behind (run before pushing)
```

Add `--check` to whatever you do before deploying; it exits 1 and names the
pages that still point at an old hash.

## 5. WAF, bots and rate limiting

Exact click paths in the current dashboard (the mobile dashboard uses the same
names, just stacked):

| What | Where |
|---|---|
| Bot Fight Mode | **Security ▸ Bots** ▸ *Bot Fight Mode* toggle → On |
| Custom rules | **Security ▸ WAF ▸ Custom rules** ▸ *Create rule* |
| Rate limiting | **Security ▸ WAF ▸ Rate limiting rules** ▸ *Create rule* |
| Cache bypass | **Caching ▸ Cache Rules** ▸ *Create rule* |

**Security ▸ Bots** → *Bot Fight Mode*: **On**.
If a real visitor ever gets challenged in a loop on the login page, add a WAF
skip rule for `http.request.uri.path in {"/profile.html" "/auth.js"}`.

**Security ▸ WAF ▸ Custom rules** (free plan allows 5; two are enough). For each
one: *Create rule* → name it → paste the expression → **Action: Block** →
*Deploy*.

| # | Name | Expression | Action |
|---|---|---|---|
| 1 | `static-no-writes` | `http.request.method in {"POST" "PUT" "PATCH" "DELETE"}` | Block |
| 2 | `hide-internals` | `http.request.uri.path contains ".git/" or http.request.uri.path contains ".env" or starts_with(http.request.uri.path, "/apps-script/") or starts_with(http.request.uri.path, "/cloudflare/") or http.request.uri.path eq "/config.yml" or http.request.uri.path eq "/.htaccess"` | Block |

Rule 1 is safe because nothing posts to our own domain — the forms POST to
`script.google.com` (a different host), and the login is a GET redirect. A
blocked request returns **403**, so a rule that works changes a leaked path from
200 to 403 (GitHub's own 404 is equally fine).

Rule 2 is **defence in depth**: `_config.yml` already stops those paths from
being published at all (they answer 404). Keep the rule anyway — it is what
covers a file someone adds later and forgets to exclude, and it costs none of
the free plan's quota that this site needs.

**Security ▸ WAF ▸ Rate limiting rules** (free plan allows 1):

- Name: `login-page`
- If incoming requests match:
  `http.request.uri.path eq "/profile.html" or http.request.uri.path eq "/auth.js"`
- Rate: **30 requests per 1 minute**, counting by **IP**
- Action: **Block**, duration **1 minute**, response code **429**

### 5a. Prove each one from outside

```bash
./cloudflare/waf-test.sh              # all five protections
./cloudflare/waf-test.sh --no-ratelimit   # skip the 40-request burst
```

| Check | What a working rule looks like |
|---|---|
| cache bypass | `auth.js` → `cf-cache-status: bypass` (or `dynamic`) |
| writes blocked | `POST /` → **403** (a 405 means the request reached GitHub) |
| test sources hidden | `/apps-script/test/*.js` → **403** or 404 |
| bot mitigation | scripted UA → 403/429/503 or a `cf-mitigated` header |
| rate limit | at least one **429** inside the burst |

The rate-limit check fires 40 requests on purpose and runs last; your own IP may
be blocked for a minute afterwards, which is the rule doing its job.

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
- **If DNSSEC was already enabled:** delete the **DS record at Domains.co.za
  first**, then move the nameservers back. Leaving a DS behind that points at a
  key the new nameservers do not have keeps the domain on `SERVFAIL` long after
  the rollback.
- Nothing in this folder changes the site's code, so no redeploy of the site is
  needed for either rollback.

## 9. Perimeter summary

Every control, where it lives, why that layer, and how it is proven. "Repo"
means it is already in place and cannot drift; "dashboard" means it is still to
be created.

| Control | Layer | State | Proof |
|---|---|---|---|
| Login backend and Worker source not published | **Repo** – `_config.yml` `exclude:` | ✅ in place | `waf-test.sh` §3 → every path 404 |
| `auth.js` cannot serve stale code | **Repo** – content hash `?v=` + `tools/version-assets.sh --check` | ✅ in place | `version-assets.sh --check` exits 0 |
| Stale edge copy of `auth.js` | **Dashboard** – Caching ▸ Cache Rules | ⏳ to create | `waf-test.sh` §1 → `cf-cache-status: bypass` |
| Writes refused at the edge | **Dashboard** – WAF custom rule 1 | ⏳ to create | `waf-test.sh` §2 → POST = 403 |
| Internals blocked even if published again | **Dashboard** – WAF custom rule 2 | ⏳ to create | `waf-test.sh` §3 (403 instead of 404 is also a pass) |
| Automated clients challenged | **Dashboard** – Security ▸ Bots | ⏳ to create | `waf-test.sh` §4 → challenge or 403/429/503 |
| Login page rate limited | **Dashboard** – WAF rate limiting (1 rule) | ⏳ to create | `waf-test.sh` §5 → a 429 inside 40 requests |
| CSP, nosniff, Referrer-Policy, COOP, Permissions-Policy | **Dashboard** – Worker (§3) or Transform Rules (§3b) | ⏳ to create | `verify.sh` → 14/14 |
| DNSSEC | **Dashboard + registrar** | ✅ in place | `status.sh` §4 → registry signed, `AD=true` |
| Cloudflare authoritative for the zone | **Registrar** | ✅ in place | `status.sh` §1–3 |

Two rules of thumb that keep this cheap:

- **Fix it at the source first.** A file that is not published cannot be leaked,
  and needs no rule, no quota and no maintenance. That is why the source leak is
  a repo fix, not a WAF rule.
- **Spend dashboard quota on behaviour, not on file lists.** The free plan gives
  5 custom rules and 1 rate-limit rule; behaviour rules (`no writes`, one
  combined `hide-internals`) leave room for the login-specific protections.

### The freed redirect

`.htaccess` used to redirect `legacylaunchpad.co.za` → `www.neonlegacies.co.za`.
GitHub Pages never executes Apache config, so it did nothing except publish
itself. If that domain still matters, do it in **Rules ▸ Redirect Rules**:

- If: `http.host eq "legacylaunchpad.co.za" or http.host eq "www.legacylaunchpad.co.za"`
- Then: dynamic redirect **301** to `concat("https://www.neonlegacies.co.za", http.request.uri.path)`
