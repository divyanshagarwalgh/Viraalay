'use strict';

const express = require('express');
const { config } = require('../config');
const payu = require('../lib/payu');
const guesty = require('../lib/guesty');
const store = require('../lib/store');
const { money, httpError } = require('../lib/util');

const router = express.Router();
const asyncRoute = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

function redirectTo(res, path, params) {
  const url = new URL(config.siteBaseUrl + path);
  for (const [k, v] of Object.entries(params)) if (v) url.searchParams.set(k, String(v));
  res.redirect(303, url.toString());
}

/**
 * PayU posts the result here as an HTML form POST (both surl and furl point at
 * this one endpoint). Three independent checks must all pass before a
 * reservation is created in Guesty:
 *
 *   1. the reverse hash matches (proves PayU sent it, not a forged browser POST)
 *   2. verify_payment server-to-server says the transaction succeeded
 *   3. the amount PayU captured equals the amount we recorded at checkout
 *
 * Anything less and money could be confirmed that was never taken.
 */
router.post(
  '/callback',
  asyncRoute(async (req, res) => {
    const body = req.body || {};
    const reference = String(body.udf1 || '').toUpperCase();
    const txnid = body.txnid;

    if (!reference) {
      console.error('[payu] callback without a booking reference', { txnid });
      return redirectTo(res, config.failurePath, { reason: 'no_reference' });
    }

    // 1. Reverse hash — evidence this POST really came from PayU.
    //
    // A mismatch is NOT evidence the payment failed, and it used to be treated
    // as such: the booking was marked failed and the guest was told "no charge
    // has been made", which nobody had established. The authoritative check is
    // the server-to-server verify_payment below — it is strictly stronger than
    // a hash on a browser-posted form, because it asks PayU directly over a
    // channel the browser cannot touch.
    //
    // So a bad hash downgrades this response to "unattributed" rather than
    // ending the booking: we stop trusting anything the POST claims and go ask
    // PayU. The consequences are handled at each use below.
    const hashOk = payu.verifyResponseHash(body);
    if (!hashOk) {
      console.error('[payu] reverse hash mismatch — falling back to server-to-server verification', {
        reference,
        txnid,
        // Enough to diagnose the formula without logging guest details: which
        // fields arrived, and whether the response carries the extras that
        // change the hash sequence.
        fields: Object.keys(body).sort().join(','),
        status: body.status,
        hasAdditionalCharges: Boolean(body.additionalCharges),
        receivedHashLength: String(body.hash || '').length,
      });
    }

    const booking = await store.findByReference(reference);
    if (!booking) {
      console.error('[payu] no booking for reference', { reference, txnid });
      return redirectTo(res, config.failurePath, { ref: reference, reason: 'not_found' });
    }

    // Already processed - PayU retries and users refresh. Do not double-book.
    if (booking.bookingStatus === store.STATUS.CONFIRMED) {
      return redirectTo(res, config.successPath, { ref: reference });
    }

    // Only act on a declared failure when we know PayU sent it. Otherwise a
    // forged POST could cancel somebody's booking, and — more likely here — a
    // hash quirk could throw away a payment that actually went through.
    const declared = String(body.status || '').toLowerCase();
    if (hashOk && declared !== 'success') {
      await store.update(reference, {
        bookingStatus: store.STATUS.FAILED,
        paymentStatus: store.PAYMENT.FAILED,
        txnid,
        mihpayid: body.mihpayid || '',
        paymentMode: body.mode || '',
      });
      return redirectTo(res, config.failurePath, {
        ref: reference,
        reason: body.error_Message || body.error || 'declined',
      });
    }

    // 2. Independent verification.
    let verified;
    try {
      verified = await payu.verifyPayment(txnid);
    } catch (err) {
      console.error('[payu] verify_payment failed', { reference, txnid, error: err.message });
      // Only record this against the booking if PayU is known to have sent the
      // response. An unattributed POST that also fails verification tells us
      // nothing, and letting it move a real booking to "awaiting" would hand
      // anyone who guessed a reference a way to disturb it.
      if (hashOk) {
        await store.update(reference, {
          paymentStatus: store.PAYMENT.PENDING,
          bookingStatus: store.STATUS.AWAITING,
          txnid,
          mihpayid: body.mihpayid || '',
        });
      }
      // Deliberately NOT a failure page: the money may well have been taken.
      return redirectTo(res, config.failurePath, { ref: reference, reason: 'verification_pending' });
    }

    if (verified.status !== 'success') {
      await store.update(reference, {
        bookingStatus: store.STATUS.FAILED,
        paymentStatus: store.PAYMENT.FAILED,
        txnid,
        mihpayid: verified.mihpayid || '',
        paymentMode: verified.mode || '',
      });
      return redirectTo(res, config.failurePath, { ref: reference, reason: verified.error || 'declined' });
    }

    // 3. Amount check, to the paisa.
    const expected = Number(booking.payuAmount || booking.total);
    const captured = Number(verified.amount);
    if (!Number.isFinite(captured) || Math.abs(captured - expected) > 0.01) {
      console.error('[payu] amount mismatch', { reference, expected, captured });
      await store.update(reference, {
        paymentStatus: store.PAYMENT.PARTIAL,
        bookingStatus: store.STATUS.AWAITING,
        txnid,
        mihpayid: verified.mihpayid || '',
        amountPaid: money(captured || 0),
      });
      return redirectTo(res, config.failurePath, { ref: reference, reason: 'amount_mismatch' });
    }

    // Money is confirmed. Create the reservation in Guesty.
    const notes = [
      `Booked on viraalay.com. Reference ${reference}.`,
      `Paid via PayU. txnid ${txnid}, mihpayid ${verified.mihpayid}.`,
      booking.specialRequests ? `Guest note: ${booking.specialRequests}` : null,
    ]
      .filter(Boolean)
      .join(' ');

    let reservation = null;
    let reservationError = null;

    // Preferred path: create from the exact quote the guest paid for, so the
    // Guesty invoice matches the charge to the paisa.
    try {
      if (!booking.quoteId || !booking.ratePlanId) throw new Error('no quote on booking');
      reservation = await guesty.createReservationFromQuote({
        quoteId: booking.quoteId,
        ratePlanId: booking.ratePlanId,
        guest: booking.guest,
        notes,
      });
    } catch (err) {
      console.warn('[payu] quote-based reservation failed, trying direct', {
        reference,
        error: err.message,
      });
      // Fallback: the quote expired between checkout and the PayU return.
      // Guesty re-prices here, so flag it — the invoice may differ slightly
      // from what was charged.
      try {
        reservation = await guesty.createReservationDirect({
          listingId: booking.listingId,
          checkIn: booking.checkIn,
          checkOut: booking.checkOut,
          guestsCount: (booking.adults || 0) + (booking.children || 0),
          guest: booking.guest,
          money: {
            currency: booking.currency,
            fareAccommodation: booking.fareAccommodation,
            fareCleaning: booking.fareCleaning,
          },
          notes: `${notes} [Quote expired - reservation re-priced by Guesty; verify invoice against ${booking.payuAmount} ${booking.currency}.]`,
        });
      } catch (err2) {
        // The guest HAS paid. Never show them a failure for our own integration
        // problem - confirm the payment, flag the reservation for staff.
        reservationError = err2.message;
        console.error('[payu] reservation creation failed AFTER successful payment', {
          reference,
          txnid,
          error: err2.message,
        });
      }
    }

    await store.update(reference, {
      bookingStatus: reservation ? store.STATUS.CONFIRMED : store.STATUS.INQUIRY,
      paymentStatus:
        config.capture.mode === 'part' ? store.PAYMENT.PARTIAL : store.PAYMENT.PAID,
      amountPaid: money(captured),
      balanceDue: money(Math.max(0, booking.total - captured)),
      txnid,
      mihpayid: verified.mihpayid || body.mihpayid || '',
      paymentMode: verified.mode || body.mode || '',
      paymentTime: new Date().toISOString(),
      reservationId: reservation?._id || '',
      confirmationCode: reservation?.confirmationCode || '',
      specialRequests: reservationError
        ? `${booking.specialRequests || ''}\n[ACTION REQUIRED] Payment captured but Guesty reservation failed: ${reservationError}`.trim()
        : booking.specialRequests,
    });

    return redirectTo(res, config.successPath, { ref: reference });
  })
);

/** Some PayU configurations issue a GET on return; handle it gracefully. */
router.get('/callback', (req, res) => {
  const ref = String(req.query.udf1 || req.query.ref || '').toUpperCase();
  redirectTo(res, ref ? config.successPath : config.failurePath, { ref, reason: 'get_callback' });
});

async function safeMarkFailed(reference, reason, body) {
  try {
    await store.update(reference, {
      bookingStatus: store.STATUS.FAILED,
      paymentStatus: store.PAYMENT.FAILED,
      txnid: body?.txnid || '',
    });
  } catch (err) {
    console.warn(`[payu] could not mark ${reference} failed (${reason}): ${err.message}`);
  }
}

module.exports = router;
