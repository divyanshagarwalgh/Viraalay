'use strict';

const app = require('./app');
const { config } = require('./config');
const sync = require('./lib/sync');

app.listen(config.port, () => {
  console.log(`Viraalay booking engine listening on http://localhost:${config.port}`);
  console.log(`Public base URL: ${config.publicBaseUrl}`);
  console.log(`Script tag: <script defer src="${config.publicBaseUrl}/assets/viraalay-booking.js"></script>`);
  startSyncSchedule();
});

/**
 * Periodic Guesty -> Webflow sync, belt-and-braces alongside the webhooks: it
 * catches anything a dropped or mis-delivered hook missed.
 *
 * Runs in-process rather than as a separate cron service hitting
 * /api/sync/listings?token=... That endpoint still exists for manual runs, but
 * scheduling it externally would mean a second deployment and the sync secret
 * living in a third party's job config. The work is the same either way — the
 * sync is idempotent and skips listings that have not changed.
 *
 * Set SYNC_INTERVAL_HOURS=0 to hand the job to an external cron instead.
 */
function startSyncSchedule() {
  const hours = config.syncIntervalHours;
  if (!hours || hours <= 0) {
    console.log('[sync] scheduler disabled (SYNC_INTERVAL_HOURS=0)');
    return;
  }

  const everyMs = hours * 60 * 60 * 1000;
  let running = false;

  const run = async () => {
    // A slow sync must never overlap the next tick — Guesty rate-limits, and
    // two concurrent passes would write the same items twice.
    if (running) {
      console.warn('[sync] previous run still in progress, skipping this tick');
      return;
    }
    running = true;
    try {
      const report = await sync.syncListings({});
      console.log('[sync] scheduled run complete', JSON.stringify(report));
    } catch (err) {
      // Never let a failed sync take the booking API down with it.
      console.error('[sync] scheduled run failed:', err.message);
    } finally {
      running = false;
    }
  };

  const timer = setInterval(run, everyMs);
  // Do not hold the process open for the sake of the timer.
  if (timer.unref) timer.unref();

  console.log(`[sync] scheduled every ${hours}h`);
}
