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
Google sign-in | `profile.html` | verified, then written to the `Logins` tab (not `Leads`)
Liquor licence | `liquor-licence.html` | `Liquor Licence`
Spaza compliance | `spaza-compliance.html` | `Spaza Compliance`

## Google account login (`Auth.gs` – recommended first step)

`Auth.gs` is a **separate** tiny web app that signs members in with their
Google account **without an OAuth client id** – no Google Cloud Console needed.
(The `action=googleLogin` section below is the optional nicer-button route.)

**Deploy it (3 minutes)**

1. <https://script.google.com> → **New project** → paste the whole of `Auth.gs`
   → Save.
2. **Deploy ▸ New deployment ▸ Web app**
   - *Execute as:* **User accessing the web app** ← this is what makes Google
     authenticate the visitor as *their* Google account
   - *Who has access:* **Anyone with Google account**
   - Deploy.
3. Copy the `/exec` URL into `auth.js` → `NEON_AUTH.authEndpoint` – or paste it
   into the **Set up Google sign-in** panel on `profile.html` to test it on that
   device before committing.

**How it works**

- The site sends the visitor there; Google signs them in (no permissions are
  requested, so there is no consent screen).
- The script reads `Session.getActiveUser().getEmail()`, mints a 64-character
  session token, stores it **hashed** in the script's own properties and sends
  the visitor back to the site with `#nl_auth=<token>&nl_email=…`.
- `auth.js` strips the token from the address bar, then re-checks it over JSONP
  (`?action=session&token=…&callback=…`) on every visit; `?action=signout`
  revokes it server-side.

**Check it**: open the `/exec` URL in a browser while signed in to Google →
`{"ok":true,"service":"neon-legacies-google-auth","signedInAs":"you@…"}`. If
`signedInAs` is missing, the deployment is running as *Me* – switch *Execute as*
to *User accessing the web app*.

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

## Google Sign-in (`action=googleLogin`)

`profile.html` signs members in with their **Google account** – see `auth.js`
on the site. The browser verifies the ID token with Google, then posts it here
so the sign-in is verified a second time and recorded.

**Switch it on**

1. <https://console.cloud.google.com/apis/credentials> → *Create credentials ▸
   OAuth client ID ▸ Web application*.
2. *Authorised JavaScript origins*: `https://www.neonlegacies.co.za`
   (+ `http://localhost:8000` for local testing).
3. Paste the client id into `GOOGLE.CLIENT_ID` in `Code.gs` **and** into
   `NEON_AUTH.googleClientId` in `auth.js`. They must match – a mismatch makes
   every sign-in fail with `wrong audience`.
4. Publish a **new version** of the existing web app deployment (the `/exec`
   URL does not change). The `Logins` tab is created on the first sign-in.

**What is checked** (`verifyGoogleToken`)

Google's `tokeninfo` must accept the token (this is what proves the signature),
and then: `iss` is Google, `aud` is our client id, `exp` is in the future,
`sub` exists, `email` exists and `email_verified` is true. Anything else is
refused with the reason – nothing is written and no mail is sent.

**Logins tab**

Timestamp | Google ID | Name | Email | Domain | Page | Session expires | Account JSON

- One row per verified sign-in; the same token (`sub` + `iat`) is only recorded
  once, so retries and double-clicks do not duplicate rows.
- At most 20 sign-ins per Google account per hour.
- The team is emailed only about an account not seen in the last 7 days, so
  the mail quota is not burned by people signing in and out.

**Test it** (a real ID token from your own Google account):

```bash
curl -sS -X POST '<EXEC_URL>' -H 'Content-Type: text/plain' \
  --data '{"action":"googleLogin","credential":"<ID_TOKEN>","token":"<TOKEN>"}'
# {"ok":true,"user":{"sub":"…","email":"…"},"session":{"days":7,"expiresAt":"…"}}
```

The browser cannot read this reply (Apps Script sends no CORS headers) – the
Logins tab and the team email are the audit trail.

## Tests

```bash
node apps-script/test/google-auth.test.js
```

Runs the **real** `Code.gs` and `Auth.gs` through an Apps Script stub and the
**real** `auth.js` / `app.js` through a small fake DOM: token verification,
replay and throttling, both login routes (OAuth + Apps Script), session
restore/expiry, sign-out, gated-page unlocking, XSS escaping, page wiring and
the browser → backend hand-off.

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
