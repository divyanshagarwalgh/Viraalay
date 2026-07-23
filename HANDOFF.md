# Viraalay booking engine — HANDOFF

**Read this first when resuming.** Last updated 2026-07-23 (end of a long session;
39 commits that day). HEAD at handover: `5a80e6f`.

Companion docs in this repo:
- `README.md` — architecture, API reference, security model, credential rotation
- `DEPLOY.md` — the deployment runbook (Parts 1–8 done)
- `WEBFLOW.md` — every collection / page / class / attribute id in the Webflow site
- `CLIENT-HANDOVER.html` — the non-technical handbook written for the Viraalay
  team (also published as a shareable Artifact)

---

## 0. RESUME HERE — state at handover

**The site is live and working.** Deployed on Railway, Webflow switched on,
prices real, calendar correct, checkout working. Every fix below is deployed and
was verified against the live site.

### Two payments are unreconciled — deal with these first

Both were taken while the callback was broken. **Check PayU for each and either
refund it or create the reservation in Guesty by hand.**

| Reference | Property | Dates | Amount | What happened |
|---|---|---|---|---|
| `VRL-PM6J95` | The Majestic Crown | 9–10 Nov 2026 | ₹7.08 | Callback 500'd on the CORS bug — never verified, no reservation |
| `VRL-K28GNF` | The Majestic Crown | 19–20 Nov 2026 | ₹3.54 (shown ₹4) | Reverse hash mismatch — booking marked failed, guest told "no charge has been made", which was never established |

### The one open engineering question

**Why does PayU's reverse hash not match?** Unidentified. A live payment hit it
on 2026-07-23. Payments are no longer lost to it — a mismatch now falls through
to the authoritative server-to-server `verify_payment` — but the root cause is
still open. The callback now logs the field names, `status`, and whether
`additionalCharges` is present on mismatch. **One more live payment plus those
logs should identify which hash variant this merchant account signs with.**
Suspects worth checking in that order: `additionalCharges` prepending, salt v1
vs v2, and the udf6–udf10 placeholder count.

### Waiting on the client / not started

1. **Hero search bar position** — the client wants to control it in Designer.
   It cannot be, because three rules in the **head custom code** pin it with an
   **ID selector** (which beats any Designer class) at a fixed `bottom` in px
   (which is why it overlaps on some screens and sits too low on others).
   Delete these three and Designer owns it:
   - `#viraalay-hero-search{position:absolute;left:0;right:0;bottom:170px;display:flex;justify-content:center;padding:0 5%;z-index:20}`
   - inside `@media(max-width:991px)`: `#viraalay-hero-search{bottom:130px}`
   - inside `@media(max-width:767px)`: `#viraalay-hero-search{bottom:92px;padding:0 20px}`

   Keep `.section_header_home{position:relative}`. Advise percentage offsets, not
   px, so the bar keeps its relation to the heading. **The client was deciding
   whether to make this edit themselves or have it done** — see the warning about
   the head block in §8.
2. **Guesty still has ₹3/night test rates on The Majestic Crown.** Restore real
   rates before any further testing, or the figures look broken when they are not.
3. **Nobody has confirmed Guesty's automated guest emails are switched on.** The
   service sends no email at all. Until that is checked, a guest can pay and
   receive nothing in writing. Flagged in the client handbook.

### Smaller open items

- Totals display as whole rupees while the exact paise is charged (₹4 shown,
  ₹3.54 taken). Trivial at real prices, glaring at test rates. Not fixed.
- The **ROOMS** selector in the booking box changes nothing — Guesty prices the
  whole property. Hide it or relabel it.
- Adding a destination city means editing the `DEST` array in the head code. The
  commented-out `window.VIRAALAY_DESTINATIONS` override in the **footer does not
  work** — the list is captured when the head script parses, long before the
  footer runs. A CMS-driven version was designed but not built: the Locations
  collection already has `city`, `state`, `display-order` and an auto-maintained
  `property-count`, so it needs an endpoint plus a lazy read in the head widget.
- Rooms are only bookable as separate Guesty listings (as BlueRoot already is).
  A room picker inside one property page is a substantial build — Guesty's
  reservation flow is one listing per reservation.

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
| Webhooks registered | ✅ **2026-07-23** — Guesty subscription `6a61a8079eaaf2001a871b57` (6 events) + 2 Webflow triggers; a `reservation.created.v2` hook arrived and was handled within seconds |
| Sync scheduled every 6h | ✅ **2026-07-23** — in-process in `src/server.js`; log says `[sync] scheduled every 6h` |
| Auto-deploy from GitHub | ❌ **OFF** — pushing to `main` ships nothing. Deploy from the Railway dashboard or via the Railway MCP after every push |
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

   **Always-on is not enough on its own — every DEPLOY costs a token.** The file
   cache lives in the container temp dir, which Railway wipes on each deploy, so
   a restart looks exactly like a cold start. Three deploys inside an hour on
   2026-07-23 exhausted the quota and `/api/quote` returned 429 for the rest of
   the window. Two defences, both now in the code:
   - `TOKEN_CACHE_DIR` — point it at a **mounted Railway volume** so the cached
     token survives deploys. Without this, budget deploys against the 5/day.
   - `GUESTY_OPENAPI_ACCESS_TOKEN` + `GUESTY_OPENAPI_EXPIRES_AT` (epoch ms) —
     paste in a token you already hold and the service will not ask for another.
     The escape hatch when the quota is already spent. Read-only; clearing the
     vars returns to the normal flow.

   A valid token normally sits in `%TEMP%\viraalay-token-openApi.json` on the
   machine that last ran a script — that is where to get a value to seed with.

   **This happened, and is currently seeded.** On 2026-07-23 the quota was spent
   and pricing was down; `GUESTY_OPENAPI_ACCESS_TOKEN` +
   `GUESTY_OPENAPI_EXPIRES_AT` were set on Railway from the local cache and
   pricing came straight back. That seed expires **24 Jul 2026 11:03 IST**.
   A seeded token wins over every other source, so nothing is written to `/data`
   until it lapses; after that the service fetches once, caches to the volume,
   and carries on. **Delete both variables after 24 Jul** — once past expiry they
   are ignored but log a warning on every read.

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

**Guesty webhooks take one subscription per URL with an `events` ARRAY**, not one
subscription per event — posting `{ event }` returns 400 "events are required",
so the original registration script had never worked. `reservation.new` /
`reservation.updated` are also deprecated now; Guesty names
`reservation.created.v2` / `reservation.updated.v2` as the replacements. The v2
payloads carry the event name in `eventType` and nest the reservation somewhere
other than `body.reservation`, so `src/routes/hooks.js` probes several shapes.

**The date picker's day cells carry no date.** It renders each day as a bare
`<button class="vla-d">12</button>`, so the availability painting — which keys
off `[data-date]` — had never marked anything: 61 cells on screen, 11 blocked
dates known, zero marked. `stampCalendarDates()` recovers the date from each
`.vla-mo` block's "Aug 2026" heading plus the cell order and stamps `data-date`.
Blocked cells deliberately keep `pointer-events` so their `title` tooltip shows;
clicks are swallowed by a **capture-phase** listener instead, because the picker
binds its own `onclick` and would otherwise take the date first.

**The /properties list is rendered by Finsweet, not by Webflow.** A pass at boot
finds zero cards, and Finsweet rebuilds the list on every filter, sort and page
change, discarding anything written into a card. `ListingPage` watches the list
and re-applies, caching the `/api/search` result per date range.

**The card price field is not a nightly rate.** Cards render the CMS `price`
field under a "Per Night" label, but The Royal Crown carries `18016` there
against a live rate of `5500` a night — roughly threefold overstated. Live rates
now overwrite it from the calendar `/api/search` already fetches. Write a **bare
number**: the rupee sign is a sibling element, and the field carries
`fs-list-fieldtype="number"` for Finsweet's price sort and range filters, so a
formatted string renders "₹ ₹5,500" and breaks both.

**`prices.basePrice` is not what anyone pays.** This account runs PriceOptimizer,
so the calendar holds the real rates and basePrice is a vestigial default —
18016 vs a 90-day calendar of 5000–9749 on The Royal Crown. The sync now writes
the **lowest available nightly rate over the next 90 days** into the CMS `price`
field (`lowestNightlyRate()`), so the home page and any non-dated card advertise
a figure somebody could really book, with no client-side patching. Blocked dates
are excluded — a rate you cannot book is not a "from" price.

**THE WEBHOOKS CLOSED A WRITE LOOP.** `pushPropertyToGuesty` pushed title and
summary on every Webflow event regardless of whether they had changed: a Webflow
write fired `collection_item_changed` → push to Guesty → Guesty fired
`listing.updated` → Guesty→Webflow sync → another Webflow write → round two.
Observed live 2026-07-23 running flat out until it exhausted Webflow's
60-a-minute budget, which also starved every other write. The tell was a PATCH
returning the new value and a GET seconds later returning the old one. It now
compares against Guesty before writing, so the second hop finds nothing to do.
**Any future Webflow→Guesty push must be a no-op when nothing differs.**

**Webflow 429s are back-pressure, not failure.** `webflow.api()` backs off
2/4/8/16/32s. Before that a long sync silently dropped listings — one run
reported eleven.

**`npm run sync` is dry by default and needs `--confirm`.** It used to write
unless you passed `--dry-run`, and PowerShell swallows the bare `--` separator,
so the flag never arrived and a "dry run" wrote for real. Prefer
`node scripts/sync-once.js --confirm` on Windows.

**`/assets` is served with `Cache-Control: max-age=300`.** Browsers hold the
booking script for five minutes, so a just-deployed fix will not appear on a
reload inside that window — check `performance.getEntriesByType('resource')`
for `transferSize: 0` before concluding a fix did not work.

**A reverse-hash mismatch is NOT evidence that a payment failed.** It says the
browser-posted form cannot be attributed to PayU — nothing about whether money
moved. It used to mark the booking failed and tell the guest "no charge has been
made", which nobody had established. A bad hash now downgrades the response to
*unattributed*: the declared status is ignored, and the authoritative
server-to-server `verify_payment` decides, since that asks PayU over a channel
the browser cannot touch. A forged POST still cannot confirm a booking (verified
live) and, with a failing verification, is not written to the booking at all.
**A live payment on 2026-07-23 hit this** (`reason=invalid_signature`); the
mismatch's cause is still unidentified, and the callback now logs the field
names, status and whether `additionalCharges` is present so the next one pins
down which hash variant this merchant account signs with.

**CORS MUST NOT THROW ON AN UNKNOWN ORIGIN.** PayU returns the guest by posting
a form from `secure.payu.in`, which carries an `Origin` header like any other
cross-site POST. The origin callback used to `callback(new Error(...))`, which
turned that return into a **500 before the route ran** — so on 2026-07-23 a real
payment was taken, never verified, no reservation created, and the guest was
shown "Something went wrong on our side". Every payment would have done this.
Refuse the *headers* (`callback(null, false)`) instead: withholding them is the
actual protection, since a browser then refuses to hand a scripted cross-origin
response to a page that was not granted access, while form posts and navigations
— which CORS does not govern — proceed. Reproduce with:
`curl -X POST <base>/api/payu/callback -H "Origin: https://secure.payu.in" -d "status=success&txnid=X&udf1=Y"`
— a 303 is correct, a 500 is the bug.

**The picker closes its own calendar when it re-renders.** Choosing a date or a
month arrow makes it rebuild the calendar, replacing every node in the popover.
The click then reaches its document-level "click outside closes the popover"
check, which tests `pop.contains(e.target)` — false, because the rebuild just
destroyed that node — so it closes. Symptoms: month arrows shut the calendar,
and picking a check-in shut it before a check-out could be chosen.
`SearchFlow.keepCalendarOpen()` stops clicks inside `.vla-cal` at the popover so
that check never runs for them. **Any listener that needs to see calendar clicks
must therefore use the capture phase** — that is why the auto-advance listener
does.

**Never read an element the page WRITES to.** `#vbk_ci` / `#vbk_co` are the
checkout page's own display, filled by `CheckoutPage.render`. Adding them to
`readSelection`'s picker list made checkout read the element it was about to
fill, find the "Select date" placeholder, and refuse every booking with "We
could not load your booking". Only `#bk_*` (booking sidebar), `#vm_*` (mobile
modal) and `#vh_*` (hero) are inputs, and none of them exist on `/checkout`, so
it falls through to the URL — which is where checkout has always got its dates.

**A picker showing "Select date" is an ANSWER, not a missing value.** Choosing a
new check-in clears the check-out on purpose. Falling back to the URL there
resurrected the old check-out, so one click looked like a complete stay: wrong
nights priced, and the auto-advance replaced the calendar before a check-out
could be chosen. `fromPicker()` consults the URL only when the element does not
exist at all — i.e. on pages with no picker (checkout, listings).

**`/assets` revalidates now (`max-age=0, must-revalidate`), it is not cached for
five minutes.** That window meant a shipped fix reached nobody until it expired,
and made verification unreliable. `Timing-Allow-Origin: *` is set so
`transferSize` is meaningful cross-origin — without it the browser reports 0
whether cached or not, which is actively misleading when chasing "why hasn't my
fix appeared". **Verify front-end changes in a separate browser** (the in-app
one held stale copies for far longer than the TTL).

**`readSelection()` reads the WIDGET first, the URL second.** It was the other
way round, and a property page is always reached with `?checkin=…`, so the URL
always matched and the picker was never consulted: changing dates updated the
display while the price stayed on the old dates until someone edited the address
bar. The URL is a seed and the fallback for pages with no picker (checkout,
listings). Guests are recovered as `shownTotal - urlChildren`, because the
picker only ever displays a combined head count.

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

`DEPLOY.md` Parts 1–8 are **done** — deployed, env set, site switched on, guest
path verified, webhooks registered, sync scheduled. What is left:

1. **Part 9 — one real booking.** Lakecity, ₹5,000/night, one night, then refund
   from the PayU dashboard. This charges a real card. Nothing else can prove the
   PayU leg, because PayU has no usable test mode with these credentials.
2. **The sidebar price duplicate was fixed** 2026-07-23 (see A2), but the
   **checkout still shows placeholder cancellation copy** — "Cancellation terms
   for this home will appear here." The Open API quote returns
   `cancellationPolicy: null`, so nothing fills it. Either map the Cancellation
   Policies collection by property or drop the block.

### A2. Fixed 2026-07-23 — the sidebar showed two different totals

The CMS static price card ("Total (Incl. taxes) ₹14,998 for 2 nights") rendered
*above* the live quote panel, which for the same stay said ₹17,818 — the stale
figure read first. `public/viraalay-booking.js` now hides that card and its
divider once a real quote lands, and moves the quote panel up into the slot it
vacated so the price still sits above the Book Now row. The card comes back
whenever there is no live quote (no dates, unavailable dates, API error, engine
off), so the sidebar is never priceless.

The card is matched **by text** (`/total/i` plus a figure) because every block in
that column is an identically-classed `.booking_content`. If the Designer copy
changes so nothing matches, the panel renders where it already is and only the
duplicate returns — it fails soft, but re-test after any sidebar restyle.

**The quote panel is hidden in the Designer, and that was swallowing every
failure message.** Measured live: computed `display:none`, with
"We could not price these dates" written inside it. So when pricing broke the
guest saw only the CMS card — a fixed figure "for 2 nights" that disagrees with
whatever dates were chosen — and no sign anything was wrong. `showPanelWithoutPrice()`
now forces the panel visible for anything the guest must read and clears stale
line items; the failed-quote branch also hides the CMS card, since a price for
the wrong number of nights is worse than no price. On checkout a failed quote
now dims **PAY SECURELY** to "Pricing unavailable" — `pay()` always refused
without a quote, but it used to claim pricing was "still loading".

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

### B2. What runs unattended, and what does not

**Automatic, no human needed:**
- Guesty OAuth token — one fetch a day, cached on the `/data` volume so deploys
  and restarts reuse it instead of spending quota.
- Guesty → Webflow sync every 6h in-process, **and it now publishes**, so the
  live site actually changes.
- Webhooks push listing, calendar and reservation changes through immediately.
- Webflow 429s back off and retry.
- Container auto-restarts on crash (`restartPolicyType: ALWAYS`, set 2026-07-23)
  and never sleeps.

- **Monitoring** — `.github/workflows/uptime.yml` checks `/health` and a real
  Guesty-backed availability call, and GitHub emails the repo owner when it
  fails. It also runs on every push to `main`, which doubles as a deploy smoke
  test (verified passing 2026-07-23).
  **The 15-minute cron is best effort.** GitHub documents scheduled workflows as
  delayable and droppable under load; this one did not fire at all in its first
  35 minutes. Treat it as a free safety net, not a guarantee — a quiet hour is
  not proof the site is up. For a hard guarantee, put a free purpose-built
  uptime monitor (UptimeRobot and similar have free tiers with 5-minute checks)
  on `/health` as well; it needs an account, so it cannot be scripted from here. It runs on **GitHub, not Railway**, on purpose: a monitor
  inside the service cannot report that service being down, and a second Railway
  service would eat the Hobby credit. Free — Actions minutes are unlimited on a
  public repo. **GitHub disables scheduled workflows after 60 days with no repo
  activity** (it emails first); any push re-arms it.

**Still needs a human:**
- **Billing.** Railway Hobby, $5/month included credit, overage on the card. A
  failed card or exhausted credit stops the service. Nothing warns you — the
  uptime check would fire once the service actually stopped, but not before.
- **New Guesty listings arrive as Webflow drafts** and stay off the site until a
  human publishes them. Deliberate (review before publish), but it *is* manual.
- **Refunds** — issue in the PayU dashboard and update the booking by hand.
- **Code changes need a manual deploy** — auto-deploy from GitHub is off.
- Guest PII accumulates in the Bookings collection with no retention policy.

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
