'use strict';

/**
 * Editorial content for the Viraalay properties, transcribed from
 * "Niharika x Viraalay working document.docx".
 *
 * Keyed by Webflow slug. Six doc sections cover eleven of the sixteen Guesty
 * listings, because the five BlueRoot rooms and four Lakecity apartments are
 * individually-let units of one building each.
 *
 * Anything not in the doc (The Brindha Villa, Anavya Chilli Farm Villa) is
 * left to the Guesty description the sync already wrote — no invented copy.
 */

const HOUSE_RULES_STANDARD = [
  'Please be considerate by maintaining reasonable noise levels, especially between 10PM and 7AM. Avoid hosting loud parties or events on the property.',
  'Smoking is only permitted in clearly demarcated, designated areas.',
  'Chewing tobacco is strictly prohibited with no exceptions.',
  'Daily cleaning of our rooms is compulsory. Kindly coordinate with our caretakers for a seamless experience.',
  'Pets are not allowed on the property.',
  'Kindly adhere to the maximum occupancy limit. Any additional guests must be approved by management beforehand. Tariffs are levied on standard occupancy; additional guests attract an extra charge.',
  'Guests are responsible for any damages and subsequent repairs during their stay. Restoration charges may apply. Kindly pledge to move through the property with care.',
  'Ensure all doors and windows are duly locked when leaving the property unattended.',
];

const HORIZON = {
  tagline: 'Wake where the horizon seems endless…',
  about:
    'The Horizon Villa unfolds as a study in sophistication. Designed for 10 guests with a maximum occupancy of 15, it is nestled amidst the tranquil landscape of Udaipur, Rajasthan. Fully furnished with 5 bedrooms, 2 bathrooms, 2 living rooms, a modular kitchen, lush garden, and swimming pool. Begin your day with a fresh breakfast basket in the garden, spend leisurely afternoons lounging by the pool, and savour a glowing bonfire and barbecue at sundown. The contemporary architecture exudes quiet calm moulded in earth-like accents with an occasional pop of colour.',
  glance: ['5 bedrooms', '5 bathrooms', '2 living rooms', '1 kitchen', 'Outdoor swimming pool', 'Lush garden', 'Occupancy: 10 guests', 'Maximum occupancy: 15 guests', 'Family friendly'],
  docAmenities: ['Air conditioned', 'Balcony', 'Work / study space', 'Wi-fi', 'CCTV', 'Geyser', 'Power back-up', 'First aid kit', 'Iron', 'Wardrobe', 'Oven', 'Microwave', 'Toaster', 'Mixer / Grinder', 'Kettle', 'Dishwasher', 'Washing machine', 'Water purifier', 'Crockery / Cutlery', '8-seater dining area', 'Indoor bar', 'Indoor games', 'Outdoor swimming pool', "Children's swimming pool", 'Garden', 'Wooden swing for play', 'Parking'],
  houseRules: HOUSE_RULES_STANDARD,
  transfers: ['Maharana Pratap Airport (27.3 km)', 'Udaipur Railway Junction (10 km)', 'Thoor Bus Stand (8.9 km)'],
  attractions: ['City Palace (8.5 km)', 'Fateh Sagar Lake (6.2 km)', 'Haldighati (34.9 km)', 'Kumbhalgarh (74 km)', 'Ekling Ji Temple (22.7 km)', 'Sajjan Garh Fort (9.3 km)', 'Karni Mata Temple (10.1 km)'],
  restaurants: ['UPRE Roof Top (7.8 km)', 'Panna Vilas Restaurant & Lounge (5.8 km)', 'Shilpgram (2.5 km)'],
  rooms: [
    { name: 'Living Room 1', highlight: '450 sq ft', summary: 'Ground floor living room with a 75" smart TV and pool access.', detail: ['450 sq ft', 'Situated on the ground floor', 'Includes a 75" smart TV, plush sofa sets, pouffes and a centre table', 'Air conditioned with pool access'] },
    { name: 'Living Room 2', highlight: '450 sq ft', summary: 'First floor living room with bean bags and an attached balcony.', detail: ['450 sq ft', 'Situated on the first floor', 'Includes plush sofa sets, bean bags, pouffes, and a centre table', 'Air conditioned with an attached balcony'] },
    { name: 'Kitchen', highlight: 'Modular', summary: 'Ground floor modular kitchen with ample storage.', detail: ['Situated on the ground floor', 'Modular with ample storage space'] },
    { name: 'Dining Area', highlight: '8-seater', summary: 'Luxury 8-seater dining alongside an indoor bar setup.', detail: ['Situated on the ground floor', 'Luxury 8-seater experience', 'Alongside an indoor bar setup with stools'] },
    { name: 'Swimming Pool', highlight: '350 sq ft', summary: 'Private outdoor pool with a light fountain, child friendly.', detail: ['350 sq ft', 'Private outdoor pool area with an exorbitant light fountain', 'Child friendly'] },
    { name: 'Garden', highlight: '800 sq ft', summary: 'Garden with a seating area and a wooden lounge swing.', detail: ['800 sq ft', 'Equipped with a seating area and a wooden lounge swing'] },
    { name: 'Bedroom 1', highlight: 'Hill view', summary: 'First floor king bedroom with a hill view and private balcony.', detail: ['Situated on the first floor with a hill view', 'King-sized bed', 'Includes a dressing room, wardrobe space, sofa chairs, and a centre table', 'Air conditioned with an independent study workspace, attached balcony and seating', 'Ensuite bathroom with organic toiletries'] },
    { name: 'Bedroom 2', highlight: 'King bed', summary: 'First floor king bedroom with study workspace and balcony.', detail: ['Situated on the first floor', 'King-sized bed', 'Includes a dressing room, wardrobe space, sofa chairs, and a centre table', 'Air conditioned with an independent study workspace, attached balcony and seating', 'Ensuite bathroom with organic toiletries'] },
    { name: 'Bedroom 3', highlight: 'King bed', summary: 'First floor king bedroom with study workspace and balcony.', detail: ['Situated on the first floor', 'King-sized bed', 'Includes a dressing room, wardrobe space, sofa chairs, and a centre table', 'Air conditioned, with an independent study workspace and an attached balcony with seating', 'Ensuite bathroom with organic toiletries'] },
    { name: 'Bedroom 4', highlight: 'Garden view', summary: 'Ground floor king bedroom with direct garden access.', detail: ['Situated on the ground floor with a garden view', 'King-sized bed', 'Includes wardrobe space, sofa chairs, and a centre table', 'Air conditioned with garden access', 'Ensuite bathroom with organic toiletries'] },
    { name: 'Bedroom 5', highlight: 'King bed', summary: 'Ground floor king bedroom with an independent study workspace.', detail: ['Situated on the ground floor', 'King-sized bed', 'Includes wardrobe space, sofa chairs, and a centre table', 'Air conditioned, with an independent study workspace', 'Ensuite bathroom with organic toiletries'] },
  ],
};

const BLUE_ROOT = {
  tagline: 'Rooted in heritage. Wrapped in relaxing blue…',
  about:
    'Indulge in old-world Rajasthani romance at our heritage Blue Root Villa. A structure that endures with grace, intertwining generational tradition and modern-day living in perfect symphony. Relish high-tea with a book beneath a cosy green canopy by day, and revel in a candle-lit dinner by night. This villa is testimony to the respectful preservation of an estate etched in eternal stories — a living archive of culture that builds a bridge connecting past and present.',
  glance: ['5 bedrooms', '5 bathrooms', '1 living room', 'Open kitchen for candlelight dinners', 'High-tea', 'Occupancy: 10 guests', 'Maximum occupancy: 15 guests', 'Family friendly'],
  docAmenities: ['Air conditioned', 'Organic toiletries', 'Wi-fi', 'Geyser', 'Power back-up', 'Indoor games', 'Washing Machine'],
  houseRules: HOUSE_RULES_STANDARD,
  transfers: ['Maharana Pratap Airport (21 km)', 'Udaipur Railway Junction (3 km)', 'Fatehpura Bus Stand (4 km)'],
  attractions: ['City Palace (1 km)', 'Fateh Sagar Lake (4 km)', 'Kumbhalgarh (82 km)', 'Ekling Ji Temple (21 km)', 'Sajjan Garh Fort (8 km)', 'Karni Mata Temple (2.5 km)'],
  restaurants: ['UPRE Roof Top (1.5 km)', 'Rani Road Restaurant (3 km)', 'Shilpgram (6 km)', 'Panna Vilas (3 km)'],
  rooms: [
    { name: 'Darikhana', highlight: 'Audience hall', summary: 'A spacious ground-floor reception hall with handcrafted furniture.', detail: ['Darikhana translates to a spacious audience hall, guest room or reception area', 'Situated on the ground floor', 'Complemented by opulent handcrafted furniture evoking a serene aesthetic'] },
    { name: 'Badi Medhi', highlight: 'Upper terrace', summary: 'Fully furnished room with a plush queen-sized bed off the main terrace.', detail: ['Badi Medhi translates to the main or upper terrace', 'Fully furnished with a plush queen-sized bed', 'Mornings wrapped in the quiet hum of an easy day'] },
    { name: 'Choti Medhi', highlight: 'First floor', summary: 'A private sanctuary for both business and leisure, with a double bed.', detail: ['Situated on the first floor', 'Fully furnished with a comfortable double bed', 'A private sanctuary for both business and leisure'] },
    { name: 'Ori', highlight: 'Heritage room', summary: 'A traditional heritage chamber within the haveli.', detail: ['A traditional heritage chamber within the haveli'] },
  ],
};

const ROYAL_CROWN = {
  tagline: 'A regal apartment where elegance reigns…',
  about:
    'Perched in the heart of the city, The Royal Crown Apartment is a priceless jewel in Jaipur’s treasury. This home balances privacy with togetherness, and relaxation with productivity. A place of restoration and calm return after drifting through Rajasthan’s vibrant, bustling streets.',
  special:
    'A fully serviced apartment for guests seeking warmth without straying from the pulse of the city. Spacious yet intimate, designed for uninterrupted workflows, high-performing professionals, and the joy of shared living.',
  glance: ['3 bedrooms', '3 ensuite bathrooms', '1 living room', '1 kitchen', 'Occupancy: 6 guests', 'Maximum occupancy: 8 guests', 'Family friendly', 'Business trip friendly'],
  docAmenities: ['Air conditioned', 'Balcony', 'Dedicated workspace', 'Dining area', 'Lounge', 'Smart TV', 'Wi-fi', 'Geyser', 'Organic toiletries', 'Power back-up', 'Parking'],
  houseRules: HOUSE_RULES_STANDARD,
  transfers: ['Jaipur International Airport (1.5 km)', 'Durgapura Metro, under construction (1.5 km)', 'New Atish Market Subway Station (6 km)', 'Vivek Vihar Subway Station (6 km)', 'Nearest Bus Stand (44 km)'],
  attractions: ['Birla Planetarium (7 km)', 'Museum Of Indology (7 km)', 'Statue Circle (7 km)', 'City Palace (9 km)', 'Hawa Mahal, Palace of Winds (10 km)', 'Nahargarh Fort Palace (13 km)', 'Jalmahal (13 km)', 'Seesh Mahal (19 km)', 'Amer Fort (19 km)'],
  restaurants: ['Murli Tiffin Center (100 m)', 'Shri Shyam Restaurant (1.2 km)', 'Crazy Coffee cafe and bar (100 m)'],
  nearby: ['Mahal Palace Golden Garden (200 m)', 'Shree Vihar Park (650 m)', 'Mehta Garden (800 m)', 'Jain Park (900 m)', 'Municipal Park Jaipur (1.1 km)', 'Jawahar Circle Udyan (1.3 km)'],
  rooms: [
    { name: 'Master Bedroom', highlight: 'Ensuite', summary: 'King bedroom with ensuite bathroom and organic toiletries.', detail: ['King-sized bed', 'Ensuite bathroom with organic toiletries', 'Air conditioned with wardrobe space'] },
    { name: 'Second Bedroom', highlight: 'Ensuite', summary: 'Comfortable ensuite bedroom with a dedicated workspace.', detail: ['Queen-sized bed', 'Ensuite bathroom', 'Air conditioned with a dedicated workspace'] },
    { name: 'Third Bedroom', highlight: 'Ensuite', summary: 'Ensuite bedroom suited to families or colleagues sharing.', detail: ['Twin or queen configuration', 'Ensuite bathroom', 'Air conditioned with wardrobe space'] },
    { name: 'Living Room', highlight: 'Lounge', summary: 'Lounge with a smart TV opening onto the balcony.', detail: ['Plush sofa seating with a smart TV', 'Opens onto the balcony', 'Air conditioned'] },
  ],
};

const MAJESTIC_CROWN = {
  tagline: 'A distinguished address…',
  about:
    'A fully-serviced luxury apartment in Jaipur’s metropolitan centre, an inviting atmosphere of sophisticated elegance. A contemporary retreat with tasteful furnishings crafted for gentle sunlight.',
  special:
    'An apartment which values both momentum and stillness. The Majestic Crown facilitates business through design dedicated to maximise workspeed. Once the office day elapses, unwind by the opulent balcony — a front-row seat to a dusky Jaipur sunset.',
  glance: ['3 bedrooms', '3 ensuite bathrooms', '1 living room', '1 kitchen', 'Occupancy: 6 guests', 'Maximum occupancy: 8 guests', 'Family friendly', 'Business trip friendly'],
  docAmenities: ['Air conditioned', 'Balcony', 'Dedicated workspace', 'Dining area', 'Lounge', 'Smart TV', 'Wi-fi', 'Geyser', 'Organic toiletries', 'Power back-up', 'Parking'],
  houseRules: HOUSE_RULES_STANDARD,
  transfers: ROYAL_CROWN.transfers,
  attractions: ROYAL_CROWN.attractions,
  restaurants: ROYAL_CROWN.restaurants,
  nearby: ROYAL_CROWN.nearby,
  rooms: [
    { name: 'Master Bedroom', highlight: 'Ensuite', summary: 'King bedroom with ensuite bathroom and balcony access.', detail: ['King-sized bed', 'Ensuite bathroom with organic toiletries', 'Air conditioned with balcony access'] },
    { name: 'Second Bedroom', highlight: 'Ensuite', summary: 'Ensuite bedroom with a dedicated workspace.', detail: ['Queen-sized bed', 'Ensuite bathroom', 'Air conditioned with a dedicated workspace'] },
    { name: 'Living Room', highlight: 'Lounge', summary: 'Lounge with a smart TV and an opulent balcony.', detail: ['Plush sofa seating with a smart TV', 'Opens onto the opulent balcony', 'Air conditioned'] },
  ],
};

const LAKE_CITY = {
  tagline: 'Awaken to the City of Lakes…',
  about:
    'Mere moments from the Fateh Sagar Lake, The Lake City Apartment is an ode to quintessential Udaipur living. Plush, snug sofa sets and a balcony painted in soothing vistas of the Aravalli Hills.',
  special:
    'The Lake City Apartment allows guests to immerse themselves in Udaipur’s energetic city existence entirely. Once the hustle-bustle fades, discover the quiet pleasure of returning to an apartment that feels like your own.',
  glance: ['2 bedrooms', '2 bathrooms', '1 living room', '1 kitchen', 'Occupancy: 4 guests', 'Maximum occupancy: 6 guests', 'Family friendly', 'Business trip friendly'],
  docAmenities: ['Air conditioned', 'Wi-fi', 'Balcony', 'Dining area', 'Storage', 'Refrigerator', 'Iron', 'Microwave', 'Toaster', 'Cutlery', 'Induction', 'Kettle', 'Water purifier / RO', 'Geyser', 'Organic toiletries', 'Power back-up', 'Indoor games', 'Caretaker', 'Parking'],
  houseRules: [
    'Please be considerate and avoid hosting loud parties or events on the property.',
    ...HOUSE_RULES_STANDARD.slice(1),
  ],
  transfers: ['Maharana Pratap Airport (29 km)', 'Jawahar Nagar Railway Station (8.5 km)', 'Thoor Bus Stand (7.6 km)'],
  attractions: ['Fateh Sagar Lake (5 km)', 'Sajjan Garh Fort (10 km)', 'Lake Pichola (8.9 km)', 'Karni Mata Temple (8.9 km)', 'Kumbhalgarh (75.2 km)', 'Haldighati (35.7 km)'],
  restaurants: ['Upre (8.7 km)', 'Botanic Cafe (6.8 km)', 'The Lily Court Cafe (9.9 km)'],
  rooms: [
    { name: 'Master Bedroom', highlight: 'Aravalli view', summary: 'Air-conditioned bedroom with wardrobe space and hill views.', detail: ['Air conditioned with wardrobe space', 'Views towards the Aravalli Hills'] },
    { name: 'Second Bedroom', highlight: 'Air conditioned', summary: 'Comfortable second bedroom with ample storage.', detail: ['Air conditioned', 'Ample storage'] },
    { name: 'Living Room', highlight: 'Balcony', summary: 'Snug sofa sets opening onto a balcony with hill vistas.', detail: ['Plush, snug sofa sets', 'Balcony with vistas of the Aravalli Hills'] },
  ],
};

const KVANYA = {
  tagline: 'A private estate that alters how you experience time…',
  about:
    'Standing tall on the gentle Udaipur terrain, Kvanya Villa is a private luxury estate unfolding opulently, weaving its way into daily luxury living. Allow your mornings to melt away basking in sunlight swims, quieten the world’s noise at noon lost in the library, and revel in an abundant feast that tastes sweeter when shared with loved ones.',
  special:
    'Some homes impress, while some alter the way you experience time. Plunge into an azure swimming pool, awaken the cinema buff in you reclined at the home theatre, and sip on an inventive golden hour cocktail. Expansive living spaces with gorgeous views that require no introduction.',
  glance: ['5 bedrooms', '5 bathrooms', '1 living room', '1 kitchen (rasoi)', 'Occupancy: 10 guests', 'Maximum occupancy: 16 guests', 'Private swimming pool', 'Home theatre', 'Library'],
  docAmenities: ['Air conditioned', 'Wi-fi', 'Swimming pool', 'Home theatre', 'Library', 'Power back-up', 'Parking', 'Organic toiletries'],
  houseRules: HOUSE_RULES_STANDARD,
  transfers: ['Maharana Pratap Airport (32 km)', 'Udaipur Railway Junction (11 km)'],
  attractions: ['City Palace (11 km)', 'Lake Pichola (11 km)', 'Fateh Sagar Lake (12 km)', 'Sajjan Garh Fort (14 km)'],
  restaurants: ['Upre (11 km)', 'Ambrai (11 km)'],
  rooms: [
    { name: 'Bedroom 1', highlight: 'King bed', summary: 'King bedroom with ensuite bathroom and estate views.', detail: ['King-sized bed', 'Ensuite bathroom with organic toiletries', 'Air conditioned with wardrobe space'] },
    { name: 'Bedroom 2', highlight: 'King bed', summary: 'King bedroom with ensuite bathroom.', detail: ['King-sized bed', 'Ensuite bathroom with organic toiletries', 'Air conditioned'] },
    { name: 'Bedroom 3', highlight: 'King bed', summary: 'King bedroom with ensuite bathroom.', detail: ['King-sized bed', 'Ensuite bathroom with organic toiletries', 'Air conditioned'] },
    { name: 'Bedroom 4', highlight: 'Queen bed', summary: 'Queen bedroom with ensuite bathroom.', detail: ['Queen-sized bed', 'Ensuite bathroom', 'Air conditioned'] },
    { name: 'Bedroom 5', highlight: 'Queen bed', summary: 'Queen bedroom with ensuite bathroom.', detail: ['Queen-sized bed', 'Ensuite bathroom', 'Air conditioned'] },
    { name: 'Home Theatre', highlight: 'Private cinema', summary: 'A private cinema room for premieres and long evenings.', detail: ['Dedicated home theatre system', 'Reclined seating for a private premiere'] },
    { name: 'Library', highlight: 'Quiet room', summary: 'A quiet library to lose the afternoon in.', detail: ['A quiet reading room', 'Where the world’s noise falls away at noon'] },
    { name: 'Swimming Pool', highlight: 'Azure pool', summary: 'A private azure swimming pool for sunlight swims.', detail: ['Private outdoor swimming pool', 'Sunlight swims through the morning'] },
    { name: 'Rasoi (Kitchen)', highlight: 'Full kitchen', summary: 'A full working kitchen for abundant shared feasts.', detail: ['Fully equipped kitchen', 'Built for abundant feasts shared with loved ones'] },
  ],
};

/** Webflow slug -> doc section. */
const BY_SLUG = {
  'the-horizon-villa-by-viraalay-premium-5bhk-villa': HORIZON,
  'the-blue-root-by-viraalay-5-bed-heritage-home-villa-in-udaipur': BLUE_ROOT,
  'the-royal-crown-3bhk-luxury-home-by-viraalay': ROYAL_CROWN,
  'the-majestic-crown-2bhk-luxury-home-by-viraalay': MAJESTIC_CROWN,
  'kvanya-mansion-by-viraalay-luxe-5bhk-villa-in-udaipur': KVANYA,
  'comfy-2bhk-at-lakecity-apartments-by-viraalay': LAKE_CITY,
  'homely-2bhk-at-lakecity-apartments-by-viraalay': LAKE_CITY,
  'premium-2bhk-at-lakecity-apartments-by-viraalay': LAKE_CITY,
  'smart-2bhk-at-lakecity-apartments-by-viraalay': LAKE_CITY,
};

/**
 * The five BlueRoot listings are individual rooms inside the Blue Root haveli,
 * so they inherit the building's location content but not its room list.
 */
const BLUE_ROOT_ROOM_SLUGS = [
  'blueroot-heritage-home-cozy-room-old-city-udaipur',
  'blueroot-heritage-home-intimate-old-city-room',
  'blueroot-heritage-home-large-room-old-city-udaipur',
  'blueroot-heritage-home-spacious-room-old-city',
  'blueroot-heritage-home-upchic-french-style-room',
];

for (const slug of BLUE_ROOT_ROOM_SLUGS) {
  BY_SLUG[slug] = {
    ...BLUE_ROOT,
    rooms: [],
    glance: ['1 private room', 'Ensuite or shared bathroom', 'Within the Blue Root heritage haveli', 'Family friendly'],
  };
}

module.exports = { BY_SLUG, HOUSE_RULES_STANDARD };
