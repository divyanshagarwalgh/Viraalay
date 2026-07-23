'use strict';

const { config } = require('../config');
const webflow = require('./webflow');
const { httpError, money, ymd, nightsBetween } = require('./util');

/**
 * The Bookings CMS collection is the durable record of every booking attempt.
 *
 * Items are ALWAYS created and kept as drafts (`isDraft: true`) and are never
 * published, so guest details never appear on the public site or in the
 * sitemap. They are visible to staff in the Webflow Editor, which is the point:
 * the client gets a readable booking ledger without another admin tool.
 *
 * A short-lived memory cache in front of it keeps the PayU round trip fast.
 */

const cache = new Map();
const CACHE_TTL = 30 * 60 * 1000;

const COLLECTION = () => config.webflow.collections.bookings;

const STATUS = {
  AWAITING: 'Awaiting payment',
  CONFIRMED: 'Confirmed',
  INQUIRY: 'Inquiry',
  CANCELLED: 'Cancelled',
  FAILED: 'Failed',
  EXPIRED: 'Expired',
};

const PAYMENT = {
  PENDING: 'Pending',
  PAID: 'Paid',
  PARTIAL: 'Partially paid',
  FAILED: 'Failed',
  REFUNDED: 'Refunded',
  CANCELLED: 'Cancelled',
};

function cacheSet(reference, record) {
  cache.set(reference, { at: Date.now(), record });
}

function cacheGet(reference) {
  const hit = cache.get(reference);
  if (!hit) return null;
  if (Date.now() - hit.at > CACHE_TTL) {
    cache.delete(reference);
    return null;
  }
  return hit.record;
}

function toFieldData(booking) {
  const nights = booking.nights ?? nightsBetween(booking.checkIn, booking.checkOut);
  return {
    name: `${booking.reference} - ${booking.propertyName || 'Booking'}`,
    slug: booking.reference.toLowerCase(),
    'booking-reference': booking.reference,
    ...(booking.propertyItemId ? { property: booking.propertyItemId } : {}),
    'property-name': booking.propertyName || '',
    'guesty-listing-id': booking.listingId || '',
    'guesty-quote-id': booking.quoteId || '',
    'guesty-rate-plan-id': booking.ratePlanId || '',
    'guesty-reservation-id': booking.reservationId || '',
    'confirmation-code': booking.confirmationCode || '',
    'check-in': booking.checkIn ? `${ymd(booking.checkIn)}T00:00:00.000Z` : null,
    'check-out': booking.checkOut ? `${ymd(booking.checkOut)}T00:00:00.000Z` : null,
    nights,
    adults: Number(booking.adults) || 0,
    children: Number(booking.children) || 0,
    infants: Number(booking.infants) || 0,
    pets: Number(booking.pets) || 0,
    'guest-first-name': booking.guest?.firstName || '',
    'guest-last-name': booking.guest?.lastName || '',
    'guest-email': booking.guest?.email || '',
    'guest-phone': booking.guest?.phone || '',
    currency: booking.currency || 'INR',
    'accommodation-fare': Math.round(booking.fareAccommodation || 0),
    'cleaning-fee': Math.round(booking.fareCleaning || 0),
    'other-fees': Math.round(booking.totalFees || 0),
    taxes: Math.round(booking.totalTaxes || 0),
    discount: Math.round(booking.discount || 0),
    'total-amount': Math.round(booking.total || 0),
    'amount-paid': Math.round(booking.amountPaid || 0),
    'balance-due': Math.round(booking.balanceDue || 0),
    'payu-amount': booking.payuAmount || '',
    'coupon-code': booking.coupon || '',
    'payu-txnid': booking.txnid || '',
    'payu-mihpayid': booking.mihpayid || '',
    'payment-mode': booking.paymentMode || '',
    ...(booking.paymentTime ? { 'payment-time': booking.paymentTime } : {}),
    'special-requests': booking.specialRequests || '',
    source: booking.source || 'Website',
    'payment-status': booking.paymentStatus || PAYMENT.PENDING,
    'booking-status': booking.bookingStatus || STATUS.AWAITING,
  };
}

function fromFieldData(item) {
  const f = item.fieldData || {};
  return {
    itemId: item.id,
    reference: f['booking-reference'],
    propertyItemId: f.property || null,
    propertyName: f['property-name'] || '',
    listingId: f['guesty-listing-id'] || '',
    quoteId: f['guesty-quote-id'] || '',
    ratePlanId: f['guesty-rate-plan-id'] || '',
    reservationId: f['guesty-reservation-id'] || '',
    confirmationCode: f['confirmation-code'] || '',
    checkIn: ymd(f['check-in']),
    checkOut: ymd(f['check-out']),
    nights: f.nights || 0,
    adults: f.adults || 0,
    children: f.children || 0,
    infants: f.infants || 0,
    pets: f.pets || 0,
    guest: {
      firstName: f['guest-first-name'] || '',
      lastName: f['guest-last-name'] || '',
      email: f['guest-email'] || '',
      phone: f['guest-phone'] || '',
    },
    currency: f.currency || 'INR',
    fareAccommodation: f['accommodation-fare'] || 0,
    fareCleaning: f['cleaning-fee'] || 0,
    totalFees: f['other-fees'] || 0,
    totalTaxes: f.taxes || 0,
    discount: f.discount || 0,
    total: f['total-amount'] || 0,
    amountPaid: f['amount-paid'] || 0,
    balanceDue: f['balance-due'] || 0,
    payuAmount: f['payu-amount'] || '',
    coupon: f['coupon-code'] || '',
    txnid: f['payu-txnid'] || '',
    mihpayid: f['payu-mihpayid'] || '',
    paymentMode: f['payment-mode'] || '',
    paymentTime: f['payment-time'] || null,
    specialRequests: f['special-requests'] || '',
    source: f.source || '',
    paymentStatus: f['payment-status'] || '',
    bookingStatus: f['booking-status'] || '',
    invoiceItems: [],
  };
}

async function create(booking) {
  const created = await webflow.createItem(COLLECTION(), toFieldData(booking), { isDraft: true });
  const record = { ...booking, itemId: created.id };
  cacheSet(booking.reference, record);
  webflow.invalidateIndex(COLLECTION(), 'booking-reference');
  return record;
}

async function findByReference(reference) {
  const cached = cacheGet(reference);
  if (cached) return cached;

  // Slug == lowercased reference, so this is a single indexed lookup.
  const page = await webflow.api(`/collections/${COLLECTION()}/items`, {
    query: { slug: String(reference).toLowerCase(), limit: 1 },
    label: 'Webflow find booking',
  });
  const item = (page.items || [])[0];
  if (!item) return null;

  const record = fromFieldData(item);
  cacheSet(reference, record);
  return record;
}

async function update(reference, patch) {
  const existing = (await findByReference(reference));
  if (!existing) throw httpError(404, 'booking_not_found', `No booking with reference ${reference}`);

  const merged = { ...existing, ...patch, guest: { ...existing.guest, ...(patch.guest || {}) } };
  await webflow.updateItem(COLLECTION(), existing.itemId, toFieldData(merged), { isDraft: true });
  cacheSet(reference, merged);
  return merged;
}

/** What the confirmation page is allowed to see. Never leak internal ids. */
function toPublic(booking) {
  return {
    reference: booking.reference,
    status: booking.bookingStatus,
    paymentStatus: booking.paymentStatus,
    propertyName: booking.propertyName,
    propertySlug: booking.propertySlug || null,
    propertyImage: booking.propertyImage || null,
    propertyLocation: booking.propertyLocation || null,
    checkIn: booking.checkIn,
    checkOut: booking.checkOut,
    checkInTime: booking.checkInTime || null,
    checkOutTime: booking.checkOutTime || null,
    nights: booking.nights,
    adults: booking.adults,
    children: booking.children,
    infants: booking.infants,
    guestName: [booking.guest?.firstName, booking.guest?.lastName].filter(Boolean).join(' '),
    currency: booking.currency,
    lineItems: (booking.invoiceItems || []).map((i) => ({ title: i.title, amount: money(i.amount) })),
    fareAccommodation: booking.fareAccommodation,
    fareCleaning: booking.fareCleaning,
    totalFees: booking.totalFees,
    totalTaxes: booking.totalTaxes,
    total: booking.total,
    amountPaid: booking.amountPaid,
    balanceDue: booking.balanceDue,
    confirmationCode: booking.confirmationCode || null,
    paymentReference: booking.mihpayid || booking.txnid || null,
  };
}

module.exports = { create, findByReference, update, toPublic, STATUS, PAYMENT, cacheSet };
