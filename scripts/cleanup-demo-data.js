'use strict';

/**
 * One-time removal of the site's placeholder content, now that the 16 real
 * Guesty listings are in the CMS.
 *
 *   npm run cleanup -- --dry-run    list what would go (default: dry run)
 *   npm run cleanup -- --confirm    actually delete
 *
 * A property is "demo" if and only if it has no Guesty listing ID. Everything
 * else is derived from that, so this cannot delete a synced property. Shared
 * taxonomies (Amenities, Great For, Property Types, Teams) are never touched.
 *
 * Everything removed here was backed up first:
 *   backups/properties-faq-backup.json   the 63 FAQ Q&A pairs
 *   backups/demo-data-deleted.json       written by this script before deleting
 */

const fs = require('fs');
const path = require('path');
const webflow = require('../src/lib/webflow');
const { config } = require('../src/config');
const { sleep } = require('../src/lib/util');

const args = process.argv.slice(2);
const CONFIRM = args.includes('--confirm');

const FAQS_COLLECTION = '6a60595fc48c9e90dad6b125';
const EMPTY_DESTINATIONS = ['goa', 'coorg', 'lonavala', 'mumbai'];

async function main() {
  const C = config.webflow.collections;
  const cols = await webflow.api(`/sites/${config.webflow.siteId}/collections`, { label: 'cols' });
  const id = (slug) => cols.collections.find((c) => c.slug === slug)?.id;

  const roomsId = id('rooms');
  const reviewsId = id('reviews');

  const properties = await webflow.listAllItems(C.properties);
  const demo = properties.filter((p) => !p.fieldData['guesty-listing-id']);
  const real = properties.filter((p) => p.fieldData['guesty-listing-id']);
  const demoIds = new Set(demo.map((p) => p.id));

  if (!real.length) {
    throw new Error('No Guesty-linked properties found — refusing to delete anything. Run the sync first.');
  }

  const faqs = (await webflow.listAllItems(FAQS_COLLECTION)).filter((f) =>
    demoIds.has(f.fieldData.property)
  );
  const reviews = (await webflow.listAllItems(reviewsId)).filter((r) => {
    const refs = [].concat(r.fieldData.property || [], r.fieldData['property-stayed-in'] || []);
    return refs.some((x) => demoIds.has(x));
  });
  const rooms = (await webflow.listAllItems(roomsId)).filter((r) => {
    const refs = [].concat(r.fieldData.property || []);
    return !refs.length || refs.every((x) => demoIds.has(x));
  });
  const locations = (await webflow.listAllItems(C.locations)).filter(
    (l) =>
      EMPTY_DESTINATIONS.includes(String(l.fieldData.slug).toLowerCase()) &&
      !(l.fieldData.properties || []).some((p) => !demoIds.has(p))
  );

  const plan = [
    { label: 'FAQs (attached to demo properties)', collectionId: FAQS_COLLECTION, items: faqs },
    { label: 'Reviews (placeholder guests)', collectionId: reviewsId, items: reviews },
    { label: 'Rooms (unlinked demo rooms)', collectionId: roomsId, items: rooms },
    { label: 'Properties (demo)', collectionId: C.properties, items: demo },
    { label: 'Locations (no real listings)', collectionId: C.locations, items: locations },
  ];

  console.log(`Keeping ${real.length} Guesty-linked properties.\n`);
  let total = 0;
  for (const step of plan) {
    console.log(`${step.label}: ${step.items.length}`);
    step.items.forEach((i) => console.log(`   - ${i.fieldData.slug || i.fieldData.name}`));
    total += step.items.length;
  }
  console.log(`\nTotal items to delete: ${total}`);

  if (!CONFIRM) {
    console.log('\nDRY RUN — nothing deleted. Re-run with --confirm to apply.');
    return;
  }

  // Snapshot before destroying anything.
  const backupPath = path.join(__dirname, '..', 'backups', 'demo-data-deleted.json');
  fs.writeFileSync(
    backupPath,
    JSON.stringify(
      { deletedAt: new Date().toISOString(), groups: plan.map((s) => ({ label: s.label, collectionId: s.collectionId, items: s.items })) },
      null,
      2
    )
  );
  console.log(`\nBackup written to ${backupPath}`);

  /**
   * Webflow refuses to delete an item that anything still references (409
   * conflict), and these references are circular: a demo Property points at its
   * Reviews and Rooms, those collections are pointed at by the Property, and the
   * demo Properties cross-reference each other via "Similar Nearby Properties".
   *
   * So every reference field on the demo properties is emptied first. After that
   * the children are unreferenced and delete cleanly, and the properties no
   * longer point at each other.
   */
  const REFERENCE_FIELDS = {
    [C.properties]: [
      'reviews',
      'rooms',
      'similar-nearby-properties',
      'amenities',
      'great-for',
      'property-types',
      'destination',
      'cancellation-policy-type',
      'faqs',
    ],
    [reviewsId]: ['property', 'property-stayed-in'],
    [roomsId]: ['property'],
  };

  /**
   * References must be cleared on BOTH sides and on BOTH copies.
   *
   * Reviews point at Properties and Properties point back at Reviews, so
   * clearing one side still leaves a conflict. And Webflow keeps staged and
   * live copies separately: patching only updates staged, so the published copy
   * keeps its old references and the live delete still 409s. Hence detach,
   * then publish so live matches, then delete.
   */
  const detachTargets = [
    { collectionId: C.properties, items: demo },
    { collectionId: reviewsId, items: reviews },
    { collectionId: roomsId, items: rooms },
  ];

  console.log('\nStep 1 — detaching references (staged copies)...');
  const toPublish = new Map();
  for (const group of detachTargets) {
    for (const item of group.items) {
      const patch = {};
      for (const field of REFERENCE_FIELDS[group.collectionId] || []) {
        const current = item.fieldData[field];
        if (Array.isArray(current) && current.length) patch[field] = [];
        else if (typeof current === 'string' && current) patch[field] = null;
      }
      if (!Object.keys(patch).length) continue;
      try {
        await webflow.updateItem(group.collectionId, item.id, patch);
        console.log(`   ${item.fieldData.slug}: cleared ${Object.keys(patch).join(', ')}`);
        if (!item.isDraft) {
          if (!toPublish.has(group.collectionId)) toPublish.set(group.collectionId, []);
          toPublish.get(group.collectionId).push(item.id);
        }
      } catch (err) {
        console.error(`   ! ${item.fieldData.slug}: ${err.message.slice(0, 140)}`);
      }
      await sleep(150);
    }
  }

  console.log('\nStep 2 — publishing the detached items so the live copies match...');
  for (const [collectionId, ids] of toPublish) {
    try {
      await webflow.publishItems(collectionId, ids);
      console.log(`   published ${ids.length} item(s) in ${collectionId}`);
    } catch (err) {
      console.error(`   ! publish failed for ${collectionId}: ${err.message.slice(0, 140)}`);
    }
    await sleep(400);
  }

  console.log('\nStep 3 — deleting...\n');

  const report = {};
  for (const step of plan) {
    let ok = 0;
    let failed = 0;
    for (const item of step.items) {
      try {
        await webflow.deleteItem(step.collectionId, item.id, { wasPublished: !item.isDraft });
        ok += 1;
      } catch (err) {
        failed += 1;
        console.error(`   ! ${item.fieldData.slug}: ${err.message.slice(0, 120)}`);
      }
      await sleep(120); // stay inside Webflow's 60 req/min
    }
    report[step.label] = { deleted: ok, failed };
    console.log(`   ${step.label}: ${ok} deleted${failed ? `, ${failed} failed` : ''}`);
  }

  console.log('\nDone.');
  console.log(JSON.stringify(report, null, 2));
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
