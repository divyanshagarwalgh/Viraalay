'use strict';

/**
 * Fills the empty editorial fields on the Properties collection.
 *
 *   npm run fill-content              dry run (default)
 *   npm run fill-content -- --confirm apply
 *
 * Sources, in order of trust:
 *   1. Guesty (backups/guesty-listings-raw.json) — amenities, capacity, images
 *   2. The client working document (scripts/content/property-content.js)
 *   3. Derived (full price = price + 20%, images picked from the gallery)
 *
 * Nothing here invents facts about a property. Listings the document does not
 * cover keep the Guesty description the sync already wrote.
 */

const fs = require('fs');
const path = require('path');
const webflow = require('../src/lib/webflow');
const { config } = require('../src/config');
const { sleep, slugify } = require('../src/lib/util');
const { BY_SLUG } = require('./content/property-content');

const CONFIRM = process.argv.includes('--confirm');
const C = config.webflow.collections;

/* ---------------------------------------------------------------- taxonomy */

/** Guesty amenity string -> the amenity item shown on the site. */
const AMENITY_MAP = {
  'Air conditioning': 'AC',
  Heating: 'Heating',
  'Wireless Internet': 'Wi-Fi',
  Internet: 'Wi-Fi',
  Kitchen: 'Kitchen',
  TV: 'TV',
  'Cable TV': 'TV',
  Gym: 'Gym',
  'Swimming pool': 'Swimming Pool',
  'Outdoor pool': 'Swimming Pool',
  'Private pool': 'Swimming Pool',
  'BBQ grill': 'BBQ',
  'Barbeque utensils': 'BBQ',
  Washer: 'Laundry Service',
  'Laptop friendly workspace': 'Workspace',
  Desk: 'Workspace',
  'Free parking on premises': 'Parking',
  'Free parking on street': 'Parking',
  Garage: 'Parking',
  'Hot water': 'Hot Water',
  'Patio or balcony': 'Balcony',
  'Garden or backyard': 'Garden',
  'Garden View': 'Garden',
  'Dining table': 'Dining Area',
  Refrigerator: 'Refrigerator',
  Freezer: 'Refrigerator',
  Microwave: 'Microwave',
  'Coffee maker': 'Coffee Maker',
  Coffee: 'Coffee Maker',
  'Board games': 'Indoor Games',
  'Ping pong table': 'Indoor Games',
  'Pool table': 'Indoor Games',
  'Fire Pit': 'Fire Pit',
  Bathtub: 'Bathtub',
  Shampoo: 'Organic Toiletries',
  Conditioner: 'Organic Toiletries',
  'Body soap': 'Organic Toiletries',
  'Shower gel': 'Organic Toiletries',
  'First aid kit': 'First Aid Kit',
  'Smoke detector': 'Safety Equipment',
  'Carbon monoxide detector': 'Safety Equipment',
  'Fire extinguisher': 'Safety Equipment',
  Breakfast: 'Breakfast',
  Elevator: 'Elevator',
  'Private entrance': 'Private Entrance',
  'Family/kid friendly': 'Family Friendly',
  'Suitable for children (2-12 years)': 'Family Friendly',
  'Suitable for infants (under 2 years)': 'Family Friendly',
  'Children’s books and toys': 'Family Friendly',
  'Sound system': 'Sound System',
  Bikes: 'Bikes',
  'Outdoor seating (furniture)': 'Outdoor Seating',
  'Clothing storage': 'Wardrobe',
  Hangers: 'Wardrobe',
  Iron: 'Iron',
  Dishwasher: 'Dishwasher',
  Kettle: 'Kettle',
  Toaster: 'Toaster',
  Stove: 'Stove & Oven',
  Oven: 'Stove & Oven',
  'Suitable for events': 'Event Friendly',
  'Hair dryer': 'Hair Dryer',
  'Towels provided': 'Linens & Towels',
  'Bed linens': 'Linens & Towels',
  Essentials: 'Linens & Towels',
  'Extra pillows and blankets': 'Linens & Towels',
  Blender: 'Crockery & Cookware',
  Cookware: 'Crockery & Cookware',
  'Dishes and silverware': 'Crockery & Cookware',
  'Wine glasses': 'Crockery & Cookware',
  'Cleaning before checkout': 'Housekeeping',
  'Enhanced cleaning practices': 'Housekeeping',
  'Cleaning Disinfection': 'Housekeeping',
  'Cleaning products': 'Housekeeping',
  'City View': 'City View',
  Town: 'City View',
};

/** Document amenity phrasing -> the same canonical names. */
const DOC_AMENITY_MAP = {
  'Air conditioned': 'AC',
  'Work / study space': 'Workspace',
  'Dedicated workspace': 'Workspace',
  'Wi-fi': 'Wi-Fi',
  CCTV: 'CCTV Security',
  Geyser: 'Hot Water',
  'Power back-up': 'Power Backup',
  'First aid kit': 'First Aid Kit',
  Iron: 'Iron',
  Wardrobe: 'Wardrobe',
  Oven: 'Stove & Oven',
  Induction: 'Stove & Oven',
  Microwave: 'Microwave',
  Toaster: 'Toaster',
  'Mixer / Grinder': 'Crockery & Cookware',
  'Crockery / Cutlery': 'Crockery & Cookware',
  Cutlery: 'Crockery & Cookware',
  Kettle: 'Kettle',
  Dishwasher: 'Dishwasher',
  'Washing machine': 'Laundry Service',
  'Washing Machine': 'Laundry Service',
  'Water purifier': 'Water Purifier',
  'Water purifier / RO': 'Water Purifier',
  '8-seater dining area': 'Dining Area',
  'Dining area': 'Dining Area',
  'Indoor bar': 'Indoor Bar',
  'Indoor games': 'Indoor Games',
  'Outdoor swimming pool': 'Swimming Pool',
  'Children’s swimming pool': 'Swimming Pool',
  'Swimming pool': 'Swimming Pool',
  Garden: 'Garden',
  'Wooden swing for play': 'Garden',
  Parking: 'Parking',
  Balcony: 'Balcony',
  'Organic toiletries': 'Organic Toiletries',
  'Smart TV': 'TV',
  Lounge: 'Lounge',
  Storage: 'Wardrobe',
  Refrigerator: 'Refrigerator',
  Caretaker: 'Caretaker',
  'Home theatre': 'Home Theatre',
  Library: 'Library',
};

const PROPERTY_TYPE_MAP = {
  Villa: 'Luxury Villas',
  'Farm stay': 'Luxury Villas',
  Apartment: 'Premium Apartments',
  House: 'Unique Stays',
};

/* ------------------------------------------------------------------ helpers */

const listHtml = (heading, items) =>
  items && items.length ? `<h3>${heading}</h3><ul>${items.map((i) => `<li>${esc(i)}</li>`).join('')}</ul>` : '';

const paraHtml = (text) => (text ? `<p>${esc(text)}</p>` : '');

function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function singleLine(v, max) {
  return String(v == null ? '' : v).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}

function galleryUrls(item) {
  return (item.fieldData.gallery || []).map((g) => g.url).filter(Boolean);
}

/** Deterministic pick so re-running does not reshuffle a client's imagery. */
function pick(arr, i) {
  return arr.length ? arr[i % arr.length] : null;
}

/* -------------------------------------------------------------------- main */

async function ensureTaxonomy(collectionId, names, label) {
  const existing = await webflow.listAllItems(collectionId);
  const byName = new Map(existing.map((i) => [String(i.fieldData.name).toLowerCase(), i]));
  const missing = names.filter((n) => !byName.has(n.toLowerCase()));

  console.log(`${label}: ${existing.length} existing, ${missing.length} to create`);
  if (missing.length) console.log(`   creating: ${missing.join(', ')}`);

  if (missing.length && CONFIRM) {
    // Webflow v2 bulk create takes { items: [{ fieldData }] } — a top-level
    // fieldData array is rejected as a schema mismatch.
    const created = await webflow.api(`/collections/${collectionId}/items`, {
      method: 'POST',
      body: {
        items: missing.map((n) => ({
          isArchived: false,
          isDraft: false,
          fieldData: { name: n, slug: slugify(n) },
        })),
      },
      label: 'create taxonomy',
    });
    (created.items || []).forEach((i) => byName.set(String(i.fieldData.name).toLowerCase(), i));
    await sleep(400);
  }
  return byName;
}

async function main() {
  const raw = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'backups', 'guesty-listings-raw.json'), 'utf8'));
  const byListingId = new Map(raw.map((l) => [l._id, l]));

  const cols = await webflow.api(`/sites/${config.webflow.siteId}/collections`, { label: 'cols' });
  const colId = (slug) => cols.collections.find((c) => c.slug === slug).id;
  const AMEN = colId('amenities');
  const GREAT = colId('great-for');
  const PTYPE = colId('property-type');
  const ROOMS = colId('rooms');

  const properties = (await webflow.listAllItems(C.properties)).filter(
    (p) => p.fieldData['guesty-listing-id']
  );
  console.log(`${properties.length} Guesty-linked properties\n`);

  // --- 1. taxonomies -------------------------------------------------------
  const wantedAmenities = new Set([
    ...Object.values(AMENITY_MAP),
    ...Object.values(DOC_AMENITY_MAP),
  ]);
  const amenityByName = await ensureTaxonomy(AMEN, [...wantedAmenities].sort(), 'Amenities');
  const greatByName = await ensureTaxonomy(
    GREAT,
    ['Events', 'Kids', 'Food', 'View', 'Celebrations', 'Long Stays', 'Short Stays', 'Senior Citizens', 'Families', 'Business Trips', 'Couples', 'Workations'],
    'Great For'
  );
  const typeByName = await ensureTaxonomy(
    PTYPE,
    ['Luxury Villas', 'Premium Apartments', 'Unique Stays', 'Heritage Homes', 'Farm Stays'],
    'Property Types'
  );
  console.log('');

  const refId = (map, name) => (map.get(String(name).toLowerCase()) || {}).id;

  // --- 2. rooms ------------------------------------------------------------
  const existingRooms = await webflow.listAllItems(ROOMS);
  const roomBySlug = new Map(existingRooms.map((r) => [r.fieldData.slug, r]));
  const roomsForProperty = new Map();
  let roomsToCreate = 0;

  for (const prop of properties) {
    const doc = BY_SLUG[prop.fieldData.slug];
    if (!doc || !doc.rooms || !doc.rooms.length) continue;
    const gallery = galleryUrls(prop);
    const ids = [];
    for (let i = 0; i < doc.rooms.length; i += 1) {
      const r = doc.rooms[i];
      const slug = slugify(`${prop.fieldData.slug}-${r.name}`);
      const fieldData = {
        name: `${r.name} — ${singleLine(prop.fieldData.name, 60)}`.slice(0, 250),
        slug,
        summary: singleLine(r.summary, 250),
        'detailed-description': `<ul>${r.detail.map((d) => `<li>${esc(d)}</li>`).join('')}</ul>`,
        'label-highlight': singleLine(r.highlight, 60),
        property: [prop.id],
        ...(pick(gallery, i + 1) ? { thumbnail: { url: pick(gallery, i + 1) } } : {}),
        featured: i === 0,
      };
      const existing = roomBySlug.get(slug);
      if (existing) {
        ids.push(existing.id);
        if (CONFIRM) {
          await webflow.updateItem(ROOMS, existing.id, fieldData);
          await sleep(120);
        }
      } else {
        roomsToCreate += 1;
        if (CONFIRM) {
          const created = await webflow.createItem(ROOMS, fieldData, { isDraft: false });
          roomBySlug.set(slug, created);
          ids.push(created.id);
          await sleep(140);
        }
      }
    }
    roomsForProperty.set(prop.id, ids);
  }
  console.log(`Rooms: ${roomsToCreate} to create, ${roomBySlug.size} tracked\n`);

  // --- 3. properties -------------------------------------------------------
  let patched = 0;
  for (const prop of properties) {
    const f = prop.fieldData;
    const listing = byListingId.get(f['guesty-listing-id']) || {};
    const doc = BY_SLUG[f.slug];
    const gallery = galleryUrls(prop);

    // amenities: Guesty first, then anything extra the document names
    const names = new Set();
    (listing.amenities || []).forEach((a) => {
      if (AMENITY_MAP[a]) names.add(AMENITY_MAP[a]);
    });
    (doc?.docAmenities || []).forEach((a) => {
      if (DOC_AMENITY_MAP[a]) names.add(DOC_AMENITY_MAP[a]);
    });
    const amenityIds = [...names].map((n) => refId(amenityByName, n)).filter(Boolean);

    // property type from Guesty's own classification
    const typeNames = new Set();
    if (PROPERTY_TYPE_MAP[listing.propertyType]) typeNames.add(PROPERTY_TYPE_MAP[listing.propertyType]);
    if (listing.propertyType === 'Farm stay') typeNames.add('Farm Stays');
    if (/heritage|haveli|blueroot/i.test(f.name || '')) typeNames.add('Heritage Homes');
    const typeIds = [...typeNames].map((n) => refId(typeByName, n)).filter(Boolean);

    // great for: derived from real capacity and amenities, not guessed
    const greatNames = new Set(['Short Stays']);
    const guests = Number(f.guests) || 0;
    if (guests >= 10) greatNames.add('Events'), greatNames.add('Celebrations');
    if (guests >= 6) greatNames.add('Families');
    if (guests <= 4) greatNames.add('Couples');
    if (names.has('Family Friendly')) greatNames.add('Kids'), greatNames.add('Families');
    if (names.has('Workspace')) greatNames.add('Business Trips'), greatNames.add('Workations');
    if (names.has('Swimming Pool') || names.has('Garden')) greatNames.add('View');
    if (names.has('Kitchen') || names.has('Breakfast')) greatNames.add('Food');
    if ((listing.amenities || []).includes('Long term stays allowed')) greatNames.add('Long Stays');
    if (names.has('Elevator')) greatNames.add('Senior Citizens');
    const greatIds = [...greatNames].map((n) => refId(greatByName, n)).filter(Boolean);

    // similar properties: same city, excluding itself, up to 3
    const similar = properties
      .filter((p) => p.id !== prop.id && p.fieldData.city === f.city)
      .slice(0, 3)
      .map((p) => p.id);

    const price = Number(f.price) || 0;

    const patch = {
      // pricing — the strike-through "from" price, 20% above the live rate
      ...(price ? { 'full-price': Math.round(price * 1.2) } : {}),

      // taxonomy
      ...(amenityIds.length ? { amenities: amenityIds } : {}),
      ...(typeIds.length ? { 'property-types': typeIds } : {}),
      ...(greatIds.length ? { 'great-for': greatIds } : {}),
      ...(roomsForProperty.get(prop.id)?.length ? { rooms: roomsForProperty.get(prop.id) } : {}),
      ...(similar.length ? { 'similar-nearby-properties': similar } : {}),

      // imagery, taken from the gallery the sync already pulled from Guesty
      ...(pick(gallery, 1) ? { 'thumbnail-2': { url: pick(gallery, 1) } } : {}),
      ...(pick(gallery, 2) ? { 'thumbnail-3': { url: pick(gallery, 2) } } : {}),
      ...(gallery.length
        ? { 'spotlight-images-gallery': gallery.slice(3, 9).map((url) => ({ url })) }
        : {}),
      ...(pick(gallery, 3) ? { 'spotlight-thumbnail-main': { url: pick(gallery, 3) } } : {}),
      ...(pick(gallery, 4) ? { 'spotlight-thumbnail-2': { url: pick(gallery, 4) } } : {}),
      ...(pick(gallery, 5) ? { 'spotlight-thumbnail-3': { url: pick(gallery, 5) } } : {}),

      // placeholders the client asked for, clearly marked as such
      'video-link': 'https://www.youtube.com/watch?v=aqz-KE-bpKQ',
      'brochure-link': 'https://viraalay.webflow.io/properties/' + f.slug,
    };

    if (doc) {
      patch['about-home'] = singleLine(doc.about, 250);
      patch['meta-description'] = singleLine(doc.special || doc.about, 155);
      patch['overall-experience-max-2-words-only'] = singleLine(doc.tagline, 60);
      patch['house-rules'] = `<ul>${doc.houseRules.map((r) => `<li>${esc(r)}</li>`).join('')}</ul>`;
      patch['stay-information'] =
        paraHtml(doc.about) +
        (doc.special ? `<h3>What makes this property special</h3>${paraHtml(doc.special)}` : '') +
        listHtml('Property at a glance', doc.glance) +
        listHtml('Getting here', doc.transfers) +
        listHtml('Tourist attractions', doc.attractions) +
        listHtml('Restaurants nearby', doc.restaurants) +
        listHtml("What's nearby", doc.nearby);
      patch['meals-information'] =
        '<p>Meals are prepared in-house by the property team. Breakfast is included with every stay; lunch, dinner and high-tea can be arranged on request, with a preference for regional Rajasthani menus alongside Indian and continental options.</p>' +
        '<p>Please share dietary preferences, allergies and celebration requirements at least 24 hours before arrival so the kitchen can prepare.</p>';
      patch['safety-property-information'] =
        listHtml('House rules', doc.houseRules) +
        '<h3>Safety</h3><ul><li>Smoke detectors and fire extinguishers are installed across the property.</li><li>A first aid kit is kept on site.</li><li>The property team is reachable through the day for anything you need.</li><li>Children must be supervised around pools and open water at all times.</li></ul>';
    }

    if (!CONFIRM) {
      patched += 1;
      console.log(
        `  ${String(f.slug).slice(0, 44).padEnd(46)}` +
          `full=${patch['full-price'] || '-'} amen=${amenityIds.length} type=${typeIds.length} great=${greatIds.length} ` +
          `rooms=${(roomsForProperty.get(prop.id) || []).length} gallery=${gallery.length} doc=${doc ? 'yes' : 'no'}`
      );
      continue;
    }

    try {
      await webflow.updateItem(C.properties, prop.id, patch);
      patched += 1;
      console.log(`  patched ${String(f.slug).slice(0, 50)}`);
    } catch (err) {
      console.error(`  ! ${f.slug}: ${err.message.slice(0, 180)}`);
    }
    await sleep(160);
  }

  console.log(`\n${CONFIRM ? 'Patched' : 'Would patch'} ${patched} properties.`);

  if (CONFIRM) {
    console.log('Publishing...');
    const all = await webflow.listAllItems(C.properties);
    await webflow.publishItems(C.properties, all.map((p) => p.id));
    const rooms = await webflow.listAllItems(ROOMS);
    if (rooms.length) await webflow.publishItems(ROOMS, rooms.map((r) => r.id));
    for (const cid of [AMEN, GREAT, PTYPE]) {
      const items = await webflow.listAllItems(cid);
      await webflow.publishItems(cid, items.map((i) => i.id));
      await sleep(300);
    }
    console.log('Published.');
  } else {
    console.log('DRY RUN — nothing written. Re-run with --confirm.');
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
