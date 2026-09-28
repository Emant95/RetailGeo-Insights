import type * as T from './types';
import type { MemorySnapshot } from './memory-store';
import { priceLine, computeTotals } from './pricing';

/**
 * Deterministic beta seed for the pilot markets (Dallas–Fort Worth, Houston, Austin).
 * All names are fictional. Dates are relative to "now" so the data always looks current.
 * Used by `npm run db:seed` (PostgreSQL) and by the browser demo (in-memory store).
 */
export const DEMO_PASSWORD = 'RetailGeo2026';
export const DEMO_ACCOUNTS = [
  { email: 'maya@retailgeo.demo', name: 'Maya Reyes', role: 'consumer' as const, label: 'Shopper' },
  { email: 'dan@retailgeo.demo', name: 'Dan Okafor', role: 'merchant_admin' as const, label: 'Store owner' },
  { email: 'sam@retailgeo.demo', name: 'Sam Patel', role: 'store_employee' as const, label: 'Store employee' },
  { email: 'ops@retailgeo.demo', name: 'Alex Chen', role: 'platform_admin' as const, label: 'Platform admin' },
  { email: 'jo@retailgeo.demo', name: 'Jo Martinez', role: 'platform_support' as const, label: 'Ops & support' },
];

function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function generateSeed(opts: { passwordHash: string; now?: Date; seed?: number }): MemorySnapshot {
  const rand = rng(opts.seed ?? 20260928);
  const now = opts.now ?? new Date();
  const hex = (n: number) => Array.from({ length: n }, () => Math.floor(rand() * 16).toString(16)).join('');
  const id = () => `${hex(8)}-${hex(4)}-4${hex(3)}-${'89ab'[Math.floor(rand() * 4)]}${hex(3)}-${hex(12)}`;
  const pick = <V>(arr: V[]) => arr[Math.floor(rand() * arr.length)];
  const between = (a: number, b: number) => a + rand() * (b - a);
  const ago = (days: number, hours = 0) => new Date(now.getTime() - days * 86400_000 - hours * 3600_000).toISOString();
  const iso = now.toISOString();

  const tables = ['users', 'userRoles', 'sessions', 'authTokens', 'businesses', 'stores', 'storeHours', 'storeUsers', 'markets', 'categories', 'brands', 'products', 'variants', 'storeProducts', 'inventoryEvents', 'offers', 'addresses', 'carts', 'cartItems', 'orders', 'orderItems', 'statusHistory', 'storeOrders', 'storeOrderItems', 'payments', 'paymentTransactions', 'notifications', 'favorites', 'supportTickets', 'searchEvents', 'analyticsEvents', 'auditLogs', 'settings', 'searchIndex'] as const;
  const S = {} as Record<(typeof tables)[number], any[]>;
  for (const t of tables) (S as any)[t] = [];
  const push = <K extends keyof MemorySnapshot>(t: K, row: any) => ((S as any)[t].push(row), row);

  // ── Markets
  const markets = [
    { name: 'Dallas–Fort Worth', state: 'TX', latitude: 32.85, longitude: -96.97, radiusMi: 45, status: 'active' },
    { name: 'Houston', state: 'TX', latitude: 29.76, longitude: -95.37, radiusMi: 30, status: 'active' },
    { name: 'Austin', state: 'TX', latitude: 30.27, longitude: -97.74, radiusMi: 25, status: 'active' },
    { name: 'San Antonio', state: 'TX', latitude: 29.4241, longitude: -98.4936, radiusMi: 30, status: 'planned' },
  ].map((m) => push('markets', { id: id(), ...m, createdAt: ago(120), updatedAt: ago(30) }) as T.GeographicMarket);
  const [DFW, HOU, AUS] = markets;

  // ── Users
  const mkUser = (email: string, fullName: string, createdDays: number, extra: Partial<T.User> = {}): T.User =>
    push('users', {
      id: id(), email, passwordHash: opts.passwordHash, fullName, phone: `(214) 555-${String(1000 + Math.floor(rand() * 8999))}`, status: 'active',
      emailVerifiedAt: ago(createdDays), mfaEnabled: false, failedLogins: 0, lockedUntil: null, marketingConsent: rand() > 0.5, locationSharing: true,
      deletedAt: null, createdAt: ago(createdDays), updatedAt: ago(createdDays / 2), ...extra,
    });
  const role = (userId: string, r: T.RoleKey, businessId: string | null = null) => push('userRoles', { id: id(), userId, role: r, businessId, createdAt: ago(60) });

  const maya = mkUser('maya@retailgeo.demo', 'Maya Reyes', 64);
  role(maya.id, 'consumer');
  const dan = mkUser('dan@retailgeo.demo', 'Dan Okafor', 110);
  role(dan.id, 'consumer');
  const sam = mkUser('sam@retailgeo.demo', 'Sam Patel', 80);
  role(sam.id, 'consumer');
  const ops = mkUser('ops@retailgeo.demo', 'Alex Chen', 200, { mfaEnabled: true });
  role(ops.id, 'platform_admin');
  const jo = mkUser('jo@retailgeo.demo', 'Jo Martinez', 150);
  role(jo.id, 'platform_support');

  const firstNames = ['Olivia', 'Liam', 'Ava', 'Noah', 'Sofia', 'Mateo', 'Harper', 'Ethan', 'Camila', 'James', 'Zoe', 'Diego', 'Nora', 'Caleb', 'Priya', 'Marcus', 'Leah', 'Tyler', 'Grace', 'Andre'];
  const lastNames = ['Nguyen', 'Johnson', 'Garcia', 'Williams', 'Kim', 'Brown', 'Hernandez', 'Davis', 'Lopez', 'Wilson', 'Thompson', 'Moore', 'Jackson', 'Lee', 'Walker'];
  const shoppers = [maya];
  for (let i = 0; i < 22; i++) {
    const fn = firstNames[i % firstNames.length];
    const ln = pick(lastNames);
    const u = mkUser(`${fn.toLowerCase()}.${ln.toLowerCase()}${i}@example.com`, `${fn} ${ln}`, Math.floor(between(5, 90)));
    role(u.id, 'consumer');
    shoppers.push(u);
  }

  // ── Categories
  const catDefs: [string, string, string[]][] = [
    ['Grocery', 'basket', ['Beverages', 'Snacks', 'Dairy & Eggs', 'Produce', 'Bakery', 'Pantry', 'Frozen & Ice', 'International Foods']],
    ['Health & Pharmacy', 'pill', ['Pain & Fever', 'Cold & Allergy', 'Vitamins', 'Personal Care', 'First Aid']],
    ['Household', 'home', ['Cleaning', 'Paper Goods', 'Home & Hardware']],
    ['Automotive', 'car', ['Motor Oil & Fluids', 'Car Care']],
    ['Baby', 'baby', ['Diapers & Wipes', 'Baby Food']],
    ['Pet', 'paw', ['Dog', 'Cat']],
    ['Electronics', 'bolt', ['Phone Accessories', 'Batteries']],
  ];
  const cat: Record<string, T.Category> = {};
  catDefs.forEach(([name, icon, subs], i) => {
    const parent = push('categories', { id: id(), parentId: null, name, slug: slug(name), sort: i, icon }) as T.Category;
    cat[name] = parent;
    subs.forEach((s, j) => (cat[s] = push('categories', { id: id(), parentId: parent.id, name: s, slug: slug(s), sort: j, icon })));
  });

  // ── Brands & products (fictional brands)
  const brandNames = ['Lone Star Springs', 'Red River', 'Pecan Grove', 'Brazos Valley', 'Bluebonnet', 'Prairie Kettle', 'Longhorn Provisions', 'Rio Verde', 'Cowtown', 'Sunbelt', 'Volt', 'Gulf Coast', 'Hill Country', 'Caddo Farms', 'Trinity Home', 'Mesa Health', 'Northstar', 'Little Acorn', 'Ranch Hand Pet', 'Circuit Line', 'Kolache Kitchen', 'Seoul Street', 'Masa Real', 'RoadReady', 'CleanWell'];
  const brand: Record<string, T.Brand> = {};
  for (const b of brandNames) brand[b] = push('brands', { id: id(), name: b });

  type PDef = [name: string, brand: string, category: string, size: string | null, priceCents: number, unit?: string, attrs?: Record<string, string | number | boolean>];
  const pdefs: PDef[] = [
    ['Spring Water 24-Pack', 'Lone Star Springs', 'Beverages', '24 × 16.9 fl oz', 599, 'pack', { container: 'plastic bottle' }],
    ['Spring Water', 'Lone Star Springs', 'Beverages', '1 gal', 179],
    ['Classic Cola', 'Red River', 'Beverages', '20 fl oz', 229, 'bottle'],
    ['Classic Cola 12-Pack', 'Red River', 'Beverages', '12 × 12 fl oz cans', 799, 'pack'],
    ['Cold Brew Coffee', 'Pecan Grove', 'Beverages', '11 fl oz', 349],
    ['Orange Juice, No Pulp', 'Sunbelt', 'Beverages', '52 fl oz', 449],
    ['Sweet Tea', 'Bluebonnet', 'Beverages', '1 gal', 399],
    ['Energy Drink, Citrus', 'Volt', 'Beverages', '16 fl oz', 299],
    ['Sparkling Water, Lime 8-Pack', 'Gulf Coast', 'Beverages', '8 × 12 fl oz', 549],
    ['Sports Drink, Glacier', 'Hill Country', 'Beverages', '28 fl oz', 219],
    ['Kettle Chips, Sea Salt', 'Prairie Kettle', 'Snacks', '8 oz', 429],
    ['Beef Jerky, Original', 'Longhorn Provisions', 'Snacks', '3.25 oz', 799],
    ['Trail Mix, Texas Pecan', 'Pecan Grove', 'Snacks', '10 oz', 649],
    ['Tortilla Chips, Restaurant Style', 'Rio Verde', 'Snacks', '13 oz', 399],
    ['Salsa, Medium', 'Rio Verde', 'Snacks', '16 oz', 349],
    ['Milk Chocolate Bar', 'Cowtown', 'Snacks', '1.5 oz', 169],
    ['Whole Milk', 'Brazos Valley', 'Dairy & Eggs', '1 gal', 389],
    ['2% Reduced Fat Milk', 'Brazos Valley', 'Dairy & Eggs', '½ gal', 259],
    ['Large Grade A Eggs', 'Caddo Farms', 'Dairy & Eggs', '12 ct', 349],
    ['Sharp Cheddar', 'Brazos Valley', 'Dairy & Eggs', '8 oz', 399],
    ['Greek Yogurt, Plain', 'Brazos Valley', 'Dairy & Eggs', '32 oz', 579],
    ['Salted Butter', 'Brazos Valley', 'Dairy & Eggs', '1 lb', 479],
    ['Bananas', 'Caddo Farms', 'Produce', 'per lb', 69, 'lb'],
    ['Hass Avocado', 'Caddo Farms', 'Produce', 'each', 129],
    ['Limes', 'Caddo Farms', 'Produce', 'each', 35],
    ['Roma Tomatoes', 'Caddo Farms', 'Produce', 'per lb', 149, 'lb'],
    ['Yellow Onions', 'Caddo Farms', 'Produce', '3 lb bag', 299],
    ['Strawberries', 'Caddo Farms', 'Produce', '1 lb', 399],
    ['Sausage & Cheese Kolaches 6-Pack', 'Kolache Kitchen', 'Bakery', '6 ct', 899],
    ['Fruit Kolaches 6-Pack', 'Kolache Kitchen', 'Bakery', '6 ct', 849],
    ['White Sandwich Bread', 'Pecan Grove', 'Bakery', '20 oz', 299],
    ['Flour Tortillas', 'Masa Real', 'Bakery', '10 ct', 329],
    ['Long Grain White Rice', 'Pecan Grove', 'Pantry', '5 lb', 549],
    ['Pinto Beans', 'Rio Verde', 'Pantry', '2 lb', 279],
    ['Extra Virgin Olive Oil', 'Hill Country', 'Pantry', '16.9 fl oz', 899],
    ['Ground Coffee, Medium Roast', 'Pecan Grove', 'Pantry', '12 oz', 799],
    ['Creamy Peanut Butter', 'Pecan Grove', 'Pantry', '16 oz', 349],
    ['Spaghetti', 'Hill Country', 'Pantry', '1 lb', 179],
    ['Pepperoni Pizza', 'Cowtown', 'Frozen & Ice', '12 in', 699],
    ['Bagged Ice', 'Lone Star Springs', 'Frozen & Ice', '10 lb', 299],
    ['Vanilla Bean Ice Cream', 'Bluebonnet', 'Frozen & Ice', '1 pt', 549],
    ['Masa Harina', 'Masa Real', 'International Foods', '4.4 lb', 499],
    ['Jasmine Rice', 'Seoul Street', 'International Foods', '5 lb', 899],
    ['Napa Cabbage Kimchi', 'Seoul Street', 'International Foods', '16 oz', 749],
    ['Ibuprofen 200 mg Tablets', 'Mesa Health', 'Pain & Fever', '100 ct', 899, 'bottle', { activeIngredient: 'ibuprofen', strengthMg: 200 }],
    ['Acetaminophen 500 mg Caplets', 'Mesa Health', 'Pain & Fever', '100 ct', 849, 'bottle', { activeIngredient: 'acetaminophen', strengthMg: 500 }],
    ['Allergy Relief Loratadine 10 mg', 'Mesa Health', 'Cold & Allergy', '30 ct', 1299, 'box', { activeIngredient: 'loratadine', strengthMg: 10 }],
    ['Cough Syrup, Honey', 'Mesa Health', 'Cold & Allergy', '8 fl oz', 999],
    ['Vitamin D3 2000 IU', 'Northstar', 'Vitamins', '90 ct', 1049],
    ['Daily Multivitamin', 'Northstar', 'Vitamins', '100 ct', 1199],
    ['Sunscreen SPF 50', 'Mesa Health', 'Personal Care', '6 fl oz', 1149],
    ['Fluoride Toothpaste', 'CleanWell', 'Personal Care', '4.8 oz', 399],
    ['Adhesive Bandages', 'Mesa Health', 'First Aid', '30 ct', 449],
    ['Hand Sanitizer', 'CleanWell', 'First Aid', '8 fl oz', 349],
    ['Electrolyte Powder Sticks', 'Hill Country', 'First Aid', '6 ct', 899],
    ['Dish Soap', 'CleanWell', 'Cleaning', '22 fl oz', 349],
    ['Laundry Detergent', 'CleanWell', 'Cleaning', '64 loads', 1399],
    ['All-Purpose Cleaner', 'CleanWell', 'Cleaning', '32 fl oz', 449],
    ['Paper Towels 6 Rolls', 'Trinity Home', 'Paper Goods', '6 rolls', 1099],
    ['Bath Tissue 12 Rolls', 'Trinity Home', 'Paper Goods', '12 rolls', 1299],
    ['Kitchen Trash Bags 13 gal', 'Trinity Home', 'Paper Goods', '40 ct', 999],
    ['LED Light Bulbs A19', 'Trinity Home', 'Home & Hardware', '4-pack', 899],
    ['Duct Tape', 'Trinity Home', 'Home & Hardware', '20 yd', 749],
    ['Outdoor Extension Cord', 'Trinity Home', 'Home & Hardware', '25 ft', 1999],
    ['Box Fan', 'Trinity Home', 'Home & Hardware', '20 in', 3299],
    ['Charcoal Briquets', 'Longhorn Provisions', 'Home & Hardware', '15.4 lb', 1299],
    ['Full Synthetic Motor Oil 5W-30', 'RoadReady', 'Motor Oil & Fluids', '5 qt', 2899],
    ['Windshield Washer Fluid', 'RoadReady', 'Motor Oil & Fluids', '1 gal', 399],
    ['Antifreeze/Coolant 50/50', 'RoadReady', 'Motor Oil & Fluids', '1 gal', 1499],
    ['Digital Tire Pressure Gauge', 'RoadReady', 'Car Care', 'each', 1299],
    ['Diapers Size 3', 'Little Acorn', 'Diapers & Wipes', '84 ct', 2799],
    ['Baby Wipes, Unscented', 'Little Acorn', 'Diapers & Wipes', '3 × 80 ct', 899],
    ['Infant Formula', 'Little Acorn', 'Baby Food', '12.4 oz', 2199],
    ['Adult Dry Dog Food, Chicken', 'Ranch Hand Pet', 'Dog', '15 lb', 2499],
    ['Clumping Cat Litter', 'Ranch Hand Pet', 'Cat', '20 lb', 1299],
    ['USB-C Charging Cable', 'Circuit Line', 'Phone Accessories', '6 ft', 1299],
    ['Dual USB Car Charger', 'Circuit Line', 'Phone Accessories', 'each', 1499],
    ['Portable Power Bank 10,000 mAh', 'Circuit Line', 'Phone Accessories', 'each', 2999],
    ['AA Alkaline Batteries', 'Circuit Line', 'Batteries', '8-pack', 999],
    ['AAA Alkaline Batteries', 'Circuit Line', 'Batteries', '8-pack', 999],
  ];
  const upc = (n: number) => {
    const base = `0${String(840000 + n).padStart(6, '0')}${String(1000 + n * 7).slice(-4)}`.slice(0, 11);
    const digits = base.split('').map(Number);
    const sum = digits.reduce((s, d, i) => s + d * (i % 2 === 0 ? 3 : 1), 0);
    return base + ((10 - (sum % 10)) % 10);
  };
  const products: (T.Product & { base: number; parent: string })[] = pdefs.map(([name, b, c, size, price, unit, attrs], i) => {
    const category = cat[c];
    const parent = Object.values(cat).find((x) => x.id === category.parentId)!;
    const p: T.Product = {
      id: id(), categoryId: category.id, brandId: brand[b].id, name, slug: slug(`${b} ${name}`), description: describe(name, b, size),
      upc: upc(i + 1), sku: `RG-${parent.slug.slice(0, 3).toUpperCase()}-${String(i + 101)}`, unit: unit ?? 'each', size,
      attributes: { ...(attrs ?? {}) }, images: [], status: 'active', createdByStoreId: null, deletedAt: null, createdAt: ago(100), updatedAt: ago(20),
    };
    push('products', p);
    return { ...p, base: price, parent: parent.name };
  });
  // Variants on a couple of products
  const diapers = products.find((p) => p.name === 'Diapers Size 3')!;
  for (const [n, s] of [['Size 1', '1'], ['Size 2', '2'], ['Size 4', '4']]) push('variants', { id: id(), productId: diapers.id, name: n, sku: `${diapers.sku}-${s}`, upc: null, attributes: { size: s } });
  const cable = products.find((p) => p.name === 'USB-C Charging Cable')!;
  for (const [n, s] of [['3 ft', '3'], ['10 ft', '10']]) push('variants', { id: id(), productId: cable.id, name: n, sku: `${cable.sku}-${s}`, upc: null, attributes: { length: `${s} ft` } });
  // One product pending moderation + one likely duplicate for the admin queue
  push('products', { id: id(), categoryId: cat['Beverages'].id, brandId: brand['Lone Star Springs'].id, name: 'Spring Water 24 Pack', slug: 'spring-water-24-pack-dup', description: 'Submitted by a merchant.', upc: null, sku: 'OCB-WATER-24', unit: 'pack', size: '24 × 16.9 fl oz', attributes: {}, images: [], status: 'pending_review', createdByStoreId: null, deletedAt: null, createdAt: ago(1), updatedAt: ago(1) });

  // ── Businesses & stores
  const streets = ['Main St', 'Elm St', 'Commerce St', 'Ross Ave', 'Gaston Ave', 'Swiss Ave', 'Live Oak St', 'Greenville Ave', 'Mockingbird Ln', 'Preston Rd', 'Lemmon Ave', 'Cedar Springs Rd', 'Davis St', 'Jefferson Blvd', 'Belt Line Rd', 'Camp Bowie Blvd', 'Magnolia Ave', 'Westheimer Rd', 'Congress Ave', 'Lamar Blvd'];
  type SDef = [name: string, type: T.StoreType, lat: number, lng: number, city: string, county: string, zip: string, market: T.GeographicMarket, desc: string];
  const sdefs: SDef[] = [
    ['Trinity Fresh Market', 'grocery', 32.8262, -96.744, 'Dallas', 'Dallas', '75214', DFW, 'Neighborhood grocer on Abrams with a full produce wall, local dairy and a hot kolache case every morning.'],
    ['Trinity Fresh Express', 'convenience', 32.7847, -96.7802, 'Dallas', 'Dallas', '75226', DFW, 'Grab-and-go sister store to Trinity Fresh Market, open late for Deep Ellum.'],
    ['Bluebonnet Fuel & Go', 'gas_station', 32.813, -96.819, 'Dallas', 'Dallas', '75219', DFW, 'Twelve pumps, clean restrooms, cold drinks and ice. Open 24 hours.'],
    ['Lone Star Pharmacy', 'pharmacy', 32.801, -96.801, 'Dallas', 'Dallas', '75204', DFW, 'Independent Uptown pharmacy. Over-the-counter medicine, vitamins and everyday essentials.'],
    ['Cedar Springs Corner Mart', 'convenience', 32.809, -96.8105, 'Dallas', 'Dallas', '75219', DFW, 'Corner store with snacks, drinks, household basics and phone chargers.'],
    ['Bishop Arts Provisions', 'specialty', 32.749, -96.829, 'Dallas', 'Dallas', '75208', DFW, 'Specialty pantry: masa, imported staples, cold brew and small-batch snacks.'],
    ['Greenville Avenue Grocer', 'grocery', 32.8335, -96.7705, 'Dallas', 'Dallas', '75206', DFW, 'Full-service grocery with a wholesale desk for neighboring shops.'],
    ['Mockingbird Wellness Pharmacy', 'pharmacy', 32.837, -96.772, 'Dallas', 'Dallas', '75206', DFW, 'Pharmacy and wellness shop near Mockingbird Station.'],
    ['White Rock Quick Stop', 'gas_station', 32.841, -96.727, 'Dallas', 'Dallas', '75214', DFW, 'Fuel, ice and trail snacks on the way to White Rock Lake.'],
    ['Preston Hollow Market', 'grocery', 32.895, -96.803, 'Dallas', 'Dallas', '75230', DFW, 'Upscale neighborhood market with a large dairy and bakery section.'],
    ['NorthPark Home & Hardware', 'retail', 32.869, -96.773, 'Dallas', 'Dallas', '75231', DFW, 'Hardware, home basics, fans, cords and car care.'],
    ['Lake Highlands Fuel Center', 'gas_station', 32.893, -96.721, 'Dallas', 'Dallas', '75243', DFW, 'Fuel and convenience with a kolache counter.'],
    ['Richardson Asian Market', 'specialty', 32.948, -96.732, 'Richardson', 'Dallas', '75080', DFW, 'Pan-Asian grocery: rice, kimchi, noodles and produce.'],
    ['Plano Family Pharmacy', 'pharmacy', 33.02, -96.7, 'Plano', 'Collin', '75074', DFW, 'Family-owned pharmacy serving East Plano since 1998.'],
    ['Legacy Fresh Foods', 'grocery', 33.078, -96.815, 'Plano', 'Collin', '75024', DFW, 'West Plano grocer near Legacy West.'],
    ['Frisco Main Street Mercantile', 'retail', 33.15, -96.823, 'Frisco', 'Collin', '75034', DFW, 'General store for home, pet and electronics basics.'],
    ['Las Colinas Express Mart', 'convenience', 32.874, -96.946, 'Irving', 'Dallas', '75038', DFW, 'Office-district convenience store with coffee and snacks.'],
    ['Irving Petro & Deli', 'gas_station', 32.842, -96.99, 'Irving', 'Dallas', '75038', DFW, 'Truck-friendly fuel stop with a deli and cold case.'],
    ['Arlington Entertainment District Mart', 'convenience', 32.751, -97.082, 'Arlington', 'Tarrant', '76011', DFW, 'Game-day supplies steps from the stadiums.'],
    ['Grand Prairie Mercado', 'grocery', 32.746, -97.0, 'Grand Prairie', 'Dallas', '75050', DFW, 'Mercado with fresh tortillas, produce and pantry staples.'],
    ['Stockyards General Store', 'specialty', 32.789, -97.349, 'Fort Worth', 'Tarrant', '76164', DFW, 'Jerky, snacks and Texas-made goods in the Stockyards.'],
    ['Magnolia Avenue Market', 'grocery', 32.73, -97.334, 'Fort Worth', 'Tarrant', '76104', DFW, 'Near Southside grocery with local bakery goods.'],
    ['Near Southside Pharmacy', 'pharmacy', 32.733, -97.324, 'Fort Worth', 'Tarrant', '76104', DFW, 'Neighborhood pharmacy and health essentials.'],
    ['Mesquite Travel Center', 'gas_station', 32.79, -96.615, 'Mesquite', 'Dallas', '75150', DFW, 'I-635 travel center: fuel, motor oil, ice and snacks.'],
    ['Garland Neighborhood Pantry', 'convenience', 32.912, -96.64, 'Garland', 'Dallas', '75040', DFW, 'Everyday essentials for Garland families.'],
    ['Carrollton Farmers Grocery', 'grocery', 32.954, -96.89, 'Carrollton', 'Dallas', '75006', DFW, 'Produce-forward grocery near Old Downtown Carrollton.'],
    ['Denton Square Supply', 'retail', 33.215, -97.133, 'Denton', 'Denton', '76201', DFW, 'Hardware and home supply on the Square.'],
    ['Montrose Market Hall', 'grocery', 29.745, -95.39, 'Houston', 'Harris', '77006', HOU, 'Montrose grocery with prepared foods.'],
    ['Heights Corner Pharmacy', 'pharmacy', 29.798, -95.399, 'Houston', 'Harris', '77008', HOU, 'Pharmacy on 19th Street in the Heights.'],
    ['Midtown Fuel Stop', 'gas_station', 29.742, -95.378, 'Houston', 'Harris', '77002', HOU, 'Fuel and cold drinks in Midtown.'],
    ['South Congress Grocery Co.', 'grocery', 30.248, -97.75, 'Austin', 'Travis', '78704', AUS, 'SoCo grocery with local produce and tacos to go.'],
    ['Hyde Park Neighborhood Mart', 'convenience', 30.306, -97.727, 'Austin', 'Travis', '78751', AUS, 'Walkable corner store for Hyde Park.'],
    ['Barton Springs Fuel', 'gas_station', 30.261, -97.77, 'Austin', 'Travis', '78704', AUS, 'Fuel, ice and sunscreen on the way to the springs.'],
  ];

  const ownerBiz = push('businesses', { id: id(), legalName: 'Trinity Fresh Markets LLC', dbaName: 'Trinity Fresh', einLast4: '4821', ownerUserId: dan.id, status: 'approved', contactEmail: 'dan@retailgeo.demo', contactPhone: '(214) 555-0142', reviewNotes: null, reviewedBy: ops.id, reviewedAt: ago(100), createdAt: ago(105), updatedAt: ago(100) }) as T.Business;
  role(dan.id, 'merchant_admin', ownerBiz.id);

  const hoursFor = (t: T.StoreType): [string, string, boolean][] => {
    switch (t) {
      case 'gas_station': return Array(7).fill(['00:00', '24:00', false]);
      case 'convenience': return Array(7).fill(['06:00', '23:59', false]);
      case 'grocery': return Array(7).fill(['07:00', '22:00', false]);
      case 'pharmacy': return [['10:00', '18:00', false], ...Array(5).fill(['08:00', '21:00', false]), ['09:00', '19:00', false]];
      case 'specialty': return [['11:00', '17:00', false], ['00:00', '00:00', true], ...Array(4).fill(['10:00', '20:00', false]), ['10:00', '21:00', false]];
      case 'retail': return [['10:00', '18:00', false], ...Array(6).fill(['08:00', '20:00', false])];
    }
  };
  const services: Record<T.StoreType, string[]> = {
    grocery: ['Curbside pickup', 'Wholesale desk', 'EBT accepted', 'Bakery'],
    convenience: ['ATM', 'Hot coffee', 'Lottery'],
    gas_station: ['Fuel', 'Air pump', 'Restrooms', 'ATM', 'Car wash'],
    pharmacy: ['OTC consults', 'Flu shots', 'Prescription transfer'],
    specialty: ['Special orders', 'Gift boxes'],
    retail: ['Key cutting', 'Propane exchange', 'Local delivery'],
  };

  const stores: T.Store[] = sdefs.map(([name, type, lat, lng, city, county, zip, market, desc], i) => {
    let bizId = ownerBiz.id;
    if (i > 1) {
      const owner = mkUser(`owner${i}@example.com`, `${pick(firstNames)} ${pick(lastNames)}`, Math.floor(between(60, 150)));
      role(owner.id, 'consumer');
      const b = push('businesses', { id: id(), legalName: `${name} LLC`, dbaName: name, einLast4: String(1000 + Math.floor(rand() * 8999)), ownerUserId: owner.id, status: 'approved', contactEmail: owner.email, contactPhone: null, reviewNotes: null, reviewedBy: ops.id, reviewedAt: ago(80), createdAt: ago(90), updatedAt: ago(80) }) as T.Business;
      role(owner.id, 'merchant_admin', b.id);
      bizId = b.id;
    }
    const s: T.Store = {
      id: id(), businessId: bizId, marketId: market.id, name, slug: slug(name), storeType: type, description: desc,
      addressLine1: `${100 + Math.floor(rand() * 8800)} ${pick(streets)}`, city, county, state: 'TX', zip, latitude: lat, longitude: lng,
      serviceRadiusMi: type === 'grocery' ? 6 : type === 'retail' ? 8 : 4, phone: `(${market === DFW ? '214' : market === HOU ? '713' : '512'}) 555-${String(1000 + i * 37).slice(-4)}`,
      email: `hello@${slug(name).slice(0, 20)}.example`, website: rand() > 0.5 ? `https://${slug(name).slice(0, 20)}.example` : null,
      services: services[type].slice(0, 2 + Math.floor(rand() * 3)), pickupEnabled: true, deliveryEnabled: type === 'grocery' || type === 'pharmacy' || type === 'retail',
      deliveryFeeCents: type === 'grocery' ? 499 : 599, status: 'active', verifiedAt: ago(70), deletedAt: null, createdAt: ago(95 - i), updatedAt: ago(5),
    };
    push('stores', s);
    hoursFor(type).forEach(([o, c, closed], d) => push('storeHours', { id: id(), storeId: s.id, dayOfWeek: d, opens: o, closes: c, closed }));
    return s;
  });
  const [lakewood, deepEllum, bluebonnet, loneStarRx, , , greenville, , whiteRock, prestonHollow] = stores;

  // Staff: Sam at Lakewood with limited capabilities
  push('userRoles', { id: id(), userId: sam.id, role: 'store_employee', businessId: ownerBiz.id, createdAt: ago(70) });
  push('storeUsers', { id: id(), storeId: lakewood.id, userId: sam.id, staffRole: 'employee', capabilities: ['inventory.manage', 'orders.process', 'orders.view'], createdAt: ago(70) });
  const mgr = mkUser('rosa.manager@example.com', 'Rosa Alvarez', 90);
  role(mgr.id, 'consumer');
  push('userRoles', { id: id(), userId: mgr.id, role: 'store_employee', businessId: ownerBiz.id, createdAt: ago(88) });
  push('storeUsers', { id: id(), storeId: deepEllum.id, userId: mgr.id, staffRole: 'manager', capabilities: ['inventory.manage', 'orders.process', 'orders.view', 'products.manage', 'offers.manage', 'store_orders.manage'], createdAt: ago(88) });

  // Pending applications for the admin review queue
  const pendingOwner = mkUser('lucia@oakcliffbodega.example', 'Lucia Romero', 2);
  role(pendingOwner.id, 'consumer');
  const pendingBiz = push('businesses', { id: id(), legalName: 'Romero Family Foods LLC', dbaName: 'Oak Cliff Bodega', einLast4: '7310', ownerUserId: pendingOwner.id, status: 'pending', contactEmail: pendingOwner.email, contactPhone: '(214) 555-0199', reviewNotes: null, reviewedBy: null, reviewedAt: null, createdAt: ago(1, 5), updatedAt: ago(1, 5) }) as T.Business;
  role(pendingOwner.id, 'merchant_admin', pendingBiz.id);
  const pendingStore = push('stores', { ...stores[5], id: id(), businessId: pendingBiz.id, name: 'Oak Cliff Bodega', slug: 'oak-cliff-bodega', storeType: 'convenience', description: 'Family bodega on Jefferson Blvd.', addressLine1: '412 W Jefferson Blvd', zip: '75208', latitude: 32.7435, longitude: -96.8255, status: 'pending', verifiedAt: null, services: ['Hot coffee'], createdAt: ago(1, 5), updatedAt: ago(1, 5) });
  hoursFor('convenience').forEach(([o, c, closed], d) => push('storeHours', { id: id(), storeId: pendingStore.id, dayOfWeek: d, opens: o, closes: c, closed }));
  const pendingOwner2 = mkUser('kwame@sunsetfuel.example', 'Kwame Asante', 3);
  role(pendingOwner2.id, 'consumer');
  const pendingBiz2 = push('businesses', { id: id(), legalName: 'Sunset Fuel Partners Inc.', dbaName: 'Sunset Fuel', einLast4: '5528', ownerUserId: pendingOwner2.id, status: 'pending', contactEmail: pendingOwner2.email, contactPhone: '(972) 555-0131', reviewNotes: null, reviewedBy: null, reviewedAt: null, createdAt: ago(3), updatedAt: ago(3) }) as T.Business;
  role(pendingOwner2.id, 'merchant_admin', pendingBiz2.id);
  const pendingStore2 = push('stores', { ...stores[8], id: id(), businessId: pendingBiz2.id, name: 'Sunset Fuel — Garland Rd', slug: 'sunset-fuel-garland-rd', addressLine1: '9110 Garland Rd', zip: '75218', latitude: 32.8492, longitude: -96.6951, status: 'pending', verifiedAt: null, createdAt: ago(3), updatedAt: ago(3) });
  hoursFor('gas_station').forEach(([o, c, closed], d) => push('storeHours', { id: id(), storeId: pendingStore2.id, dayOfWeek: d, opens: o, closes: c, closed }));

  // ── Inventory (store-specific price + stock)
  const assortment: Record<T.StoreType, string[]> = {
    grocery: ['Grocery', 'Household', 'Health & Pharmacy', 'Baby', 'Pet'],
    convenience: ['Beverages', 'Snacks', 'Dairy & Eggs', 'Bakery', 'Frozen & Ice', 'Paper Goods', 'Pain & Fever', 'First Aid', 'Phone Accessories', 'Batteries'],
    gas_station: ['Beverages', 'Snacks', 'Frozen & Ice', 'Bakery', 'Automotive', 'Phone Accessories', 'Batteries', 'Pain & Fever'],
    pharmacy: ['Health & Pharmacy', 'Baby', 'Beverages', 'Snacks', 'Paper Goods', 'Batteries'],
    specialty: ['International Foods', 'Pantry', 'Snacks', 'Beverages', 'Produce', 'Bakery'],
    retail: ['Household', 'Electronics', 'Automotive', 'Pet'],
  };
  const markup: Record<T.StoreType, number> = { grocery: 0.95, convenience: 1.18, gas_station: 1.22, pharmacy: 1.08, specialty: 1.06, retail: 1.02 };
  const listingsByStore = new Map<string, T.StoreProduct[]>();
  const price99 = (c: number) => Math.max(29, Math.round(c / 10) * 10 - 1);
  for (const s of stores) {
    const list: T.StoreProduct[] = [];
    for (const p of products) {
      const catName = Object.values(cat).find((c) => c.id === p.categoryId)!.name;
      const ok = assortment[s.storeType].includes(catName) || assortment[s.storeType].includes(p.parent);
      if (!ok) continue;
      const keep = s.id === lakewood.id || s.id === deepEllum.id ? 0.92 : 0.72;
      if (rand() > keep && !(p.name.startsWith('Spring Water') && s.storeType !== 'retail')) continue;
      const priceCents = price99(p.base * markup[s.storeType] * between(0.93, 1.08));
      const roll = rand();
      let quantity = roll < 0.07 ? 0 : roll < 0.17 ? 1 + Math.floor(rand() * 4) : 8 + Math.floor(rand() * 70);
      const staleRoll = rand();
      const updatedAt = staleRoll < 0.06 ? ago(between(9, 20)) : ago(between(0, 3), between(0, 12));
      const b2b = (s.storeType === 'grocery' || s.storeType === 'retail' || s.storeType === 'specialty') && (rand() < 0.45 || p.name.startsWith('Spring Water') || p.name.includes('Cola'));
      if (b2b) quantity = Math.max(quantity, 30 + Math.floor(rand() * 120));
      const l: T.StoreProduct = {
        id: id(), storeId: s.id, productId: p.id, variantId: null, storeSku: rand() > 0.6 ? `${s.slug.slice(0, 3).toUpperCase()}${Math.floor(rand() * 90000 + 10000)}` : null,
        priceCents, promoPriceCents: rand() < 0.08 ? price99(priceCents * 0.85) : null, quantity, lowStockThreshold: p.base > 1500 ? 3 : 6,
        minOrderQty: 1, maxOrderQty: p.parent === 'Health & Pharmacy' ? 4 : null, visible: true,
        b2bEnabled: b2b, b2bPriceCents: b2b ? price99(p.base * 0.72) : null, b2bMinQty: b2b ? (p.base < 400 ? 12 : 4) : 1, b2bUnit: p.unit === 'pack' ? 'pack' : p.unit,
        availableFrom: null, availableUntil: null, source: rand() < 0.3 ? 'csv' : 'manual', updatedAt, createdAt: ago(60),
      };
      push('storeProducts', l);
      list.push(l);
    }
    listingsByStore.set(s.id, list);
  }
  // Scenario tuning: Lakewood is low on water and ice (drives the sourcing story).
  const tune = (storeId: string, name: string, patch: Partial<T.StoreProduct>) => {
    const p = products.find((x) => x.name === name)!;
    const l = listingsByStore.get(storeId)!.find((x) => x.productId === p.id);
    if (l) Object.assign(l, patch);
    return l;
  };
  tune(lakewood.id, 'Spring Water 24-Pack', { quantity: 3, lowStockThreshold: 10, updatedAt: ago(0, 2) });
  tune(lakewood.id, 'Bagged Ice', { quantity: 0, updatedAt: ago(0, 1) });
  tune(greenville.id, 'Spring Water 24-Pack', { quantity: 100, b2bEnabled: true, b2bPriceCents: 429, b2bMinQty: 10, b2bUnit: 'pack' });
  tune(prestonHollow.id, 'Spring Water 24-Pack', { quantity: 50, b2bEnabled: true, b2bPriceCents: 449, b2bMinQty: 10, b2bUnit: 'pack' });
  // Spec example: the same cola at three stores with different prices.
  tune(bluebonnet.id, 'Classic Cola', { priceCents: 229, quantity: 15 });
  tune(deepEllum.id, 'Classic Cola', { priceCents: 199, quantity: 43 });
  tune(whiteRock.id, 'Classic Cola', { priceCents: 249, quantity: 7 });

  for (const l of S.storeProducts as T.StoreProduct[]) {
    push('inventoryEvents', { id: id(), storeProductId: l.id, storeId: l.storeId, delta: l.quantity, quantityAfter: l.quantity, reason: 'opening stock', source: l.source, actorId: null, createdAt: ago(60) });
  }

  // ── Offers
  const P = (name: string) => products.find((p) => p.name === name)!;
  const offer = (s: T.Store, o: Partial<T.Offer>) =>
    push('offers', {
      id: id(), storeId: s.id, name: '', description: '', scope: 'product', productId: null, categoryId: null, discountType: 'percent', discountValue: 10,
      buyQty: null, getQty: null, startAt: ago(5), endAt: new Date(now.getTime() + 9 * 86400_000).toISOString(), eligibility: 'all', geoRadiusMi: null,
      usageLimit: null, usageCount: Math.floor(rand() * 40), status: 'active', createdAt: ago(6), updatedAt: ago(6), ...o,
    });
  offer(bluebonnet, { name: '25% off Classic Cola', description: 'Cold 20 oz bottles, any time of day.', productId: P('Classic Cola').id, discountValue: 25 });
  offer(deepEllum, { name: 'Kolache BOGO', description: 'Buy one 6-pack of sausage & cheese kolaches, get one free.', productId: P('Sausage & Cheese Kolaches 6-Pack').id, discountType: 'bxgy', buyQty: 1, getQty: 1, discountValue: 0 });
  offer(greenville, { name: '$1 off water 24-packs', description: 'Stock up for summer.', productId: P('Spring Water 24-Pack').id, discountType: 'fixed', discountValue: 100 });
  offer(loneStarRx, { name: '15% off vitamins', description: 'All vitamins and supplements.', scope: 'category', categoryId: cat['Vitamins'].id, discountValue: 15 });
  offer(lakewood, { name: 'New neighbor: 10% off', description: 'First order at Trinity Fresh Market.', scope: 'store', discountValue: 10, eligibility: 'new_customer' });
  offer(lakewood, { name: 'Lakewood produce 20% off', description: 'For shoppers within 3 miles of the store.', scope: 'category', categoryId: cat['Produce'].id, discountValue: 20, geoRadiusMi: 3 });
  offer(whiteRock, { name: 'Ice: buy 2, get 1', description: 'Heading to the lake? Grab three bags.', productId: P('Bagged Ice').id, discountType: 'bxgy', buyQty: 2, getQty: 1, discountValue: 0 });
  offer(stores[10], { name: '20% off box fans', description: 'Beat the Texas heat.', productId: P('Box Fan').id, discountValue: 20, endAt: new Date(now.getTime() + 2 * 86400_000).toISOString() });
  offer(stores[12], { name: 'Kimchi Tuesday', description: '$1.50 off every jar.', productId: P('Napa Cabbage Kimchi').id, discountType: 'fixed', discountValue: 150 });
  offer(stores[14], { name: '10% off dairy', description: 'Milk, eggs, cheese and yogurt.', scope: 'category', categoryId: cat['Dairy & Eggs'].id, discountValue: 10 });
  offer(stores[23], { name: '$5 off synthetic oil', description: 'Full synthetic 5W-30, 5 qt jugs.', productId: P('Full Synthetic Motor Oil 5W-30').id, discountType: 'fixed', discountValue: 500 });
  offer(stores[27], { name: '15% off store-wide', description: 'Grand opening in Montrose.', scope: 'store', discountValue: 15 });
  offer(stores[30], { name: 'Sunscreen 2 for 1', description: 'SPF 50, 6 oz tubes.', productId: P('Sunscreen SPF 50').id, discountType: 'bxgy', buyQty: 1, getQty: 1, discountValue: 0 });
  offer(stores[6], { name: 'Fall pantry sale', description: 'Scheduled promotion.', scope: 'category', categoryId: cat['Pantry'].id, discountValue: 12, startAt: new Date(now.getTime() + 3 * 86400_000).toISOString(), endAt: new Date(now.getTime() + 17 * 86400_000).toISOString(), usageCount: 0 });
  offer(lakewood, { name: 'Labor Day grill kit', description: 'Ended promotion.', scope: 'category', categoryId: cat['Home & Hardware'].id, discountValue: 15, startAt: ago(30), endAt: ago(20), status: 'active' });

  // ── Addresses, favorites
  push('addresses', { id: id(), userId: maya.id, label: 'Home', line1: '6340 Lakewood Blvd', city: 'Dallas', state: 'TX', zip: '75214', latitude: 32.8252, longitude: -96.7475, isDefault: true, createdAt: ago(60), updatedAt: ago(60) });
  push('addresses', { id: id(), userId: maya.id, label: 'Work', line1: '1601 Elm St', city: 'Dallas', state: 'TX', zip: '75201', latitude: 32.7812, longitude: -96.7969, isDefault: false, createdAt: ago(50), updatedAt: ago(50) });
  push('favorites', { id: id(), userId: maya.id, storeId: lakewood.id, productId: null, createdAt: ago(40) });
  push('favorites', { id: id(), userId: maya.id, storeId: loneStarRx.id, productId: null, createdAt: ago(30) });
  push('favorites', { id: id(), userId: maya.id, storeId: null, productId: P('Cold Brew Coffee').id, createdAt: ago(20) });
  push('favorites', { id: id(), userId: maya.id, storeId: null, productId: P('Sausage & Cheese Kolaches 6-Pack').id, createdAt: ago(12) });

  // ── Consumer orders (last 30 days)
  const cats = S.categories as T.Category[];
  let seq = 0;
  const makeOrder = (user: T.User, store: T.Store, daysAgo: number, finalStatus: T.OrderStatus, opts: { fulfillment?: T.FulfillmentType; count?: number } = {}) => {
    const list = (listingsByStore.get(store.id) ?? []).filter((l) => l.quantity > 0);
    if (list.length === 0) return null;
    const n = opts.count ?? 1 + Math.floor(rand() * 4);
    const chosen = new Set<T.StoreProduct>();
    while (chosen.size < Math.min(n, list.length)) chosen.add(pick(list));
    const createdAt = ago(daysAgo, between(0, 10));
    const lines = [...chosen].map((l) => {
      const p = products.find((x) => x.id === l.productId)!;
      return { l, p, line: priceLine(l, p, 1 + Math.floor(rand() * 3), [], { now: new Date(createdAt), isNewCustomer: false, categories: cats }) };
    });
    const fulfillment: T.FulfillmentType = opts.fulfillment ?? (store.deliveryEnabled && rand() < 0.25 ? 'delivery' : rand() < 0.2 ? 'curbside' : 'pickup');
    const totals = computeTotals(lines.map((x) => x.line), { state: store.state, feeCents: fulfillment === 'delivery' ? store.deliveryFeeCents : 0 });
    const payInStore = fulfillment !== 'delivery' && rand() < 0.15;
    const paymentStatus: T.PaymentStatus = payInStore ? 'pay_in_store' : finalStatus === 'cancelled' ? 'refunded' : ['ready', 'out_for_delivery', 'completed'].includes(finalStatus) ? 'captured' : 'authorized';
    const o: T.Order = {
      id: id(), number: `RG-${(Math.floor(now.getTime() / 1000) - daysAgo * 86400).toString(36).toUpperCase().slice(-5)}${(seq++).toString(36).toUpperCase().padStart(3, '0')}`,
      userId: user.id, storeId: store.id, status: finalStatus, fulfillmentType: fulfillment,
      deliveryAddress: fulfillment === 'delivery' ? { line1: `${1000 + Math.floor(rand() * 8000)} ${pick(streets)}`, city: store.city, state: 'TX', zip: store.zip } : null,
      subtotalCents: totals.subtotalCents, discountCents: totals.discountCents, taxCents: totals.taxCents, feeCents: totals.feeCents, totalCents: totals.totalCents,
      paymentStatus, idempotencyKey: null, notes: null, createdAt, updatedAt: createdAt,
    };
    push('orders', o);
    for (const x of lines) push('orderItems', { id: id(), orderId: o.id, storeProductId: x.l.id, productId: x.p.id, productName: `${x.p.name}${x.p.size ? ` (${x.p.size})` : ''}`, unitPriceCents: x.line.unitCents, quantity: x.line.quantity, discountCents: x.line.discountCents, totalCents: x.line.totalCents, offerId: null });
    const path: T.OrderStatus[] = ['pending_payment', 'confirmed'];
    const flow: T.OrderStatus[] = fulfillment === 'delivery' ? ['processing', 'out_for_delivery', 'completed'] : ['processing', 'ready', 'completed'];
    if (finalStatus === 'cancelled') path.push('cancelled');
    else for (const s of flow) { if (path.includes(finalStatus)) break; path.push(s); if (s === finalStatus) break; }
    let t = new Date(createdAt).getTime();
    let prev: string | null = null;
    for (const s of path) {
      push('statusHistory', { id: id(), orderId: o.id, kind: 'consumer', fromStatus: prev, toStatus: s, actorId: null, note: null, createdAt: new Date(t).toISOString() });
      prev = s;
      t += between(0.2, 3) * 3600_000;
    }
    o.updatedAt = new Date(Math.min(t, now.getTime())).toISOString();
    if (!payInStore) {
      const pay = push('payments', { id: id(), orderId: o.id, provider: 'mock', providerRef: `mock_pi_seed${seq}`, status: paymentStatus, amountCents: o.totalCents, refundedCents: paymentStatus === 'refunded' ? o.totalCents : 0, cardBrand: pick(['Visa', 'Mastercard', 'American Express']), cardLast4: pick(['4242', '4444', '0005', '1881']), createdAt, updatedAt: o.updatedAt });
      push('paymentTransactions', { id: id(), paymentId: pay.id, type: 'authorize', amountCents: o.totalCents, providerRef: pay.providerRef, success: true, message: null, createdAt });
      if (paymentStatus === 'captured') push('paymentTransactions', { id: id(), paymentId: pay.id, type: 'capture', amountCents: o.totalCents, providerRef: pay.providerRef, success: true, message: null, createdAt: o.updatedAt });
    }
    push('analyticsEvents', { id: id(), name: 'purchase', schemaVersion: 1, userId: user.id, storeId: store.id, props: { orderId: o.id, totalCents: o.totalCents }, createdAt });
    return o;
  };
  const dfwStores = stores.filter((s) => s.marketId === DFW.id);
  for (let i = 0; i < 150; i++) {
    const d = Math.floor(Math.pow(rand(), 1.3) * 30);
    const st: T.OrderStatus = d === 0 ? pick(['confirmed', 'processing', 'ready', 'completed']) : d === 1 ? pick(['completed', 'completed', 'ready']) : rand() < 0.06 ? 'cancelled' : 'completed';
    const store = rand() < 0.25 ? lakewood : rand() < 0.1 ? deepEllum : pick(rand() < 0.85 ? dfwStores : stores);
    makeOrder(pick(shoppers.slice(1)), store, d, st);
  }
  // Today's queue at Lakewood for the merchant dashboard
  makeOrder(shoppers[3], lakewood, 0, 'confirmed', { fulfillment: 'pickup', count: 3 });
  makeOrder(shoppers[5], lakewood, 0, 'confirmed', { fulfillment: 'delivery', count: 4 });
  makeOrder(shoppers[7], lakewood, 0, 'processing', { fulfillment: 'curbside', count: 2 });
  // Maya's history
  const mayaReady = makeOrder(maya, lakewood, 0, 'ready', { fulfillment: 'pickup', count: 3 });
  makeOrder(maya, loneStarRx, 0, 'processing', { fulfillment: 'pickup', count: 2 });
  makeOrder(maya, bluebonnet, 6, 'completed', { fulfillment: 'pickup', count: 2 });
  makeOrder(maya, greenville, 13, 'completed', { fulfillment: 'delivery', count: 4 });
  const pf = makeOrder(shoppers[9], stores[14], 0, 'completed', { count: 1 });
  if (pf) { pf.status = 'payment_failed'; pf.paymentStatus = 'failed'; }

  // ── Store-to-store requests
  const so = (buyer: T.Store, seller: T.Store, status: T.StoreOrderStatus, items: [string, number][], daysAgo: number, notes: string | null = null) => {
    const createdAt = ago(daysAgo, between(1, 8));
    const lines = items.map(([pn, q]) => {
      const p = P(pn);
      let l = listingsByStore.get(seller.id)!.find((x) => x.productId === p.id);
      if (!l) {
        l = { ...(S.storeProducts as T.StoreProduct[])[0], id: id(), storeId: seller.id, productId: p.id, priceCents: price99(p.base), quantity: 80, b2bEnabled: true, b2bPriceCents: price99(p.base * 0.72), b2bMinQty: 6, b2bUnit: p.unit, storeSku: null, promoPriceCents: null, updatedAt: ago(1) };
        push('storeProducts', l);
        listingsByStore.get(seller.id)!.push(l);
      }
      if (!l.b2bEnabled) Object.assign(l, { b2bEnabled: true, b2bPriceCents: price99(p.base * 0.72), b2bMinQty: 6 });
      const accepted = ['accepted', 'preparing', 'ready', 'completed'].includes(status) ? q : null;
      const fulfilled = ['ready', 'completed'].includes(status) ? q : null;
      return { p, l, q, accepted, fulfilled };
    });
    const order = push('storeOrders', {
      id: id(), number: `S2S-${(Math.floor(now.getTime() / 1000) - daysAgo * 86400).toString(36).toUpperCase().slice(-5)}${(seq++).toString(36).toUpperCase().padStart(3, '0')}`,
      buyerStoreId: buyer.id, sellerStoreId: seller.id, status, subtotalCents: lines.reduce((s, x) => s + (x.l.b2bPriceCents ?? x.l.priceCents) * (x.fulfilled ?? x.accepted ?? x.q), 0),
      buyerNotes: notes, sellerNotes: status === 'rejected' ? 'We need that stock for a weekend event. Try Preston Hollow Market.' : null, createdBy: buyer.id === lakewood.id || buyer.id === deepEllum.id ? dan.id : ops.id, partial: false, createdAt, updatedAt: createdAt,
    }) as T.StoreOrder;
    for (const x of lines) push('storeOrderItems', { id: id(), storeOrderId: order.id, storeProductId: x.l.id, productId: x.p.id, productName: `${x.p.name}${x.p.size ? ` (${x.p.size})` : ''}`, unitLabel: x.l.b2bUnit, unitPriceCents: x.l.b2bPriceCents ?? x.l.priceCents, requestedQty: x.q, acceptedQty: x.accepted, fulfilledQty: x.fulfilled });
    const steps: T.StoreOrderStatus[] = ['draft', 'submitted', 'pending_acceptance', 'accepted', 'preparing', 'ready', 'completed'];
    const path = status === 'rejected' ? ['draft', 'submitted', 'pending_acceptance', 'rejected'] : status === 'cancelled' ? ['draft', 'submitted', 'pending_acceptance', 'cancelled'] : steps.slice(0, steps.indexOf(status) + 1);
    let t = new Date(createdAt).getTime();
    let prev: string | null = null;
    for (const s of path) {
      push('statusHistory', { id: id(), orderId: order.id, kind: 'store', fromStatus: prev, toStatus: s, actorId: null, note: s === 'submitted' ? notes : null, createdAt: new Date(t).toISOString() });
      prev = s;
      t += between(0.3, 5) * 3600_000;
    }
    order.updatedAt = new Date(Math.min(t, now.getTime())).toISOString();
    return order;
  };
  so(greenville, lakewood, 'pending_acceptance', [['Sausage & Cheese Kolaches 6-Pack', 12], ['Whole Milk', 10]], 0, 'Our bakery oven is down until Friday. Can you cover kolaches for the weekend?');
  so(stores[4], lakewood, 'pending_acceptance', [['Large Grade A Eggs', 20]], 0, null);
  so(lakewood, prestonHollow, 'accepted', [['Spring Water 24-Pack', 20]], 1, 'Heat advisory this week. Need water for Saturday.');
  so(deepEllum, lakewood, 'completed', [['Bananas', 30], ['Hass Avocado', 24]], 9);
  so(lakewood, greenville, 'completed', [['Classic Cola 12-Pack', 24]], 16);
  so(lakewood, stores[10], 'rejected', [['Charcoal Briquets', 10]], 5, 'For the Labor Day grill kit bundle.');
  so(deepEllum, greenville, 'preparing', [['Bagged Ice', 40]], 0, 'Concert night at the Bomb Factory.');
  so(stores[16], stores[14], 'ready', [['Ground Coffee, Medium Roast', 12]], 1);
  so(stores[21], stores[19], 'completed', [['Flour Tortillas', 40], ['Pinto Beans', 20]], 7);
  so(stores[24], stores[25], 'cancelled', [['Paper Towels 6 Rolls', 12]], 11);

  // ── Notifications
  const note = (userId: string, type: string, title: string, body: string, link: string | null, daysAgo: number, read = false, storeId: string | null = null) =>
    push('notifications', { id: id(), userId, storeId, type, title, body, link, channel: 'in_app', readAt: read ? ago(daysAgo * 0.5) : null, createdAt: ago(daysAgo, between(0, 3)) });
  if (mayaReady) note(maya.id, 'order_ready', `Order ${mayaReady.number} is ready for pickup`, 'Head to Trinity Fresh Market and show your order number at the counter.', `/account/orders/${mayaReady.id}`, 0);
  note(maya.id, 'offer', 'New near you: 25% off Classic Cola', 'Bluebonnet Fuel & Go, 1.9 mi away.', `/store/${bluebonnet.slug}`, 1);
  note(maya.id, 'order_status', 'Your Greenville Avenue Grocer order was delivered', 'Thanks for shopping local.', null, 13, true);
  note(dan.id, 'store_order_request', 'Stock request from Greenville Avenue Grocer', 'They asked for kolaches and milk.', '/merchant/store-orders', 0, false, lakewood.id);
  note(dan.id, 'low_inventory', 'Low stock: Spring Water 24-Pack', 'Only 3 left. Source it from a nearby store.', '/merchant/inventory', 0, false, lakewood.id);
  note(dan.id, 'new_order', 'New delivery order', 'A customer placed a delivery order.', '/merchant/orders', 0, false, lakewood.id);
  note(dan.id, 'store_order_decision', 'Request declined by NorthPark Home & Hardware', 'Charcoal request was declined.', '/merchant/store-orders', 5, true, lakewood.id);
  note(sam.id, 'new_order', 'New pickup order', 'Pack 3 items for pickup.', '/merchant/orders', 0, false, lakewood.id);
  note(ops.id, 'system', 'Two merchant applications waiting', 'Oak Cliff Bodega and Sunset Fuel applied this week.', '/admin/merchants', 1);

  // ── Support tickets
  push('supportTickets', { id: id(), userId: shoppers[4].id, email: shoppers[4].email, subject: 'Charged but order shows cancelled', body: 'I placed an order Tuesday and it was cancelled, but I still see a pending charge on my card.', orderId: (S.orders as T.Order[]).find((o) => o.status === 'cancelled')?.id ?? null, status: 'open', category: 'payment', createdAt: ago(1), updatedAt: ago(1) });
  push('supportTickets', { id: id(), userId: null, email: 'owner@corner-store.example', subject: 'How do I list my second location?', body: 'We have two convenience stores in Garland. Can one account manage both?', orderId: null, status: 'in_progress', category: 'store', createdAt: ago(3), updatedAt: ago(2) });
  push('supportTickets', { id: id(), userId: shoppers[8].id, email: shoppers[8].email, subject: 'Store hours were wrong', body: 'The app said open until 10 PM but the store closed at 9.', orderId: null, status: 'resolved', category: 'store', createdAt: ago(9), updatedAt: ago(7) });

  // ── Search + analytics history (drives dashboards, zero-result reports)
  const queries = ['bottled water', 'water', 'ibuprofen', 'ice', 'kolaches', 'cold brew', 'eggs', 'milk', 'diapers', 'sunscreen', 'motor oil', 'phone charger', 'avocado', 'tortillas', 'propane', 'charcoal', 'allergy', 'dog food', 'batteries', 'box fan', 'lighter fluid', 'masa', 'kimchi', 'cola'];
  for (let i = 0; i < 520; i++) {
    const q = pick(queries);
    const s = pick(stores);
    const d = Math.floor(rand() * 30);
    push('searchEvents', { id: id(), userId: rand() < 0.5 ? pick(shoppers).id : null, query: q, latRounded: Math.round(s.latitude * 100) / 100, lngRounded: Math.round(s.longitude * 100) / 100, radiusMi: pick([5, 10, 10, 25]), resultCount: q === 'propane' || q === 'lighter fluid' ? 0 : 3 + Math.floor(rand() * 20), createdAt: ago(d, between(0, 23)) });
  }
  for (let i = 0; i < 1400; i++) {
    const s = rand() < 0.2 ? lakewood : pick(stores);
    const name = pick(['store_view', 'product_view', 'product_view', 'product_view', 'add_to_cart', 'offer_view', 'checkout_started']);
    push('analyticsEvents', { id: id(), name, schemaVersion: 1, userId: rand() < 0.4 ? pick(shoppers).id : null, storeId: s.id, props: {}, createdAt: ago(Math.floor(rand() * 30), between(0, 23)) });
  }

  // ── Audit + settings
  const auditRow = (actor: T.User, action: string, entity: string, entityId: string, before: unknown, after: unknown, daysAgo: number) =>
    push('auditLogs', { id: id(), actorId: actor.id, actorEmail: actor.email, action, entity, entityId, before, after, ip: `10.0.${Math.floor(rand() * 255)}.${Math.floor(rand() * 255)}`, userAgent: 'Mozilla/5.0', createdAt: ago(daysAgo, between(0, 12)) });
  auditRow(ops, 'merchant.approved', 'business', ownerBiz.id, { status: 'pending' }, { status: 'approved' }, 100);
  auditRow(dan, 'listing.updated', 'store_product', listingsByStore.get(lakewood.id)![0].id, { priceCents: 429 }, { priceCents: 399 }, 2);
  auditRow(dan, 'offer.created', 'offer', (S.offers as T.Offer[])[4].id, null, { name: 'New neighbor: 10% off' }, 6);
  auditRow(ops, 'setting.updated', 'system_setting', 'tax.rates', { TX: 8.25 }, { TX: 8.25, OK: 8.95 }, 12);
  auditRow(jo, 'store.verified', 'store', whiteRock.id, { verifiedAt: null }, { verifiedAt: ago(40) }, 40);
  auditRow(sam, 'inventory.csv_import', 'store', lakewood.id, null, { updated: 42, created: 3, skipped: 1 }, 1);

  const setting = (k: string, v: unknown) => push('settings', { id: k, value: v, updatedBy: ops.id, updatedAt: ago(12) });
  setting('tax.rates', { TX: 8.25, OK: 8.95, LA: 9.55 });
  setting('search.default_radius_mi', 10);
  setting('inventory.stale_days', 7);
  setting('checkout.delivery_enabled', true);
  setting('notifications.sms_enabled', false);
  setting('privacy.search_log_retention_days', 180);
  setting('maintenance.banner', '');

  return S;
}

function slug(s: string) {
  return s.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function describe(name: string, brand: string, size: string | null) {
  return `${brand} ${name}${size ? `, ${size}` : ''}. Stocked by independent stores across the RetailGeo network. Prices and availability are set by each store.`;
}
