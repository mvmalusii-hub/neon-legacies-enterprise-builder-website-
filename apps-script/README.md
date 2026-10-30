# Website lead intake – Google Apps Script

One web app receives **every** form on the site, writes a row to a Google
Sheet, emails the team and receipts the customer.

Form | Page | Form type in the sheet
---|---|---
Order | `order-documents.html` | `Order`
Hire admin | `hire-admin.html` | `Hire Admin`
Growth consultation | `strategic-growth.html` | `Growth Consultation`
Director session | `business-partners.html` | `Director Session`
Partner application | `partners.html` | `Partner Application`
Company registration | `market-leads.html` | `Market Lead Company`
Account signup | `profile.html` | `Account Signup`
Liquor licence | `liquor-licence.html` | `Liquor Licence`
Spaza compliance | `spaza-compliance.html` | `Spaza Compliance`

## Deploy it (about 5 minutes)

1. **Create the sheet** with the Google account that owns the data
   (`mv.malusii@gmail.com`): <https://sheets.new> → name it
   *Neon Legacies – Website Leads*. The `Leads` tab and its headers are
   created automatically on the first submission.
2. In that sheet: **Extensions ▸ Apps Script**.
3. Delete the placeholder `myFunction` and paste the whole of `Code.gs`.
   `SHARED_TOKEN` is already set to the value the site sends, so **do not edit it**
   unless you also change `window.NEON_LEADS.token` in `app.js` and `LEAD_TOKEN`
   in `order-documents.html`. Adjust if needed:
   - `NOTIFY_EMAILS` – where new-lead alerts land (default `mv.malusii@gmail.com`).
   - `AUTO_REPLY` – `true` sends the customer a receipt with a reference number.
4. **Deploy ▸ New deployment ▸ Web app**
   - Description: `Website leads v1`
   - **Execute as: Me**
   - **Who has access: Anyone** ← required, the site is public
   - **Deploy**, then authorise the script (Google will warn that the app is
     unverified – choose *Advanced ▸ Go to … (unsafe)*: it is your own script).
5. Copy the **Web app URL** (ends in `/exec`).
6. The site already carries deployment ID
   `AKfycbzM082roGPD0iDJy8XgmSdFATcPS8Ma5b2Y7XtAAEiO`. If your new deployment ID
   differs, paste it in exactly two places (bare ID **or** full `/exec` URL both work):
   - `app.js` → `window.NEON_LEADS.endpoint`
   - `order-documents.html` → `LEAD_ID`
7. Commit + push. Pages redeploys in about a minute.

> **Why the token is in a public repo:** both the endpoint URL and the token are
> visible in the source, so the token only stops naive bots. Real protection is
> the honeypot, the per-email throttle and server-side validation. Rotate the
> token if you start seeing junk rows.

## Verify

- **Health check**: open the `/exec` URL in a browser; you should see
  `{"ok":true,"service":"neon-legacies-leads","version":1}`.
- **End to end**: submit the order form on the live site; a row appears in
  `Leads` within a few seconds, the team email arrives, and the customer gets
  a receipt with a reference like `ORD-261030-4821`.
- **Command line** (replace URL + token):

```bash
curl -sS -X POST '<EXEC_URL>' -H 'Content-Type: text/plain' \
  --data '{"formType":"Test","name":"Test Lead","email":"you@example.com","message":"hello","token":"<TOKEN>"}'
```

## Notes

- **Spam**: a hidden `_hp` honeypot field plus the shared token, a per-email
  throttle (5/hour) and an idempotency key on every payload.
- **Failures**: the browser cannot read Apps Script responses cross-origin
  (`no-cors`), so the site queues any payload it cannot deliver in
  `localStorage` (`neonLeadQueue`); re-submissions are de-duplicated by `id`.
- **POPIA**: the sheet holds names, emails and phone numbers. Keep it shared
  with as few people as possible, and prune old rows periodically – the
  privacy policy at `privacy.html` describes this processing.
- **Quota**: a free consumer Gmail account allows 100 recipients/day via
  `MailApp` (1 500 for Workspace). A notification + a receipt per lead uses
  two recipients, so roughly 50 leads/day on Gmail.
