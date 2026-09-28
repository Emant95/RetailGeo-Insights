import { z } from 'zod';
import { STORE_TYPES, EMPLOYEE_CAPABILITIES, ORDER_STATUSES, STORE_ORDER_STATUSES } from './types';
import { ZIP_RE, US_STATES, isUSCoordinate } from './geo';

/** Request validation schemas — also the source for the generated OpenAPI document. */

const trimmed = (min = 1, max = 200) => z.string().trim().min(min).max(max);
export const zip = z.string().trim().regex(ZIP_RE, 'Enter a 5-digit ZIP code.');
export const stateCode = z.string().trim().toUpperCase().refine((s) => !!US_STATES[s], 'Use a 2-letter U.S. state code.');
export const cents = z.number().int().min(0).max(10_000_000);
export const password = z
  .string()
  .min(10, 'Use at least 10 characters.')
  .max(128)
  .refine((p) => /[A-Za-z]/.test(p) && /\d/.test(p), 'Include at least one letter and one number.');
const num = (min: number, max: number) => z.coerce.number().min(min).max(max);
const bool = z.preprocess((v) => (v === 'true' || v === true ? true : v === 'false' || v === false ? false : undefined), z.boolean().optional());
const csv = z.preprocess((v) => (typeof v === 'string' && v ? v.split(',') : Array.isArray(v) ? v : undefined), z.array(z.string()).optional());

export const Schemas = {
  register: z.object({
    email: z.string().trim().toLowerCase().email('Enter a valid email address.'),
    password,
    fullName: trimmed(2, 120),
    marketingConsent: z.boolean().default(false),
  }),
  login: z.object({ email: z.string().trim().toLowerCase().email(), password: z.string().min(1).max(128) }),
  mfa: z.object({ challengeId: z.string().uuid(), code: z.string().regex(/^\d{6}$/, 'Enter the 6-digit code.') }),
  refresh: z.object({ refreshToken: z.string().min(20) }),
  token: z.object({ token: z.string().min(10) }),
  forgot: z.object({ email: z.string().trim().toLowerCase().email() }),
  reset: z.object({ token: z.string().min(10), password }),

  profile: z.object({
    fullName: trimmed(2, 120).optional(),
    phone: z.string().trim().regex(/^\+?1?[\s-]?\(?\d{3}\)?[\s-]?\d{3}[\s-]?\d{4}$/, 'Enter a U.S. phone number.').nullable().optional(),
    marketingConsent: z.boolean().optional(),
    locationSharing: z.boolean().optional(),
  }),
  address: z.object({
    label: trimmed(1, 40),
    line1: trimmed(3, 160),
    city: trimmed(2, 80),
    state: stateCode,
    zip,
    isDefault: z.boolean().default(false),
  }),
  favorite: z.object({ storeId: z.string().uuid().optional(), productId: z.string().uuid().optional() }).refine((v) => !!v.storeId !== !!v.productId, 'Choose a store or a product.'),

  geoQuery: z.object({
    lat: num(-90, 90).optional(),
    lng: num(-180, 180).optional(),
    radius: num(0.5, 100).default(10),
  }),
  nearbyStores: z.object({
    lat: num(-90, 90).optional(),
    lng: num(-180, 180).optional(),
    radius: num(0.5, 100).default(10),
    type: csv,
    q: z.string().max(100).optional(),
    city: z.string().max(80).optional(),
    state: z.string().max(2).optional(),
    openNow: bool,
    sort: z.enum(['distance', 'name']).default('distance'),
    page: num(1, 1000).default(1),
    pageSize: num(1, 100).default(24),
  }),
  search: z.object({
    q: z.string().max(120).default(''),
    lat: num(-90, 90).optional(),
    lng: num(-180, 180).optional(),
    radius: num(0.5, 100).default(10),
    category: z.string().optional(),
    storeType: csv,
    inStock: bool,
    onSale: bool,
    minPrice: num(0, 1e7).optional(),
    maxPrice: num(0, 1e7).optional(),
    sort: z.enum(['relevance', 'distance', 'price_asc', 'price_desc']).default('relevance'),
    page: num(1, 1000).default(1),
    pageSize: num(1, 60).default(24),
  }),
  cartAdd: z.object({ storeProductId: z.string().uuid(), quantity: z.number().int().min(1).max(999) }),
  cartUpdate: z.object({ quantity: z.number().int().min(0).max(999) }),
  checkout: z.object({
    storeId: z.string().uuid(),
    fulfillmentType: z.enum(['pickup', 'curbside', 'delivery']),
    deliveryAddress: z.object({ line1: trimmed(3, 160), city: trimmed(2, 80), state: stateCode, zip }).optional(),
    paymentMethod: z.enum(['card', 'pay_in_store']).default('card'),
    paymentToken: z.string().max(200).optional(),
    notes: z.string().max(500).optional(),
    /** Echo of the total the shopper saw; checkout fails if prices moved. */
    expectedTotalCents: cents.optional(),
  }),
  cancel: z.object({ reason: z.string().max(300).optional() }),
  support: z.object({
    email: z.string().trim().email(),
    subject: trimmed(3, 140),
    body: trimmed(10, 4000),
    orderId: z.string().uuid().optional(),
    category: z.enum(['order', 'account', 'store', 'payment', 'other']).default('other'),
  }),
  track: z.object({
    name: z.enum(['product_view', 'store_view', 'offer_view', 'add_to_cart', 'checkout_started', 'favorite_added', 'location_search']),
    storeId: z.string().uuid().optional(),
    props: z.record(z.union([z.string(), z.number(), z.boolean(), z.null()])).default({}),
  }),

  // merchant
  application: z.object({
    legalName: trimmed(2, 160),
    dbaName: z.string().trim().max(160).optional(),
    einLast4: z.string().regex(/^\d{4}$/, 'Enter the last 4 digits of your EIN.').optional(),
    contactEmail: z.string().trim().email(),
    contactPhone: z.string().trim().max(20).optional(),
    store: z.object({
      name: trimmed(2, 120),
      storeType: z.enum(STORE_TYPES),
      addressLine1: trimmed(3, 160),
      city: trimmed(2, 80),
      state: stateCode,
      zip,
      phone: z.string().trim().max(20).optional(),
      latitude: z.number().optional(),
      longitude: z.number().optional(),
    }),
  }),
  storeUpdate: z.object({
    name: trimmed(2, 120).optional(),
    description: z.string().max(1000).optional(),
    storeType: z.enum(STORE_TYPES).optional(),
    addressLine1: trimmed(3, 160).optional(),
    city: trimmed(2, 80).optional(),
    state: stateCode.optional(),
    zip: zip.optional(),
    latitude: z.number().optional(),
    longitude: z.number().optional(),
    serviceRadiusMi: z.number().min(0).max(100).optional(),
    phone: z.string().max(20).nullable().optional(),
    email: z.string().email().nullable().optional(),
    website: z.string().url().nullable().optional(),
    services: z.array(z.string().max(40)).max(20).optional(),
    pickupEnabled: z.boolean().optional(),
    deliveryEnabled: z.boolean().optional(),
    deliveryFeeCents: cents.optional(),
  }).refine((v) => (v.latitude == null && v.longitude == null) || (v.latitude != null && v.longitude != null && isUSCoordinate(v.latitude, v.longitude)), 'Coordinates must be a valid U.S. location.'),
  hours: z.object({
    hours: z.array(z.object({
      dayOfWeek: z.number().int().min(0).max(6),
      opens: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
      closes: z.string().regex(/^([01]\d|2[0-4]):[0-5]\d$/),
      closed: z.boolean(),
    })).length(7),
  }),
  employee: z.object({
    email: z.string().trim().toLowerCase().email(),
    fullName: trimmed(2, 120),
    staffRole: z.enum(['manager', 'employee']).default('employee'),
    capabilities: z.array(z.enum(EMPLOYEE_CAPABILITIES)).default(['orders.view']),
  }),
  employeeUpdate: z.object({
    staffRole: z.enum(['manager', 'employee']).optional(),
    capabilities: z.array(z.enum(EMPLOYEE_CAPABILITIES)).optional(),
  }),
  productCreate: z.object({
    name: trimmed(2, 160),
    brand: z.string().trim().max(80).optional(),
    categoryId: z.string().uuid(),
    description: z.string().max(2000).default(''),
    upc: z.string().regex(/^\d{8,14}$/, 'UPC must be 8–14 digits.').optional(),
    sku: z.string().trim().regex(/^[A-Za-z0-9._-]{3,40}$/, 'SKU may use letters, numbers, dot, dash and underscore (3–40).'),
    unit: z.string().max(20).default('each'),
    size: z.string().max(40).optional(),
    images: z.array(z.string().url()).max(8).default([]),
    attributes: z.record(z.union([z.string(), z.number(), z.boolean()])).default({}),
    variants: z.array(z.object({ name: trimmed(1, 80), sku: z.string().regex(/^[A-Za-z0-9._-]{3,40}$/), upc: z.string().regex(/^\d{8,14}$/).optional() })).max(20).default([]),
    listing: z.object({
      priceCents: cents.refine((v) => v > 0, 'Price must be greater than $0.'),
      quantity: z.number().int().min(0).max(1_000_000),
      storeSku: z.string().max(40).optional(),
      lowStockThreshold: z.number().int().min(0).max(10000).default(5),
    }),
  }),
  listingUpdate: z.object({
    priceCents: cents.optional(),
    promoPriceCents: cents.nullable().optional(),
    quantity: z.number().int().min(0).max(1_000_000).optional(),
    lowStockThreshold: z.number().int().min(0).max(10000).optional(),
    minOrderQty: z.number().int().min(1).max(1000).optional(),
    maxOrderQty: z.number().int().min(1).max(10000).nullable().optional(),
    visible: z.boolean().optional(),
    storeSku: z.string().max(40).nullable().optional(),
    b2bEnabled: z.boolean().optional(),
    b2bPriceCents: cents.nullable().optional(),
    b2bMinQty: z.number().int().min(1).max(10000).optional(),
    b2bUnit: z.string().max(40).optional(),
    availableFrom: z.string().datetime().nullable().optional(),
    availableUntil: z.string().datetime().nullable().optional(),
    reason: z.string().max(200).optional(),
  }),
  inventoryImport: z.object({ csv: z.string().min(10).max(2_000_000), dryRun: z.boolean().default(false) }),
  merchantOrderStatus: z.object({ status: z.enum(ORDER_STATUSES), note: z.string().max(300).optional() }),
  offer: z.object({
    name: trimmed(2, 120),
    description: z.string().max(500).default(''),
    scope: z.enum(['product', 'category', 'store']),
    productId: z.string().uuid().nullable().optional(),
    categoryId: z.string().uuid().nullable().optional(),
    discountType: z.enum(['percent', 'fixed', 'bxgy']),
    discountValue: z.number().min(0).max(1_000_000).default(0),
    buyQty: z.number().int().min(1).max(20).nullable().optional(),
    getQty: z.number().int().min(1).max(20).nullable().optional(),
    startAt: z.string().datetime(),
    endAt: z.string().datetime(),
    eligibility: z.enum(['all', 'new_customer']).default('all'),
    geoRadiusMi: z.number().min(1).max(100).nullable().optional(),
    usageLimit: z.number().int().min(1).nullable().optional(),
    status: z.enum(['draft', 'active', 'paused']).default('active'),
  }).superRefine((o, ctx) => {
    if (new Date(o.endAt) <= new Date(o.startAt)) ctx.addIssue({ code: 'custom', path: ['endAt'], message: 'End date must be after the start date.' });
    if (o.scope === 'product' && !o.productId) ctx.addIssue({ code: 'custom', path: ['productId'], message: 'Choose a product.' });
    if (o.scope === 'category' && !o.categoryId) ctx.addIssue({ code: 'custom', path: ['categoryId'], message: 'Choose a category.' });
    if (o.discountType === 'percent' && (o.discountValue <= 0 || o.discountValue > 90)) ctx.addIssue({ code: 'custom', path: ['discountValue'], message: 'Percent discounts must be between 1 and 90.' });
    if (o.discountType === 'fixed' && o.discountValue <= 0) ctx.addIssue({ code: 'custom', path: ['discountValue'], message: 'Enter a discount amount.' });
    if (o.discountType === 'bxgy' && (!o.buyQty || !o.getQty)) ctx.addIssue({ code: 'custom', path: ['buyQty'], message: 'Enter both buy and get quantities.' });
  }),
  sourcing: z.object({
    storeId: z.string().uuid(),
    q: z.string().max(120).default(''),
    radius: num(1, 100).default(25),
  }),
  storeOrderCreate: z.object({
    buyerStoreId: z.string().uuid(),
    sellerStoreId: z.string().uuid(),
    items: z.array(z.object({ storeProductId: z.string().uuid(), quantity: z.number().int().min(1).max(100000) })).min(1).max(50),
    notes: z.string().max(500).optional(),
    submit: z.boolean().default(true),
  }),
  storeOrderTransition: z.object({
    storeId: z.string().uuid(),
    status: z.enum(STORE_ORDER_STATUSES),
    note: z.string().max(500).optional(),
    /** Seller adjusts quantities on accept, or records fulfilled quantities on ready. */
    quantities: z.record(z.string().uuid(), z.number().int().min(0)).optional(),
  }),

  // admin
  review: z.object({ decision: z.enum(['approve', 'reject']), notes: z.string().max(1000).optional() }),
  statusChange: z.object({ status: z.string().min(2).max(40), reason: z.string().max(500).optional() }),
  transferOwnership: z.object({ businessId: z.string().uuid() }),
  userAdmin: z.object({ status: z.enum(['active', 'disabled']).optional(), roles: z.array(z.enum(['consumer', 'merchant_admin', 'store_employee', 'platform_admin', 'platform_support'])).optional() }),
  category: z.object({ name: trimmed(2, 80), parentId: z.string().uuid().nullable().default(null), sort: z.number().int().default(0), icon: z.string().max(40).nullable().default(null) }),
  moderate: z.object({ status: z.enum(['active', 'rejected', 'archived', 'pending_review']), notes: z.string().max(500).optional() }),
  market: z.object({ name: trimmed(2, 80), state: stateCode, latitude: z.number(), longitude: z.number(), radiusMi: z.number().min(1).max(200), status: z.enum(['active', 'planned', 'paused']) })
    .refine((m) => isUSCoordinate(m.latitude, m.longitude), 'Market center must be inside the U.S.'),
  refund: z.object({ amountCents: cents.optional(), reason: z.string().max(300).optional() }),
  ticketUpdate: z.object({ status: z.enum(['open', 'in_progress', 'resolved']) }),
  setting: z.object({ value: z.unknown() }),
  broadcast: z.object({ audience: z.enum(['all', 'consumers', 'merchants']), title: trimmed(3, 120), body: trimmed(3, 1000) }),
  listQuery: z.object({
    page: num(1, 10000).default(1),
    pageSize: num(1, 100).default(25),
    q: z.string().max(120).optional(),
    status: z.string().max(40).optional(),
    storeId: z.string().uuid().optional(),
    role: z.string().max(40).optional(),
  }),
};

export type SchemaName = keyof typeof Schemas;
