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

### Cloudflare (CDN, security, analytics)

The site is served through **Cloudflare** in front of GitHub Pages — see
[`cloudflare/README.md`](cloudflare/README.md) for the full runbook (DNS, TLS,
redirect rules, security headers, caching, WAF, Web Analytics, optional
Cloudflare Pages hosting).

What is already in the repository:

| File | Purpose |
| --- | --- |
| `assets/js/cloudflare-analytics.js` | Cookieless Cloudflare Web Analytics beacon — loaded on every page. Paste your token into `CF_ANALYTICS_TOKEN` to activate. |
| `_headers` | Security headers + cache-control rules used by Cloudflare Pages. |
| `_redirects` | Canonical `www` host and clean-URL 301 redirects for Cloudflare Pages. |
| `wrangler.toml` | Cloudflare Pages project config (no build step). |
| `cloudflare/github-workflow/cloudflare-pages.yml` | Optional CI deploy to Cloudflare Pages (copy into `.github/workflows/`). |
| `404.html` | Branded not-found page used by both GitHub Pages and Cloudflare Pages. |

```bash
npx wrangler pages dev . --port 8080   # preview with _headers/_redirects applied
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

## 🧩 To Do / Roadmap

- [ ] Replace logo placeholder with actual logo image.
- [ ] Add actual PDFs to `assets/pdfs/`.
- [x] Connect contact form to a backend (Google Apps Script → Sheets).
- [x] Cloudflare integration (edge proxy, security headers, 404 page, Web Analytics).
- [ ] Paste the Cloudflare Web Analytics token into `assets/js/cloudflare-analytics.js`.
- [ ] Optional: enable Cloudflare Pages deploys by adding `CLOUDFLARE_API_TOKEN` / `CLOUDFLARE_ACCOUNT_ID` secrets.

---

**Last updated:** May 2025  
**Maintained by:** Neon Legacies Enterprise Builder(Pty) Ltd
