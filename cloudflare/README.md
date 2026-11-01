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

### Verified state of this domain (checked 2026-11-01)

| Record | Value |
|---|---|
| `neonlegacies.co.za` NS | `ns1.anycast-ns.com`, `ns2.anycast-ns.net`, `ns3.anycast-ns.com`, `ns4.anycast-ns.net` → **Domains.co.za** (unchanged) |
| `neonlegacies.co.za` DS | **none** – DNSSEC is not delegated |
| `neonlegacies.co.za` SOA | `ns1.anycast-ns.com dns-admin.domains.co.za` |
| `www` CNAME | `mvmalusii-hub.github.io` → `185.199.108–111.153` (GitHub Pages), `server: GitHub.com` |
| apex `A` | **none** – the bare domain does not resolve today |
| Cloudflare zone | exists and answers (`emma.ns.cloudflare.com` is authoritative), status *Pending Nameserver Update* |
| Cloudflare zone contents | **empty** – `www` and the apex return NODATA/NXDOMAIN when asked directly |
| Registry (WHOIS, 00:18:48Z) | `emma.ns.cloudflare.com`, `norm.ns.cloudflare.com`, **plus** `ns3.anycast-ns.com`, `ns4.anycast-ns.net`, `DNSSEC: unsigned` – **a partial change** |

Check it yourself at any time, without `dig`:

```bash
./cloudflare/status.sh          # live verdict: registry, resolvers, zone, DNSSEC, traffic
./cloudflare/status.test.sh     # 12 offline checks of that verdict logic
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
Then `./cloudflare/verify.sh` for the headers (13 checks) and Cloudflare ▸
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
node cloudflare/dnsprobe.js 108.162.192.112 CNAME www.neonlegacies.co.za
#    expected: mvmalusii-hub.github.io   (Cloudflare flattens it to A records
#              once the CNAME is proxied – an A answer is equally good)

# Traffic must arrive via Cloudflare
curl -sI https://www.neonlegacies.co.za/profile.html | grep -i '^server:'
#    expected: server: cloudflare      (NOT server: GitHub.com)

# Headers + blocked paths
./cloudflare/verify.sh
#    expected: 13 checks passed
```

All five must agree. If `server:` still says `GitHub.com`, the delegation is not
clean, no matter what the dashboard shows.

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
- **If DNSSEC was already enabled:** delete the **DS record at Domains.co.za
  first**, then move the nameservers back. Leaving a DS behind that points at a
  key the new nameservers do not have keeps the domain on `SERVFAIL` long after
  the rollback.
- Nothing in this folder changes the site's code, so no redeploy of the site is
  needed for either rollback.
