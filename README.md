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
│ ├── Code.gs # Lead intake + Google token verification
│ ├── README.md # How to deploy it
│ └── test/ # Node tests (run the real Code.gs, auth.js, app.js)
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

**How it works** (`auth.js` → `apps-script/Code.gs`):

1. Google Identity Services renders the *Sign in with Google* button on
   `profile.html` and returns an **ID token** (a JWT signed by Google).
2. `auth.js` decodes it and asks Google itself to confirm it
   (`oauth2.googleapis.com/tokeninfo`). Only a token Google vouches for –
   issued to *our* client id, unexpired, with a **verified** email address –
   creates a session. Tokens edited, replayed from another site or expired
   are refused, and the visitor is told why.
3. The sign-in is posted to the Apps Script web app (`action=googleLogin`),
   which verifies the same token a second time and writes a row to the
   **Logins** tab (idempotent per token, 20 sign-ins/hour, one team email per
   new account).
4. The session is cached in `localStorage` for 7 days, which is what unlocks
   the member areas: business hub, market leads, referrals, partner and
   international applications, strategic growth, hire-admin. `logout.html`
   ends it (and switches off Google's auto-select).

**Switch it on (about 5 minutes):**

1. <https://console.cloud.google.com/apis/credentials> → **Create
   credentials ▸ OAuth client ID ▸ Web application**.
2. *Authorised JavaScript origins*: `https://www.neonlegacies.co.za`
   (add `http://localhost:8000` while testing).
3. Paste the client id into **both**:
   - `auth.js` → `NEON_AUTH.googleClientId`
   - `apps-script/Code.gs` → `GOOGLE.CLIENT_ID`

   They must match, or every token is refused as *wrong audience*. Until then
   the button says exactly what is missing instead of pretending to work.

**Test it:**

```bash
node apps-script/test/google-auth.test.js   # 34 tests, ~300 assertions
```

The suite runs the real `Code.gs`, `auth.js` and `app.js` (through an Apps
Script stub and a small fake DOM): token verification, session handling,
sign-out, gated-page unlocking and page wiring.

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
- [x] Sign in with Google – `auth.js` + `Code.gs` (`action=googleLogin`).
- [ ] Paste the Google OAuth client id into `auth.js` and `Code.gs` (go-live step).
- [ ] Password sign-in / email verification (needs a user store in Apps Script).
- [ ] Add Google Analytics (optional).

---

**Last updated:** May 2025  
**Maintained by:** Neon Legacies Enterprise Builder(Pty) Ltd
