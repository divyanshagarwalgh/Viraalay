'use strict';

/**
 * Registers the Guesty -> Webflow and Webflow -> Guesty webhooks.
 * Run once after the service is deployed and the env vars are set:
 *
 *   npm run register-webhooks
 *
 * Safe to re-run: existing subscriptions with the same URL are skipped.
 */

const { config } = require('../src/config');
const guesty = require('../src/lib/guesty');
const webflow = require('../src/lib/webflow');

/**
 * `reservation.new` / `reservation.updated` are DEPRECATED — Guesty rejects them
 * with a 400 naming `reservation.created.v2` / `reservation.updated.v2` as the
 * replacements. Verified live 2026-07-23.
 */
const GUESTY_EVENTS = [
  'listing.new',
  'listing.updated',
  'listing.removed',
  'listing.calendar.updated',
  'reservation.created.v2',
  'reservation.updated.v2',
];

async function main() {
  if (!config.publicBaseUrl || /localhost/.test(config.publicBaseUrl)) {
    throw new Error('PUBLIC_BASE_URL must be a public https URL before registering webhooks');
  }
  if (!config.guesty.webhookToken) throw new Error('Set GUESTY_WEBHOOK_TOKEN first');
  if (!config.webflow.webhookToken) throw new Error('Set WEBFLOW_WEBHOOK_TOKEN first');

  const guestyUrl = `${config.publicBaseUrl}/api/hooks/guesty?token=${encodeURIComponent(config.guesty.webhookToken)}`;
  const webflowUrl = `${config.publicBaseUrl}/api/hooks/webflow?token=${encodeURIComponent(config.webflow.webhookToken)}`;

  console.log('--- Guesty ---');
  let existing = [];
  try {
    const list = await guesty.listWebhooks();
    existing = list.results || list.data || list || [];
  } catch (err) {
    console.warn('Could not list existing Guesty webhooks:', err.message);
  }

  // One subscription per URL, carrying every event — that is the shape Guesty
  // wants. Re-running finds the existing subscription by URL and leaves it be.
  const already = existing.find((w) => w.url === guestyUrl);
  if (already) {
    const covered = already.events || already.event || [];
    console.log(`  = already registered (${[].concat(covered).join(', ') || 'no events listed'})`);
    const missing = GUESTY_EVENTS.filter((e) => ![].concat(covered).includes(e));
    if (missing.length) {
      console.warn(`  ! subscription is missing: ${missing.join(', ')}`);
      console.warn('    Delete it in Guesty and re-run, or add the events by hand.');
    }
  } else {
    try {
      const created = await guesty.createWebhook({ events: GUESTY_EVENTS, url: guestyUrl });
      console.log(`  + ${GUESTY_EVENTS.join(', ')}`);
      if (created && created._id) console.log(`    id ${created._id}`);
    } catch (err) {
      console.error(`  ! create failed: ${err.message}`);
    }
  }

  console.log('--- Webflow ---');
  const triggers = ['collection_item_changed', 'collection_item_created'];
  let wfExisting = [];
  try {
    const list = await webflow.api(`/sites/${config.webflow.siteId}/webhooks`, {
      label: 'Webflow list webhooks',
    });
    wfExisting = list.webhooks || [];
  } catch (err) {
    console.warn('Could not list existing Webflow webhooks:', err.message);
  }

  for (const triggerType of triggers) {
    const already = wfExisting.find((w) => w.triggerType === triggerType && w.url === webflowUrl);
    if (already) {
      console.log(`  = ${triggerType} already registered`);
      continue;
    }
    try {
      await webflow.api(`/sites/${config.webflow.siteId}/webhooks`, {
        method: 'POST',
        body: { triggerType, url: webflowUrl },
        label: 'Webflow create webhook',
      });
      console.log(`  + ${triggerType}`);
    } catch (err) {
      console.error(`  ! ${triggerType}: ${err.message}`);
    }
  }

  console.log('\nDone.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
