'use strict';

/**
 * Imports guest reviews from Guesty into the Webflow Reviews collection and
 * rolls the scores up onto each property.
 *
 *   npm run sync-reviews                 dry run
 *   npm run sync-reviews -- --confirm    apply
 *   npm run sync-reviews -- --confirm --placeholders
 *       also seeds sample reviews for listings with none yet
 *
 * Real reviews come from Guesty (`GET /reviews`) — Airbnb ratings, category
 * breakdowns, guest names and review text. Those are genuine and are marked
 * Source: "Airbnb via Guesty".
 *
 * `--placeholders` fills the gap for listings that have no reviews yet. Those
 * items get **Placeholder? = ON** and the guest name is prefixed "Sample —" so
 * nobody mistakes them for real guest feedback. Delete them, or filter on the
 * switch, before launch. Re-running the import never touches them.
 */

const fs = require('fs');
const path = require('path');
const webflow = require('../src/lib/webflow');
const guesty = require('../src/lib/guesty');
const { config } = require('../src/config');
const { sleep, slugify } = require('../src/lib/util');

const CONFIRM = process.argv.includes('--confirm');
const PLACEHOLDERS = process.argv.includes('--placeholders');
const C = config.webflow.collections;
const REVIEWS = '6a5a5f4c194856c6b6f5ea98';

const round1 = (n) => Math.round(n * 10) / 10;
const single = (v, max) =>
  String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, max);

/** Airbnb's six categories mapped onto the four the site displays. */
function categoryAverages(reviews) {
  const cats = {};
  for (const r of reviews) {
    for (const c of r.rawReview?.category_ratings || []) {
      (cats[c.category] = cats[c.category] || []).push(Number(c.rating) || 0);
    }
  }
  const avg = (k) =>
    cats[k] && cats[k].length ? cats[k].reduce((a, b) => a + b, 0) / cats[k].length : null;
  const overall =
    reviews.reduce((s, r) => s + (Number(r.rawReview?.overall_rating) || 0), 0) / reviews.length;

  const staffParts = [avg('communication'), avg('checkin')].filter((n) => n != null);
  const expParts = [avg('accuracy'), avg('value')].filter((n) => n != null);

  return {
    overall: round1(overall),
    clean: avg('cleanliness') != null ? round1(avg('cleanliness')) : round1(overall),
    staff: staffParts.length ? round1(staffParts.reduce((a, b) => a + b, 0) / staffParts.length) : round1(overall),
    experience: expParts.length ? round1(expParts.reduce((a, b) => a + b, 0) / expParts.length) : round1(overall),
    // Airbnb has no meals category, so this mirrors the overall score rather
    // than inventing a number. Replace once direct-booking reviews exist.
    meals: round1(overall),
  };
}

/** A short summary built only from what guests actually wrote. */
function summarise(reviews) {
  const texts = reviews.map((r) => String(r.rawReview?.public_review || '')).filter(Boolean);
  if (!texts.length) return '';
  const blob = texts.join(' ').toLowerCase();
  const themes = [
    [/clean|spotless|well.maintained|well maintained/, 'spotless housekeeping'],
    [/caretaker|staff|host|housekeeper|attentive|courteous/, 'attentive on-site staff'],
    [/location|prime location|close by|central/, 'a convenient location'],
    [/view|ambience|vibe|beautiful|stunning|charm/, 'the setting and ambience'],
    [/food|meal|tea|yummy|breakfast/, 'the food'],
    [/comfort|cosy|cozy|relax|warm/, 'how comfortable it feels'],
    [/family|kids/, 'family stays'],
    [/communication|as described|exactly as/, 'accurate listings and quick communication'],
  ]
    .filter(([re]) => re.test(blob))
    .map(([, label]) => label);

  const n = reviews.length;
  const avg = round1(
    reviews.reduce((s, r) => s + (Number(r.rawReview?.overall_rating) || 0), 0) / n
  );
  const lead = `${n} verified guest${n === 1 ? '' : 's'} rated this home ${avg} out of 5.`;
  if (!themes.length) return single(lead, 250);
  const list =
    themes.length === 1
      ? themes[0]
      : `${themes.slice(0, -1).join(', ')} and ${themes[themes.length - 1]}`;
  return single(`${lead} Guests most often mention ${list}.`, 250);
}

const PLACEHOLDER_REVIEWS = [
  { name: 'Sample — Aarav M.', rating: 5, short: 'A beautifully kept home with a genuinely warm team.', long: 'Sample review text for design purposes. Replace with a real guest review before launch. The home was exactly as described and the on-site team were quick to help with everything we asked for.' },
  { name: 'Sample — Priya R.', rating: 5, short: 'Spotless, comfortable and easy to settle into.', long: 'Sample review text for design purposes. Replace with a real guest review before launch. Check-in was straightforward, the rooms were spotless and the location worked well for us.' },
  { name: 'Sample — Kabir S.', rating: 4, short: 'Comfortable stay, would return.', long: 'Sample review text for design purposes. Replace with a real guest review before launch. A comfortable stay overall with helpful staff and good value for the price.' },
];

async function main() {
  const listings = JSON.parse(
    fs.readFileSync(path.join(__dirname, '..', 'backups', 'guesty-listings-raw.json'), 'utf8')
  );

  // Pull reviews fresh so a re-run picks up anything new.
  let reviews = [];
  let skip = 0;
  for (;;) {
    const r = await guesty.call('openApi', '/reviews', { query: { limit: 100, skip }, label: 'reviews' });
    const rows = r.results || r.data || [];
    reviews.push(...rows);
    const total = r.count ?? r.total ?? reviews.length;
    skip += rows.length;
    if (!rows.length || skip >= total) break;
  }
  reviews = reviews.filter((r) => r.rawReview && !r.rawReview.hidden);
  console.log(`Guesty returned ${reviews.length} visible reviews`);

  // Guest names
  const guestIds = [...new Set(reviews.map((r) => r.guestId).filter(Boolean))];
  const names = {};
  for (const g of guestIds) {
    try {
      const gg = await guesty.call('openApi', `/guests/${g}`, { label: 'guest' });
      names[g] = gg.fullName || [gg.firstName, gg.lastName].filter(Boolean).join(' ') || 'Guest';
    } catch {
      names[g] = 'Guest';
    }
    await sleep(60);
  }

  const properties = (await webflow.listAllItems(C.properties)).filter(
    (p) => p.fieldData['guesty-listing-id']
  );
  const propByListing = new Map(properties.map((p) => [p.fieldData['guesty-listing-id'], p]));

  const existing = await webflow.listAllItems(REVIEWS);
  const byGuestyId = new Map(
    existing.filter((r) => r.fieldData['guesty-review-id']).map((r) => [r.fieldData['guesty-review-id'], r])
  );
  const bySlug = new Map(existing.map((r) => [r.fieldData.slug, r]));

  const byListing = {};
  reviews.forEach((r) => {
    if (propByListing.has(r.listingId)) (byListing[r.listingId] = byListing[r.listingId] || []).push(r);
  });

  console.log(
    `${Object.keys(byListing).length} of ${properties.length} properties have real reviews\n`
  );

  const reviewIdsByProperty = new Map();
  let created = 0;
  let updated = 0;

  // --- real reviews --------------------------------------------------------
  for (const [listingId, rows] of Object.entries(byListing)) {
    const prop = propByListing.get(listingId);
    const ids = [];
    for (const r of rows) {
      const raw = r.rawReview;
      const guest = names[r.guestId] || 'Guest';
      const text = single(raw.public_review, 1000) || 'No written review left.';
      const slug = slugify(`review-${r._id}`);
      const fieldData = {
        name: single(`${guest} — ${text}`, 120),
        slug,
        'guest-name': single(guest, 80),
        'short-review': single(text, 140),
        'long-review': single(text, 1000),
        'rating-value': Number(raw.overall_rating) || 5,
        property: prop.id,
        'property-stayed-in': [prop.id],
        'review-date': raw.submitted_at || r.createdAt || null,
        source: `${r.channelId === 'airbnb2' ? 'Airbnb' : r.channelId || 'Direct'} via Guesty`,
        'guesty-review-id': r._id,
        placeholder: false,
        featured: (Number(raw.overall_rating) || 0) >= 5,
      };
      const hit = byGuestyId.get(r._id) || bySlug.get(slug);
      if (hit) {
        ids.push(hit.id);
        if (CONFIRM) {
          await webflow.updateItem(REVIEWS, hit.id, fieldData);
          updated += 1;
          await sleep(120);
        }
      } else if (CONFIRM) {
        const c = await webflow.createItem(REVIEWS, fieldData, { isDraft: false });
        ids.push(c.id);
        bySlug.set(slug, c);
        created += 1;
        await sleep(140);
      } else {
        created += 1;
      }
    }
    reviewIdsByProperty.set(prop.id, ids);
  }

  // --- placeholders for properties with none -------------------------------
  if (PLACEHOLDERS) {
    for (const prop of properties) {
      if ((reviewIdsByProperty.get(prop.id) || []).length) continue;
      const ids = [];
      for (let i = 0; i < PLACEHOLDER_REVIEWS.length; i += 1) {
        const t = PLACEHOLDER_REVIEWS[i];
        const slug = slugify(`sample-${prop.fieldData.slug}-${i + 1}`);
        const fieldData = {
          name: single(`${t.name} — ${prop.fieldData.name}`, 120),
          slug,
          'guest-name': t.name,
          'short-review': t.short,
          'long-review': t.long,
          'rating-value': t.rating,
          property: prop.id,
          'property-stayed-in': [prop.id],
          'review-date': new Date().toISOString(),
          source: 'Placeholder — not a real review',
          placeholder: true,
          featured: false,
        };
        const hit = bySlug.get(slug);
        if (hit) {
          ids.push(hit.id);
        } else if (CONFIRM) {
          const c = await webflow.createItem(REVIEWS, fieldData, { isDraft: false });
          ids.push(c.id);
          bySlug.set(slug, c);
          created += 1;
          await sleep(140);
        } else {
          created += 1;
        }
      }
      reviewIdsByProperty.set(prop.id, ids);
      // Placeholder scores are flat 4.7 so they read as obviously synthetic.
      prop._placeholderScores = { overall: 4.7, clean: 4.7, staff: 4.7, experience: 4.7, meals: 4.7, count: 3 };
    }
  }

  // --- roll up onto the properties ----------------------------------------
  let rolled = 0;
  for (const prop of properties) {
    const rows = byListing[prop.fieldData['guesty-listing-id']] || [];
    const ids = reviewIdsByProperty.get(prop.id) || [];
    let scores;
    let count;
    if (rows.length) {
      scores = categoryAverages(rows);
      count = rows.length;
    } else if (prop._placeholderScores) {
      scores = prop._placeholderScores;
      count = 3;
    } else {
      continue;
    }

    const patch = {
      'average-rating': scores.overall,
      'total-number-of-ratings': count,
      'clean-rating': scores.clean,
      'staff-rating': scores.staff,
      'experience-rating': scores.experience,
      'meals-rating': scores.meals,
      'review-ai-summary': rows.length
        ? summarise(rows)
        : 'Sample summary for design purposes — this property has no guest reviews yet.',
      ...(ids.length ? { reviews: ids } : {}),
    };

    if (!CONFIRM) {
      console.log(
        `  ${String(prop.fieldData.slug).slice(0, 44).padEnd(46)} avg=${scores.overall} n=${count} ${rows.length ? 'REAL' : 'placeholder'}`
      );
      rolled += 1;
      continue;
    }
    try {
      await webflow.updateItem(C.properties, prop.id, patch);
      rolled += 1;
      console.log(`  ${String(prop.fieldData.slug).slice(0, 44).padEnd(46)} avg=${scores.overall} n=${count}`);
    } catch (err) {
      console.error(`  ! ${prop.fieldData.slug}: ${err.message.slice(0, 160)}`);
    }
    await sleep(150);
  }

  console.log(
    `\n${CONFIRM ? 'Done' : 'Dry run'}: ${created} review(s) created, ${updated} updated, ${rolled} properties rolled up.`
  );

  if (CONFIRM) {
    const all = await webflow.listAllItems(REVIEWS);
    if (all.length) await webflow.publishItems(REVIEWS, all.map((r) => r.id));
    const props = await webflow.listAllItems(C.properties);
    await webflow.publishItems(C.properties, props.map((p) => p.id));
    console.log('Published.');
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
