import type { z } from 'zod';
import type { Deps, RequestContext } from '../context';
import type { Schemas } from '../schemas';
import type { Offer, OrderStatus, Product, StoreProduct, InventorySource } from '../types';
import { AppError, notFound, invalid, forbidden } from '../errors';
import { stockStatus, isStale, formatUSD } from '../pricing';
import { isUSCoordinate, distanceMi } from '../geo';
import { nowIso, uuid, requireUser, paginate, audit, assertStoreAccess, accessibleStoreIds, slugify, diff } from '../util';
import { getOrder, transitionOrder } from './commerce';
import { openStatus } from './discovery';

// ─── Onboarding ───────────────────────────────────────────────────────────
export async function applyAsMerchant(deps: Deps, ctx: RequestContext, input: z.infer<typeof Schemas.application>) {
  const u = requireUser(ctx);
  const pending = await deps.db.businesses.findOne({ ownerUserId: u.id, status: 'pending' });
  if (pending) throw new AppError('CONFLICT', 'You already have an application under review.');
  let lat = input.store.latitude;
  let lng = input.store.longitude;
  if (lat == null || lng == null) {
    const g = (await deps.geocoder.geocode(input.store.zip))[0];
    if (!g) throw invalid('We could not locate that ZIP code. RetailGeo beta currently serves Dallas–Fort Worth, Houston and Austin.', { field: 'store.zip' });
    lat = g.lat + (Math.random() - 0.5) * 0.01;
    lng = g.lng + (Math.random() - 0.5) * 0.01;
  }
  if (!isUSCoordinate(lat, lng)) throw invalid('Store location must be in the United States.');
  // Duplicate store detection: same name within 0.1 mi or same address+zip.
  const nearby = await deps.db.storesNear({ lat, lng, radiusMi: 0.1, statuses: ['active', 'pending', 'suspended'] });
  const dup = nearby.find((h) => h.store.name.toLowerCase() === input.store.name.toLowerCase())
    ?? (await deps.db.stores.findOne({ addressLine1: input.store.addressLine1, zip: input.store.zip }) ? { store: { name: input.store.name } } : null);
  if (dup) throw new AppError('CONFLICT', `A store named "${dup.store.name}" is already registered at this location. Contact support to claim it.`);
  const markets = await deps.db.markets.findMany({ status: 'active' });
  const market = markets.find((m) => distanceMi({ lat: m.latitude, lng: m.longitude }, { lat: lat!, lng: lng! }) <= m.radiusMi) ?? null;
  const business = await deps.db.businesses.insert({
    id: uuid(), legalName: input.legalName, dbaName: input.dbaName ?? null, einLast4: input.einLast4 ?? null, ownerUserId: u.id,
    status: 'pending', contactEmail: input.contactEmail, contactPhone: input.contactPhone ?? null, reviewNotes: null, reviewedBy: null, reviewedAt: null,
    createdAt: nowIso(), updatedAt: nowIso(),
  });
  const g = (await deps.geocoder.reverse(lat, lng));
  const store = await deps.db.stores.insert({
    id: uuid(), businessId: business.id, marketId: market?.id ?? null, name: input.store.name, slug: `${slugify(input.store.name)}-${uuid().slice(0, 4)}`,
    storeType: input.store.storeType, description: '', addressLine1: input.store.addressLine1, city: input.store.city, county: g?.county ?? null,
    state: input.store.state, zip: input.store.zip, latitude: lat, longitude: lng, serviceRadiusMi: 5, phone: input.store.phone ?? null,
    email: input.contactEmail, website: null, services: [], pickupEnabled: true, deliveryEnabled: false, deliveryFeeCents: 499,
    status: 'pending', verifiedAt: null, deletedAt: null, createdAt: nowIso(), updatedAt: nowIso(),
  });
  for (let d = 0; d < 7; d++) await deps.db.storeHours.insert({ id: uuid(), storeId: store.id, dayOfWeek: d, opens: '08:00', closes: '21:00', closed: false });
  await deps.db.userRoles.insert({ id: uuid(), userId: u.id, role: 'merchant_admin', businessId: business.id, createdAt: nowIso() });
  await audit(deps, ctx, 'merchant.applied', 'business', business.id, null, { legalName: business.legalName, storeId: store.id });
  return { business, store, marketName: market?.name ?? null };
}

export async function myBusinesses(deps: Deps, ctx: RequestContext) {
  const u = requireUser(ctx);
  const ids = await accessibleStoreIds(deps, ctx);
  const stores = [];
  for (const id of ids) {
    const s = (await deps.db.stores.get(id))!;
    const staff = await deps.db.storeUsers.findOne({ storeId: id, userId: u.id });
    const business = await deps.db.businesses.get(s.businessId);
    stores.push({ ...s, businessName: business?.dbaName ?? business?.legalName, businessStatus: business?.status, myRole: staff ? staff.staffRole : 'owner', capabilities: staff?.capabilities ?? null });
  }
  const businesses = [];
  for (const r of await deps.db.userRoles.findMany({ userId: u.id, role: 'merchant_admin' })) if (r.businessId) businesses.push(await deps.db.businesses.get(r.businessId));
  return { stores, businesses: businesses.filter(Boolean) };
}

// ─── Dashboard & reports ─────────────────────────────────────────────────
function dayKey(iso: string) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago' }).format(new Date(iso));
}

export async function dashboard(deps: Deps, ctx: RequestContext, storeId: string) {
  const store = await assertStoreAccess(deps, ctx, storeId, 'orders.view');
  const orders = await deps.db.orders.findMany({ storeId });
  const today = dayKey(nowIso());
  const placed = orders.filter((o) => !['pending_payment', 'payment_failed'].includes(o.status));
  const listings = await deps.db.storeProducts.findMany({ storeId });
  const offers = await deps.db.offers.findMany({ storeId, status: 'active' });
  const now = new Date();
  const incoming = await deps.db.storeOrders.findMany({ sellerStoreId: storeId });
  const outgoing = await deps.db.storeOrders.findMany({ buyerStoreId: storeId });
  const views = await deps.db.analyticsEvents.findMany({ storeId, name: { $in: ['store_view', 'product_view'] } });
  const since7 = Date.now() - 7 * 86400_000;
  const salesTrend: { day: string; salesCents: number; orders: number }[] = [];
  for (let i = 13; i >= 0; i--) {
    const d = dayKey(new Date(Date.now() - i * 86400_000).toISOString());
    const dayOrders = placed.filter((o) => dayKey(o.createdAt) === d && o.status !== 'cancelled');
    salesTrend.push({ day: d, salesCents: dayOrders.reduce((s, o) => s + o.totalCents, 0), orders: dayOrders.length });
  }
  const lowStock = listings.filter((l) => l.visible && stockStatus(l) !== 'in_stock');
  const products = new Map((await deps.db.products.findMany({ id: { $in: lowStock.map((l) => l.productId) } })).map((p) => [p.id, p]));
  const recent = placed.sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 6);
  return {
    store: { id: store.id, name: store.name, status: store.status, verified: !!store.verifiedAt, ...openStatus(store, await deps.db.storeHours.findMany({ storeId })) },
    metrics: {
      ordersToday: placed.filter((o) => dayKey(o.createdAt) === today).length,
      pendingOrders: placed.filter((o) => ['confirmed', 'processing'].includes(o.status)).length,
      salesTodayCents: placed.filter((o) => dayKey(o.createdAt) === today && o.status !== 'cancelled').reduce((s, o) => s + o.totalCents, 0),
      sales7dCents: placed.filter((o) => new Date(o.createdAt).getTime() >= since7 && o.status !== 'cancelled').reduce((s, o) => s + o.totalCents, 0),
      activeProducts: listings.filter((l) => l.visible && l.quantity > 0).length,
      lowStockProducts: lowStock.length,
      activeOffers: offers.filter((o) => new Date(o.startAt) <= now && new Date(o.endAt) > now).length,
      storeViews7d: views.filter((v) => v.name === 'store_view' && new Date(v.createdAt).getTime() >= since7).length,
      productViews7d: views.filter((v) => v.name === 'product_view' && new Date(v.createdAt).getTime() >= since7).length,
      storeOrdersIncoming: incoming.filter((s) => s.status === 'pending_acceptance').length,
      storeOrdersOpen: [...incoming, ...outgoing].filter((s) => ['accepted', 'preparing', 'ready'].includes(s.status)).length,
      staleListings: listings.filter((l) => isStale(l.updatedAt)).length,
    },
    salesTrend,
    lowStock: lowStock.slice(0, 8).map((l) => ({ storeProductId: l.id, name: products.get(l.productId)?.name ?? '', quantity: l.quantity, threshold: l.lowStockThreshold, status: stockStatus(l) })),
    recentOrders: recent.map((o) => ({ id: o.id, number: o.number, status: o.status, totalCents: o.totalCents, fulfillmentType: o.fulfillmentType, createdAt: o.createdAt })),
  };
}

export async function reports(deps: Deps, ctx: RequestContext, storeId: string, days = 30) {
  await assertStoreAccess(deps, ctx, storeId, 'orders.view');
  const since = Date.now() - days * 86400_000;
  const orders = (await deps.db.orders.findMany({ storeId })).filter((o) => new Date(o.createdAt).getTime() >= since && !['pending_payment', 'payment_failed', 'cancelled'].includes(o.status));
  const items = await deps.db.orderItems.findMany({ orderId: { $in: orders.map((o) => o.id) } });
  const byProduct = new Map<string, { name: string; units: number; revenueCents: number }>();
  for (const it of items) {
    const r = byProduct.get(it.productId) ?? { name: it.productName, units: 0, revenueCents: 0 };
    r.units += it.quantity;
    r.revenueCents += it.totalCents;
    byProduct.set(it.productId, r);
  }
  const events = (await deps.db.analyticsEvents.findMany({ storeId })).filter((e) => new Date(e.createdAt).getTime() >= since);
  const count = (n: string) => events.filter((e) => e.name === n).length;
  const fulfillment = { pickup: 0, curbside: 0, delivery: 0 } as Record<string, number>;
  for (const o of orders) fulfillment[o.fulfillmentType]++;
  const daily: { day: string; salesCents: number; orders: number }[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = dayKey(new Date(Date.now() - i * 86400_000).toISOString());
    const dayOrders = orders.filter((o) => dayKey(o.createdAt) === d);
    daily.push({ day: d, salesCents: dayOrders.reduce((s, o) => s + o.totalCents, 0), orders: dayOrders.length });
  }
  const b2bSold = (await deps.db.storeOrders.findMany({ sellerStoreId: storeId, status: 'completed' })).filter((s) => new Date(s.updatedAt).getTime() >= since);
  return {
    days,
    totals: {
      orders: orders.length,
      salesCents: orders.reduce((s, o) => s + o.totalCents, 0),
      avgOrderCents: orders.length ? Math.round(orders.reduce((s, o) => s + o.totalCents, 0) / orders.length) : 0,
      discountCents: orders.reduce((s, o) => s + o.discountCents, 0),
      b2bSalesCents: b2bSold.reduce((s, o) => s + o.subtotalCents, 0),
    },
    funnel: { storeViews: count('store_view'), productViews: count('product_view'), addToCart: count('add_to_cart'), purchases: orders.length },
    fulfillment,
    daily,
    topProducts: [...byProduct.values()].sort((a, b) => b.revenueCents - a.revenueCents).slice(0, 10),
    inventoryChanges: events.filter((e) => e.name === 'inventory_changed').length,
  };
}

// ─── Store profile, hours, staff ─────────────────────────────────────────
export async function updateStore(deps: Deps, ctx: RequestContext, storeId: string, input: z.infer<typeof Schemas.storeUpdate>) {
  const store = await assertStoreAccess(deps, ctx, storeId);
  await requireOwnerOrManager(deps, ctx, storeId);
  const patch = { ...input, updatedAt: nowIso() };
  if ((input.zip && input.zip !== store.zip) && input.latitude == null) {
    const g = (await deps.geocoder.geocode(input.zip))[0];
    if (!g) throw invalid('We could not locate that ZIP code.', { field: 'zip' });
    Object.assign(patch, { latitude: g.lat, longitude: g.lng, county: g.county });
  }
  const { before, after } = diff(store as any, patch);
  const updated = await deps.db.stores.update(storeId, patch);
  await audit(deps, ctx, 'store.updated', 'store', storeId, before, after);
  await deps.events.publish('store.status_changed', { storeId, status: updated.status });
  return updated;
}

async function requireOwnerOrManager(deps: Deps, ctx: RequestContext, storeId: string) {
  const u = requireUser(ctx);
  const store = (await deps.db.stores.get(storeId))!;
  const owner = await deps.db.userRoles.findOne({ userId: u.id, role: 'merchant_admin', businessId: store.businessId });
  if (owner || u.roles.includes('platform_admin')) return;
  const staff = await deps.db.storeUsers.findOne({ userId: u.id, storeId });
  if (staff?.staffRole !== 'manager') throw forbidden('Only the store owner or a manager can change this.');
}

export async function getHours(deps: Deps, ctx: RequestContext, storeId: string) {
  await assertStoreAccess(deps, ctx, storeId);
  return deps.db.storeHours.findMany({ storeId }, { orderBy: [['dayOfWeek', 'asc']] });
}

export async function setHours(deps: Deps, ctx: RequestContext, storeId: string, input: z.infer<typeof Schemas.hours>) {
  await assertStoreAccess(deps, ctx, storeId);
  await requireOwnerOrManager(deps, ctx, storeId);
  const before = await deps.db.storeHours.findMany({ storeId });
  for (const h of before) await deps.db.storeHours.delete(h.id);
  for (const h of input.hours) {
    if (!h.closed && h.closes <= h.opens) throw invalid(`Closing time must be after opening time on day ${h.dayOfWeek}.`);
    await deps.db.storeHours.insert({ id: uuid(), storeId, ...h });
  }
  await audit(deps, ctx, 'store.hours_updated', 'store', storeId, before, input.hours);
  return getHours(deps, ctx, storeId);
}

export async function listStaff(deps: Deps, ctx: RequestContext, storeId: string) {
  await assertStoreAccess(deps, ctx, storeId);
  const staff = await deps.db.storeUsers.findMany({ storeId });
  const out = [];
  for (const s of staff) {
    const u = await deps.db.users.get(s.userId);
    out.push({ ...s, fullName: u?.fullName, email: u?.email, status: u?.status });
  }
  return out;
}

export async function addStaff(deps: Deps, ctx: RequestContext, storeId: string, input: z.infer<typeof Schemas.employee>) {
  const store = await assertStoreAccess(deps, ctx, storeId);
  const u = requireUser(ctx);
  if (!(await deps.db.userRoles.findOne({ userId: u.id, role: 'merchant_admin', businessId: store.businessId }))) throw forbidden('Only the store owner can add staff.');
  let user = await deps.db.users.findOne({ email: input.email });
  if (!user) {
    user = await deps.db.users.insert({
      id: uuid(), email: input.email, passwordHash: '!invited', fullName: input.fullName, phone: null, status: 'pending_verification', emailVerifiedAt: null,
      mfaEnabled: false, failedLogins: 0, lockedUntil: null, marketingConsent: false, locationSharing: false, deletedAt: null, createdAt: nowIso(), updatedAt: nowIso(),
    });
    await deps.db.userRoles.insert({ id: uuid(), userId: user.id, role: 'consumer', businessId: null, createdAt: nowIso() });
  }
  if (await deps.db.storeUsers.findOne({ storeId, userId: user.id })) throw new AppError('CONFLICT', `${input.email} already works at this store.`);
  if (!(await deps.db.userRoles.findOne({ userId: user.id, role: 'store_employee' }))) await deps.db.userRoles.insert({ id: uuid(), userId: user.id, role: 'store_employee', businessId: store.businessId, createdAt: nowIso() });
  const su = await deps.db.storeUsers.insert({ id: uuid(), storeId, userId: user.id, staffRole: input.staffRole, capabilities: input.capabilities, createdAt: nowIso() });
  await deps.email.send({ to: input.email, kind: 'staff_invite', subject: `You've been added to ${store.name} on RetailGeo`, body: `Sign in or set a password at ${deps.config.publicWebUrl}/#/forgot to start.` });
  await audit(deps, ctx, 'staff.added', 'store_user', su.id, null, { email: input.email, staffRole: input.staffRole, capabilities: input.capabilities });
  return su;
}

export async function updateStaff(deps: Deps, ctx: RequestContext, storeId: string, staffId: string, input: z.infer<typeof Schemas.employeeUpdate>) {
  await assertStoreAccess(deps, ctx, storeId);
  await requireOwnerOrManager(deps, ctx, storeId);
  const s = await deps.db.storeUsers.get(staffId);
  if (!s || s.storeId !== storeId) throw notFound('Staff member');
  const updated = await deps.db.storeUsers.update(staffId, input);
  await audit(deps, ctx, 'staff.updated', 'store_user', staffId, { staffRole: s.staffRole, capabilities: s.capabilities }, input);
  return updated;
}

export async function removeStaff(deps: Deps, ctx: RequestContext, storeId: string, staffId: string) {
  await assertStoreAccess(deps, ctx, storeId);
  await requireOwnerOrManager(deps, ctx, storeId);
  const s = await deps.db.storeUsers.get(staffId);
  if (!s || s.storeId !== storeId) throw notFound('Staff member');
  await deps.db.storeUsers.delete(staffId);
  await audit(deps, ctx, 'staff.removed', 'store_user', staffId, s, null);
  return { ok: true };
}

// ─── Products & inventory ────────────────────────────────────────────────
function inventoryRow(l: StoreProduct, p: Product | undefined, brand: string | null, category: string | null) {
  return {
    ...l,
    product: p ? { id: p.id, name: p.name, sku: p.sku, upc: p.upc, size: p.size, unit: p.unit, images: p.images, status: p.status, categoryId: p.categoryId } : null,
    brand, category,
    stockStatus: stockStatus(l),
    stale: isStale(l.updatedAt),
  };
}

export async function listInventory(deps: Deps, ctx: RequestContext, storeId: string, q: { q?: string; status?: string; page?: number; pageSize?: number }) {
  await assertStoreAccess(deps, ctx, storeId, 'orders.view');
  const listings = await deps.db.storeProducts.findMany({ storeId });
  const products = new Map((await deps.db.products.findMany({ id: { $in: listings.map((l) => l.productId) } })).map((p) => [p.id, p]));
  const brands = new Map((await deps.db.brands.findMany()).map((b) => [b.id, b.name]));
  const cats = new Map((await deps.db.categories.findMany()).map((c) => [c.id, c.name]));
  let rows = listings.map((l) => {
    const p = products.get(l.productId);
    return inventoryRow(l, p, p?.brandId ? brands.get(p.brandId) ?? null : null, p ? cats.get(p.categoryId) ?? null : null);
  });
  if (q.q) {
    const t = q.q.toLowerCase();
    rows = rows.filter((r) => r.product?.name.toLowerCase().includes(t) || r.product?.sku.toLowerCase().includes(t) || r.product?.upc?.includes(t) || r.storeSku?.toLowerCase().includes(t));
  }
  if (q.status === 'stale') rows = rows.filter((r) => r.stale);
  else if (q.status === 'hidden') rows = rows.filter((r) => !r.visible);
  else if (q.status === 'b2b') rows = rows.filter((r) => r.b2bEnabled);
  else if (q.status) rows = rows.filter((r) => r.stockStatus === q.status);
  rows.sort((a, b) => (a.product?.name ?? '').localeCompare(b.product?.name ?? ''));
  const summary = {
    total: listings.length,
    inStock: rows.filter((r) => r.stockStatus === 'in_stock').length,
    lowStock: listings.filter((l) => stockStatus(l) === 'low_stock').length,
    outOfStock: listings.filter((l) => stockStatus(l) === 'out_of_stock').length,
    stale: listings.filter((l) => isStale(l.updatedAt)).length,
  };
  return { summary, ...paginate(rows, q.page, q.pageSize ?? 50) };
}

async function recordInventoryChange(deps: Deps, ctx: RequestContext, before: StoreProduct, after: StoreProduct, reason: string, source: InventorySource) {
  const delta = after.quantity - before.quantity;
  if (delta !== 0) {
    await deps.db.inventoryEvents.insert({ id: uuid(), storeProductId: after.id, storeId: after.storeId, delta, quantityAfter: after.quantity, reason, source, actorId: ctx.user?.id ?? null, createdAt: nowIso() });
    await deps.events.publish('inventory.changed', { storeId: after.storeId, storeProductId: after.id, delta, quantityAfter: after.quantity, source });
    if (stockStatus(after) !== 'in_stock' && stockStatus(before) === 'in_stock') {
      const p = await deps.db.products.get(after.productId);
      await deps.events.publish('inventory.low_stock', { storeId: after.storeId, storeProductId: after.id, productName: p?.name ?? 'Product', quantity: after.quantity });
    }
  }
}

export async function updateListing(deps: Deps, ctx: RequestContext, storeId: string, listingId: string, input: z.infer<typeof Schemas.listingUpdate>) {
  const onlyStock = Object.keys(input).every((k) => ['quantity', 'reason', 'lowStockThreshold'].includes(k));
  await assertStoreAccess(deps, ctx, storeId, onlyStock ? 'inventory.manage' : 'products.manage');
  const l = await deps.db.storeProducts.get(listingId);
  if (!l || l.storeId !== storeId) throw notFound('Listing');
  const { reason, ...patch } = input;
  const price = patch.priceCents ?? l.priceCents;
  if (patch.promoPriceCents != null && patch.promoPriceCents >= price) throw invalid('Sale price must be lower than the regular price.', { field: 'promoPriceCents' });
  if (patch.b2bPriceCents != null && patch.b2bPriceCents <= 0) throw invalid('Wholesale price must be greater than $0.', { field: 'b2bPriceCents' });
  if (patch.maxOrderQty != null && patch.maxOrderQty < (patch.minOrderQty ?? l.minOrderQty)) throw invalid('Maximum order quantity must be at least the minimum.');
  if (patch.priceCents != null && l.priceCents > 0 && (patch.priceCents > l.priceCents * 10 || patch.priceCents < l.priceCents / 10)) {
    throw invalid(`That price is more than 10× different from the current ${formatUSD(l.priceCents)}. Check for a typo.`, { field: 'priceCents' });
  }
  const updated = await deps.db.storeProducts.update(listingId, { ...patch, source: 'manual', updatedAt: nowIso() });
  await recordInventoryChange(deps, ctx, l, updated, reason ?? 'manual adjustment', 'manual');
  const { before, after } = diff(l as any, patch);
  if (Object.keys(after).length) await audit(deps, ctx, 'listing.updated', 'store_product', listingId, before, after);
  return updated;
}

export async function createProduct(deps: Deps, ctx: RequestContext, storeId: string, input: z.infer<typeof Schemas.productCreate>) {
  await assertStoreAccess(deps, ctx, storeId, 'products.manage');
  if (!(await deps.db.categories.get(input.categoryId))) throw invalid('Choose a valid category.', { field: 'categoryId' });
  // Duplicate detection: reuse the platform catalog entry when UPC matches.
  let product = input.upc ? await deps.db.products.findOne({ upc: input.upc }) : null;
  const reused = !!product;
  if (!product) {
    const sameSku = await deps.db.products.findOne({ sku: input.sku });
    if (sameSku) throw new AppError('CONFLICT', `SKU ${input.sku} is already used by "${sameSku.name}". Use its UPC to list the same product, or pick another SKU.`, { field: 'sku' });
    let brandId: string | null = null;
    if (input.brand) {
      const b = (await deps.db.brands.findMany()).find((x) => x.name.toLowerCase() === input.brand!.toLowerCase());
      brandId = b?.id ?? (await deps.db.brands.insert({ id: uuid(), name: input.brand })).id;
    }
    product = await deps.db.products.insert({
      id: uuid(), categoryId: input.categoryId, brandId, name: input.name, slug: `${slugify(input.name)}-${uuid().slice(0, 4)}`, description: input.description,
      upc: input.upc ?? null, sku: input.sku, unit: input.unit, size: input.size ?? null, attributes: input.attributes, images: input.images,
      status: 'active', createdByStoreId: storeId, deletedAt: null, createdAt: nowIso(), updatedAt: nowIso(),
    });
    for (const v of input.variants) await deps.db.variants.insert({ id: uuid(), productId: product.id, name: v.name, sku: v.sku, upc: v.upc ?? null, attributes: {} });
    await deps.events.publish('product.upserted', { productId: product.id });
  }
  if (await deps.db.storeProducts.findOne({ storeId, productId: product.id })) throw new AppError('CONFLICT', `"${product.name}" is already in your catalog. Edit its price and stock in Inventory.`);
  const listing = await deps.db.storeProducts.insert({
    id: uuid(), storeId, productId: product.id, variantId: null, storeSku: input.listing.storeSku ?? null, priceCents: input.listing.priceCents, promoPriceCents: null,
    quantity: input.listing.quantity, lowStockThreshold: input.listing.lowStockThreshold, minOrderQty: 1, maxOrderQty: null, visible: true,
    b2bEnabled: false, b2bPriceCents: null, b2bMinQty: 1, b2bUnit: 'each', availableFrom: null, availableUntil: null, source: 'manual', updatedAt: nowIso(), createdAt: nowIso(),
  });
  await deps.db.inventoryEvents.insert({ id: uuid(), storeProductId: listing.id, storeId, delta: listing.quantity, quantityAfter: listing.quantity, reason: 'initial stock', source: 'manual', actorId: ctx.user?.id ?? null, createdAt: nowIso() });
  await audit(deps, ctx, 'product.listed', 'store_product', listing.id, null, { productId: product.id, reusedCatalogEntry: reused, priceCents: listing.priceCents });
  return { product, listing, reusedCatalogEntry: reused };
}

export async function inventoryHistory(deps: Deps, ctx: RequestContext, storeId: string, listingId: string) {
  await assertStoreAccess(deps, ctx, storeId, 'orders.view');
  return deps.db.inventoryEvents.findMany({ storeProductId: listingId }, { orderBy: [['createdAt', 'desc']], limit: 50 });
}

/**
 * CSV import (Phase 1 bulk update path). Columns (header required):
 *   sku|upc, price, quantity[, promo_price, low_stock_threshold, visible, name, category, brand, size]
 * Rows matching an existing listing update it; rows with a known catalog UPC/SKU create a listing;
 * unknown products with name+category create a catalog product.
 */
export async function importInventoryCsv(deps: Deps, ctx: RequestContext, storeId: string, input: z.infer<typeof Schemas.inventoryImport>) {
  await assertStoreAccess(deps, ctx, storeId, 'inventory.manage');
  const rows = parseCsv(input.csv);
  if (rows.length < 2) throw invalid('The file needs a header row and at least one product row.');
  const header = rows[0].map((h) => h.trim().toLowerCase().replace(/\s+/g, '_'));
  const col = (name: string) => header.indexOf(name);
  if (col('sku') < 0 && col('upc') < 0) throw invalid('Add a "sku" or "upc" column.');
  if (col('quantity') < 0 && col('price') < 0) throw invalid('Add a "quantity" and/or "price" column.');
  const cats = await deps.db.categories.findMany();
  const results: { row: number; sku: string; action: 'updated' | 'created' | 'skipped'; message: string }[] = [];
  const listings = await deps.db.storeProducts.findMany({ storeId });
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    if (r.every((c) => !c.trim())) continue;
    const get = (n: string) => (col(n) >= 0 ? (r[col(n)] ?? '').trim() : '');
    const sku = get('sku');
    const upc = get('upc');
    const key = sku || upc;
    const price = get('price') ? Math.round(Number(get('price').replace(/[$,]/g, '')) * 100) : null;
    const qty = get('quantity') ? Number(get('quantity')) : null;
    const promo = get('promo_price') ? Math.round(Number(get('promo_price').replace(/[$,]/g, '')) * 100) : undefined;
    if (price != null && (!Number.isFinite(price) || price <= 0)) { results.push({ row: i + 1, sku: key, action: 'skipped', message: 'Price must be a positive number.' }); continue; }
    if (qty != null && (!Number.isInteger(qty) || qty < 0)) { results.push({ row: i + 1, sku: key, action: 'skipped', message: 'Quantity must be a whole number ≥ 0.' }); continue; }
    if (upc && !/^\d{8,14}$/.test(upc)) { results.push({ row: i + 1, sku: key, action: 'skipped', message: 'UPC must be 8–14 digits.' }); continue; }
    const product = (upc && (await deps.db.products.findOne({ upc }))) || (sku && (await deps.db.products.findOne({ sku }))) || null;
    const listing = product ? listings.find((l) => l.productId === product!.id) : listings.find((l) => l.storeSku && l.storeSku === sku);
    if (listing) {
      const patch: Partial<StoreProduct> = { source: 'csv', updatedAt: nowIso() };
      if (price != null) patch.priceCents = price;
      if (qty != null) patch.quantity = qty;
      if (promo !== undefined) patch.promoPriceCents = promo && promo < (price ?? listing.priceCents) ? promo : null;
      if (get('low_stock_threshold')) patch.lowStockThreshold = Number(get('low_stock_threshold'));
      if (get('visible')) patch.visible = !['false', 'no', '0'].includes(get('visible').toLowerCase());
      if (!input.dryRun) {
        const updated = await deps.db.storeProducts.update(listing.id, patch);
        await recordInventoryChange(deps, ctx, listing, updated, 'CSV import', 'csv');
      }
      results.push({ row: i + 1, sku: key, action: 'updated', message: product?.name ?? 'Updated' });
      continue;
    }
    if (!product) {
      const name = get('name');
      const cat = cats.find((c) => c.name.toLowerCase() === get('category').toLowerCase() || c.slug === get('category').toLowerCase());
      if (!name || !cat || !sku) { results.push({ row: i + 1, sku: key, action: 'skipped', message: 'New products need sku, name and a known category.' }); continue; }
      if (price == null) { results.push({ row: i + 1, sku: key, action: 'skipped', message: 'New products need a price.' }); continue; }
      if (!input.dryRun) {
        const created = await createProduct(deps, ctx, storeId, { name, categoryId: cat.id, sku, upc: upc || undefined, brand: get('brand') || undefined, size: get('size') || undefined, description: '', unit: 'each', images: [], attributes: {}, variants: [], listing: { priceCents: price, quantity: qty ?? 0, lowStockThreshold: 5 } });
        await deps.db.storeProducts.update(created.listing.id, { source: 'csv' });
      }
      results.push({ row: i + 1, sku: key, action: 'created', message: `New product: ${name}` });
      continue;
    }
    if (price == null) { results.push({ row: i + 1, sku: key, action: 'skipped', message: `Add a price to list "${product.name}".` }); continue; }
    if (!input.dryRun) {
      const l = await deps.db.storeProducts.insert({
        id: uuid(), storeId, productId: product.id, variantId: null, storeSku: sku || null, priceCents: price, promoPriceCents: null, quantity: qty ?? 0,
        lowStockThreshold: 5, minOrderQty: 1, maxOrderQty: null, visible: true, b2bEnabled: false, b2bPriceCents: null, b2bMinQty: 1, b2bUnit: 'each',
        availableFrom: null, availableUntil: null, source: 'csv', updatedAt: nowIso(), createdAt: nowIso(),
      });
      listings.push(l);
    }
    results.push({ row: i + 1, sku: key, action: 'created', message: `Listed catalog product: ${product.name}` });
  }
  const summary = { updated: results.filter((r) => r.action === 'updated').length, created: results.filter((r) => r.action === 'created').length, skipped: results.filter((r) => r.action === 'skipped').length };
  if (!input.dryRun) await audit(deps, ctx, 'inventory.csv_import', 'store', storeId, null, summary);
  return { dryRun: input.dryRun, summary, results };
}

export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') q = false;
      else cell += ch;
    } else if (ch === '"') q = true;
    else if (ch === ',') { row.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); rows.push(row); row = []; cell = '';
    } else cell += ch;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

// ─── Orders ───────────────────────────────────────────────────────────────
export async function listStoreOrders(deps: Deps, ctx: RequestContext, storeId: string, q: { status?: string; page?: number; pageSize?: number; q?: string }) {
  await assertStoreAccess(deps, ctx, storeId, 'orders.view');
  let orders = await deps.db.orders.findMany({ storeId }, { orderBy: [['createdAt', 'desc']] });
  orders = orders.filter((o) => o.status !== 'pending_payment');
  if (q.status === 'open') orders = orders.filter((o) => ['confirmed', 'processing', 'ready', 'out_for_delivery'].includes(o.status));
  else if (q.status) orders = orders.filter((o) => o.status === q.status);
  if (q.q) orders = orders.filter((o) => o.number.toLowerCase().includes(q.q!.toLowerCase()));
  const out = [];
  for (const o of paginate(orders, q.page, q.pageSize ?? 25).items) {
    const u = await deps.db.users.get(o.userId);
    const items = await deps.db.orderItems.findMany({ orderId: o.id });
    out.push({ ...o, idempotencyKey: undefined, customerName: u?.fullName ?? 'Customer', itemCount: items.reduce((s, i) => s + i.quantity, 0) });
  }
  const page = paginate(orders, q.page, q.pageSize ?? 25);
  return { ...page, items: out };
}

export async function merchantOrder(deps: Deps, ctx: RequestContext, storeId: string, orderId: string) {
  await assertStoreAccess(deps, ctx, storeId, 'orders.view');
  const o = await deps.db.orders.get(orderId);
  if (!o || o.storeId !== storeId) throw notFound('Order');
  return getOrder(deps, ctx, orderId, { asMerchant: true });
}

export async function setOrderStatus(deps: Deps, ctx: RequestContext, storeId: string, orderId: string, input: z.infer<typeof Schemas.merchantOrderStatus>) {
  await assertStoreAccess(deps, ctx, storeId, 'orders.process');
  const o = await deps.db.orders.get(orderId);
  if (!o || o.storeId !== storeId) throw notFound('Order');
  await transitionOrder(deps, ctx, orderId, input.status as OrderStatus, input.note);
  await audit(deps, ctx, 'order.status_changed', 'order', orderId, { status: o.status }, { status: input.status });
  return merchantOrder(deps, ctx, storeId, orderId);
}

// ─── Offers ───────────────────────────────────────────────────────────────
export async function listOffers(deps: Deps, ctx: RequestContext, storeId: string) {
  await assertStoreAccess(deps, ctx, storeId, 'orders.view');
  const offers = await deps.db.offers.findMany({ storeId }, { orderBy: [['createdAt', 'desc']] });
  const now = new Date();
  const out = [];
  for (const o of offers) {
    const product = o.productId ? await deps.db.products.get(o.productId) : null;
    const category = o.categoryId ? await deps.db.categories.get(o.categoryId) : null;
    const effective = o.status === 'active' && new Date(o.endAt) <= now ? 'expired' : o.status === 'active' && new Date(o.startAt) > now ? 'scheduled' : o.status;
    out.push({ ...o, effectiveStatus: effective, productName: product?.name ?? null, categoryName: category?.name ?? null });
  }
  return out;
}

async function validateOfferTarget(deps: Deps, storeId: string, input: z.infer<typeof Schemas.offer>) {
  if (input.scope === 'product') {
    const l = await deps.db.storeProducts.findOne({ storeId, productId: input.productId! });
    if (!l) throw invalid('That product is not in your store catalog.', { field: 'productId' });
    if (input.discountType === 'fixed' && input.discountValue >= l.priceCents) throw invalid('The discount is larger than the product price.', { field: 'discountValue' });
  }
}

export async function createOffer(deps: Deps, ctx: RequestContext, storeId: string, input: z.infer<typeof Schemas.offer>) {
  await assertStoreAccess(deps, ctx, storeId, 'offers.manage');
  await validateOfferTarget(deps, storeId, input);
  const offer: Offer = {
    id: uuid(), storeId, name: input.name, description: input.description, scope: input.scope,
    productId: input.scope === 'product' ? input.productId ?? null : null, categoryId: input.scope === 'category' ? input.categoryId ?? null : null,
    discountType: input.discountType, discountValue: input.discountValue, buyQty: input.buyQty ?? null, getQty: input.getQty ?? null,
    startAt: input.startAt, endAt: input.endAt, eligibility: input.eligibility, geoRadiusMi: input.geoRadiusMi ?? null, usageLimit: input.usageLimit ?? null,
    usageCount: 0, status: input.status, createdAt: nowIso(), updatedAt: nowIso(),
  };
  await deps.db.offers.insert(offer);
  await audit(deps, ctx, 'offer.created', 'offer', offer.id, null, offer);
  if (offer.status === 'active') await deps.events.publish('offer.published', { offerId: offer.id, storeId });
  return offer;
}

export async function updateOffer(deps: Deps, ctx: RequestContext, storeId: string, offerId: string, input: z.infer<typeof Schemas.offer>) {
  await assertStoreAccess(deps, ctx, storeId, 'offers.manage');
  const o = await deps.db.offers.get(offerId);
  if (!o || o.storeId !== storeId) throw notFound('Offer');
  await validateOfferTarget(deps, storeId, input);
  const patch = { ...input, productId: input.scope === 'product' ? input.productId ?? null : null, categoryId: input.scope === 'category' ? input.categoryId ?? null : null, updatedAt: nowIso() };
  const updated = await deps.db.offers.update(offerId, patch);
  const d = diff(o as any, patch);
  await audit(deps, ctx, 'offer.updated', 'offer', offerId, d.before, d.after);
  return updated;
}

export async function setOfferStatus(deps: Deps, ctx: RequestContext, storeId: string, offerId: string, status: 'active' | 'paused') {
  await assertStoreAccess(deps, ctx, storeId, 'offers.manage');
  const o = await deps.db.offers.get(offerId);
  if (!o || o.storeId !== storeId) throw notFound('Offer');
  await audit(deps, ctx, 'offer.status', 'offer', offerId, { status: o.status }, { status });
  return deps.db.offers.update(offerId, { status, updatedAt: nowIso() });
}
