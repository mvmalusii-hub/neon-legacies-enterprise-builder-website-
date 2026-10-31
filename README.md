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
- [ ] Auth.gs web-app URL in `auth.js` currently 404s from Google – copy the
  correct *Web app URL* from **Deploy ▸ Manage deployments** in the Apps Script
  editor (it must end in `/exec`) and paste it into `NEON_AUTH.authEndpoint`,
  or into the "Set up Google sign-in" panel and press *Test connection*.
- [ ] Password sign-in / email verification (needs a user store in Apps Script).
- [ ] Add Google Analytics (optional).

---

**Last updated:** May 2025  
**Maintained by:** Neon Legacies Enterprise Builder(Pty) Ltd
