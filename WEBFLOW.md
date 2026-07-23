# What was built inside Webflow

Site `viraalay` · site_id `6a56f9a2d06b16a017f0dd75` · published `viraalay.webflow.io`

Everything below is **native Webflow** — real elements, real classes, editable
in the Designer. No part of the UI is injected by JavaScript except the price
line items, which clone a native template row that is in the Designer.

---

## New CMS collections

| Collection | id | Purpose |
|---|---|---|
| **Locations** | `6a6049b09409fba1e822a90c` | Destination pages. Seeded with Goa, Jaipur, Udaipur, Coorg, Lonavala, Mumbai. Has a `Properties` multi-reference the sync maintains, plus `property-count` and `starting-price`. |
| **Property Sync** | `6a604a6b6e24d84900fe7827` | One record per Guesty listing: pricing, terms, geo, capacity, house content, check-in times, sync hash. Machine-owned. |
| **Bookings** | `6a6049b12f7e47d5f9aa08a4` | The booking ledger. Guest, dates, money, Guesty ids, PayU ids, statuses. **Always drafts — never published.** |
| **Add Ons** | `6a6049b28d94bdc10b0ba24d` | Chef, decor, airport transfer etc. Price + price type + which properties offer it. |
| **Cancellation Policies** | `6a6049b38d94bdc10b0ba283` | Seeded with Flexible / Moderate / Strict / Non-refundable, mapped to Guesty's codes. |

Seeded item ids are in the sync report; destinations are already linked to the
seven existing properties.

## FAQs collection — `6a60595fc48c9e90dad6b125`

The eighteen flat `Q1…Q9` / `A1…A9` fields were replaced by a proper FAQs
collection. **All 63 Q&A pairs (7 properties × 9) were migrated first**, then
the fields were deleted. Fields: Question, Answer (rich text), Answer plain text
(for `FAQPage` schema), Property (reference), Display order, Site-wide FAQ?,
Category.

A raw backup of the original field values is at
`backups/properties-faq-backup.json`.

**To rebuild the FAQ section on the property template:** add a Collection List
bound to FAQs, filter `Property = Current Property`, sort by Display order.
Alternatively bind the new **FAQs** multi-reference field on Properties, which
gives manual ordering.

## Changes to the Properties collection

Net effect: 61 fields → 57, with 3 slots spare.

**Removed (18):** `q1`–`q9`, `a1`–`a9` — content migrated to FAQs first.

**Added (16):**

| Field | Type | Written by |
|---|---|---|
| Guesty listing ID | Plain text | sync (join key) |
| Destination | Reference → Locations | sync |
| FAQs | Multi-reference → FAQs | editor |
| Cancellation policy type | Reference → Cancellation Policies | sync |
| City | Plain text | sync |
| Latitude / Longitude | Plain text | sync |
| Bedrooms | Number | sync |
| Minimum nights | Number | sync |
| Currency | Plain text | sync |
| Cleaning fee | Number | sync |
| Check-in time / Check-out time | Plain text | sync (formatted, e.g. "2:00 PM") |
| Instant bookable? | Switch | sync |
| Last synced from Guesty | Date | sync |
| Lock editorial content? | Switch | editor |

The existing rich-text **Cancellation policy** field is untouched — it is for
custom copy; the new reference field carries the structured policy.

> **Note on `Baths`.** Webflow created it at integer precision, so a 5.5-bath
> villa is floored to 5 (understating is safer than promising a bathroom that
> is not there). The exact value is kept on Property Sync as text. Change the
> field's precision to decimal in the Designer if you want 5.5 shown.

---

## New pages

| Page | id | Path |
|---|---|---|
| Checkout | `6a604ae6644b84c5cbf0fd2d` | `/checkout` |
| Booking Confirmed | `6a604ae68a36ea87a9544a2a` | `/booking-confirmed` |
| Booking Failed | `6a604ae79409fba1e8237098` | `/booking-failed` |

All three are responsive: two-column on desktop, single column from tablet down,
full-width fields and a 100%-wide thumbnail on phones. Verified live at 1280px
and 375px with no horizontal overflow.

## Property detail template

Added inside `booking_wrap` (`6a58ffaac89342cf498710e0`):

- `.vbk-quote` — the live price panel: per-night figure, status line, line-item
  rows, total, **Reserve now** button.
- `.vbk-meta` — a hidden marker carrying `data-guesty-listing`.

The existing `.vla-bk` check-in/check-out/guest grid and the hero/nav search
widget are untouched. The booking script reads `#bk_ci` / `#bk_co` / `#bk_g` and
the URL parameters those already produce.

---

## Style classes

Prefixed `vbk-` (matching the existing `vla-` convention), all editable:

`vbk-page` `vbk-shell` `vbk-head` `vbk-eyebrow` `vbk-h1` `vbk-steps` `vbk-step`
`vbk-alert` `vbk-formwrap` `vbk-grid` `vbk-main` `vbk-side` `vbk-card` `vbk-h2`
`vbk-stay` `vbk-thumb` `vbk-stayinfo` `vbk-propname` `vbk-proploc` `vbk-daterow`
`vbk-datecell` `vbk-dlab` `vbk-dval` `vbk-dsub` `vbk-editlink` `vbk-form`
`vbk-field` `vbk-half` `vbk-flab` `vbk-input` `vbk-textarea` `vbk-policy`
`vbk-check` `vbk-checkbox` `vbk-checktext` `vbk-summary` `vbk-sumhead` `vbk-rows`
`vbk-row` `vbk-rlab` `vbk-rval` `vbk-divider` `vbk-total` `vbk-tlab` `vbk-tval`
`vbk-taxnote` `vbk-coupon` `vbk-cinput` `vbk-cbtn` `vbk-err` `vbk-pay`
`vbk-secure` `vbk-conf` `vbk-conftick` `vbk-confsub` `vbk-confref`
`vbk-confrefval` `vbk-confgrid` `vbk-confdivider` `vbk-ghost` `vbk-failtick`
`vbk-failcard` `vbk-faillist` `vbk-failitem` `vbk-retry` `vbk-quote`
`vbk-qpernight` `vbk-qstatus` `vbk-qrows` `vbk-reserve` `vbk-meta`

Brand values reused from the existing hero bar: `#74263c`, 10px radii, soft
shadows, uppercase 0.06em button lettering.

---

## Hooks the script looks for

Rename or restyle freely — just keep these attributes:

| Attribute | Where | Meaning |
|---|---|---|
| `data-vbk-quote` | property page | the price panel root |
| `data-vbk-quote-rows` | property page | container for line items |
| `data-vbk-quote-total` | property page | total figure |
| `data-vbk-quote-status` | property page | status / error line |
| `data-vbk-pernight` | property page | per-night figure |
| `data-vbk-reserve` | property page | goes to checkout |
| `data-vbk-row="template"` | both | the row that gets cloned per line item |
| `data-guesty-listing` | anywhere | optional explicit listing id |
| `data-vbk-availability-note` | /properties | optional "N homes hidden" line |
| `#vbk_*` | /checkout | form fields and totals |
| `#vbc_*` | /booking-confirmed | reservation details |
| `#vbf_*` | /booking-failed | reason and retry |

---

## Live content state (2026-07-22)

The placeholder content was removed once the 16 real Guesty listings landed.

| | Before | After |
|---|---|---|
| Properties | 7 demo + 16 synced | **16 synced, all published** |
| FAQs | 63 (demo properties) | 0 |
| Reviews | 5 (John Doe, Jane Smith…) | 0 |
| Rooms | 7 unlinked demo rooms | 0 |
| Locations | 7 (Goa, Coorg, Lonavala, Mumbai unused) | **3: Udaipur (13), Jaipur (2), Jodhpur (1)** |

Amenities, Great For, Property Types and Teams were left alone — they are
shared taxonomies, not placeholder content.

Everything deleted was snapshotted first:
`backups/properties-faq-backup.json` and `backups/demo-data-deleted.json`.
Re-run with `npm run cleanup` (dry run by default).

### Deleting referenced CMS items

Webflow returns 409 if anything still references an item, and these references
were circular (Property → Reviews → Property, plus Properties cross-referencing
each other). It also keeps **staged and live copies separately**, so clearing a
reference by PATCH is not enough — the published copy keeps the old reference
and the live delete still 409s.

The working order, encoded in `scripts/cleanup-demo-data.js`:
1. clear every reference field on **both sides** (staged)
2. **publish** those items so the live copies match
3. delete live, then staged

## Property content fill (2026-07-22)

`npm run fill-content` and `npm run fill-remaining` populate every empty
editorial field. **40 of 42 fields are now complete on all 16 properties.**

Sources, in order of trust:
1. **Guesty** (`backups/guesty-listings-raw.json`) — amenities, capacity, imagery
2. **The client working document** — copy for 11 of 16 listings (six sections;
   the five BlueRoot rooms and four Lakecity flats are units of one building each)
3. **Derived** — full price = live price + 20%; images picked deterministically
   from each property's own gallery

| What | How |
|---|---|
| Full Price | `price × 1.2`, rounded |
| Amenities | Guesty's 86 raw strings mapped to 52 guest-facing items. Horizon Villa gets 37. |
| Property Types | From Guesty's own `propertyType` (Villa/Apartment/House/Farm stay) |
| Great For | Derived from real capacity and amenities — never guessed |
| Rooms | **61 room items**, from the document's "Spaces" sections; Guesty bedroom counts where the doc is silent |
| Thumbnail 2 / 3 | Gallery images 2 and 3 |
| Spotlight gallery | Gallery images 4–9 |
| Spotlight thumbs | Gallery images 4, 5, 6 |
| Cancellation policy | Text + reference to the **Moderate** policy, which is what Guesty returns on every quote for this account |
| Video / brochure link | Placeholders, as requested |
| Brochure file | Placeholder PDF — Webflow File fields accept `{url}` and re-host on their CDN. One shared asset, not sixteen. |

Taxonomies grew to: **52 amenities, 12 great-fors, 5 property types, 61 rooms.**

### Deliberately left empty

**Average rating, total ratings, staff/clean/meals/experience ratings, review
AI summary.** There are no real guest reviews in the system. Filling these would
put fabricated star ratings in front of paying guests, which is not a
placeholder — it is false social proof. They populate naturally once Guesty
reviews are synced or real reviews are entered.

I also cleared **Overall experience (Max 2 words only)** — that field belongs to
the ratings block, so a marketing sentence does not belong in it. The editorial
headlines moved to a new **Tagline** field instead.

## Reviews, ratings and FAQs (2026-07-22)

### Reviews — `npm run sync-reviews -- --confirm --placeholders`

**Guesty holds 20 real Airbnb reviews** with guest names, overall ratings and
Airbnb's six category scores. Those are imported verbatim and marked
`Source: Airbnb via Guesty`, `Placeholder? = OFF`.

| Property | Real reviews | Avg |
|---|---|---|
| The Royal Crown | 8 | 5.0 |
| The Brindha Villa | 7 | 5.0 |
| BlueRoot Spacious Room | 2 | 5.0 |
| Horizon Villa / Majestic Crown / BlueRoot Intimate | 1 each | 4.0 / 5.0 / 5.0 |

The other 10 properties have no reviews yet, so `--placeholders` seeds 3 sample
reviews each. **Those are marked `Placeholder? = ON`, guest name prefixed
"Sample —", and Source "Placeholder — not a real review".** Filter or delete
them before launch:

> Reviews collection → filter `Placeholder? = ON` → delete. Re-running the
> import never recreates them and never touches real ones.

Ratings roll up onto each property. Airbnb's categories map as:
`cleanliness → Clean rating`, `communication + checkin → Staff rating`,
`accuracy + value → Experience rating`. **Airbnb has no meals category**, so
Meals rating mirrors the overall score rather than inventing a number.
`Review AI summary` is generated from the themes guests actually wrote about.

### FAQs — `npm run gen-faqs -- --confirm`

**190 FAQs, 11–14 per property.** Every answer is composed from a value the
system actually holds — real check-in times, capacity, minimum nights,
amenities, pet rules, the live cancellation policy, and the transfer distances
in the client document. A question is only asked when its answer is known, so
nothing is invented. Categorised (Booking & payment, The property, Check-in &
check-out, Meals & services, House rules, Location & travel, Cancellation).

## Fixes applied

**Search selection now survives navigation.** A registered script,
`ViraalaySearchMemory`, stores the search in `sessionStorage` and restores it
into the URL before the search widget boots, so the nav pill and the booking
sidebar stay populated on the property page. It also copies the current search
onto property links. Verified: landing on a bare `/properties/<slug>` URL
restores `Jodhpur · 24 Jul – 30 Jul · 3 guests` in both the nav and the sidebar.

**The stray "Line item 0 / Total --" panel is gone.** `.vbk-quote` is now
`display:none` in the Designer and the price-row template carries a
`vbk-rowtpl` hidden class. The panel reveals itself only when the live booking
engine returns a real quote, so it never duplicates the site's own price card
while the engine is idle. The site's existing **Book Now** button is wired to
the checkout flow instead.

**Room cards were blank** because the template binds `gallery-images`, not
`thumbnail`. All 61 rooms now carry 4 gallery images each, sliced so adjacent
room cards do not repeat the same photo.

### Two Designer tasks left

1. **Rebuild the FAQ section.** The old section was bound to the eighteen
   `Q1…Q9` / `A1…A9` fields, so deleting those left only the "FAQs" tab label —
   there is no list element on the template any more. The data is ready (190
   items); it needs a Collection List, which the Data API cannot create:

   > Property template → FAQ tab section → add a **Collection List** → source
   > **FAQs** → filter `Property = Current Property` → sort by `Display order` →
   > bind Question and Answer inside the item. Publish.
   >
   > Or bind the **FAQs** multi-reference field on Properties if you want manual
   > ordering per property.

2. **Bind the new `Tagline` field** on the property template — it is the only
   filled field not yet displayed anywhere.
3. **Raise the Collection List item limit** (see below).

### Known Designer-side limit

`/properties` renders **15 of 16** properties. Webflow itself only emits 15
items, so the Collection List has an item limit set in the Designer. That
setting is not exposed by the Data API — fix it in Webflow:

> Open `/properties` → select the properties Collection List → Settings panel →
> raise **Limit items** (or remove it). Then publish.

`The Brindha Villa - by Viraalay` is the one currently cut off.

## Site script

A registered inline script **ViraalayBookingEngine v1.0.0** is applied
site-wide in the footer. It does nothing until you add this to
**Site settings → Custom code → Footer**:

```html
<script>window.VIRAALAY_BOOKING = { apiBase: "https://your-booking-service" };</script>
```

The freeform head block (the 19KB hero/nav search widget) and the existing
footer block (Swiper, Lenis, modal, WhatsApp) were **not modified**.

---

## Optional: bind the listing id in the Designer

The script resolves each property's Guesty listing id from
`/api/properties-index` using the URL slug, so no binding is required.

If you would rather it be explicit and save a request, select the hidden
`.vbk-meta` div on the property template, open **Settings → Custom attributes**,
and bind `data-guesty-listing` to the **Guesty listing ID** field. The API
couldn't do this itself — bound attributes are only settable on Webflow's
`DOM`-type elements, and the builder produces a `Block`.
