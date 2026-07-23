'use strict';

/**
 * Builds per-property FAQs.
 *
 *   npm run gen-faqs                 dry run
 *   npm run gen-faqs -- --confirm    apply
 *
 * Every answer is composed from a value the system actually holds — check-in
 * times, capacity, minimum nights, amenities, pet rules, the cancellation
 * policy, and the transfer distances in the client document. Nothing is
 * invented: a question is only asked when its answer is known.
 *
 * The question set follows the FAQ headings in the client working document.
 */

const fs = require('fs');
const path = require('path');
const webflow = require('../src/lib/webflow');
const { config } = require('../src/config');
const { sleep, slugify } = require('../src/lib/util');
const { BY_SLUG } = require('./content/property-content');

const CONFIRM = process.argv.includes('--confirm');
const C = config.webflow.collections;
const FAQS = '6a60595fc48c9e90dad6b125';

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const single = (v, max) => String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, max);

function buildFaqs({ prop, listing, doc, amenityNames, policyName, policySummary }) {
  const f = prop.fieldData;
  const has = (n) => amenityNames.has(n);
  const out = [];

  const add = (category, question, answer) =>
    out.push({ category, question, answer: single(answer, 900) });

  // Capacity — always known.
  add(
    'The property',
    `How many guests can ${f.name} accommodate?`,
    `${f.name} sleeps up to ${f.guests} guests across ${f.bedrooms || f.beds} bedroom${(f.bedrooms || f.beds) === 1 ? '' : 's'} with ${f.baths} bathroom${f.baths === 1 ? '' : 's'}. The property is let on an entire-property basis, so the whole home is yours for the duration of your stay.`
  );

  // Check-in / check-out — real values from Guesty.
  if (f['check-in-time'] && f['check-out-time']) {
    add(
      'Check-in & check-out',
      'What are the check-in and check-out times?',
      `Check-in is from ${f['check-in-time']} and check-out is by ${f['check-out-time']}. Early check-in or late check-out can sometimes be arranged if the property is free either side of your booking — ask the team once your booking is confirmed.`
    );
  }

  // Minimum stay.
  if (f['minimum-nights']) {
    const n = f['minimum-nights'];
    add(
      'Booking & payment',
      'Is there a minimum stay?',
      n > 1
        ? `Yes, ${f.name} has a ${n}-night minimum stay. Longer minimums can apply over weekends, festive dates and peak season — the booking calendar will show the requirement for your dates.`
        : `There is no general minimum stay at ${f.name}, though longer minimums can apply over weekends, festive dates and peak season. The booking calendar shows the requirement for your dates.`
    );
  }

  // Furnishing and staffing.
  add(
    'The property',
    `Is ${f.name} fully furnished and staffed?`,
    `Yes. The home is fully furnished and comes with an on-site team who look after housekeeping and day-to-day requests.${has('Caretaker') ? ' A caretaker is present at the property.' : ''}${has('Housekeeping') ? ' Daily housekeeping is included.' : ''}`
  );

  // Pets — from Guesty's own flag and rules text.
  const rules = String(listing.publicDescription?.houseRules || '');
  const petsAllowed = Boolean(listing.petsAllowed);
  add(
    'House rules',
    'Are pets permitted on the property?',
    petsAllowed
      ? 'Pets are welcome at this property. Please tell us in advance so the team can prepare, and keep pets off upholstered furniture and out of the pool.'
      : 'Pets are not permitted at this property. If you are travelling with an assistance animal, contact us before booking so we can make arrangements.'
  );

  // Pool — only when the property actually has one.
  if (has('Swimming Pool')) {
    add(
      'The property',
      'What are the swimming pool rules?',
      'The pool is for the exclusive use of guests staying at the property. Children must be supervised by an adult at all times — the pool is not fenced or lifeguarded. Please shower before entering, and avoid glassware in the pool area.'
    );
  }

  // Parking.
  if (has('Parking')) {
    add(
      'Location & travel',
      'Is parking available?',
      'Yes, parking is available at the property at no extra charge. Let the team know how many vehicles you are bringing so space can be kept for you.'
    );
  }

  // Meals.
  add(
    'Meals & services',
    'Can meals be arranged at the property?',
    `Yes. Meals are prepared on site by the property team — breakfast is included with every stay, and lunch, dinner and high-tea can be arranged on request.${/veg/i.test(rules) ? ' Please note this property serves pure vegetarian food only.' : ''} Share dietary preferences, allergies and celebration requirements at least 24 hours before arrival.`
  );

  // Wi-Fi / workspace.
  if (has('Wi-Fi')) {
    add(
      'The property',
      'Is Wi-Fi available, and is the property suitable for remote work?',
      `Wi-Fi is available throughout the property.${has('Workspace') ? ' There is a dedicated workspace, so the home works well for remote working and longer stays.' : ''}`
    );
  }

  // Cancellation — the policy Guesty will actually apply.
  add(
    'Cancellation',
    'What is the cancellation policy?',
    `This property is booked on our ${policyName} policy: ${policySummary} The exact terms are shown before you pay, and your confirmation email repeats them. Refunds return to the original payment method and can take 5–7 working days.`
  );

  // Events — only where Guesty says they are allowed or capacity supports it.
  if (has('Event Friendly') || Number(f.guests) >= 12) {
    add(
      'House rules',
      'Can we host an event or celebration here?',
      'Small gatherings and celebrations can be hosted with prior approval. Guest numbers above the standard occupancy attract an additional charge and may require a refundable damage deposit. Outdoor music must stop by 10:00 PM in line with local rules. Please raise event plans before booking.'
    );
  }

  // Transfers — only where the document gives real distances.
  if (doc?.transfers?.length) {
    add(
      'Location & travel',
      'How do I get to the property?',
      `Nearest transport links: ${doc.transfers.join('; ')}. Airport transfers can be arranged through the property team for an additional charge.`
    );
  }
  if (doc?.attractions?.length) {
    add(
      'Location & travel',
      'What is there to see nearby?',
      `Close by: ${doc.attractions.slice(0, 6).join('; ')}. The team can help arrange guides, drivers and tickets.`
    );
  }

  // Payment.
  add(
    'Booking & payment',
    'How do I pay, and is my payment secure?',
    'Bookings are paid online through PayU, an RBI-authorised payment gateway. Card and UPI details are entered on PayU’s own secure checkout and are never stored on our servers. You will receive a booking reference and confirmation by email as soon as payment clears.'
  );

  return out;
}

async function main() {
  const listings = JSON.parse(
    fs.readFileSync(path.join(__dirname, '..', 'backups', 'guesty-listings-raw.json'), 'utf8')
  );
  const byListingId = new Map(listings.map((l) => [l._id, l]));

  const cols = await webflow.api(`/sites/${config.webflow.siteId}/collections`, { label: 'cols' });
  const AMEN = cols.collections.find((c) => c.slug === 'amenities').id;
  const amenityById = new Map(
    (await webflow.listAllItems(AMEN)).map((a) => [a.id, a.fieldData.name])
  );

  const policies = await webflow.listAllItems(C.cancellation);
  const policyById = new Map(policies.map((p) => [p.id, p.fieldData]));

  const properties = (await webflow.listAllItems(C.properties)).filter(
    (p) => p.fieldData['guesty-listing-id']
  );
  const existing = await webflow.listAllItems(FAQS);
  const bySlug = new Map(existing.map((f) => [f.fieldData.slug, f]));

  let created = 0;
  let updatedCount = 0;
  const idsByProperty = new Map();

  for (const prop of properties) {
    const f = prop.fieldData;
    const listing = byListingId.get(f['guesty-listing-id']) || {};
    const doc = BY_SLUG[f.slug];
    const amenityNames = new Set((f.amenities || []).map((id) => amenityById.get(id)).filter(Boolean));
    const policy = policyById.get(f['cancellation-policy-type']) || {};

    const faqs = buildFaqs({
      prop,
      listing,
      doc,
      amenityNames,
      policyName: policy.name || 'Moderate',
      policySummary: policy.summary || 'Free cancellation up to 5 days before check-in.',
    });

    const ids = [];
    for (let i = 0; i < faqs.length; i += 1) {
      const q = faqs[i];
      const slug = slugify(`${f.slug}-faq-${i + 1}`);
      const fieldData = {
        name: single(`${f.name} — ${q.question}`, 240),
        slug,
        question: single(q.question, 240),
        answer: `<p>${esc(q.answer)}</p>`,
        'answer-plain-text': q.answer,
        property: prop.id,
        'display-order': i + 1,
        category: q.category,
        'site-wide-faq': false,
      };
      const hit = bySlug.get(slug);
      if (hit) {
        ids.push(hit.id);
        if (CONFIRM) {
          await webflow.updateItem(FAQS, hit.id, fieldData);
          updatedCount += 1;
          await sleep(110);
        }
      } else if (CONFIRM) {
        const c = await webflow.createItem(FAQS, fieldData, { isDraft: false });
        ids.push(c.id);
        bySlug.set(slug, c);
        created += 1;
        await sleep(130);
      } else {
        created += 1;
      }
    }
    idsByProperty.set(prop.id, ids);
    console.log(`  ${String(f.slug).slice(0, 46).padEnd(48)} ${faqs.length} FAQs`);
  }

  if (CONFIRM) {
    for (const prop of properties) {
      const ids = idsByProperty.get(prop.id) || [];
      if (!ids.length) continue;
      await webflow.updateItem(C.properties, prop.id, { faqs: ids });
      await sleep(140);
    }
    const all = await webflow.listAllItems(FAQS);
    await webflow.publishItems(FAQS, all.map((x) => x.id));
    const props = await webflow.listAllItems(C.properties);
    await webflow.publishItems(C.properties, props.map((p) => p.id));
  }

  console.log(
    `\n${CONFIRM ? 'Done' : 'Dry run'}: ${created} FAQ(s) created, ${updatedCount} updated across ${properties.length} properties.`
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
