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

## 📦 Dependencies

- None – the site uses vanilla HTML/CSS and Font Awesome (CDN).
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

## 🔐 Accounts & lead intake

Every form on the site posts to one Google Apps Script web app (`apps-script/Code.gs`).
The same deployment also runs the account system.

File | Role
---|---
`app.js` | site-wide lead capture, page behaviour, gated-form checks
`auth.js` | `window.NEON_AUTH` – sign up, sign in, session refresh, profile, password change/reset, sign out
`reset.js` | logic for `reset.html` (the link in the reset email)
`profile.html` | sign-in / sign-up, signed-in account panel, password change
`reset.html` | choose a new password from an emailed link
`logout.html` | ends the server session and clears this device
`apps-script/Code.gs` | leads + accounts backend (Sheets: `Leads`, `Users`, `Sessions`)
`apps-script/README.md` | deployment, sheet schema, security notes, tests

Accounts are real: passwords are salted and iterated (SHA-256 × 600), sessions
are server-side (`Sessions` sheet, 7 days) and only a hash of the token is
stored. Gated forms — director session, partner application, growth
consultation, hire admin and market-lead registration — only record a lead when
a session exists.

Run the test suites (plain Node, no installs):

```bash
node apps-script/test/code.test.js
node apps-script/test/accounts.test.js
node apps-script/test/app.test.js
node apps-script/test/auth-client.test.js
node apps-script/test/forms.test.js
node apps-script/test/wiring.test.js
```

---

## 🧩 To Do / Roadmap

- [x] Lead intake backend (Google Apps Script + Sheets).
- [x] Real account system (sign up, sign in, sessions, password reset).
- [ ] Email verification on signup and Google sign-in.
- [ ] Admin screen for `Users` / `Leads` (status pipeline lives in the sheet for now).
- [ ] Self-service account deletion (POPIA request handling).
- [ ] Replace logo placeholder with actual logo image.
- [ ] Add actual PDFs to `assets/pdfs/`.
- [ ] Add Google Analytics (optional).

---

**Last updated:** October 2026  
**Maintained by:** Neon Legacies Enterprise Builder(Pty) Ltd
