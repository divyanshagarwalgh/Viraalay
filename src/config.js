'use strict';

require('dotenv').config();

function req(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required environment variable: ${name}`);
  return v;
}

function opt(name, fallback = '') {
  const v = process.env[name];
  return v === undefined || v === '' ? fallback : v;
}

const config = {
  publicBaseUrl: opt('PUBLIC_BASE_URL', 'http://localhost:3000').replace(/\/$/, ''),
  siteBaseUrl: opt('SITE_BASE_URL', 'https://viraalay.webflow.io').replace(/\/$/, ''),
  successPath: opt('SUCCESS_PATH', '/booking-confirmed'),
  failurePath: opt('FAILURE_PATH', '/booking-failed'),

  allowedOrigins: opt('ALLOWED_ORIGINS', '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),

  guesty: {
    /**
     * Which Guesty product serves availability and quotes.
     *
     *  'open-api'       - calendar, quotes and reservations all come from the
     *                     Open API. Default, because the Open API ships with
     *                     every Guesty account.
     *  'booking-engine' - calendar + quotes come from the separately-licensed
     *                     Booking Engine API add-on. Only set this if the
     *                     account actually has that add-on enabled.
     */
    mode: opt('GUESTY_API_MODE', 'open-api'),
    bookingEngine: {
      base: 'https://booking.guesty.com',
      tokenUrl: 'https://booking.guesty.com/oauth2/token',
      scope: 'booking_engine:api',
      clientId: opt('GUESTY_BE_CLIENT_ID'),
      clientSecret: opt('GUESTY_BE_CLIENT_SECRET'),
    },
    openApi: {
      base: 'https://open-api.guesty.com/v1',
      tokenUrl: 'https://open-api.guesty.com/oauth2/token',
      scope: 'open-api',
      clientId: opt('GUESTY_OA_CLIENT_ID'),
      clientSecret: opt('GUESTY_OA_CLIENT_SECRET'),
    },
    webhookToken: opt('GUESTY_WEBHOOK_TOKEN'),
  },

  webflow: {
    base: 'https://api.webflow.com/v2',
    token: opt('WEBFLOW_API_TOKEN'),
    siteId: opt('WEBFLOW_SITE_ID', '6a56f9a2d06b16a017f0dd75'),
    webhookToken: opt('WEBFLOW_WEBHOOK_TOKEN'),
    collections: {
      properties: opt('WEBFLOW_COLLECTION_PROPERTIES', '6a58ffaac89342cf498710b9'),
      propertySync: opt('WEBFLOW_COLLECTION_PROPERTY_SYNC', '6a604a6b6e24d84900fe7827'),
      bookings: opt('WEBFLOW_COLLECTION_BOOKINGS', '6a6049b12f7e47d5f9aa08a4'),
      locations: opt('WEBFLOW_COLLECTION_LOCATIONS', '6a6049b09409fba1e822a90c'),
      cancellation: opt('WEBFLOW_COLLECTION_CANCELLATION', '6a6049b38d94bdc10b0ba283'),
      addons: opt('WEBFLOW_COLLECTION_ADDONS', '6a6049b28d94bdc10b0ba24d'),
    },
  },

  payu: {
    key: opt('PAYU_MERCHANT_KEY'),
    salt: opt('PAYU_MERCHANT_SALT'),
    saltV2: opt('PAYU_MERCHANT_SALT_V2'),
    clientId: opt('PAYU_CLIENT_ID'),
    clientSecret: opt('PAYU_CLIENT_SECRET'),
    mode: opt('PAYU_MODE', 'test'),
    /** Every salt a response hash may legitimately have been signed with. */
    get salts() {
      return [this.salt, this.saltV2].filter(Boolean);
    },
    get paymentUrl() {
      return this.mode === 'live'
        ? 'https://secure.payu.in/_payment'
        : 'https://test.payu.in/_payment';
    },
    // Post-service (verify_payment) endpoint is the same host for both modes.
    get postServiceUrl() {
      return this.mode === 'live'
        ? 'https://info.payu.in/merchant/postservice.php?form=2'
        : 'https://test.payu.in/merchant/postservice.php?form=2';
    },
  },

  capture: {
    mode: opt('PAYMENT_CAPTURE_MODE', 'full'),
    depositPercent: Number(opt('PAYMENT_DEPOSIT_PERCENT', '30')),
  },

  syncSecret: opt('SYNC_SECRET'),
  // Hours between automatic Guesty -> Webflow syncs. 0 disables the in-process
  // scheduler, for when an external cron owns the job instead.
  syncIntervalHours: Number(opt('SYNC_INTERVAL_HOURS', '6')),
  port: Number(opt('PORT', '3000')),
};

config.assertGuesty = function assertGuesty() {
  const which = config.guesty.mode === 'booking-engine' ? 'bookingEngine' : 'openApi';
  const cfg = config.guesty[which];
  if (!cfg.clientId || !cfg.clientSecret) {
    throw Object.assign(
      new Error(
        `Guesty ${which === 'openApi' ? 'Open API' : 'Booking Engine API'} credentials are not configured`
      ),
      { status: 503, code: 'guesty_not_configured' }
    );
  }
};

config.assertPayU = function assertPayU() {
  if (!config.payu.key || !config.payu.salt) {
    throw Object.assign(new Error('PayU credentials are not configured'), {
      status: 503,
      code: 'payu_not_configured',
    });
  }
};

config.assertWebflow = function assertWebflow() {
  if (!config.webflow.token) {
    throw Object.assign(new Error('Webflow API token is not configured'), {
      status: 503,
      code: 'webflow_not_configured',
    });
  }
};

module.exports = { config, req, opt };
