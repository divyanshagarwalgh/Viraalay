'use strict';

const express = require('express');
const { config } = require('../config');
const guesty = require('../lib/guesty');
const payu = require('../lib/payu');
const store = require('../lib/store');
const {
  bookingReference,
  payuTxnId,
  ymd,
  nightsBetween,
  addDays,
  money,
  money2,
  httpError,
} = require('../lib/util');

const router = express.Router();

const asyncRoute = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

/* -------------------------------------------------------------------------- */
/* GET /api/availability                                                       */
/* -------------------------------------------------------------------------- */
/**
 * Returns the blocked dates and per-day minimum-stay rules for one listing so
 * the date picker can grey out what cannot be booked.
 */
router.get(
  '/availability',
  asyncRoute(async (req, res) => {
    const listingId = String(req.query.listingId || '').trim();
    if (!listingId) throw httpError(400, 'missing_listing', 'listingId is required');

    const from = ymd(req.query.from) || ymd(new Date());
    const to = ymd(req.query.to) || addDays(from, 365);

    const days = await guesty.getCalendar(listingId, from, to);

    const blocked = [];
    const minNights = {};
    const prices = {};
    let baseMinNights = 1;

    for (const day of days) {
      const date = ymd(day.date);
      if (!date) continue;
      if (!guesty.isDayAvailable(day)) blocked.push(date);
      if (day.minNights) {
        minNights[date] = day.minNights;
        if (day.isBaseMinNights) baseMinNights = day.minNights;
      }
      if (day.price !== undefined) prices[date] = money(day.price);
      if (day.cta) blocked.push(`cta:${date}`);
    }

    res.json({
      listingId,
      from,
      to,
      blocked: blocked.filter((d) => !d.startsWith('cta:')),
      noCheckIn: blocked.filter((d) => d.startsWith('cta:')).map((d) => d.slice(4)),
      minNights,
      baseMinNights,
      prices,
    });
  })
);

/* -------------------------------------------------------------------------- */
/* POST /api/quote                                                             */
/* -------------------------------------------------------------------------- */
/**
 * Price is only ever produced here, from Guesty, server-side. The browser
 * displays what this returns; it never calculates a total of its own.
 */
router.post(
  '/quote',
  asyncRoute(async (req, res) => {
    const {
      listingId,
      checkIn,
      checkOut,
      adults = 2,
      children = 0,
      infants = 0,
      pets = 0,
      coupon,
    } = req.body || {};

    if (!listingId) throw httpError(400, 'missing_listing', 'listingId is required');
    if (!ymd(checkIn) || !ymd(checkOut)) {
      throw httpError(400, 'missing_dates', 'checkIn and checkOut are required (YYYY-MM-DD)');
    }
    const nights = nightsBetween(checkIn, checkOut);
    if (nights < 1) throw httpError(400, 'invalid_range', 'Check-out must be after check-in');

    const raw = await guesty.createQuote({
      listingId,
      checkIn,
      checkOut,
      adults,
      children,
      infants,
      pets,
      coupons: coupon || undefined,
    });

    const quote = guesty.normaliseQuote(raw);
    const payable =
      config.capture.mode === 'part'
        ? money((quote.total * config.capture.depositPercent) / 100)
        : quote.total;

    res.json({
      ...quote,
      nights,
      perNight: nights ? money(quote.fareAccommodation / nights) : quote.fareAccommodation,
      captureMode: config.capture.mode,
      payableNow: payable,
      balanceDue: money(quote.total - payable),
    });
  })
);

/* -------------------------------------------------------------------------- */
/* POST /api/checkout                                                          */
/* -------------------------------------------------------------------------- */
/**
 * Creates the pending booking and returns a signed PayU form for the browser
 * to auto-submit. The amount is re-derived from a fresh Guesty quote here, so a
 * tampered price in the request body cannot reduce what the guest is charged.
 */
router.post(
  '/checkout',
  asyncRoute(async (req, res) => {
    config.assertPayU();

    const {
      listingId,
      checkIn,
      checkOut,
      adults = 2,
      children = 0,
      infants = 0,
      pets = 0,
      coupon,
      guest = {},
      specialRequests = '',
      propertyItemId,
      propertyName,
      propertySlug,
      propertyImage,
      propertyLocation,
    } = req.body || {};

    if (!listingId) throw httpError(400, 'missing_listing', 'listingId is required');
    if (!ymd(checkIn) || !ymd(checkOut)) throw httpError(400, 'missing_dates', 'Valid dates are required');
    if (!guest.firstName || !guest.lastName) throw httpError(400, 'missing_name', 'Guest name is required');
    if (!guest.email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(guest.email)) {
      throw httpError(400, 'missing_email', 'A valid guest email is required');
    }
    if (!guest.phone || String(guest.phone).replace(/\D/g, '').length < 8) {
      throw httpError(400, 'missing_phone', 'A valid mobile number is required');
    }

    // Re-quote. Never trust a price that arrived from the browser.
    const raw = await guesty.createQuote({
      listingId,
      checkIn,
      checkOut,
      adults,
      children,
      infants,
      pets,
      coupons: coupon || undefined,
    });
    const quote = guesty.normaliseQuote(raw);

    const payable =
      config.capture.mode === 'part'
        ? money((quote.total * config.capture.depositPercent) / 100)
        : quote.total;
    if (!(payable > 0)) throw httpError(422, 'zero_amount', 'Guesty returned a zero total for these dates');

    const reference = bookingReference();
    const txnid = payuTxnId(reference);
    const nights = nightsBetween(checkIn, checkOut);

    const booking = {
      reference,
      txnid,
      listingId,
      propertyItemId: propertyItemId || null,
      propertyName: propertyName || 'Viraalay stay',
      propertySlug: propertySlug || null,
      propertyImage: propertyImage || null,
      propertyLocation: propertyLocation || null,
      quoteId: quote.quoteId,
      ratePlanId: quote.ratePlanId,
      checkIn: ymd(checkIn),
      checkOut: ymd(checkOut),
      nights,
      adults: Number(adults) || 0,
      children: Number(children) || 0,
      infants: Number(infants) || 0,
      pets: Number(pets) || 0,
      guest: {
        firstName: String(guest.firstName).trim(),
        lastName: String(guest.lastName).trim(),
        email: String(guest.email).trim(),
        phone: String(guest.phone).trim(),
      },
      specialRequests,
      coupon: coupon || '',
      currency: quote.currency,
      fareAccommodation: quote.fareAccommodation,
      fareCleaning: quote.fareCleaning,
      totalFees: quote.totalFees,
      totalTaxes: quote.totalTaxes,
      total: quote.total,
      amountPaid: 0,
      balanceDue: money(quote.total - payable),
      payuAmount: money2(payable),
      invoiceItems: quote.invoiceItems,
      source: 'Website',
      paymentStatus: store.PAYMENT.PENDING,
      bookingStatus: store.STATUS.AWAITING,
    };

    await store.create(booking);

    // No pipes: the PayU hash is pipe-delimited (payu.clean strips them anyway).
    const productinfo = `${booking.propertyName} - ${booking.checkIn} to ${booking.checkOut} - ${nights} night${nights === 1 ? '' : 's'}`;

    const { action, fields } = payu.buildPaymentRequest({
      txnid,
      amount: payable,
      productinfo,
      firstname: booking.guest.firstName,
      lastname: booking.guest.lastName,
      email: booking.guest.email,
      phone: booking.guest.phone,
      // udf1 carries the reference so the callback can find the booking even if
      // PayU's txnid mapping is ever ambiguous.
      udf: [reference, listingId, booking.checkIn, booking.checkOut, String(nights)],
      surl: `${config.publicBaseUrl}/api/payu/callback`,
      furl: `${config.publicBaseUrl}/api/payu/callback`,
    });

    res.json({ reference, action, fields, amount: money2(payable), currency: quote.currency });
  })
);

/* -------------------------------------------------------------------------- */
/* GET /api/booking/:reference                                                 */
/* -------------------------------------------------------------------------- */
router.get(
  '/booking/:reference',
  asyncRoute(async (req, res) => {
    const booking = await store.findByReference(String(req.params.reference).toUpperCase());
    if (!booking) throw httpError(404, 'booking_not_found', 'Booking not found');
    res.json(store.toPublic(booking));
  })
);

/* -------------------------------------------------------------------------- */
/* POST /api/search                                                            */
/* -------------------------------------------------------------------------- */
/**
 * Given dates and a set of listing ids (the cards currently rendered by the
 * Webflow Collection List), report which are actually bookable. The listing
 * page uses this to hide sold-out homes without a page reload.
 */
router.post(
  '/search',
  asyncRoute(async (req, res) => {
    const { listingIds = [], checkIn, checkOut } = req.body || {};
    if (!Array.isArray(listingIds) || !listingIds.length) {
      throw httpError(400, 'missing_listings', 'listingIds must be a non-empty array');
    }
    if (!ymd(checkIn) || !ymd(checkOut)) {
      throw httpError(400, 'missing_dates', 'checkIn and checkOut are required');
    }
    const nights = nightsBetween(checkIn, checkOut);
    if (nights < 1) throw httpError(400, 'invalid_range', 'Check-out must be after check-in');

    const ids = listingIds.slice(0, 60);
    const results = await Promise.all(
      ids.map(async (id) => {
        try {
          // The checkout night itself is never occupied, so the last night
          // checked is the one before checkout.
          const days = await guesty.getCalendar(id, checkIn, addDays(checkOut, -1));
          const unavailable = days.find((d) => !guesty.isDayAvailable(d));
          const minNights = Math.max(1, ...days.map((d) => Number(d.minNights) || 1));
          return {
            listingId: id,
            available: !unavailable && nights >= minNights,
            minNights,
            reason: unavailable ? 'blocked' : nights < minNights ? 'min_nights' : null,
          };
        } catch (err) {
          // A calendar failure must not hide an otherwise valid property.
          console.warn(`[search] calendar failed for ${id}: ${err.message}`);
          return { listingId: id, available: true, minNights: 1, reason: 'unknown' };
        }
      })
    );

    res.json({ checkIn: ymd(checkIn), checkOut: ymd(checkOut), nights, results });
  })
);

/* -------------------------------------------------------------------------- */
/* GET /api/properties-index                                                   */
/* -------------------------------------------------------------------------- */
/**
 * slug -> Guesty listing id, plus the few display fields the checkout needs.
 *
 * This exists so the front end never depends on someone remembering to bind a
 * hidden attribute in the Designer: the property page resolves its own listing
 * from the URL slug, and the listing page matches cards by their detail link.
 * Cached for five minutes because it is hit on every property page view.
 */
let indexCache = { at: 0, data: null };

router.get(
  '/properties-index',
  asyncRoute(async (req, res) => {
    const TTL = 5 * 60 * 1000;
    if (indexCache.data && Date.now() - indexCache.at < TTL) {
      res.set('Cache-Control', 'public, max-age=300');
      return res.json(indexCache.data);
    }

    const webflow = require('../lib/webflow');
    const items = await webflow.listAllItems(config.webflow.collections.properties);

    const data = {
      updatedAt: new Date().toISOString(),
      properties: items
        .filter((i) => !i.isArchived)
        .map((i) => {
          const f = i.fieldData || {};
          return {
            itemId: i.id,
            slug: f.slug,
            name: f.name,
            listingId: f['guesty-listing-id'] || null,
            location: f.location || '',
            image: f.thumbnail?.url || null,
            guests: f.guests || null,
            price: f.price || null,
          };
        })
        .filter((p) => p.slug),
    };

    indexCache = { at: Date.now(), data };
    res.set('Cache-Control', 'public, max-age=300');
    res.json(data);
  })
);

/* -------------------------------------------------------------------------- */
/* GET /api/config                                                             */
/* -------------------------------------------------------------------------- */
/** Non-secret settings the front end needs to render correctly. */
router.get('/config', (req, res) => {
  res.json({
    captureMode: config.capture.mode,
    depositPercent: config.capture.depositPercent,
    currency: 'INR',
    checkoutPath: '/checkout',
    successPath: config.successPath,
    failurePath: config.failurePath,
    payuMode: config.payu.mode,
    // Readiness must follow GUESTY_API_MODE. This account has no Booking
    // Engine add-on, so bookingEngine.clientId is intentionally empty and
    // checking it reported a correctly-configured open-api install as
    // not-ready. Nothing consumes this flag yet — fixed before something does.
    ready: Boolean(
      config.payu.key &&
        (config.guesty.mode === 'open-api'
          ? config.guesty.openApi.clientId
          : config.guesty.bookingEngine.clientId)
    ),
  });
});

module.exports = router;
