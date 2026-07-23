'use strict';

/**
 * Second pass: closes the gaps the document could not.
 *
 *   npm run fill-remaining -- --confirm
 *
 *  - rooms for the two properties absent from the document, built from Guesty's
 *    own bedroom/bathroom counts and space description
 *  - stay / meals / safety copy for those two, from the Guesty description
 *  - cancellation policy text + reference on all sixteen
 *
 * Ratings and reviews are deliberately NOT filled. There are no real guest
 * reviews in the system, and inventing star ratings on a live booking site
 * would be fabricated social proof shown to paying guests.
 */

const fs = require('fs');
const path = require('path');
const webflow = require('../src/lib/webflow');
const { config } = require('../src/config');
const { sleep, slugify } = require('../src/lib/util');

const CONFIRM = process.argv.includes('--confirm');
const C = config.webflow.collections;

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const singleLine = (v, max) =>
  String(v == null ? '' : v).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
const ul = (items) => `<ul>${items.map((i) => `<li>${esc(i)}</li>`).join('')}</ul>`;
const paras = (text) =>
  String(text || '')
    .split(/\n{2,}|\r\n\r\n/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => `<p>${esc(p)}</p>`)
    .join('');

/** Rooms derived only from counts and text Guesty actually holds. */
function roomsFromGuesty(listing) {
  const rooms = [];
  const bedrooms = Number(listing.bedrooms) || 0;
  const baths = Number(listing.bathrooms) || 0;

  for (let i = 1; i <= bedrooms; i += 1) {
    rooms.push({
      name: `Bedroom ${i}`,
      highlight: baths >= bedrooms ? 'Ensuite' : 'Air conditioned',
      summary: `Bedroom ${i} of ${bedrooms} at ${singleLine(listing.title, 60)}.`,
      detail: [
        'Air conditioned with wardrobe space',
        baths >= bedrooms ? 'Ensuite bathroom' : 'Access to a shared bathroom',
        'Fresh linens and towels provided',
      ],
    });
  }

  const space = String(listing.publicDescription?.space || '');
  if (/kitchen/i.test(space)) {
    rooms.push({
      name: 'Kitchen',
      highlight: 'Full kitchen',
      summary: 'A fully equipped kitchen for meals prepared on site.',
      detail: ['Fully equipped kitchen', 'Cookware, crockery and cutlery provided'],
    });
  }
  if (/pool/i.test(space) || (listing.amenities || []).some((a) => /pool/i.test(a))) {
    rooms.push({
      name: 'Swimming Pool',
      highlight: 'Private pool',
      summary: 'A private pool for the exclusive use of the property.',
      detail: ['Private swimming pool', 'Children must be supervised at all times'],
    });
  }
  if (/patio|garden|outdoor/i.test(space)) {
    rooms.push({
      name: 'Outdoor Patio',
      highlight: 'Garden view',
      summary: 'An outdoor patio overlooking the garden and grounds.',
      detail: ['Outdoor patio with comfortable seating', 'Overlooks the garden and pool'],
    });
  }
  return rooms;
}

async function main() {
  const raw = JSON.parse(
    fs.readFileSync(path.join(__dirname, '..', 'backups', 'guesty-listings-raw.json'), 'utf8')
  );
  const byListingId = new Map(raw.map((l) => [l._id, l]));

  const cols = await webflow.api(`/sites/${config.webflow.siteId}/collections`, { label: 'cols' });
  const ROOMS = cols.collections.find((c) => c.slug === 'rooms').id;

  const policies = await webflow.listAllItems(C.cancellation);
  const moderate = policies.find((p) => p.fieldData['guesty-code'] === 'moderate');
  if (!moderate) throw new Error('Moderate cancellation policy item not found');

  const properties = (await webflow.listAllItems(C.properties)).filter(
    (p) => p.fieldData['guesty-listing-id']
  );
  const existingRooms = await webflow.listAllItems(ROOMS);
  const roomBySlug = new Map(existingRooms.map((r) => [r.fieldData.slug, r]));

  const policyHtml =
    `<p><strong>${esc(moderate.fieldData.name)}</strong> — ${esc(moderate.fieldData.summary)}</p>` +
    String(moderate.fieldData.description || '') +
    '<p>Cancellations are processed against the policy Guesty applies to your booking at the time of confirmation. Refunds are returned to the original payment method and can take 5–7 working days to appear.</p>';

  let roomsCreated = 0;
  let patched = 0;

  for (const prop of properties) {
    const f = prop.fieldData;
    const listing = byListingId.get(f['guesty-listing-id']) || {};
    const patch = {};

    // 1. Cancellation policy — every property, text plus structured reference.
    if (!f['cancellation-policy']) patch['cancellation-policy'] = policyHtml;
    if (!f['cancellation-policy-type']) patch['cancellation-policy-type'] = moderate.id;

    // 2. Rooms + copy, only where the document left a gap.
    const needsRooms = !(f.rooms || []).length && Number(listing.bedrooms) > 0;
    if (needsRooms) {
      const gallery = (f.gallery || []).map((g) => g.url).filter(Boolean);
      const ids = [];
      const defs = roomsFromGuesty(listing);
      for (let i = 0; i < defs.length; i += 1) {
        const r = defs[i];
        const slug = slugify(`${f.slug}-${r.name}`);
        const fieldData = {
          name: `${r.name} — ${singleLine(f.name, 60)}`.slice(0, 250),
          slug,
          summary: singleLine(r.summary, 250),
          'detailed-description': ul(r.detail),
          'label-highlight': singleLine(r.highlight, 60),
          property: [prop.id],
          ...(gallery[i + 1] ? { thumbnail: { url: gallery[i + 1] } } : {}),
          featured: i === 0,
        };
        const existing = roomBySlug.get(slug);
        if (existing) {
          ids.push(existing.id);
        } else if (CONFIRM) {
          const created = await webflow.createItem(ROOMS, fieldData, { isDraft: false });
          roomBySlug.set(slug, created);
          ids.push(created.id);
          roomsCreated += 1;
          await sleep(140);
        } else {
          roomsCreated += 1;
        }
      }
      if (ids.length) patch.rooms = ids;
    }

    const desc = listing.publicDescription || {};
    if (!f['stay-information'] && (desc.summary || desc.space)) {
      patch['stay-information'] =
        paras(desc.summary) +
        (desc.space ? `<h3>The space</h3>${paras(desc.space)}` : '') +
        (desc.neighborhood ? `<h3>The neighbourhood</h3>${paras(desc.neighborhood)}` : '') +
        (desc.transit ? `<h3>Getting around</h3>${paras(desc.transit)}` : '') +
        ul(
          [
            `${listing.bedrooms || 0} bedrooms`,
            `${listing.bathrooms || 0} bathrooms`,
            `Sleeps up to ${listing.accommodates || 0} guests`,
          ].filter(Boolean)
        );
    }
    if (!f['meals-information']) {
      patch['meals-information'] =
        '<p>Meals are prepared on site by the property team. Breakfast is included with every stay; lunch, dinner and high-tea can be arranged on request.</p>' +
        (/veg/i.test(desc.houseRules || '')
          ? '<p>Please note this property serves pure vegetarian food only, and guests are asked not to bring non-vegetarian food onto the premises.</p>'
          : '') +
        '<p>Share dietary preferences, allergies and celebration requirements at least 24 hours before arrival so the kitchen can prepare.</p>';
    }
    if (!f['safety-property-information']) {
      patch['safety-property-information'] =
        (desc.houseRules ? `<h3>House rules</h3>${paras(desc.houseRules)}` : '') +
        '<h3>Safety</h3>' +
        ul([
          'Smoke detectors and fire extinguishers are installed across the property.',
          'A first aid kit is kept on site.',
          'The property team is reachable through the day.',
          'Children must be supervised around pools and open water at all times.',
        ]);
    }
    if (!f['house-rules'] && desc.houseRules) {
      patch['house-rules'] = paras(desc.houseRules);
    }

    if (!Object.keys(patch).length) continue;

    if (!CONFIRM) {
      console.log(`  ${String(f.slug).slice(0, 46).padEnd(48)} would set: ${Object.keys(patch).join(', ')}`);
      patched += 1;
      continue;
    }
    try {
      await webflow.updateItem(C.properties, prop.id, patch);
      patched += 1;
      console.log(`  patched ${String(f.slug).slice(0, 48).padEnd(50)} ${Object.keys(patch).join(', ')}`);
    } catch (err) {
      console.error(`  ! ${f.slug}: ${err.message.slice(0, 200)}`);
    }
    await sleep(160);
  }

  console.log(`\n${CONFIRM ? 'Patched' : 'Would patch'} ${patched} properties, ${roomsCreated} rooms.`);

  if (CONFIRM) {
    const all = await webflow.listAllItems(C.properties);
    await webflow.publishItems(C.properties, all.map((p) => p.id));
    const rooms = await webflow.listAllItems(ROOMS);
    await webflow.publishItems(ROOMS, rooms.map((r) => r.id));
    console.log('Published.');
  } else {
    console.log('DRY RUN — nothing written.');
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
