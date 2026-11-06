# Neon Legacies Enterprise Builder– Website Repository

**Live URL:** (to be added after GitHub Pages is enabled)  
**Purpose:** Professional landing page and service hub for Neon Legacies Enterprise Builder (Pty) Ltd – a compliance, documentation, and business support consultancy.

---

## 📁 Repository Structure
Neon Legacies Enterprise Builder-website/
│
├── index.html # Main landing page
├── pricing.html # Pricing page (all services)
├── terms.html # Terms of Business
├── privacy.html # Privacy Policy (POPIA)
├── service-agreement.html # Service Agreement (Master)
├── complaints.html # Complaints Policy
│
├── 3d-floor-plans.html # 3D floor plans service page
├── personal-services.html # Personal services (UIF, ID, artist profiles)
├── business-support.html # Business support (CIPC, SARS, COIDA)
├── floor-plans-one-pager.html # Marketing one-pager (print/PDF)
│
├── industry-construction.html # Construction roadmap + FDS
├── industry-cleaning.html # Cleaning Services
├── industry-cash-for-scrap.html # Cash for Scrap / Recycling
├── industry-property.html # Property & Real Estate
├── industry-transport.html # Transport & Logistics
├── industry-retail.html # Retail (General)
├── industry-hospitality.html # Restaurant & Takeaway
├── industry-security.html # Security Services
├── industry-manufacturing.html # Light Manufacturing
├── industry-automotive.html # Automotive Repair & Sales
├── industry-beauty.html # Health & Beauty (Salon/Spa/Barbershop)
├── industry-it.html # Information Technology (IT)
├── industry-event.html # Event Management & Catering
├── industry-farming.html # Farming & Agriculture
├── industry-funeral.html # Funeral Services
├── industry-ecd.html # Early Childhood Development (ECD)
├── industry-electrical.html # Electrical & Solar Installation
├── industry-plumbing.html # Plumbing & Sanitation
├── industry-warehousing.html # Logistics & Warehousing
├── industry-ngo.html # NGO / Non‑Profit Organisation (NPO)
│
├── app.js # Site-wide JS: forms → Apps Script, gated member areas
├── auth.js # Sign in with Google (Google Identity Services)
├── main.css # Site stylesheet
├── profile.html # Sign in / sign up + your account card
├── logout.html # Ends the Google session
│
├── apps-script/
│ ├── Code.gs # Lead intake + OAuth token verification (option A)
│ ├── Auth.gs # Google account login, no OAuth client needed (option B)
│ ├── README.md # How to deploy both
│ └── test/ # Node tests (run the real Code.gs, Auth.gs, auth.js, app.js)
│
├── cloudflare/
│ ├── security-headers.worker.js # CSP / HSTS / nosniff for the login page
│ └── README.md # Cloudflare runbook (DNS, TLS, WAF, rate limits, rollback)
│
├── assets/
│ ├── css/
│ │ └── style.css # (optional – external styles)
│ ├── js/
│ │ └── main.js # (optional – interactive features)
│ ├── images/
│ │ ├── logo.png # Replace placeholder with actual logo
│ │ └── industry-thumbnails/ # For future card images
│ ├── pdfs/
│ │ └── ... # Downloadable PDFs
│ └── downloads/
│ └── ... # Templates (Excel, Word)
│
├── .gitignore
└── README.md # This file
---

## 🚀 Deployment Instructions

### GitHub Pages (free)

1. Create a new repository on GitHub (e.g., `Neon Legacies Enterprise Builder-website`).
2. Upload all files and folders as shown above.
3. Go to **Settings → Pages**.
4. Under **Branch**, select `main` (or `master`) and `/ (root)` folder.
5. Click **Save**.
6. Your site will be live at `https://www.neonlegacies.co.za/` within 2 minutes.

### Custom domain, DNS and login security
`neonlegacies.co.za` is registered at Domains.co.za and fronted by Cloudflare
(GitHub Pages cannot send security headers, and the member areas depend on
them). If the Cloudflare dashboard is stuck on *Cloudflare Nameservers* /
*DNSSEC pending*, or the site suddenly serves `server: GitHub.com`, follow
[`cloudflare/README.md`](cloudflare/README.md) – step **0b** explains that
screen and the exact registrar change. Check the live state with:

```bash
./cloudflare/status.sh        # delegation, DNSSEC, traffic path
./cloudflare/status.test.sh   # offline tests for that verdict
./cloudflare/verify.sh        # security headers on the live login page
./cloudflare/waf-test.sh      # cache bypass, WAF, bots, rate limit, leaked sources
```

### Agents (Onboard + Legis)
The raw-API agent layer lives in [`neon_agents/`](neon_agents/README.md): a prompt
and a JSON Schema per agent, one adapter for DeepSeek/Qwen, a validator that
refuses bad output, and GitHub Actions that run them. It is **excluded from the
published site** (see `_config.yml`) – `./cloudflare/waf-test.sh` proves the
prompts and schemas stay private.

```bash
python3 -m neon_agents.cli selftest   # offline: both agents, no API key
python3 -m unittest discover -s neon_agents/tests -p 'test_*.py'
```

---

## 🛠️ How to Maintain This Site

### Update pricing
- Edit `pricing.html` directly.

### Update contact details
- Edit `index.html`, `pricing.html`, `business-support.html`, etc.

### Add a new downloadable PDF
- Place PDF in `assets/pdfs/`.
- Update the relevant HTML page to link to it.

### Replace the logo
- Save your logo as `assets/images/logo.png`.
- In `index.html`, replace the `.logo-placeholder` div with an `<img>` tag.

---

## 🔐 Sign in with Google

Members sign in with their **Google account** – no password for us to store.
There are two ways to switch it on; the site automatically uses whichever is
configured. Until one is set, the button says exactly what is missing instead of
pretending to work – and the **Set up Google sign-in** panel on `profile.html`
lets the owner paste either credential and test it in the browser before
committing it to a file.

### Option B – Apps Script (recommended · ~3 minutes · no Google Cloud Console)

Uses `apps-script/Auth.gs`: a tiny web app deployed to run as *the person
visiting it*, so **Google signs them in first** and the script simply reads
their Google address. It needs no permissions, so visitors never see a consent
screen.

1. <https://script.google.com> → **New project** → paste `apps-script/Auth.gs`
   → Save.
2. **Deploy ▸ New deployment ▸ Web app**
   - *Execute as:* **User accessing the web app** ← this is what makes it their
     Google account
   - *Who has access:* **Anyone with Google account**
   - Deploy.
3. Paste the `/exec` URL into `auth.js` → `NEON_AUTH.authEndpoint`
   (or into the setup panel on `profile.html` to test on that device first).

How it works: the visitor is sent to the web app; Google makes sure it is
*their* account; the script mints a 64-character session token (stored hashed in
its own properties), sends the visitor back with `#nl_auth=…`; `auth.js` strips
the token from the address bar, then re-checks it with the script over JSONP on
every visit and revokes it server-side on sign-out.

### Option A – Google Identity Services (nicer button · ~5 minutes)

Google's own button, name and profile photo – but someone has to create an
OAuth client id first:

1. <https://console.cloud.google.com/apis/credentials> → **Create
   credentials ▸ OAuth client ID ▸ Web application**.
2. *Authorised JavaScript origins*: `https://www.neonlegacies.co.za`
   (add `http://localhost:8000` while testing).
3. Paste the client id into **both**:
   - `auth.js` → `NEON_AUTH.googleClientId`
   - `apps-script/Code.gs` → `GOOGLE.CLIENT_ID`

   They must match, or every token is refused as *wrong audience*.

How it works: Google Identity Services returns an **ID token** (a JWT signed by
Google); `auth.js` asks Google itself (`oauth2.googleapis.com/tokeninfo`) to
confirm it – right issuer, right audience, unexpired, **verified** email – before
creating a session. The sign-in is also verified a second time in `Code.gs` and
recorded in the **Logins** tab.

### Both routes

The session unlocks the member areas (business hub, market leads, referrals,
partner and international applications, strategic growth, hire-admin) for 7 days
and is ended by `logout.html`.

### Test it

```bash
node apps-script/test/google-auth.test.js   # 50 tests, ~390 assertions
```

The suite runs the real `Code.gs`, `Auth.gs`, `auth.js` and `app.js` (through an
Apps Script stub and a small fake DOM): token verification, both login routes,
session handling, sign-out, gated-page unlocking, XSS escaping and page wiring.

---

## 🔒 Login security (Cloudflare)

GitHub Pages cannot send response headers, so Cloudflare sits in front of
`www.neonlegacies.co.za` and supplies them via
`cloudflare/security-headers.worker.js`:

- **Content-Security-Policy** that allows exactly the origins the login needs
  (`accounts.google.com`, `script.google.com`, `oauth2.googleapis.com`,
  `lh3.googleusercontent.com`, Font Awesome, Google Fonts) and nothing else
- **HSTS**, `nosniff`, a tight `Referrer-Policy`, `frame-ancestors 'self'`
  (no click-jacking) and `Cross-Origin-Opener-Policy: same-origin-allow-popups`
  (keeps Google's sign-in popup working)
- **Blocks** `/.git`, `/.env`, test sources and source maps that the repo
  otherwise publishes

The full dashboard runbook — proxied DNS, `Full (strict)` TLS, cache rules so a
stale `auth.js` can never break sign-in, Bot Fight Mode, WAF rules, the login
rate limit (30 req/min per IP) and a 30-second rollback — is in
[`cloudflare/README.md`](cloudflare/README.md). It also lists the settings that
must stay **off** (Cloudflare Access, Rocket Loader, Flexible SSL), because each
one would break or bypass the Google login.

```bash
node apps-script/test/cloudflare-worker.test.js   # 6 tests, 40 assertions
```

---

## 📦 Dependencies

- None – the site uses vanilla HTML/CSS and Font Awesome (CDN).
- Sign in with Google loads Google Identity Services from
  `accounts.google.com/gsi/client` on the pages that need it (`auth.js`).
- No build step required.

---

## 🚫 Ignored files

See `.gitignore` – excludes system files (`.DS_Store`), editor settings, temp files, and large binaries.

---

## ⚠️ Legal Disclaimer

> Neon Legacies Enterprise Builder provides administrative and documentation support only. We are not lawyers, accountants, or tax practitioners. All templates, policies, and roadmaps are provided “as is” for informational purposes. 3D floor plans are visualisation aids, not stamped architectural drawings.

---

## 📞 Contact

- **Founder:** Msimelelo Victor Malusi  
- **Email:** mv.malusi@neonlegacies.co.za  
- **Phone:** 072 152 3293  
- **WhatsApp:** (via floating button on the website)

---

## 🧩 To Do / Roadmap

- [ ] Replace logo placeholder with actual logo image.
- [ ] Add actual PDFs to `assets/pdfs/`.
- [x] Connect contact form to a backend – `apps-script/Code.gs` (see its README).
- [x] Sign in with Google – `auth.js` + `Auth.gs` (no OAuth client) or `Code.gs`.
- [x] Auth.gs deployed as a web app and wired into `auth.js`
  (`NEON_AUTH.authEndpoint`, deployment `AKfycbzi1M47…`; anonymous probe shows
  Google's sign-in redirect, which is correct).
- [ ] Final check on the live site: press "Sign in with Google", pick an
  account, confirm it returns to `profile.html` signed in and the Business Hub
  opens.
- [ ] Password sign-in / email verification (needs a user store in Apps Script).
- [ ] Add Google Analytics (optional).

---

**Last updated:** May 2025  
**Maintained by:** Neon Legacies Enterprise Builder(Pty) Ltd
