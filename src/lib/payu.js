'use strict';

const crypto = require('crypto');
const { config } = require('../config');
const { sha512, money2, httpError, fetchJson } = require('./util');

/**
 * PayU hosted checkout ("PayU Hosted" / prebuilt checkout).
 *
 * Request hash:
 *   sha512(key|txnid|amount|productinfo|firstname|email|udf1|udf2|udf3|udf4|udf5||||||SALT)
 *   -> udf5 is followed by five EMPTY fields (placeholders for udf6..udf10) then SALT.
 *
 * Response ("reverse") hash is the same sequence read backwards:
 *   sha512(SALT|status|||||​|udf5|udf4|udf3|udf2|udf1|email|firstname|productinfo|amount|key)
 *
 * When PayU includes `additionalCharges` in the response, that value is
 * prepended to the reverse-hash string.
 */

const UDF_COUNT = 5;

/**
 * Every hashed field is pipe-delimited, so a literal "|" anywhere in the data
 * silently shifts the whole sequence and the reverse hash stops matching. PayU
 * also rejects several punctuation characters outright. Strip them once, here,
 * rather than trusting every caller to remember.
 */
function clean(value, max = 100) {
  return String(value == null ? '' : value)
    .replace(/[|<>"'\\`]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

function requestHash({ txnid, amount, productinfo, firstname, email, udf = [] }) {
  const udfs = Array.from({ length: UDF_COUNT }, (_, i) => udf[i] || '');
  const parts = [
    config.payu.key,
    txnid,
    money2(amount),
    productinfo,
    firstname,
    email,
    ...udfs,
    '', '', '', '', '',   // udf6..udf10 placeholders
    config.payu.salt,
  ];
  return sha512(parts.join('|'));
}

function responseHash(body, salt = config.payu.salt) {
  const udfs = Array.from({ length: UDF_COUNT }, (_, i) => body[`udf${i + 1}`] || '');
  const parts = [
    salt,
    body.status || '',
    '', '', '', '', '',   // udf10..udf6 placeholders
    ...udfs.slice().reverse(),
    body.email || '',
    body.firstname || '',
    body.productinfo || '',
    body.amount || '',
    config.payu.key,
  ];
  const base = parts.join('|');
  const withCharges = body.additionalCharges ? `${body.additionalCharges}|${base}` : base;
  return sha512(withCharges);
}

/** Constant-time compare so a bad hash cannot be probed byte by byte. */
function safeEqual(a, b) {
  const bufA = Buffer.from(String(a || ''), 'utf8');
  const bufB = Buffer.from(String(b || ''), 'utf8');
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

/**
 * PayU issues merchants a v1 salt and, later, a v2 salt, and may sign the
 * response with either during a rollover. Check every salt we hold — but always
 * with a constant-time compare, and never reveal which one matched.
 */
function verifyResponseHash(body) {
  const salts = config.payu.salts;
  if (!salts.length) return false;
  let matched = false;
  for (const salt of salts) {
    if (safeEqual(responseHash(body, salt), body.hash)) matched = true;
  }
  return matched;
}

/**
 * Build the field set the browser posts to PayU. The browser never sees the
 * salt - only the finished hash, which is useless without it.
 */
function buildPaymentRequest({
  txnid,
  amount,
  productinfo,
  firstname,
  lastname,
  email,
  phone,
  udf = [],
  surl,
  furl,
}) {
  config.assertPayU();

  const safe = {
    productinfo: clean(productinfo, 100),
    firstname: clean(firstname, 60),
    email: clean(email, 100),
    udf: Array.from({ length: UDF_COUNT }, (_, i) => clean(udf[i], 255)),
  };

  const fields = {
    key: config.payu.key,
    txnid,
    amount: money2(amount),
    productinfo: safe.productinfo,
    firstname: safe.firstname,
    email: safe.email,
    phone: String(phone || '').replace(/[^\d+]/g, ''),
    surl,
    furl,
    udf1: safe.udf[0],
    udf2: safe.udf[1],
    udf3: safe.udf[2],
    udf4: safe.udf[3],
    udf5: safe.udf[4],
  };
  if (lastname) fields.lastname = clean(lastname, 60);

  // Hash exactly the values being submitted, never the raw inputs.
  fields.hash = requestHash({
    txnid,
    amount,
    productinfo: safe.productinfo,
    firstname: safe.firstname,
    email: safe.email,
    udf: safe.udf,
  });

  return { action: config.payu.paymentUrl, fields };
}

/**
 * Server-to-server confirmation. The redirect POST alone is not sufficient
 * proof of payment: always verify out of band before creating the reservation.
 */
async function verifyPayment(txnid) {
  config.assertPayU();
  const command = 'verify_payment';

  // Try each salt we hold: a v1/v2 mismatch here would otherwise look like a
  // failed payment for a transaction that actually succeeded.
  let json = null;
  let lastError = null;
  for (const salt of config.payu.salts) {
    const body = new URLSearchParams({
      key: config.payu.key,
      command,
      var1: txnid,
      hash: sha512([config.payu.key, command, txnid, salt].join('|')),
    });
    try {
      const attempt = await fetchJson(
        config.payu.postServiceUrl,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body,
        },
        { label: 'PayU verify_payment' }
      );
      // PayU answers status 0 with an error message on a bad hash.
      if (attempt && String(attempt.status) !== '0') {
        json = attempt;
        break;
      }
      lastError = attempt?.msg || attempt?.message || 'PayU rejected the verification request';
    } catch (err) {
      lastError = err.message;
    }
  }

  if (!json) {
    throw httpError(502, 'payu_verify_failed', `PayU verification failed: ${lastError || 'no response'}`);
  }

  const record = json?.transaction_details?.[txnid];
  if (!record) {
    throw httpError(502, 'payu_verify_empty', 'PayU returned no transaction details for this txnid');
  }
  return {
    status: String(record.status || '').toLowerCase(),
    amount: record.amt ?? record.amount,
    mihpayid: record.mihpayid,
    mode: record.mode,
    bankRefNum: record.bank_ref_num,
    error: record.error_Message || record.error,
    raw: record,
  };
}

module.exports = {
  clean,
  requestHash,
  responseHash,
  verifyResponseHash,
  buildPaymentRequest,
  verifyPayment,
  safeEqual,
};
