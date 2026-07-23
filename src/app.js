'use strict';

const path = require('path');
const express = require('express');
const cors = require('cors');
const { config } = require('./config');

const apiRoutes = require('./routes/api');
const payuRoutes = require('./routes/payu');
const hookRoutes = require('./routes/hooks');
const { installLogRedaction, rateLimit, securityHeaders } = require('./lib/security');

// Wrap console before anything can log. Nothing this service prints should be
// able to carry a Guesty, Webflow or PayU secret into a log aggregator.
installLogRedaction();

const app = express();

app.set('trust proxy', true);
app.disable('x-powered-by');
app.use(securityHeaders);

// PayU posts application/x-www-form-urlencoded; everything else is JSON.
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));

/**
 * The booking script is loaded by the Webflow site, so the browser calls this
 * origin cross-site. Only the site's own origins are allowed; PayU callbacks
 * are server-to-server and are not affected by CORS.
 */
const corsOptions = {
  origin(origin, callback) {
    if (!origin) return callback(null, true); // curl, server-to-server, same-origin
    if (!config.allowedOrigins.length) return callback(null, true);
    if (config.allowedOrigins.includes(origin)) return callback(null, true);
    // Allow any *.webflow.io preview of this site.
    if (/^https:\/\/[a-z0-9-]+\.webflow\.io$/i.test(origin)) return callback(null, true);
    return callback(new Error(`Origin ${origin} is not allowed`));
  },
  methods: ['GET', 'POST', 'OPTIONS'],
  maxAge: 86400,
};
app.use(cors(corsOptions));

// The front-end bundle the Webflow site loads.
app.use(
  '/assets',
  express.static(path.join(__dirname, '..', 'public'), {
    maxAge: '5m',
    setHeaders(res) {
      res.setHeader('Access-Control-Allow-Origin', '*');
    },
  })
);

/**
 * Public health is intentionally minimal — which integrations are wired and
 * whether PayU is in live mode is useful to an attacker and to nobody else.
 * The detail is available with the sync secret.
 */
app.get('/health', (req, res) => {
  const provided =
    req.query.token || (req.get('authorization') || '').replace(/^Bearer\s+/i, '');
  const authorised = config.syncSecret && provided === config.syncSecret;

  if (!authorised) return res.json({ ok: true, service: 'viraalay-booking-engine' });

  res.json({
    ok: true,
    service: 'viraalay-booking-engine',
    time: new Date().toISOString(),
    configured: {
      guestyMode: config.guesty.mode,
      guestyOpenApi: Boolean(config.guesty.openApi.clientId),
      guestyBookingEngine: Boolean(config.guesty.bookingEngine.clientId),
      webflow: Boolean(config.webflow.token),
      payu: Boolean(config.payu.key),
      payuSalts: config.payu.salts.length,
      payuMode: config.payu.mode,
      captureMode: config.capture.mode,
    },
  });
});

// Throttles sized to real guest behaviour. Quote and checkout each cost an
// upstream Guesty call, so they are the tightest.
app.use('/api/quote', rateLimit({ key: 'quote', max: 30, windowMs: 60_000 }));
app.use('/api/availability', rateLimit({ key: 'avail', max: 60, windowMs: 60_000 }));
app.use('/api/search', rateLimit({ key: 'search', max: 15, windowMs: 60_000 }));
app.use('/api/checkout', rateLimit({ key: 'checkout', max: 10, windowMs: 60_000 }));
app.use('/api/booking', rateLimit({ key: 'booking', max: 30, windowMs: 60_000 }));

app.use('/api', apiRoutes);
app.use('/api/payu', payuRoutes);
app.use('/api/hooks', hookRoutes);
app.use('/api', hookRoutes); // exposes /api/sync/listings

app.use((req, res) => {
  res.status(404).json({ error: 'not_found', message: `No route for ${req.method} ${req.path}` });
});

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  const status = err.status || 500;
  if (status >= 500) console.error('[error]', err);
  else console.warn('[warn]', err.code || '', err.message);
  res.status(status).json({
    error: err.code || 'server_error',
    message:
      status >= 500 && process.env.NODE_ENV === 'production'
        ? 'Something went wrong on our side. Please try again.'
        : err.message,
  });
});

module.exports = app;
