# Viraalay booking engine — HANDOFF

**Read this first when resuming.** Last updated 2026-07-23.

Companion docs in this repo:
- `README.md` — architecture, API reference, security model, credential rotation
- `DEPLOY.md` — the deployment runbook (the only work left)
- `WEBFLOW.md` — every collection / page / class / attribute id in the Webflow site

---

## 1. What this is

A Node/Express middleware that turns the Viraalay Webflow site into a real
booking engine: live Guesty availability and pricing, PayU-hosted checkout,
automatic reservation creation in Guesty, and a Guesty → Webflow CMS sync.

All guest-facing UI is **native Webflow**. This service holds the credentials.

**Status: LIVE.** Deployed to Railway, the Webflow site is switched on and
published, and the whole guest path — live Guesty pricing → checkout — was
verified on the published site on 2026-07-23. No booking has been paid for yet.

---

## 2. Current state at a glance

| Thing | State |
|---|---|
| Guesty Open API | ✅ working — token, listings, calendar, quotes all verified live |
| Webflow CMS API | ✅ working — read + write |
| PayU signing | ✅ verified against production `verify_payment` |
| Sync (Guesty → Webflow) | ✅ run, idempotent (3rd run skipped all 16) |
| CMS content | ✅ 16 real properties, all fields populated, published |
| Reviews / FAQs / Rooms | ✅ 50 reviews, 190 FAQs, 61 rooms |
| Service deployed | ✅ **2026-07-23** — Railway project `Viraalay`, `https://viraalay-production.up.railway.app`, latest commit `1b0f2c3` deployed SUCCESS |
| `apiBase` set in Webflow footer | ✅ **2026-07-23** — set to the Railway URL and published; engine loads on the live site |
| Guest path verified live | ✅ **2026-07-23** — property page → live quote (₹17,818, Majestic Crown 14–17 Aug, 4 guests) → `/checkout` carrying everything; zero console errors |
| Webhooks registered | ❌ **not done** — `PUBLIC_BASE_URL` now points at Railway, so `npm run register-webhooks` is ready to run |
| Sync scheduled every 6h | ❌ **not done** |
| Live test booking | ❌ **not done** — Part 9, charges a real card |
| "Book Now" button binding | ✅ **fixed 2026-07-23** — was matching nothing; verified end-to-end against live Guesty (see §8) |

---

## 3. Credentials

All live values are in `.env` only. **Never commit it**; `npm run scan-secrets`
fails the build if a secret leaks into a tracked file.

| Credential | Value / location |
|---|---|
| Guesty Open API client id | `0oavw501blCBOXFMJ5d7` (app "Viraalay Guest Websiet Booking") |
| Guesty Open API secret | in `.env` (ends `a8os`) |
| Webflow API token | in `.env` |
| PayU merchant key / salt | in `.env` |
| Webhook + sync shared secrets | in `.env` (invented, not issued) |

> **`.env` ACL resets whenever the file is edited.** Re-apply after any edit —
> the PowerShell snippet is in `README.md` under Security model.

**All four credentials were transmitted over chat during setup. Rotating them is
outstanding.** Rotation table in `README.md`; do the PayU salt first, it maps
directly to money.

---

## 4. Facts that shaped the architecture — verified, do not re-litigate

1. **The account does NOT have the Guesty Booking Engine API add-on.**
   Verified in Add-ons → Your add-ons (only PriceOptimizer, Accounting,
   Advanced Analytics). Everything runs on the **Open API Reservations V3**
   flow instead:
   `GET /v1/availability-pricing/api/calendar/listings/{id}` →
   `POST /v1/quotes` → `POST /v1/reservations-v3/quote`.
   That last endpoint **requires no payment token**, which is exactly what makes
   PayU workable. The Booking Engine's `/quotes/:id/instant` requires a Stripe
   SCA `ccToken` and is unusable with PayU even if licensed.
   `GUESTY_API_MODE` switches between the two.

2. **The Open API nests quote money TWICE.** The real figures are at
   `rates.ratePlans[0].money.money`. `ratePlans[0].money` is only a wrapper
   (`_id` / `expirationDate` / `inquiryId`) — reading that level returns a quote
   with every figure at zero, which is how a booking engine ends up charging ₹0.
   Handled by `planMoney()` in `src/lib/guesty.js`.
   **Guest total = sum of `invoiceItems`**, not `hostPayout` (that is the host's
   share and diverges as soon as commission applies).

3. **Guesty allows only 5 OAuth token requests per client id per 24 hours.**
   A long-running process fetches one a day. Frequently cold-starting serverless
   will burn the quota and take the engine offline. Use an always-on host, or
   set `UPSTASH_REDIS_REST_URL` + `_TOKEN` so `src/lib/token-store.js` shares the
   token across invocations.

4. **The PayU credentials are LIVE, not test.** Probed: `info.payu.in` accepted
   the hash; `test.payu.in` returned "Invalid Hash." `PAYU_MODE=live` is
   therefore the only configuration that works. Nothing can be charged until the
   service is deployed *and* `apiBase` is set, but the first real booking after
   that charges a real card.

5. **Webflow caps collections at 60 custom fields.** Properties hit it. Resolved
   by migrating the eighteen `Q1…Q9`/`A1…A9` fields into a FAQs collection and
   deleting them. Properties now sits around 57 with a little headroom.

6. **Guesty OAuth app creation requires the account password** at the confirm
   step, so it cannot be automated, and the secret is shown only once.

---

## 5. Live Guesty data

**16 listings** across **Jodhpur, Udaipur, Jaipur** — all active and listed.

Verified pricing example: Kvanya Mansion, 3 nights =
₹1,70,000 accommodation + 18% GST ₹30,600 = **₹2,00,600**.

**20 real Airbnb reviews** exist in Guesty (`GET /reviews`), covering 6 of the
16 listings, with guest names (via `GET /guests/:id`), overall ratings and
Airbnb's six category scores.

Raw payloads cached in `backups/` (gitignored):
`guesty-listings-raw.json`, `guesty-reviews-raw.json`, `guesty-quote-raw.json`,
`viraalay-doc.txt` (the client working document, text-extracted).

---

## 6. Webflow site

Site `viraalay` · id `6a56f9a2d06b16a017f0dd75` · published `viraalay.webflow.io`

### Collections

| Collection | id | Items |
|---|---|---|
| Properties | `6a58ffaac89342cf498710b9` | 16 (all Guesty-linked, published) |
| Property Sync | `6a604a6b6e24d84900fe7827` | 16 |
| Locations | `6a6049b09409fba1e822a90c` | 3 — Udaipur 13, Jaipur 2, Jodhpur 1 |
| Bookings | `6a6049b12f7e47d5f9aa08a4` | 0 (fills as bookings happen; always drafts) |
| Add Ons | `6a6049b28d94bdc10b0ba24d` | 0 |
| Cancellation Policies | `6a6049b38d94bdc10b0ba283` | 4 |
| FAQs | `6a60595fc48c9e90dad6b125` | 190 |
| Reviews | `6a5a5f4c194856c6b6f5ea98` | 50 (20 real, 30 placeholder) |
| Rooms | (query by slug `rooms`) | 61 |
| Amenities / Great For / Property Types | — | 52 / 12 / 5 |

### Pages built

`/checkout` `6a604ae6644b84c5cbf0fd2d` · `/booking-confirmed`
`6a604ae68a36ea87a9544a2a` · `/booking-failed` `6a604ae79409fba1e8237098`.
All responsive, verified 1280px and 375px.

### Scripts applied site-wide (footer)

- `viraalaysearchmemory` v1.0.0 — persists the search in `sessionStorage` and
  rewrites the URL before the head widget boots, so the nav pill and booking
  sidebar stay populated across pages.
- `viraalaybookingloader` v1.0.1 — DOM-ready deferred; loads
  `<apiBase>/assets/viraalay-booking.js` only once `apiBase` is set.

The **head** freeform block holds the search widget (~19KB). Its `DEST` list is
now Udaipur/Jaipur/Jodhpur and is overridable via `window.VIRAALAY_DESTINATIONS`.
The **footer** freeform block ends with the `window.VIRAALAY_BOOKING = { apiBase: "" }`
config block — that empty string is the on/off switch for the whole engine.

---

## 7. Scripts

```
npm start                                    run the service
npm run sync                                 Guesty → Webflow (idempotent)
npm run sync -- --dry-run
npm run sync-reviews -- --confirm            import real Guesty reviews
npm run sync-reviews -- --confirm --placeholders
npm run gen-faqs -- --confirm                regenerate FAQs from real fields
npm run fill-content -- --confirm            editorial fields, taxonomy, imagery
npm run fill-remaining -- --confirm          cancellation policy, gap-filling
npm run cleanup -- --confirm                 delete demo data (already run)
npm run register-webhooks                    needs a public PUBLIC_BASE_URL
npm run scan-secrets                         pre-commit safety net
```

All are dry-run by default and idempotent.

### File map

```
HANDOFF.md  README.md  DEPLOY.md  WEBFLOW.md      docs — start with this file
.env                                              LIVE SECRETS, gitignored, ACL-locked
.env.example                                      template
src/config.js                                     env + credential guards
src/app.js  src/server.js  api/index.js           express app, node entry, serverless entry
src/lib/guesty.js                                 both Guesty APIs, planMoney(), quote normaliser
src/lib/payu.js                                   hashing, sanitisation, verify_payment
src/lib/webflow.js                                Webflow Data API v2 client
src/lib/store.js                                  booking ledger (swap this for a real DB)
src/lib/sync.js                                   Guesty <-> Webflow field mapping
src/lib/security.js                               log redaction, rate limiting, headers
src/lib/token-store.js                            Guesty OAuth cache (Upstash -> file -> memory)
src/lib/util.js                                   dates, money, refs, fetch w/ retry
src/routes/api.js                                 availability, quote, checkout, search, booking
src/routes/payu.js                                payment callback (3-way verification)
src/routes/hooks.js                               webhooks + manual sync
public/viraalay-booking.js                        the front end Webflow loads
scripts/                                          sync, reviews, FAQs, content fill, cleanup, secret scan
scripts/content/property-content.js               client-doc copy, keyed by Webflow slug
backups/                                          gitignored; raw Guesty payloads + pre-delete snapshots
```

`backups/` is worth knowing about on resume — it holds `guesty-listings-raw.json`,
`guesty-reviews-raw.json`, `guesty-quote-raw.json`, `viraalay-doc.txt` (the
client document, text-extracted) and snapshots of everything that was deleted.
Several scripts read from it rather than re-hitting Guesty.

---

## 8. Hard-won gotchas

**Webflow CMS**
- Bulk item create needs `{items:[{fieldData}]}`, **not** `{fieldData:[...]}`.
- **File fields accept `{url}`** and Webflow re-hosts the file on its CDN.
- **Single-line PlainText fields reject newlines**, and a violating item becomes
  permanently un-updatable — *every* later PATCH 400s, including flipping
  `isDraft`. `singleLine()` in `src/lib/sync.js` guards this.
- **Deleting a referenced item 409s**, references here were circular, and
  **staged and live copies are separate**. Working order: clear refs on *both*
  sides → **publish** → delete live, then staged. Encoded in
  `scripts/cleanup-demo-data.js`.
- The Data API **cannot create Collection Lists** or read/write Collection List
  filters and limits. Those are Designer-only.
- `data_whtml_builder`: inputs and labels must live inside a `<form>`; the `css`
  param takes single-class selectors only; bound attributes only work on `DOM`
  elements, not `Block`.

**"Book Now" is a Webflow component, not a plain button.** Its real markup is
`<a class="button-main">` → `span.button-main__inner` → `span.button-main__mask`
→ `span.button-main__text`. The `<a>` therefore has children, and the only leaf
holding the exact text is a **`<span>`**. The original binding in
`public/viraalay-booking.js` required `children.length === 0` *and* did not list
`span` in its selector, so it matched **nothing** — verified live: old logic
bound 0 elements, new logic binds 1. Fixed 2026-07-23 by matching the label at
any depth, adding `span`, then resolving up via `closest('a, button')`.
**Dedupe on the resolved target, not the candidate** — `<a>`, `__inner`,
`__mask` and `__text` all carry the text "Book Now", so deduping on the
candidate would bind four handlers to the same anchor and fire checkout 4×.
Any future Designer restyle of this button should be re-tested against it.

**Ratings mapping** — Airbnb has no *meals* category, so Meals rating mirrors
the overall score rather than inventing a number. clean ← cleanliness,
staff ← communication + checkin, experience ← accuracy + value.

**Placeholder reviews** are flagged `Placeholder? = ON`, guest name prefixed
`Sample —`, source "Placeholder — not a real review". Filter that switch and
delete before launch; re-running the import never recreates them and never
touches real ones.

---

## 9. What is left

### A. Finish the go-live runbook

`DEPLOY.md` Parts 1–6 are **done** (deployed, env set, site switched on, guest
path verified). Remaining, in order:

1. **Part 7 — `npm run register-webhooks`.** `PUBLIC_BASE_URL` in `.env` was
   pointed at the Railway URL on 2026-07-23, so the script's localhost guard no
   longer blocks it. Registers 6 Guesty + 2 Webflow subscriptions; idempotent.
2. **Part 8 — schedule the sync** every 6 hours:
   `GET https://viraalay-production.up.railway.app/api/sync/listings?token=SYNC_SECRET`
   (cron-job.org, or a Railway cron service on `0 */6 * * *`).
3. **Part 9 — one real booking.** Lakecity, ₹5,000/night, one night, then refund
   from the PayU dashboard. This charges a real card.

### A2. Two UI issues found during the 2026-07-23 live verification

- **The property sidebar shows two different totals.** The CMS static price block
  ("Total (Incl. taxes) ₹14,998 for 2 nights") renders *above* the live quote
  panel, which for the same stay says ₹17,818. A guest sees the stale figure
  first. Either hide the static block once a live quote renders, or move the
  quote panel above it.
- **Checkout shows placeholder cancellation copy** — "Cancellation terms for this
  home will appear here." The Open API quote returns `cancellationPolicy: null`,
  so nothing fills it. Either map the Cancellation Policies collection by
  property or drop the block.

### B. Three Designer-only tasks (Data API cannot do these)

1. **Rebuild the FAQ section on the property template.** Deleting `Q1…Q9`
   removed its bindings — only the "FAQs" tab label survives, so none of the
   190 FAQs render. Add a Collection List → source **FAQs** → filter
   `Property = Current Property` → sort by `Display order` → bind Question and
   Answer. (Or bind the `FAQs` multi-reference field on Properties.)
2. **Bind the new `Tagline` field** on the property template — it is the only
   populated field not displayed anywhere.
3. **Raise the `/properties` Collection List item limit.** It is 15, so 1 of 16
   properties (`The Brindha Villa`) never renders.

### C. Housekeeping

- **Rotate all four credentials** (chat-transmitted). PayU salt first.
- **Delete the 30 placeholder reviews** before launch.
- Replace the placeholder brochure PDF and the placeholder YouTube video link.
- Real brochures need hosting; Webflow re-hosts whatever URL you give the File field.

---

## 10. Known limitations

- Guest PII sits in the Webflow Bookings collection as unpublished drafts.
  Readable by anyone with CMS access or the API token. `src/lib/store.js` is the
  only file to replace if this should move to a real database.
- Money fields in the CMS are integers; the exact two-decimal amount charged is
  preserved in the `PayU amount` text field.
- Refunds are not automated — issue from the PayU dashboard and update the
  booking's payment status by hand.
- `/api/search` fans out one calendar call per listing, capped at 60.
- Multi-currency is untested; everything assumes INR.
