'use strict';

const { config } = require('../config');
const { fetchJson, httpError, ymd, money } = require('./util');
const tokenStore = require('./token-store');

const inflight = new Map();

/**
 * Guesty access.
 *
 * Guesty ships two API products and they do NOT share credentials:
 *
 *  - Open API (open-api.guesty.com/v1) - included with every account. Covers
 *    listings, the availability/pricing calendar, quotes (Reservations V3) and
 *    reservation creation. This is the default path.
 *  - Booking Engine API (booking.guesty.com) - a separately licensed add-on.
 *    Only used when GUESTY_API_MODE=booking-engine.
 *
 * The Viraalay account has the Open API but not the Booking Engine add-on, so
 * everything runs through the Open API. The Booking Engine path is kept because
 * it is a drop-in swap if the client ever licenses it.
 *
 * Reservations are created from the quote via `POST /reservations-v3/quote`.
 * That endpoint explicitly does NOT require a payment token, which is what
 * makes PayU workable: Guesty records the reservation at exactly the price the
 * guest was quoted, and the money is collected by us.
 */

const usingBookingEngine = () => config.guesty.mode === 'booking-engine';

/* -------------------------------------------------------------------------- */
/* Auth                                                                       */
/* -------------------------------------------------------------------------- */

async function getToken(which) {
  const cfg = which === 'openApi' ? config.guesty.openApi : config.guesty.bookingEngine;
  if (!cfg.clientId || !cfg.clientSecret) {
    throw httpError(503, 'guesty_not_configured', `Guesty ${which} credentials are not configured`);
  }

  const cached = await tokenStore.get(which);
  // Refresh 30 minutes early so an in-flight request never races expiry.
  if (cached && cached.expiresAt - Date.now() > 30 * 60 * 1000) return cached.accessToken;

  if (inflight.has(which)) return inflight.get(which);

  const promise = (async () => {
    const body = new URLSearchParams({
      grant_type: 'client_credentials',
      scope: cfg.scope,
      client_id: cfg.clientId,
      client_secret: cfg.clientSecret,
    });

    const json = await fetchJson(
      cfg.tokenUrl,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          accept: 'application/json',
        },
        body,
      },
      { label: `Guesty ${which} token`, retries: 0 }
    );

    const expiresIn = Number(json.expires_in || 86400);
    const record = { accessToken: json.access_token, expiresAt: Date.now() + expiresIn * 1000 };
    await tokenStore.set(which, record, Math.max(60, expiresIn - 120));
    return record.accessToken;
  })().finally(() => inflight.delete(which));

  inflight.set(which, promise);
  return promise;
}

async function call(which, pathname, { method = 'GET', query, body, label } = {}) {
  const cfg = which === 'openApi' ? config.guesty.openApi : config.guesty.bookingEngine;
  const token = await getToken(which);
  const url = new URL(cfg.base + pathname);
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v));
    }
  }
  return fetchJson(
    url.toString(),
    {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        accept: 'application/json',
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    },
    { label: label || `Guesty ${which} ${method} ${pathname}` }
  );
}

/* -------------------------------------------------------------------------- */
/* Availability calendar                                                      */
/* -------------------------------------------------------------------------- */

/** Guesty wraps calendar days differently per product and per version. */
function unwrapDays(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.data?.days)) return payload.data.days;
  if (Array.isArray(payload?.days)) return payload.days;
  if (Array.isArray(payload?.data)) return payload.data;
  if (Array.isArray(payload?.results)) return payload.results;
  return [];
}

async function getCalendar(listingId, from, to) {
  if (usingBookingEngine()) {
    const days = await call(
      'bookingEngine',
      `/api/listings/${encodeURIComponent(listingId)}/calendar`,
      { query: { from: ymd(from), to: ymd(to) }, label: 'Guesty BE calendar' }
    );
    return unwrapDays(days);
  }

  const days = await call(
    'openApi',
    `/availability-pricing/api/calendar/listings/${encodeURIComponent(listingId)}`,
    {
      query: { startDate: ymd(from), endDate: ymd(to) },
      label: 'Guesty calendar',
    }
  );
  return unwrapDays(days);
}

/**
 * A day is bookable only if it is 'available' AND, for multi-unit listings,
 * has allotment left. Guesty's own docs warn that multi-unit availability is
 * decided by allotment, not by `status`.
 */
function isDayAvailable(day) {
  const status = String(day.status || '').toLowerCase();
  if (day.allotment !== undefined && day.allotment !== null) {
    return Number(day.allotment) > 0;
  }
  return status === 'available';
}

/* -------------------------------------------------------------------------- */
/* Quotes                                                                     */
/* -------------------------------------------------------------------------- */

async function createQuote({
  listingId,
  checkIn,
  checkOut,
  adults = 1,
  children = 0,
  infants = 0,
  pets = 0,
  coupons,
}) {
  const guestsCount = Math.max(1, Number(adults) + Number(children));
  const numberOfGuests = {
    numberOfAdults: Math.max(1, Number(adults) || 1),
    numberOfChildren: Number(children) || 0,
    numberOfInfants: Number(infants) || 0,
    numberOfPets: Number(pets) || 0,
  };

  if (usingBookingEngine()) {
    const body = {
      listingId,
      checkInDateLocalized: ymd(checkIn),
      checkOutDateLocalized: ymd(checkOut),
      guestsCount,
      numberOfGuests,
    };
    if (coupons) body.coupons = coupons;
    return call('bookingEngine', '/api/reservations/quotes', {
      method: 'POST',
      body,
      label: 'Guesty BE create quote',
    });
  }

  const body = {
    listingId,
    checkInDateLocalized: ymd(checkIn),
    checkOutDateLocalized: ymd(checkOut),
    source: 'Viraalay Website',
    guestsCount,
    numberOfGuests,
    // Respect the real calendar, stay terms and blocks. Never set these true:
    // it would happily quote dates that cannot actually be booked.
    ignoreCalendar: false,
    ignoreTerms: false,
    ignoreBlocks: false,
  };
  if (coupons) body.couponCode = coupons;

  return call('openApi', '/quotes', {
    method: 'POST',
    body,
    label: 'Guesty create quote',
  });
}

async function getQuote(quoteId) {
  if (usingBookingEngine()) {
    return call('bookingEngine', `/api/reservations/quotes/${encodeURIComponent(quoteId)}`, {
      label: 'Guesty BE get quote',
    });
  }
  return call('openApi', `/quotes/${encodeURIComponent(quoteId)}`, { label: 'Guesty get quote' });
}

/**
 * Locate the money object inside a rate plan entry.
 *
 * The two Guesty products nest this differently, and the Open API nests it
 * twice: `ratePlans[i].money.money`. `ratePlans[i].money` is only a wrapper
 * carrying _id/expirationDate/inquiryId, so reading that level yields a quote
 * with every figure at zero.
 */
function planMoney(entry) {
  if (!entry) return {};
  if (entry.money?.money && typeof entry.money.money === 'object') return entry.money.money; // Open API
  if (entry.ratePlan?.money) return entry.ratePlan.money;                                     // Booking Engine
  if (entry.money && entry.money.fareAccommodation !== undefined) return entry.money;
  return {};
}

function planTotal(m) {
  const items = Array.isArray(m.invoiceItems) ? m.invoiceItems : [];
  if (items.length) {
    return money(items.reduce((sum, it) => sum + (Number(it.amount) || 0), 0));
  }
  return money((Number(m.subTotalPrice) || 0) + (Number(m.totalTaxes) || 0));
}

/**
 * Flatten a quote into the shape the front end renders.
 *
 * The guest total is the sum of the invoice items, because that IS the invoice
 * Guesty will raise. It is cross-checked against subTotalPrice + totalTaxes and
 * a mismatch is logged rather than silently preferred either way. `hostPayout`
 * is deliberately NOT used as the total: it is what the host receives, which
 * diverges from what the guest pays as soon as any commission applies.
 */
function normaliseQuote(quote, ratePlanId) {
  const plans = quote?.rates?.ratePlans || quote?.rates?.ratePlan || quote?.ratePlans || [];
  const list = (Array.isArray(plans) ? plans : [plans]).filter(Boolean);
  if (!list.length) {
    throw httpError(422, 'no_rate_plan', 'Guesty returned no rate plan for these dates');
  }

  const chosen =
    (ratePlanId && list.find((p) => (p?.ratePlan?._id || p?._id) === ratePlanId)) || list[0];
  const rp = chosen.ratePlan || {};
  const m = planMoney(chosen);

  const invoiceItems = (m.invoiceItems || [])
    .filter((it) => it && it.amount !== undefined && Number(it.amount) !== 0)
    .map((it) => ({
      title: it.title || it.type || 'Charge',
      amount: money(it.amount),
      type: it.type,
      currency: it.currency || m.currency,
    }));

  const fareAccommodation = money(m.fareAccommodation || 0);
  const fareCleaning = money(m.fareCleaning || 0);
  const totalFees = money(m.totalFees || 0);
  const totalTaxes = money(m.totalTaxes || 0);
  const subTotal = money(
    m.subTotalPrice !== undefined ? m.subTotalPrice : fareAccommodation + fareCleaning + totalFees
  );

  const total = planTotal(m);
  const derived = money(subTotal + totalTaxes);
  if (total > 0 && Math.abs(total - derived) > 1) {
    console.warn(
      `[guesty] quote ${quote._id}: invoice items total ${total} but subTotal+taxes is ${derived}. Charging the invoice total.`
    );
  }

  if (!(total > 0)) {
    throw httpError(422, 'zero_total', 'Guesty returned a zero total for these dates');
  }

  const nights = Array.isArray(chosen.days) ? chosen.days.length : 0;

  return {
    quoteId: quote._id || quote.id,
    ratePlanId: rp._id || chosen._id || 'default-rateplan-id',
    ratePlanName: rp.name || 'Standard rate',
    cancellationPolicy: rp.cancellationPolicy || null,
    expiresAt: quote.expiresAt || chosen.money?.expirationDate || null,
    currency: m.currency || invoiceItems[0]?.currency || 'INR',
    nights,
    fareAccommodation,
    fareCleaning,
    totalFees,
    totalTaxes,
    subTotal,
    total,
    invoiceItems,
    ratePlans: list.map((p) => ({
      id: p.ratePlan?._id || p._id,
      name: p.ratePlan?.name,
      total: planTotal(planMoney(p)),
    })),
  };
}

/* -------------------------------------------------------------------------- */
/* Listings (Open API)                                                        */
/* -------------------------------------------------------------------------- */

async function listListings({ limit = 100, skip = 0, fields, active, listed } = {}) {
  return call('openApi', '/listings', {
    query: { limit, skip, fields, active, listed },
    label: 'Guesty list listings',
  });
}

async function getListing(listingId) {
  return call('openApi', `/listings/${encodeURIComponent(listingId)}`, {
    label: 'Guesty get listing',
  });
}

async function updateListing(listingId, patch) {
  return call('openApi', `/listings/${encodeURIComponent(listingId)}`, {
    method: 'PUT',
    body: patch,
    label: 'Guesty update listing',
  });
}

/* -------------------------------------------------------------------------- */
/* Reservations                                                               */
/* -------------------------------------------------------------------------- */

/**
 * Create the reservation from the quote the guest actually paid for.
 * `POST /reservations-v3/quote` needs no payment token, so the money can be
 * (and is) collected by PayU beforehand.
 */
async function createReservationFromQuote({ quoteId, ratePlanId, guest, notes }) {
  const body = {
    quoteId,
    ratePlanId,
    status: 'confirmed',
    ignoreCalendar: false,
    ignoreTerms: false,
    ignoreBlocks: false,
    guest: {
      firstName: guest.firstName,
      lastName: guest.lastName,
      email: guest.email,
      ...(guest.phone ? { phones: [guest.phone] } : {}),
    },
    ...(notes ? { notes: { other: notes } } : {}),
  };

  return call('openApi', '/reservations-v3/quote', {
    method: 'POST',
    body,
    label: 'Guesty create reservation from quote',
  });
}

/**
 * Fallback used only when the quote has expired between checkout and the PayU
 * return. Guesty re-prices the stay itself here, so the invoice can differ very
 * slightly from what was charged - the caller logs that for reconciliation.
 */
async function createReservationDirect({
  listingId,
  checkIn,
  checkOut,
  guest,
  guestsCount,
  money: quoteMoney,
  notes,
}) {
  const body = {
    listingId,
    checkInDateLocalized: ymd(checkIn),
    checkOutDateLocalized: ymd(checkOut),
    status: 'confirmed',
    source: 'Viraalay Website',
    guestsCount: Math.max(1, Number(guestsCount) || 1),
    guest: {
      firstName: guest.firstName,
      lastName: guest.lastName,
      email: guest.email,
      ...(guest.phone ? { phones: [guest.phone] } : {}),
    },
    ...(quoteMoney
      ? {
          money: {
            currency: quoteMoney.currency,
            fareAccommodation: quoteMoney.fareAccommodation,
            fareCleaning: quoteMoney.fareCleaning,
          },
        }
      : {}),
    ...(notes ? { notes: { other: notes } } : {}),
  };

  return call('openApi', '/reservations-v3', {
    method: 'POST',
    body,
    label: 'Guesty create reservation (direct)',
  });
}

async function getReservation(reservationId) {
  return call('openApi', `/reservations/${encodeURIComponent(reservationId)}`, {
    label: 'Guesty get reservation',
  });
}

/* -------------------------------------------------------------------------- */
/* Webhooks                                                                   */
/* -------------------------------------------------------------------------- */

async function listWebhooks() {
  return call('openApi', '/webhooks', { label: 'Guesty list webhooks' });
}

async function createWebhook({ event, url, secret }) {
  return call('openApi', '/webhooks', {
    method: 'POST',
    body: { event, url, ...(secret ? { secret } : {}) },
    label: 'Guesty create webhook',
  });
}

module.exports = {
  getToken,
  call,
  usingBookingEngine,
  getCalendar,
  isDayAvailable,
  createQuote,
  getQuote,
  normaliseQuote,
  listListings,
  getListing,
  updateListing,
  createReservationFromQuote,
  createReservationDirect,
  getReservation,
  listWebhooks,
  createWebhook,
};
