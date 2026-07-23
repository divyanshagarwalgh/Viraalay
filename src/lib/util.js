'use strict';

const crypto = require('crypto');

/** Crockford-ish base32, no vowels, so references never spell anything. */
const REF_ALPHABET = '23456789BCDFGHJKLMNPQRSTVWXZ';

function bookingReference(prefix = 'VRL') {
  let out = '';
  const bytes = crypto.randomBytes(8);
  for (let i = 0; i < 6; i += 1) out += REF_ALPHABET[bytes[i] % REF_ALPHABET.length];
  return `${prefix}-${out}`;
}

/** PayU txnids must be unique, alphanumeric and <= 25 chars. */
function payuTxnId(reference) {
  const suffix = crypto.randomBytes(4).toString('hex');
  return `${reference.replace(/-/g, '')}${suffix}`.slice(0, 25);
}

function ymd(value) {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  const s = String(value).trim();
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

function nightsBetween(checkIn, checkOut) {
  const a = new Date(`${ymd(checkIn)}T00:00:00Z`);
  const b = new Date(`${ymd(checkOut)}T00:00:00Z`);
  return Math.max(0, Math.round((b - a) / 86400000));
}

function addDays(dateStr, days) {
  const d = new Date(`${ymd(dateStr)}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Money helper: PayU wants a 2-decimal string, Guesty gives floats. */
function money(n) {
  return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
}

function money2(n) {
  return money(n).toFixed(2);
}

function sha512(input) {
  return crypto.createHash('sha512').update(input, 'utf8').digest('hex');
}

function stableHash(obj) {
  return crypto.createHash('sha1').update(JSON.stringify(obj)).digest('hex');
}

function slugify(value, fallback = 'item') {
  const s = String(value || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/[\s_]+/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 200);
  return s || fallback;
}

function httpError(status, code, message, extra = {}) {
  return Object.assign(new Error(message), { status, code, ...extra });
}

/** fetch with timeout + a single retry on 429/5xx. */
async function fetchJson(url, options = {}, { timeoutMs = 20000, retries = 1, label = 'request' } = {}) {
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, { ...options, signal: controller.signal });
      clearTimeout(timer);
      const text = await res.text();
      let body;
      try {
        body = text ? JSON.parse(text) : null;
      } catch {
        body = text;
      }
      if (!res.ok) {
        if ((res.status === 429 || res.status >= 500) && attempt < retries) {
          await sleep(600 * (attempt + 1));
          continue;
        }
        throw httpError(
          res.status,
          'upstream_error',
          `${label} failed (${res.status}): ${typeof body === 'string' ? body.slice(0, 400) : JSON.stringify(body).slice(0, 400)}`,
          { upstreamBody: body }
        );
      }
      return body;
    } catch (err) {
      clearTimeout(timer);
      lastErr = err;
      if (err.name === 'AbortError' && attempt < retries) {
        await sleep(400);
        continue;
      }
      if (err.status) throw err;
      if (attempt >= retries) break;
    }
  }
  throw lastErr || httpError(502, 'upstream_error', `${label} failed`);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function pick(obj, keys) {
  const out = {};
  for (const k of keys) if (obj && obj[k] !== undefined) out[k] = obj[k];
  return out;
}

module.exports = {
  bookingReference,
  payuTxnId,
  ymd,
  nightsBetween,
  addDays,
  money,
  money2,
  sha512,
  stableHash,
  slugify,
  httpError,
  fetchJson,
  sleep,
  pick,
};
