# Viraalay booking engine

Booking middleware that turns the Viraalay Webflow site into a real booking
engine: live Guesty availability and pricing, a PayU-hosted checkout, automatic
reservation creation in Guesty, and a Guesty ⇄ Webflow CMS sync.

Everything the guest sees is a **native Webflow element**. This service holds
the credentials and does the talking; the browser only renders.

---

## Why a service is required

Webflow cannot do this on its own, and no amount of custom code changes that:

| Requirement | Why it can't live in the browser |
|---|---|
| Guesty availability / quotes | OAuth **client secret**. Guesty's own docs: "backend authentication only". |
| Creating a reservation | Same secret, plus it must happen *after* payment is verified. |
| PayU checkout | The **merchant salt** signs the amount. In the browser, anyone could book a ₹2,00,000 villa for ₹1. |
| Two-way CMS sync | Webflow's CMS write token is a secret; Guesty webhooks need a public HTTPS endpoint. |

So: one small stateless service, three secrets, and Webflow stays Webflow.

---

## Architecture

```
Webflow site (native UI)
    │  fetch  ────────────────►  THIS SERVICE  ──────────►  Guesty Booking Engine API
    │                                 │                     (calendar, quotes)
    │                                 ├──────────►  Guesty Open API
    │                                 │             (listings, reservations, webhooks)
    │                                 ├──────────►  Webflow Data API  (CMS read/write)
    │                                 └──────────►  PayU  (hash + verify_payment)
    │
    └─ browser form POST ─────────►  PayU hosted checkout  ──► back to /api/payu/callback
```

### The booking flow

1. Guest picks dates on a property page → `POST /api/quote` → Guesty prices it.
2. Guest hits **Reserve** → `/checkout?listing=…&checkin=…&checkout=…`.
3. Guest fills in details → `POST /api/checkout`:
   - the quote is **re-created server-side** (a price posted by the browser is ignored),
   - a Booking item is written to the CMS as a draft with status *Awaiting payment*,
   - a signed PayU form is returned.
4. Browser auto-POSTs to PayU. Guest pays.
5. PayU POSTs the result to `/api/payu/callback`, which requires **all three** of:
   - the reverse hash matches (proves PayU sent it),
   - `verify_payment` server-to-server says *success*,
   - the captured amount equals the recorded amount, to the paisa.
6. Only then is the reservation created in Guesty and the booking marked *Confirmed*.
7. Guest lands on `/booking-confirmed?ref=VRL-XXXXXX`.

### Which Guesty API this uses, and why

Guesty sells two API products. The Viraalay account has the **Open API** (which
every Guesty account gets) but **not** the Booking Engine API add-on — verified
in the dashboard: Integrations → OAuth applications, and Add-ons → Your add-ons
(PriceOptimizer, Accounting, Advanced Analytics only).

That turns out to be fine, and in fact cleaner. The whole flow runs on the Open
API's **Reservations V3** endpoints:

| Step | Endpoint |
|---|---|
| Availability + nightly prices | `GET /v1/availability-pricing/api/calendar/listings/{id}` |
| Authoritative quote | `POST /v1/quotes` |
| Reservation from that quote | `POST /v1/reservations-v3/quote` |

The last one is the key: it **requires no payment token**. Guesty's own docs
say it "will still create a reservation, regardless of the validity of the
payment method" — exactly the "money collected by the merchant" case.

The Booking Engine API's equivalent, `POST /api/reservations/quotes/:id/instant`,
*does* require `ccToken` and only accepts Stripe SCA tokens, which PayU can
never produce. So even with the add-on licensed, the Open API path is the right
one for this integration.

Set `GUESTY_API_MODE=booking-engine` to move calendar and quotes onto the
add-on if it is ever licensed; reservation creation stays on the Open API.

### Gotcha: where the money actually lives in a quote

Verified against a live response on 2026-07-22. The Open API nests the money
object **twice**, and the outer level is only a wrapper:

```
rates.ratePlans[0]
  ├── days[]              per-night prices
  ├── ratePlan            name, cancellationPolicy, _id   ← no money here
  └── money               _id, expirationDate, inquiryId  ← wrapper only
        └── money         fareAccommodation, totalTaxes, invoiceItems …  ← the real figures
```

Reading `ratePlans[0].money` (the obvious level) returns a quote with every
figure at zero. `planMoney()` in `src/lib/guesty.js` handles this, and the
Booking Engine's flatter shape, in one place.

The guest total is computed as the **sum of `invoiceItems`**, because that is
the invoice Guesty raises. It is cross-checked against
`subTotalPrice + totalTaxes` and any mismatch is logged. `hostPayout` is
deliberately not used — it is what the host receives, which diverges from what
the guest pays as soon as commission applies.

Live example (Kvanya Mansion, 3 nights): accommodation ₹1,70,000 + GST 18%
₹30,600 = **₹2,00,600**.

### If the quote expires

Reservations are created from the exact quote the guest paid for, so the Guesty
invoice matches the charge to the paisa. If that quote has expired by the time
PayU returns, the service falls back to `POST /v1/reservations-v3`, which
re-prices the stay — and writes a `[Quote expired - verify invoice]` note on the
reservation so staff can reconcile the difference.

---

## Setup

### 1. Credentials

| Variable | Where to get it | Status |
|---|---|---|
| `PAYU_MERCHANT_KEY` / `_SALT` | PayU dashboard → Payment gateway → API keys | **done** |
| `GUESTY_OA_CLIENT_ID` / `_SECRET` | Guesty → Integrations → **OAuth applications** → New Application | **needed** |
| `WEBFLOW_API_TOKEN` | Webflow → Site settings → Apps & integrations → API access (needs CMS read **and** write) | **needed** |
| `GUESTY_BE_CLIENT_ID` / `_SECRET` | Only if `GUESTY_API_MODE=booking-engine` | not needed |

Creating the Guesty OAuth application requires the account password at the
final confirm step, so it has to be done by a human. The client secret is shown
**once** — copy it straight into `.env`.

Invent your own values for `GUESTY_WEBHOOK_TOKEN`, `WEBFLOW_WEBHOOK_TOKEN` and
`SYNC_SECRET` — they are just shared secrets on the webhook URLs.

### 2. Deploy

```bash
npm install
cp .env.example .env      # fill it in
npm start
```

Any Node 18+ host works. **Prefer an always-on host** (Railway, Render, Fly,
a VPS) over serverless.

> **Serverless caveat.** Guesty allows only **five OAuth token requests per
> client id per 24 hours**. A long-running process fetches one token a day. A
> serverless function that cold-starts frequently can burn the whole quota in
> minutes and take the booking engine offline until the window rolls.
> If you must deploy to Vercel, set `UPSTASH_REDIS_REST_URL` and
> `UPSTASH_REDIS_REST_TOKEN` so tokens are shared across invocations —
> `src/lib/token-store.js` picks them up automatically.

### 3. Point Webflow at it

In Webflow → **Site settings → Custom code → Footer**, add:

```html
<script>window.VIRAALAY_BOOKING = { apiBase: "https://your-service-url" };</script>
```

That is the only change needed. A registered site script called
`ViraalayBookingEngine` is already applied in the footer; it reads `apiBase` and
loads `/assets/viraalay-booking.js`. Until `apiBase` is set the script does
nothing and logs a one-line notice — the site keeps working exactly as before.

Then **publish the site**.

### 4. First sync

```bash
npm run sync -- --dry-run     # see what would change
npm run sync                  # do it
```

This pulls every Guesty listing into the CMS. Listings without a matching
Property get a new Property item created **as a draft**, so nothing appears on
the live site until someone reviews it.

### 5. Webhooks

```bash
npm run register-webhooks
```

Registers `listing.new/updated/removed`, `listing.calendar.updated`,
`reservation.new/updated` on the Guesty side, and
`collection_item_changed/created` on the Webflow side.

---

## The sync, and why it won't eat your copy

Two collections, deliberately:

- **Property Sync** — every operational field from Guesty, always overwritten.
  Machine-owned; nobody edits it by hand.
- **Properties** — the editorial collection. Only `guests`, `beds`, `baths` and
  `price` are force-updated on every run. Copy, imagery, ratings and SEO are
  written **once on creation**, then filled in only where a field is still
  blank.

Each Property Sync record has a **Lock editorial content?** switch. Turn it on
and the sync refreshes price and capacity only — it will never touch that
property's copy again.

### Two-way

`Guesty → Webflow` is the full sync above.

`Webflow → Guesty` is deliberately narrow: only the property **name** and
**About home** summary are pushed back, via the `collection_item_changed`
webhook. Pricing, capacity, terms and availability are one-way by design —
Guesty is the system of record for anything that affects money or inventory, and
letting a CMS edit change a nightly rate is how a villa gets sold for nothing.
Widen `PUSHABLE` in `src/lib/sync.js` if you decide otherwise.

---

## API

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/health` | Liveness + which credentials are configured |
| `GET` | `/api/config` | Non-secret front-end settings |
| `GET` | `/api/properties-index` | slug → Guesty listing id map (5 min cache) |
| `GET` | `/api/availability?listingId=&from=&to=` | Blocked dates, min-nights, per-day prices |
| `POST` | `/api/quote` | Priced quote from Guesty |
| `POST` | `/api/checkout` | Creates the booking, returns a signed PayU form |
| `POST` | `/api/search` | Which of these listings are free for these dates |
| `GET` | `/api/booking/:reference` | Public view of one booking |
| `POST` | `/api/payu/callback` | PayU success **and** failure return |
| `POST` | `/api/hooks/guesty?token=` | Guesty → Webflow |
| `POST` | `/api/hooks/webflow?token=` | Webflow → Guesty |
| `ALL` | `/api/sync/listings?token=` | Manual / cron full sync |

---

## PayU environment — read before first launch

The supplied merchant key and salt were probed against PayU's `verify_payment`
API on 2026-07-22:

| Endpoint | Response | Meaning |
|---|---|---|
| `info.payu.in` (production) | `0 out of 1 Transactions Fetched Successfully` | hash accepted — credentials valid |
| `test.payu.in` (sandbox) | `Invalid Hash.` | credentials do not exist on test |

**These are live credentials.** `PAYU_MODE` is still set to `test`, which means
checkout will fail until it is changed — that is deliberate, so nobody takes
real money by accident. Either:

- ask PayU for sandbox credentials and use those for staging, or
- set `PAYU_MODE=live`, run one low-value real booking end to end, and refund it
  from the PayU dashboard.

## Security model

Verified 2026-07-22. Run `npm run scan-secrets` before every commit.

| Control | Where | Verified |
|---|---|---|
| Secrets only in `.env`, never in code | `.gitignore`, `scripts/scan-secrets.js` | scanner passes |
| `.env` readable by the owning OS account only | Windows ACL | `MSI\divya` FullControl, inheritance off |
| Guesty token cache locked down | `%TEMP%\viraalay-token-*.json` | same ACL |
| Log redaction | `src/lib/security.js` | all four secret types replaced with `[REDACTED]` |
| Rate limiting | `src/app.js` | quote 30/min, availability 60/min, search 15/min, checkout 10/min — 31st request returns 429 |
| Security headers | `securityHeaders` | nosniff, no-referrer, DENY framing, restrictive permissions |
| Health detail gated | `/health` | public response is `{ok, service}` only; detail needs `SYNC_SECRET` |
| CORS allow-list | `src/app.js` | site origins + `*.webflow.io` previews only |
| Booking PII unpublished | `src/lib/store.js` | items always `isDraft: true` |

> **Editing `.env` on Windows resets its ACL.** Re-apply after any edit:
> ```powershell
> $p=".env"; $a=Get-Acl $p; $a.SetAccessRuleProtection($true,$false)
> $a.Access | %{ $a.RemoveAccessRule($_) | Out-Null }
> $a.AddAccessRule((New-Object System.Security.AccessControl.FileSystemAccessRule("$env:USERDOMAIN\$env:USERNAME","FullControl","Allow")))
> Set-Acl $p $a
> ```

### Credential rotation

Every credential in `.env` was transmitted over chat during setup. Treat them as
exposed and rotate once the integration is stable:

| Credential | Blast radius if leaked | Rotate at |
|---|---|---|
| **PayU salt** | forge a "payment succeeded" response and book for free | PayU dashboard → API keys |
| **Guesty client secret** | full read/write on the PMS: reservations, pricing, guest data | Guesty → Integrations → OAuth applications |
| **Webflow API token** | full CMS write on the live site | Webflow → Site settings → Apps & integrations |
| **PayU client secret** | PayU token APIs (refunds) | PayU dashboard |

Rotating is a two-minute job: generate, paste into `.env`, restart, re-apply the
ACL. Do the PayU salt first — it is the one that maps directly to money.

- No secret ever reaches the browser. The front end receives a finished PayU
  hash, which is useless without the salt.
- The checkout price is always re-derived from Guesty server-side.
- The PayU return is verified three independent ways before a reservation is
  created (hash, `verify_payment`, amount match).
- The callback is idempotent — PayU retries and browser refreshes cannot
  double-book.
- If payment succeeds but the Guesty call fails, the guest still sees success,
  the money is recorded, and the booking is flagged *Inquiry* with
  `[ACTION REQUIRED]` in its notes. Staff reconcile; the guest is never shown a
  failure for our integration problem.
- CORS is restricted to the site's own origins plus `*.webflow.io` previews.
- Booking CMS items are created as **drafts and never published**, so guest
  details never reach the public site.

---

## Known limitations

- **Guest PII lives in the Webflow CMS.** Items are unpublished drafts, which
  keeps them off the public site, but anyone with CMS access or the API token
  can read them. That is a reasonable trade for giving the client a readable
  ledger in the Editor they already use. If the client would rather it lived in
  a real database, `src/lib/store.js` is the only file that needs replacing —
  its interface is four functions.
- **Money fields in the CMS are integers.** Webflow's API creates Number fields
  at integer precision. Exact two-decimal amounts are preserved in the
  `PayU amount` text field, which is authoritative for reconciliation. Change
  the precision in the Designer if you want decimals in the display fields too.
- **Refunds are not automated.** Cancelling in Guesty does not refund through
  PayU. Refunds are issued from the PayU dashboard and the booking's payment
  status updated by hand.
- **Multi-currency is untested.** Everything assumes INR, which is what PayU
  settles in.
- **`/api/search` fans out one calendar call per listing** and is capped at 60
  listings per request. Beyond a few hundred properties this wants replacing
  with Guesty's own availability search.

---

## Files

```
src/config.js            env + credential guards
src/lib/util.js          dates, money, references, fetch with retry
src/lib/token-store.js   Guesty OAuth token cache (Upstash → file → memory)
src/lib/guesty.js        both Guesty APIs
src/lib/payu.js          hashing, sanitisation, verify_payment
src/lib/webflow.js       Webflow Data API v2
src/lib/store.js         booking ledger
src/lib/sync.js          Guesty ⇄ Webflow mapping
src/routes/api.js        availability, quote, checkout, search, booking
src/routes/payu.js       payment callback
src/routes/hooks.js      webhooks + manual sync
public/viraalay-booking.js   the front end loaded by Webflow
scripts/                 one-off sync and webhook registration
```
