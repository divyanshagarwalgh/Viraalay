'use strict';

const express = require('express');
const { config } = require('../config');
const sync = require('../lib/sync');
const guesty = require('../lib/guesty');
const webflow = require('../lib/webflow');
const { httpError } = require('../lib/util');

const router = express.Router();
const asyncRoute = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

/**
 * A rate change in Guesty moves the "from" price the website advertises, so a
 * calendar event does now have something to copy into the CMS — it did not
 * until the card price started coming from the calendar rather than from
 * Guesty's basePrice.
 *
 * Debounced hard, because calendar events arrive in bursts: re-pricing a season
 * or importing a channel calendar can fire dozens per listing within a minute,
 * and each sync is a Guesty read plus a Webflow write and publish. Firing one
 * per event would put us straight back into the rate-limit exhaustion that took
 * the CMS writes down earlier. One sync per listing per quiet period instead.
 */
const CALENDAR_DEBOUNCE_MS = 3 * 60 * 1000;
const calendarTimers = new Map();

function scheduleCalendarSync(listingId) {
  if (!listingId) {
    // Some calendar payloads cover many listings and name none. The six-hourly
    // sweep is the backstop for those.
    console.log('[hook:guesty] calendar event without a listing id, leaving it to the scheduled sync');
    return;
  }

  clearTimeout(calendarTimers.get(listingId));
  const timer = setTimeout(async () => {
    calendarTimers.delete(listingId);
    try {
      const report = await sync.syncListings({ onlyListingIds: [listingId] });
      console.log(`[hook:guesty] calendar re-sync ${listingId}`, JSON.stringify(report));
    } catch (err) {
      console.error(`[hook:guesty] calendar re-sync failed for ${listingId}: ${err.message}`);
    }
  }, CALENDAR_DEBOUNCE_MS);

  if (timer.unref) timer.unref();
  calendarTimers.set(listingId, timer);
  console.log(`[hook:guesty] calendar change for ${listingId}, syncing in ${CALENDAR_DEBOUNCE_MS / 60000}m`);
}

function requireToken(req, expected, name) {
  const provided = req.query.token || req.get('x-webhook-token') || '';
  if (!expected) throw httpError(503, 'token_not_configured', `${name} is not configured`);
  if (provided !== expected) throw httpError(401, 'bad_token', 'Invalid webhook token');
}

/* -------------------------------------------------------------------------- */
/* Guesty -> Webflow                                                           */
/* -------------------------------------------------------------------------- */
/**
 * Guesty expects a 2xx within 15 seconds or it retries with backoff, so the
 * response is sent immediately and the sync runs after. A retry is harmless:
 * the sync is an idempotent upsert keyed on the Guesty listing id.
 */
router.post(
  '/guesty',
  asyncRoute(async (req, res) => {
    requireToken(req, config.guesty.webhookToken, 'GUESTY_WEBHOOK_TOKEN');

    // v2 reservation events name the field `eventType`; the listing events use
    // `event`. Both still match the /listing|calendar|reservation/ dispatch below.
    const event = req.body?.event || req.body?.eventType || req.body?.type || 'unknown';
    const listingId =
      req.body?.listing?._id ||
      req.body?.listingId ||
      req.body?.data?.listing?._id ||
      req.body?.data?._id ||
      null;

    res.status(200).json({ received: true, event, listingId });

    setImmediate(async () => {
      try {
        // Calendar first: the event is named `listing.calendar.updated`, so it
        // also matches the plain /listing/ test below and would otherwise be
        // handled — undebounced — by it.
        if (/calendar/i.test(event)) {
          scheduleCalendarSync(listingId);
        } else if (/listing/i.test(event) && listingId) {
          const report = await sync.syncListings({ onlyListingIds: [listingId] });
          console.log(`[hook:guesty] ${event} ${listingId}`, JSON.stringify(report));
        } else if (/reservation/i.test(event)) {
          // The v2 payloads do not put the reservation where the legacy ones
          // did, so try the known shapes and fall back to naming the top-level
          // keys — an empty log line here is useless when a real booking lands.
          const body = req.body || {};
          const reservationId =
            body.reservation?._id ||
            body.data?.reservation?._id ||
            body.payload?.reservation?._id ||
            body.data?._id ||
            body.reservationId ||
            null;
          console.log(
            `[hook:guesty] ${event} ${reservationId || `(no id; keys: ${Object.keys(body).join(',')})`}`
          );
        } else {
          console.log(`[hook:guesty] unhandled event ${event}`);
        }
      } catch (err) {
        console.error(`[hook:guesty] processing failed for ${event}:`, err.message);
      }
    });
  })
);

/* -------------------------------------------------------------------------- */
/* Webflow -> Guesty                                                           */
/* -------------------------------------------------------------------------- */
/**
 * Fires on collection_item_changed for the Properties collection. Pushes only
 * the handful of descriptive fields Guesty should mirror; pricing, capacity and
 * availability are one-way (Guesty -> Webflow) by design.
 */
router.post(
  '/webflow',
  asyncRoute(async (req, res) => {
    requireToken(req, config.webflow.webhookToken, 'WEBFLOW_WEBHOOK_TOKEN');

    const payload = req.body?.payload || req.body || {};
    const collectionId = payload.collectionId || req.body?.collectionId;

    res.status(200).json({ received: true });

    setImmediate(async () => {
      try {
        if (collectionId !== config.webflow.collections.properties) return;

        const itemId = payload.id || payload.itemId;
        if (!itemId) return;

        const item = await webflow.getItem(config.webflow.collections.properties, itemId);
        const listingId = item.fieldData?.['guesty-listing-id'];
        if (!listingId) return;

        // Respect the lock switch, whichever collection carries it.
        if (item.fieldData?.['lock-editorial-content']) {
          console.log(`[hook:webflow] ${listingId} is locked, not pushing to Guesty`);
          return;
        }
        const syncIndex = await webflow.indexBy(
          config.webflow.collections.propertySync,
          'guesty-listing-id',
          { ttlMs: 0 }
        );
        if (syncIndex.get(listingId)?.fieldData?.['lock-editorial-content']) {
          console.log(`[hook:webflow] ${listingId} is locked on Property Sync, not pushing`);
          return;
        }

        const result = await sync.pushPropertyToGuesty(item);
        console.log(`[hook:webflow] pushed ${listingId}`, JSON.stringify(result));
      } catch (err) {
        console.error('[hook:webflow] processing failed:', err.message);
      }
    });
  })
);

/* -------------------------------------------------------------------------- */
/* Manual / scheduled full sync                                                */
/* -------------------------------------------------------------------------- */
router.all(
  '/sync/listings',
  asyncRoute(async (req, res) => {
    if (config.syncSecret) {
      const provided =
        req.query.token || (req.get('authorization') || '').replace(/^Bearer\s+/i, '');
      if (provided !== config.syncSecret) throw httpError(401, 'bad_token', 'Invalid sync token');
    }

    const dryRun = String(req.query.dryRun || '') === 'true';
    const createMissing = String(req.query.createMissing || 'true') !== 'false';
    const only = req.query.listingId ? [String(req.query.listingId)] : null;

    const report = await sync.syncListings({
      dryRun,
      createMissingProperties: createMissing,
      onlyListingIds: only,
    });
    res.json(report);
  })
);

module.exports = router;
