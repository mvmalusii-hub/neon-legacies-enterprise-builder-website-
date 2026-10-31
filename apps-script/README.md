# Website lead intake – Google Apps Script

One web app receives **every** form on the site, writes a row to a Google
Sheet, emails the team and receipts the customer.

Form | Page | Form type in the sheet | Fills the extra columns
---|---|---|---
Order | `order-documents.html` | `Order` | Industry, Amount, Service
Hire admin | `hire-admin.html` | `Hire Admin` | Preferred Date
Growth consultation | `strategic-growth.html` | `Growth Consultation` | Preferred Date
Director session | `business-partners.html` | `Director Session` | Preferred Date
Partner application | `partners.html` | `Partner Application` | Industry
Company registration | `market-leads.html` | `Market Lead Company` | Industry
Account signup | `profile.html` | `Account Signup` | –
Liquor licence | `liquor-licence.html` | `Liquor Licence` | Service (licence type)
Spaza compliance | `spaza-compliance.html` | `Spaza Compliance` | –

## The sheet

`Timestamp | Reference | Form | Status | Name | Email | Phone | Company |
Service / Interest | Industry | Amount | Preferred Date | Message | Page |
Source ID | Payload JSON`

- **Status** carries a dropdown (`New`, `Contacted`, `Quoted`, `Won`, `Lost`,
  `Spam`) so the sheet can be worked as a pipeline instead of a log.
- **Source ID** is the browser's idempotency key – searching it tells you
  whether a lead was already handled.
- **Payload JSON** keeps the raw submission, so nothing is ever lost even if a
  question has no column.

## Deploy it (about 5 minutes)

1. **Create the sheet** with the Google account that owns the data
   (`mv.malusii@gmail.com`): <https://sheets.new> → name it
   *Neon Legacies – Website Leads*. The `Leads` tab, its headers and the Status
   dropdown are created automatically on the first submission.
2. In that sheet: **Extensions ▸ Apps Script**.
3. Delete the placeholder `myFunction` and paste the whole of `Code.gs`.
   `SHARED_TOKEN` is already set to the value the site sends, so **do not edit it**
   unless you also change `window.NEON_LEADS.token` in `app.js` and `LEAD_TOKEN`
   in `order-documents.html`. Adjust if needed:
   - `NOTIFY_EMAILS` – where new-lead alerts land (default `mv.malusii@gmail.com`).
   - `AUTO_REPLY` – `true` sends the customer a receipt with a reference number.
4. **Deploy ▸ New deployment ▸ Web app**
   - Description: `Website leads v2`
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

## Upgrading from v1

Deploy the new `Code.gs` as a **new version** of the same web app (the URL does
not change). The first submission – or running `migrateSheet()` once from the
editor – appends the missing columns to the existing `Leads` tab and leaves all
rows untouched. No data is moved or deleted.

## Verify

- **Health check**: open the `/exec` URL in a browser; you should see
  `{"ok":true,"service":"neon-legacies-leads","version":2}`.
- **Sheet + email**: in the Apps Script editor run `sendTestLead()` once. It
  writes a `TES-…` row using mixed field names (`businessEmail`, `total`) and
  sends the team email – proof that the field aliases work.
- **End to end**: submit a form on the live site; a row appears in `Leads`
  within a few seconds with Name, Email and Phone filled, the team email
  arrives (Reply goes straight to the customer) and the customer gets a receipt
  with a reference like `ORD-261030-4821`.
- **Command line** (replace URL, `TOKEN`):

```bash
curl -sS -X POST '<EXEC_URL>' -H 'Content-Type: text/plain' \
  --data '{"formType":"Test","businessName":"Test Lead","businessEmail":"you@example.com","businessPhone":"072 000 0000","token":"<TOKEN>"}'
```

- **Tests** (no installs, plain Node):

```bash
node apps-script/test/code.test.js   # the Apps Script backend
node apps-script/test/app.test.js    # the site-wide form hook, end to end
node apps-script/test/forms.test.js  # every real <form> on the site, field by field
```

`appsscript-stub.js` fakes `SpreadsheetApp`, `MailApp`, `CacheService`,
`LockService` and `PropertiesService`, so `Code.gs` runs unmodified. The tests
replay real payloads from every page, including the id-only field names and the
placeholder-only liquor / spaza forms. `forms.test.js` parses the actual HTML
and fails if any visible field would be dropped (`9 forms, 87 fields`).

## What v2 fixed (audit, 31 Oct 2026)

1. **Leads were being rejected.** v1 only accepted `name` and `email`, but the
   pages send `directorName`, `businessName`, `regCompanyName`, `companyName`,
   `signupName`… so every one of those forms got
   `{"ok":false,"error":"name required"}`. Because the browser uses `no-cors`
   it never saw the error: the visitor was told “thank you”, nothing was saved.
   The backend now normalises 60+ field names onto the canonical columns.
2. **Liquor and spaza submissions were empty.** Those inputs only have
   placeholders – no `name`, no `id` – so the old collector skipped them. The
   collector now falls back to the label, the placeholder, the select prompt and
   the checkbox group question, so every answer is captured.
3. **Checkbox and radio answers were dropped** (growth areas, admin services,
   contract length) because they had no `name`. They are now collected per
   question as one readable answer.
4. **Everything useful was buried in `Payload JSON`.** The sheet now has real
   columns for Service / Interest, Industry, Amount, Preferred Date and Source
   ID, plus a Status pipeline column with a dropdown.
5. **The team email hid the questionnaire.** It printed only `message`, so the
   answers never reached the inbox. It now lists every answered question and
   sets `Reply-To` to the lead's address.
6. **A mail quota error could fail a saved lead.** `MailApp` calls are wrapped
   so a failed notification never turns a stored lead into an error response.
7. **Concurrent submits could interleave rows.** Writes are serialised with
   `LockService`.
8. **Failed sends vanished.** The order page now queues a submission when the
   `fetch` itself fails (offline, blocked), same as when the endpoint is
   unconfigured; ids keep the retry idempotent.
9. **Owner tooling.** `sendTestLead()` and `migrateSheet()` run from the editor.

Still open (needs a decision, not code): file uploads on the partner / growth /
admin / market-lead forms cannot be posted to Apps Script as JSON – either drop
the upload fields or send them by email; and `profile.html` signup is a lead
only – there is no real account system behind it.

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
- **Duplicate forms on a page**: `profile.html` holds a login form marked
  `data-no-lead="true"` (never sent) and a signup form (sent). Passwords are
  always stripped before the payload leaves the browser.
