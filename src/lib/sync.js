'use strict';

const { config } = require('../config');
const guesty = require('../lib/guesty');
const webflow = require('../lib/webflow');
const { slugify, stableHash, money, sleep, ymd } = require('../lib/util');

/**
 * Guesty -> Webflow CMS sync.
 *
 * Two collections are written:
 *   Property Sync  - every operational field, always overwritten. This is the
 *                    machine's collection; nobody edits it by hand.
 *   Properties     - the editorial collection. Only capacity and price are
 *                    force-updated. Copy, imagery and ratings are written once
 *                    on first creation and then left alone unless the
 *                    "Lock editorial content?" switch is OFF and the field is
 *                    still empty.
 *
 * That split is what makes the sync safe to run on a schedule: it can never
 * flatten hand-written marketing copy with Guesty's operational text.
 */

const C = () => config.webflow.collections;

/**
 * Increment when toSyncFields / toPropertyOperationalFields change shape.
 * It is folded into the sync hash so a listing whose Guesty payload has not
 * changed is still rewritten with the new mapping.
 */
const MAPPING_VERSION = 4;

function firstPicture(listing) {
  if (listing.picture?.large) return listing.picture.large;
  if (listing.picture?.regular) return listing.picture.regular;
  if (listing.picture?.thumbnail) return listing.picture.thumbnail;
  const p = (listing.pictures || [])[0];
  return p?.original || p?.large || p?.regular || p?.thumbnail || null;
}

function galleryUrls(listing, limit = 25) {
  return (listing.pictures || [])
    .map((p) => p.original || p.large || p.regular || p.thumbnail)
    .filter(Boolean)
    .slice(0, limit);
}

/**
 * Guests see this field, so render a 12-hour time whatever Guesty supplies.
 * Observed formats on the live account: the string "14:00". The docs also
 * describe an hour integer (14), and half-hours appear as 16.5 elsewhere, so
 * all three are handled.
 */
function clockTime(value) {
  if (value === null || value === undefined || value === '') return '';

  let hour;
  let minutes = 0;

  const hhmm = String(value).match(/^(\d{1,2}):(\d{2})$/);
  if (hhmm) {
    hour = Number(hhmm[1]);
    minutes = Number(hhmm[2]);
  } else {
    const n = Number(value);
    if (!Number.isFinite(n)) return String(value); // already human-formatted
    hour = Math.floor(n);
    minutes = Math.round((n - hour) * 60);
  }

  hour = ((hour % 24) + 24) % 24;
  const suffix = hour < 12 ? 'AM' : 'PM';
  const display = hour % 12 === 0 ? 12 : hour % 12;
  return `${display}:${String(minutes).padStart(2, '0')} ${suffix}`;
}

/**
 * Webflow's single-line PlainText fields reject any embedded newline, and
 * Guesty descriptions are full of them. Writing raw text here does not just
 * fail the write — it leaves the item in a state where EVERY later update is
 * rejected with a validation error, including flipping it out of draft.
 */
function singleLine(value, max = 250) {
  return String(value == null ? '' : value)
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

function html(text) {
  if (!text) return '';
  return String(text)
    .split(/\n{2,}/)
    .map((p) => `<p>${p.replace(/\n/g, '<br>').replace(/</g, '&lt;')}</p>`)
    .join('');
}

function toSyncFields(listing, { destinationId, policyId, propertyItemId } = {}) {
  const addr = listing.address || {};
  const prices = listing.prices || {};
  const terms = listing.terms || {};
  const desc = listing.publicDescription || {};

  return {
    name: listing.nickname || listing.title || `Listing ${listing._id}`,
    slug: slugify(listing._id, 'listing'),
    'guesty-listing-id': listing._id,
    ...(propertyItemId ? { property: propertyItemId } : {}),
    ...(destinationId ? { destination: destinationId } : {}),
    ...(policyId ? { 'cancellation-policy': policyId } : {}),
    'guesty-nickname': listing.nickname || '',
    city: addr.city || '',
    state: addr.state || '',
    country: addr.country || '',
    'full-address': addr.full || '',
    latitude: addr.lat != null ? String(addr.lat) : '',
    longitude: addr.lng != null ? String(addr.lng) : '',
    timezone: listing.timezone || '',
    currency: prices.currency || 'INR',
    'base-nightly-price': Math.round(Number(prices.basePrice) || 0),
    'cleaning-fee': Math.round(Number(prices.cleaningFee) || 0),
    'extra-person-fee': Math.round(Number(prices.extraPersonFee) || 0),
    'guests-included': Number(prices.guestsIncludedInRegularFee) || 0,
    'security-deposit': Math.round(Number(prices.securityDepositFee) || 0),
    'weekly-price-factor': prices.weeklyPriceFactor != null ? String(prices.weeklyPriceFactor) : '',
    'monthly-price-factor': prices.monthlyPriceFactor != null ? String(prices.monthlyPriceFactor) : '',
    'minimum-nights': Number(terms.minNights) || 1,
    'maximum-nights': Number(terms.maxNights) || 0,
    'check-in-time': clockTime(listing.defaultCheckInTime),
    'check-out-time': clockTime(listing.defaultCheckOutTime),
    accommodates: Number(listing.accommodates) || 0,
    bedrooms: Number(listing.bedrooms) || 0,
    bathrooms: listing.bathrooms != null ? String(listing.bathrooms) : '',
    beds: Number(listing.beds) || 0,
    'instant-bookable': Boolean(listing.instantBookable ?? listing.isInstantBookable),
    'active-in-guesty': Boolean(listing.active),
    'listed-in-guesty': Boolean(listing.isListed ?? listing.listed),
    'pets-allowed': Boolean(listing.petsAllowed ?? desc.petsAllowed),
    'smoking-allowed': Boolean(listing.smokingAllowed),
    'events-allowed': Boolean(listing.eventsAllowed ?? listing.partiesAllowed),
    'guesty-summary': html(desc.summary),
    'the-space': html(desc.space),
    'guest-access': html(desc.access),
    neighbourhood: html(desc.neighborhood),
    'getting-around': html(desc.transit),
    'other-notes': html(desc.notes),
    'guesty-thumbnail-url': firstPicture(listing) || '',
    'last-synced': new Date().toISOString(),
    'sync-hash': stableHash({
      // Bump MAPPING_VERSION whenever the field mapping changes, so an
      // unchanged Guesty payload still gets rewritten with the new shape.
      v: MAPPING_VERSION,
      t: listing.title,
      n: listing.nickname,
      a: listing.address,
      p: listing.prices,
      tm: listing.terms,
      b: [listing.bedrooms, listing.bathrooms, listing.beds, listing.accommodates],
      d: listing.publicDescription,
      pic: firstPicture(listing),
    }),
  };
}

/** Fields written to the editorial Properties collection on FIRST creation. */
function toPropertyCreateFields(listing, { destinationId, policyId } = {}) {
  const addr = listing.address || {};
  const desc = listing.publicDescription || {};
  const thumb = firstPicture(listing);
  const gallery = galleryUrls(listing);

  return {
    name: singleLine(listing.title || listing.nickname || `Listing ${listing._id}`, 200),
    slug: slugify(listing.title || listing.nickname || listing._id, listing._id),
    location: singleLine(addr.full || [addr.city, addr.state].filter(Boolean).join(', ')),
    'about-home': singleLine(desc.summary, 250),
    ...(thumb ? { thumbnail: { url: thumb } } : {}),
    ...(gallery.length ? { gallery: gallery.map((url) => ({ url })) } : {}),
    'house-rules': html(desc.houseRules),
    'stay-information': html(desc.space),
    'meta-title': singleLine(`${listing.title || listing.nickname} | Viraalay`, 200),
    'meta-description': singleLine(desc.summary, 155),
    ...toPropertyOperationalFields(listing, { destinationId, policyId }),
  };
}

/** How far ahead to look for the "from" price the cards advertise. */
const FROM_PRICE_WINDOW_DAYS = 90;

/**
 * The lowest nightly rate a guest could actually book in the next 90 days.
 *
 * Guesty's `prices.basePrice` is what the CMS used to carry, but this account
 * runs PriceOptimizer: the calendar holds the real, dynamically managed rates
 * and basePrice is a default nobody is charged. Advertising it overstated some
 * homes roughly threefold.
 *
 * Returns null if the calendar cannot be read, so the caller falls back rather
 * than writing a zero over a working price.
 */
async function lowestNightlyRate(listingId) {
  const from = new Date();
  const to = new Date(Date.now() + FROM_PRICE_WINDOW_DAYS * 86400000);
  try {
    const days = await guesty.getCalendar(listingId, ymd(from), ymd(to));
    const rates = days
      // A blocked date's price is not on offer, so it must not set the "from".
      .filter((d) => guesty.isDayAvailable(d))
      .map((d) => Number(d.price))
      .filter((n) => Number.isFinite(n) && n > 0);
    return rates.length ? Math.min(...rates) : null;
  } catch (err) {
    console.warn(`[sync] calendar price unavailable for ${listingId}: ${err.message}`);
    return null;
  }
}

/**
 * Fields refreshed on EVERY sync, even when editorial content is locked.
 * These are all operational: nothing here is copy a human would have written.
 */
function toPropertyOperationalFields(listing, { destinationId, policyId, fromPrice } = {}) {
  const prices = listing.prices || {};
  const terms = listing.terms || {};
  const addr = listing.address || {};

  return {
    'guesty-listing-id': listing._id,
    guests: Number(listing.accommodates) || 0,
    beds: Number(listing.beds) || Number(listing.bedrooms) || 0,
    bedrooms: Number(listing.bedrooms) || 0,
    // Webflow's Number field here is integer precision, so a 5.5-bath villa has
    // to round. Floor rather than round: understating is safer than promising a
    // bathroom that does not exist. The exact value lives on Property Sync.
    baths: Math.floor(Number(listing.bathrooms) || 0),
    // The lowest nightly rate the calendar actually holds, not
    // `prices.basePrice`. This account runs PriceOptimizer, so basePrice is a
    // vestigial default that no guest is ever charged: The Royal Crown carries
    // 18016 there while its calendar for the next 90 days runs 5500–9749. The
    // card renders this under a "Per Night" label, so it has to be a rate
    // somebody could really book. Falls back to basePrice only if the calendar
    // could not be read.
    price: Math.round(Number(fromPrice) || Number(prices.basePrice) || 0),
    'cleaning-fee': Math.round(Number(prices.cleaningFee) || 0),
    currency: prices.currency || 'INR',
    'minimum-nights': Number(terms.minNights) || 1,
    city: addr.city || '',
    latitude: addr.lat != null ? String(addr.lat) : '',
    longitude: addr.lng != null ? String(addr.lng) : '',
    'check-in-time': clockTime(listing.defaultCheckInTime),
    'check-out-time': clockTime(listing.defaultCheckOutTime),
    'instant-bookable': Boolean(listing.instantBookable ?? listing.isInstantBookable),
    'last-synced-from-guesty': new Date().toISOString(),
    ...(destinationId ? { destination: destinationId } : {}),
    ...(policyId ? { 'cancellation-policy-type': policyId } : {}),
  };
}

async function buildLookups() {
  const [destinations, policies] = await Promise.all([
    webflow.listAllItems(C().locations),
    webflow.listAllItems(C().cancellation),
  ]);

  const byCity = new Map();
  for (const d of destinations) {
    const city = (d.fieldData?.city || d.fieldData?.name || '').trim().toLowerCase();
    if (city) byCity.set(city, d);
  }
  const byPolicy = new Map();
  for (const p of policies) {
    const code = (p.fieldData?.['guesty-code'] || p.fieldData?.name || '').trim().toLowerCase();
    if (code) byPolicy.set(code, p);
  }
  return { byCity, byPolicy, destinations };
}

/**
 * Sync every Guesty listing into Webflow.
 * @param {object} opts
 * @param {boolean} opts.createMissingProperties create editorial items for
 *        listings that have no Property yet (as drafts, never auto-published)
 * @param {string[]} opts.onlyListingIds restrict to specific listings
 */
async function syncListings({ createMissingProperties = true, onlyListingIds = null, dryRun = false } = {}) {
  config.assertWebflow();

  const report = {
    startedAt: new Date().toISOString(),
    listingsSeen: 0,
    syncCreated: 0,
    syncUpdated: 0,
    syncSkipped: 0,
    propertiesCreated: 0,
    propertiesUpdated: 0,
    propertiesPublished: 0,
    destinationsPublished: 0,
    destinationsTouched: 0,
    errors: [],
    dryRun,
  };

  const { byCity, byPolicy } = await buildLookups();

  const [syncIndex, propertyIndex] = await Promise.all([
    webflow.indexBy(C().propertySync, 'guesty-listing-id', { ttlMs: 0 }),
    webflow.indexBy(C().properties, 'guesty-listing-id', { ttlMs: 0 }),
  ]);

  // Page through Guesty.
  const listings = [];
  if (onlyListingIds?.length) {
    for (const id of onlyListingIds) {
      try {
        listings.push(await guesty.getListing(id));
      } catch (err) {
        report.errors.push({ listingId: id, error: err.message });
      }
    }
  } else {
    let skip = 0;
    for (;;) {
      const page = await guesty.listListings({ limit: 100, skip });
      const batch = page.results || page.data?.results || page.items || [];
      listings.push(...batch);
      const total = page.count ?? page.total ?? listings.length;
      skip += batch.length;
      if (!batch.length || skip >= total) break;
      await sleep(250);
    }
  }

  report.listingsSeen = listings.length;
  const destinationMembers = new Map();
  // Items whose LIVE copy needs refreshing. A Webflow write only touches the
  // staged copy, so without publishing these the site keeps showing yesterday's
  // prices however often the sync runs.
  const toPublish = new Set();
  const destinationsToPublish = new Set();

  for (const listing of listings) {
    try {
      const city = (listing.address?.city || '').trim().toLowerCase();
      const destination = byCity.get(city) || null;
      const policyCode = String(listing.terms?.cancellation || '').trim().toLowerCase();
      const policy = byPolicy.get(policyCode) || null;

      const existingSync = syncIndex.get(listing._id);
      const existingProperty = propertyIndex.get(listing._id);
      // The lock switch now lives on Properties itself (where editors see it);
      // the copy on Property Sync is still honoured for backwards compatibility.
      const locked =
        Boolean(existingProperty?.fieldData?.['lock-editorial-content']) ||
        Boolean(existingSync?.fieldData?.['lock-editorial-content']);

      const refs = {
        destinationId: destination?.id,
        policyId: policy?.id,
        fromPrice: await lowestNightlyRate(listing._id),
      };

      // --- Properties (editorial) -----------------------------------------
      let propertyItemId = existingProperty?.id || null;

      if (!propertyItemId && createMissingProperties && !dryRun) {
        const created = await webflow.createItem(
          C().properties,
          toPropertyCreateFields(listing, refs),
          { isDraft: true } // new homes stay unpublished until the team reviews them
        );
        propertyItemId = created.id;
        propertyIndex.set(listing._id, created);
        report.propertiesCreated += 1;
      } else if (propertyItemId && !dryRun) {
        const fields = locked
          ? toPropertyOperationalFields(listing, refs)
          : {
              ...toPropertyOperationalFields(listing, refs),
              ...fillEmptyOnly(existingProperty, listing),
            };
        await webflow.updateItem(C().properties, propertyItemId, fields);
        report.propertiesUpdated += 1;
        // Only items already live. A newly created home is deliberately a draft
        // awaiting review, and publishing it here would put it on the site
        // before anyone had looked at it.
        if (!existingProperty?.isDraft) toPublish.add(propertyItemId);
      }

      // --- Property Sync (operational) ------------------------------------
      const syncFields = toSyncFields(listing, {
        destinationId: destination?.id,
        policyId: policy?.id,
        propertyItemId,
      });

      if (existingSync && existingSync.fieldData?.['sync-hash'] === syncFields['sync-hash']) {
        report.syncSkipped += 1;
      } else if (!dryRun) {
        const result = await webflow.upsertByField(
          C().propertySync,
          'guesty-listing-id',
          listing._id,
          syncFields,
          { isDraft: true }
        );
        if (result.action === 'created') report.syncCreated += 1;
        else report.syncUpdated += 1;
      }

      if (destination && propertyItemId) {
        if (!destinationMembers.has(destination.id)) destinationMembers.set(destination.id, []);
        destinationMembers.get(destination.id).push({
          propertyItemId,
          // Same calendar-derived rate the card shows, so a destination's
          // "from" price agrees with the cheapest home listed under it.
          price: Math.round(Number(refs.fromPrice) || Number(listing.prices?.basePrice) || 0),
        });
      }

      await sleep(120); // stay inside Webflow's 60 req/min
    } catch (err) {
      report.errors.push({ listingId: listing?._id, error: err.message });
    }
  }

  // --- Destinations: membership, count and "from" price --------------------
  if (!dryRun) {
    for (const [destId, members] of destinationMembers) {
      try {
        const prices = members.map((m) => m.price).filter((p) => p > 0);
        await webflow.updateItem(C().locations, destId, {
          properties: members.map((m) => m.propertyItemId),
          'property-count': members.length,
          ...(prices.length ? { 'starting-price': Math.min(...prices) } : {}),
        });
        report.destinationsTouched += 1;
        destinationsToPublish.add(destId);
        await sleep(150);
      } catch (err) {
        report.errors.push({ destinationId: destId, error: err.message });
      }
    }
  }

  // --- Publish, or none of the above reaches the live site -----------------
  //
  // Everything up to here wrote the STAGED copy only. Without this the sync
  // could run every six hours forever and a guest would still be quoted the
  // price from whenever somebody last pressed Publish by hand.
  if (!dryRun) {
    try {
      if (toPublish.size) {
        await webflow.publishItems(C().properties, [...toPublish]);
        report.propertiesPublished = toPublish.size;
      }
      if (destinationsToPublish.size) {
        await webflow.publishItems(C().locations, [...destinationsToPublish]);
        report.destinationsPublished = destinationsToPublish.size;
      }
    } catch (err) {
      // The data is written and correct; only the live copy is stale. Report it
      // rather than failing the whole run — the next sync retries.
      report.errors.push({ stage: 'publish', error: err.message });
    }
  }

  report.finishedAt = new Date().toISOString();
  webflow.invalidateIndex(C().propertySync);
  webflow.invalidateIndex(C().properties);
  return report;
}

/**
 * Only fill editorial fields that are still blank, so the sync can enrich a
 * half-finished item without ever clobbering finished copy.
 */
function fillEmptyOnly(existingProperty, listing) {
  const f = existingProperty.fieldData || {};
  const desc = listing.publicDescription || {};
  const out = {};
  const thumb = firstPicture(listing);
  const gallery = galleryUrls(listing);

  if (!f.location) out.location = singleLine(listing.address?.full);
  if (!f['about-home'] && desc.summary) out['about-home'] = singleLine(desc.summary, 250);
  if (!f.thumbnail && thumb) out.thumbnail = { url: thumb };
  if ((!f.gallery || !f.gallery.length) && gallery.length) out.gallery = gallery.map((url) => ({ url }));
  if (!f['house-rules'] && desc.houseRules) out['house-rules'] = html(desc.houseRules);
  if (!f['stay-information'] && desc.space) out['stay-information'] = html(desc.space);
  if (!f['meta-description'] && desc.summary) out['meta-description'] = singleLine(desc.summary, 155);
  return out;
}

/**
 * Webflow -> Guesty. Only a deliberately narrow set of fields is pushed back,
 * because Guesty is the system of record for anything that affects money or
 * availability. Letting a CMS edit change a nightly rate would be a great way
 * to sell a villa for nothing.
 */
const PUSHABLE = {
  title: (fd) => fd.name,
  'publicDescription.summary': (fd) => stripHtml(fd['about-home']),
};

/**
 * Webflow item changed -> push the narrow editable set to Guesty.
 *
 * **This MUST no-op when nothing actually differs.** It used to push title and
 * summary on every event regardless of whether they had changed, which closed a
 * loop with the webhooks: a Webflow write fired `collection_item_changed`, this
 * pushed to Guesty, Guesty fired `listing.updated`, that ran the Guesty ->
 * Webflow sync, which wrote to Webflow and fired the next round. Observed live
 * on 2026-07-23 running flat out until it exhausted Webflow's 60-a-minute
 * budget — which also starved every other write, including the real sync.
 *
 * Comparing before writing breaks the cycle at its first hop: the second round
 * finds Guesty already holding these values and stops.
 */
async function pushPropertyToGuesty(propertyItem) {
  const fd = propertyItem.fieldData || {};
  const listingId = fd['guesty-listing-id'];
  if (!listingId) return { skipped: 'no_listing_id' };

  const title = PUSHABLE.title(fd);
  const summary = PUSHABLE['publicDescription.summary'](fd);
  if (!title && !summary) return { skipped: 'nothing_to_push' };

  let current;
  try {
    current = await guesty.getListing(listingId);
  } catch (err) {
    // Cannot prove a difference, so do not write — a blind push is what caused
    // the loop. The next scheduled sync will pick this up.
    console.warn(`[sync] cannot read ${listingId} to compare before push: ${err.message}`);
    return { skipped: 'compare_failed', listingId };
  }

  const patch = {};
  if (title && title !== current.title) patch.title = title;
  if (summary && summary !== (current.publicDescription || {}).summary) {
    patch.publicDescription = { summary };
  }

  if (!Object.keys(patch).length) return { skipped: 'already_in_sync', listingId };

  await guesty.updateListing(listingId, patch);
  return { pushed: Object.keys(patch), listingId };
}

function stripHtml(value) {
  return String(value || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

module.exports = {
  syncListings,
  pushPropertyToGuesty,
  toSyncFields,
  toPropertyCreateFields,
  toPropertyOperationalFields,
};
