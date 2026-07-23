# Deploying the Viraalay booking engine — full runbook

Last updated 2026-07-23. Follow top to bottom. Roughly 30–40 minutes including
the test booking.

At the end of this, clicking **Book Now** on the live site takes a guest through
checkout, charges their card via PayU, and creates the reservation in Guesty.

---

## Part 0 — Before you start

### What you need

| Thing | Why |
|---|---|
| A Railway account (railway.app) | hosts the service. Free trial works; ~$5/mo after |
| A credit/debit card | the one real test booking at the end charges for real |
| Access to the Webflow site `viraalay` | to paste in the URL and publish |
| The PayU dashboard login | to refund the test booking |
| This folder on your machine | `D:\Claude desktop\viraalay-booking-engine` |

### Three traps that will bite you

Read these now — each one has already cost time on this project.

1. **Guesty allows only 5 OAuth token requests per client id per 24 hours.**
   Every fresh container start fetches one. If you redeploy 5+ times in a day
   the booking engine goes dark until the window rolls. Mitigation in Part 3b —
   do it if you expect to iterate.

2. **Do NOT use Vercel/Netlify/Render-free.** They are serverless or they sleep.
   Cold starts burn the token quota above. Railway/Fly/a VPS stay warm. This is
   why `vercel.json` exists but is not the recommended path.

3. **PayU is in LIVE mode and cannot be put in test mode.** The supplied
   credentials were probed: `info.payu.in` accepts the hash, `test.payu.in`
   returns "Invalid Hash." The first booking after go-live charges a real card.
   Nothing charges before Part 5, so there is no risk until then.

---

## Part 1 — Local pre-flight

Confirm the service runs on your machine before putting it anywhere.

Open **PowerShell** and run:

```bash
cd "D:\Claude desktop\viraalay-booking-engine"
```

```bash
npm install
```

```bash
npm start
```

Expected output:

```
Viraalay booking engine listening on http://localhost:3000
Public base URL: http://localhost:3000
Script tag: <script defer src="http://localhost:3000/assets/viraalay-booking.js"></script>
```

In a second PowerShell window, verify it answers:

```bash
curl.exe http://localhost:3000/health
```

Expected: `{"ok":true,"service":"viraalay-booking-engine"}`

> **Use `curl.exe`, not `curl`.** In Windows PowerShell 5.1 — which is what you
> are running — `curl` is an alias for `Invoke-WebRequest`, a completely
> different command that returns an object instead of the raw JSON. Every
> `curl.exe` in this document is deliberate.

Stop the server with **Ctrl+C** in the first window before continuing.

> If `npm start` throws `Missing required environment variable: X`, your `.env`
> is incomplete. Compare against `.env.example`.

---

## Part 2 — Deploy to Railway

### 2a. Install the CLI and log in

```bash
npm install -g @railway/cli
```

```bash
railway login
```

This opens your browser. Approve, then return to PowerShell.

### 2b. Stop the upload from including secrets

`railway up` uploads the whole folder. Create a `.railwayignore` so your
credentials and local caches stay on your machine:

```bash
@"
.env
.env.*
backups/
node_modules/
viraalay-token-*.json
*.pem
*.key
"@ | Out-File -FilePath .railwayignore -Encoding utf8
```

> Credentials go in Railway's dashboard instead (Part 3). Even if `.env` were
> uploaded it would not override the dashboard — `dotenv` never overwrites a
> variable the host has already set — but keeping secrets off the host entirely
> is the right habit.

### 2c. Create the project and deploy

```bash
railway init
```

Give it a name when prompted, e.g. `viraalay-booking-engine`.

```bash
railway up
```

Wait for the build. The first deploy **will fail to boot** because no
environment variables are set yet. That is expected — fix it in Part 3.

---

## Part 3 — Set the environment variables

### 3a. Paste them in

Open your `.env` in Notepad to copy from:

```bash
notepad "D:\Claude desktop\viraalay-booking-engine\.env"
```

In the Railway dashboard: your project → the service → **Variables** tab →
**Raw Editor**. Paste the entire contents of `.env`, then apply these three
edits before saving:

| Variable | What to do |
|---|---|
| `PUBLIC_BASE_URL` | leave as-is for now; you will correct it in Part 4 |
| `PORT` | **do not add it.** Railway injects its own; hardcoding breaks routing |
| `PAYU_MODE` | must be `live` — it is the only mode these credentials work in |

Everything else transfers unchanged. For reference, the full list that must be
present (values are in your `.env`):

```
PUBLIC_BASE_URL              SITE_BASE_URL             ALLOWED_ORIGINS
PAYU_MERCHANT_KEY            PAYU_MERCHANT_SALT        PAYU_MERCHANT_SALT_V2
PAYU_CLIENT_ID               PAYU_CLIENT_SECRET        PAYU_MODE
GUESTY_API_MODE              GUESTY_OA_CLIENT_ID       GUESTY_OA_CLIENT_SECRET
GUESTY_BE_CLIENT_ID          GUESTY_BE_CLIENT_SECRET
WEBFLOW_API_TOKEN            WEBFLOW_SITE_ID
WEBFLOW_COLLECTION_PROPERTIES          WEBFLOW_COLLECTION_PROPERTY_SYNC
WEBFLOW_COLLECTION_BOOKINGS            WEBFLOW_COLLECTION_LOCATIONS
WEBFLOW_COLLECTION_CANCELLATION        WEBFLOW_COLLECTION_ADDONS
GUESTY_WEBHOOK_TOKEN         WEBFLOW_WEBHOOK_TOKEN     SYNC_SECRET
PAYMENT_CAPTURE_MODE         PAYMENT_DEPOSIT_PERCENT
SUCCESS_PATH                 FAILURE_PATH
```

`PAYU_MERCHANT_SALT_V2`, `GUESTY_BE_CLIENT_ID` and `GUESTY_BE_CLIENT_SECRET` are
intentionally empty — the account has no Booking Engine add-on. Leave them empty.

### 3b. Optional but recommended — protect the token quota

If you expect to redeploy more than a few times, create a free Upstash Redis
database (upstash.com) and add two more variables:

```
UPSTASH_REDIS_REST_URL
UPSTASH_REDIS_REST_TOKEN
```

The Guesty access token is then shared across restarts instead of being
re-fetched each time, so redeploys stop consuming the 5-per-day quota.

---

## Part 4 — Get the public URL and verify

### 4a. Generate a domain

```bash
railway domain
```

This prints something like `viraalay-booking-engine-production.up.railway.app`.
Your service URL is that with `https://` in front.

### 4b. Correct `PUBLIC_BASE_URL`

Back in Railway → Variables, set it to your real URL, **no trailing slash**:

```
PUBLIC_BASE_URL=https://viraalay-booking-engine-production.up.railway.app
```

Saving triggers a redeploy. Wait for it to go green.

### 4c. Verify

Replace `YOUR-URL` with your domain:

```bash
curl.exe https://YOUR-URL/health
```

Expected: `{"ok":true,"service":"viraalay-booking-engine"}`

Now the detailed check — replace `YOUR_SYNC_SECRET` with the `SYNC_SECRET` value
from `.env`:

```bash
curl.exe "https://YOUR-URL/health?token=YOUR_SYNC_SECRET"
```

You must see all of these:

```json
"guestyOpenApi": true,
"webflow": true,
"payu": true,
"payuMode": "live",
"guestyMode": "open-api"
```

Any `false` means that credential did not transfer. Fix it before continuing.

Finally confirm the front-end script is being served:

```bash
curl.exe -s https://YOUR-URL/assets/viraalay-booking.js | Select-String "a, button, span, div"
```

It should match. That file contains the Book Now fix from 2026-07-23 — if it
does not match, you deployed an older copy of the folder.

---

## Part 5 — Switch the site on

This is the actual on/off switch. Until now nothing on the live site has changed.

1. Webflow → **Site settings → Custom code → Footer code**.
2. Find the block at the bottom:

```js
window.VIRAALAY_BOOKING = {
  apiBase: ""
};
```

3. Fill in your URL — no trailing slash:

```js
window.VIRAALAY_BOOKING = {
  apiBase: "https://viraalay-booking-engine-production.up.railway.app"
};
```

4. Save, then **Publish** the site to `viraalay.webflow.io` (and your custom
   domain if connected).

> If you later connect `viraalay.com`, add it to `ALLOWED_ORIGINS` in Railway or
> the browser will block the API calls with a CORS error.

---

## Part 6 — Verify booking works, without spending money

Everything here is free to test. Do all of it before Part 9.

1. Open a property page, e.g.
   `https://viraalay.webflow.io/properties/the-majestic-crown-2bhk-luxury-home-by-viraalay`
2. Use the search widget to pick check-in and check-out dates.
3. **The price sidebar should populate with a live total** — accommodation fare,
   GST, and a total. That proves Guesty pricing is flowing.
4. Click **Book Now**. You should land on `/checkout` with the property, dates
   and guest count carried across, and the same total.
5. Fill in guest details but **stop before the payment button.**

Open the browser console (F12) on both pages. There should be no red errors.

A known-good reference from testing on 2026-07-23 — The Majestic Crown, 14–17
Aug 2026, 4 guests: ₹15,100 accommodation + ₹2,718 GST = **₹17,818** for
3 nights.

If the sidebar stays empty, see Troubleshooting below.

---

## Part 7 — Register the webhooks

These keep Webflow in step with Guesty when listings, calendars or reservations
change. Run from your machine, not the server.

First point your local `.env` at the deployed URL, because the script reads from
it:

```bash
notepad "D:\Claude desktop\viraalay-booking-engine\.env"
```

Change:

```
PUBLIC_BASE_URL=https://viraalay-booking-engine-production.up.railway.app
```

Save, then:

```bash
npm run register-webhooks
```

It registers Guesty `listing.new/updated/removed`,
`listing.calendar.updated`, `reservation.new/updated`, and Webflow
`collection_item_changed/created`. Safe to re-run — it skips anything already
registered.

> The script refuses to run if `PUBLIC_BASE_URL` still contains `localhost`.
> That guard is deliberate.

> **The `.env` file ACL resets whenever you edit it.** Re-apply the lockdown —
> the PowerShell snippet is in `README.md` under "Security model."

---

## Part 8 — Schedule the sync

Belt-and-braces alongside the webhooks; catches anything a dropped webhook
misses. Every 6 hours is right.

**Easiest — cron-job.org (free):** create a job hitting

```
https://YOUR-URL/api/sync/listings?token=YOUR_SYNC_SECRET
```

every 6 hours.

**Or Railway native:** add a Cron service in the project with schedule
`0 */6 * * *` running:

```bash
curl.exe -s "https://YOUR-URL/api/sync/listings?token=YOUR_SYNC_SECRET"
```

Verify it works by running that URL once by hand — it should return a JSON
summary of listings created/updated/skipped.

---

## Part 9 — The first real booking

**This charges a real card.** Do it once, deliberately, then refund.

1. Pick the cheapest listing — **Lakecity Apartments, ₹5,000/night**.
2. Book **one night**.
3. Pay with a real card through PayU.
4. Then confirm all four of these:

| Check | Where |
|---|---|
| Payment captured | PayU dashboard |
| Reservation created | Guesty → Reservations |
| Booking row written, status **Confirmed** | Webflow → Bookings collection |
| Guest saw the success page | `/booking-confirmed` |

5. **Refund it** from the PayU dashboard, then set that booking's payment status
   to *Refunded* in the Webflow Bookings collection by hand. Refunds are not
   automated.

> If PayU takes the money but Guesty fails, the guest still sees success and the
> booking is flagged *Inquiry* with `[ACTION REQUIRED]` in its notes. That is
> deliberate — never fail a guest after their card is charged. Always check the
> Bookings collection after this test.

---

## Part 10 — Rotate the credentials

Do this soon after go-live. Every credential was transmitted over chat during
setup, so all four should be considered compromised. The rotation table is in
`README.md`.

**Order matters — PayU salt first**, it is the one that maps directly to money:

1. PayU merchant salt → PayU dashboard
2. Guesty Open API client secret → Guesty → Integrations → your OAuth app
3. Webflow API token → Webflow → Site settings → API access
4. `SYNC_SECRET`, `GUESTY_WEBHOOK_TOKEN`, `WEBFLOW_WEBHOOK_TOKEN` → invent new
   random strings

After each rotation update the value in **both** `.env` and Railway, redeploy,
and re-run `npm run register-webhooks` if you changed a webhook token.

---

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| Book Now does nothing, no network calls | `apiBase` still empty, or site not republished | Part 5 |
| Book Now does nothing, console shows CORS error | site origin missing from `ALLOWED_ORIGINS` | add it in Railway, redeploy |
| "Please choose your check-in and check-out dates first." | no dates selected — working as designed | pick dates in the search widget |
| Price sidebar stays empty | Guesty token quota exhausted, or a bad credential | check `/health?token=`; if `guestyOpenApi` is true, wait for the 24h window |
| `401` from Guesty in logs | token quota burned by repeated restarts | set up Upstash (Part 3b), stop redeploying |
| Service boots then crashes | a required env var is missing | Railway → Deploy logs; it names the variable |
| `register-webhooks` refuses to run | `PUBLIC_BASE_URL` still localhost | Part 7 |
| Payment succeeds, booking says *Inquiry* | Guesty rejected the reservation after capture | handle by hand; details in the booking's notes |
| Only 15 of 16 properties listed | Designer-only Collection List limit | see below |

**Reading logs:**

```bash
railway logs
```

---

## Still outstanding after this (not blocking bookings)

Three Designer-only jobs the API cannot do — see `HANDOFF.md` §9B:

1. Rebuild the FAQ section on the property template — 190 FAQs exist but none
   render, because deleting `Q1…Q9` removed the bindings.
2. Bind the `Tagline` field on the property template.
3. Raise the `/properties` Collection List limit from 15 → 16+, or one property
   (`The Brindha Villa`) never shows.

Plus: delete the 30 placeholder reviews, and replace the placeholder brochure
PDF and YouTube link.
