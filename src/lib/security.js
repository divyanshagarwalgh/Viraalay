'use strict';

const { config } = require('../config');

/**
 * Security helpers: log redaction and request throttling.
 *
 * Both exist because this service holds four sets of live credentials (Guesty
 * Open API, Webflow CMS write, PayU merchant key + salt) and proxies a paid,
 * rate-limited upstream. A leaked log line or an unthrottled endpoint is how
 * either of those gets abused.
 */

/* -------------------------------------------------------------------------- */
/* Log redaction                                                              */
/* -------------------------------------------------------------------------- */

function secretValues() {
  return [
    config.payu.salt,
    config.payu.saltV2,
    config.payu.clientSecret,
    config.guesty.openApi.clientSecret,
    config.guesty.bookingEngine.clientSecret,
    config.webflow.token,
    config.guesty.webhookToken,
    config.webflow.webhookToken,
    config.syncSecret,
  ].filter((v) => typeof v === 'string' && v.length >= 8);
}

/**
 * Replace any known secret, plus anything that looks like a bearer token, with
 * a placeholder. Applied to everything this service logs.
 */
function redact(input) {
  let text = typeof input === 'string' ? input : safeStringify(input);
  for (const secret of secretValues()) {
    text = text.split(secret).join('[REDACTED]');
  }
  return text
    .replace(/(Bearer\s+)[A-Za-z0-9._~+/=-]{16,}/gi, '$1[REDACTED]')
    .replace(/("?(?:client_secret|clientSecret|access_token|accessToken|salt|hash|token|authorization)"?\s*[:=]\s*"?)([A-Za-z0-9._~+/=-]{8,})/gi,
      '$1[REDACTED]');
}

function safeStringify(value) {
  try {
    return typeof value === 'object' ? JSON.stringify(value) : String(value);
  } catch {
    return String(value);
  }
}

/** Wrap console so nothing can leak a secret through an error message. */
function installLogRedaction() {
  for (const level of ['log', 'info', 'warn', 'error']) {
    const original = console[level].bind(console);
    console[level] = (...args) => {
      original(...args.map((a) => (a instanceof Error ? redact(a.stack || a.message) : redact(a))));
    };
  }
}

/* -------------------------------------------------------------------------- */
/* Rate limiting                                                              */
/* -------------------------------------------------------------------------- */

const buckets = new Map();

setInterval(() => {
  const cutoff = Date.now() - 10 * 60 * 1000;
  for (const [key, bucket] of buckets) if (bucket.updated < cutoff) buckets.delete(key);
}, 5 * 60 * 1000).unref?.();

/**
 * Fixed-window limiter keyed on client IP + route group.
 *
 * The quote and availability routes each cost an upstream Guesty call, and
 * Guesty rate-limits per account: without this, one abusive client could take
 * the booking engine offline for every real guest.
 *
 * In-process only, so a multi-instance deployment gets N times the limit.
 * That is fine at this scale; move to Redis if it ever runs behind a fleet.
 */
function rateLimit({ windowMs = 60_000, max = 30, key = 'default' } = {}) {
  return function limiter(req, res, next) {
    const ip =
      (req.headers['x-forwarded-for'] || '').split(',')[0].trim() ||
      req.ip ||
      req.socket?.remoteAddress ||
      'unknown';
    const bucketKey = `${key}:${ip}`;
    const now = Date.now();

    let bucket = buckets.get(bucketKey);
    if (!bucket || now - bucket.start >= windowMs) {
      bucket = { start: now, count: 0, updated: now };
      buckets.set(bucketKey, bucket);
    }

    bucket.count += 1;
    bucket.updated = now;

    const remaining = Math.max(0, max - bucket.count);
    res.setHeader('RateLimit-Limit', String(max));
    res.setHeader('RateLimit-Remaining', String(remaining));

    if (bucket.count > max) {
      const retryAfter = Math.ceil((bucket.start + windowMs - now) / 1000);
      res.setHeader('Retry-After', String(retryAfter));
      return res.status(429).json({
        error: 'rate_limited',
        message: 'Too many requests. Please wait a moment and try again.',
      });
    }
    return next();
  };
}

/** Standard hardening headers. This API serves JSON and one static script. */
function securityHeaders(req, res, next) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
  res.setHeader('Permissions-Policy', 'geolocation=(), camera=(), microphone=()');
  next();
}

module.exports = { redact, installLogRedaction, rateLimit, securityHeaders };
