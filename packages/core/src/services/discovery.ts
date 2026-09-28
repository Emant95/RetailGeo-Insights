import type { z } from 'zod';
import type { Deps, RequestContext } from '../context';
import type { Schemas } from '../schemas';
import type { Category, Offer, Product, Store, StoreHours, StoreProduct, StoreType } from '../types';
import { notFound, invalid } from '../errors';
import { DEFAULT_LOCATION, roundMi, extractRadius, distanceMi } from '../geo';
import { displayPrice, isOfferLive, stockStatus, isStale, type PricingContext } from '../pricing';
import { nowIso, uuid, paginate } from '../util';
import { cleanQuery } from '../text-match';

// ─── Helpers ─────────────────────────────────────────────────────────────────
const STORE_TZ: Record<string, string> = { TX: 'America/Chicago', OK: 'America/Chicago', LA: 'America/Chicago', CA: 'America/Los_Angeles', NY: 'America/New_York', FL: 'America/New_York' };

export function openStatus(store: Store, hours: StoreHours[], at = new Date()) {
  const tz = STORE_TZ[store.state] ?? 'America/Chicago';
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(at);
  const wd = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(parts.find((p) => p.type === 'weekday')!.value);
  const hh = parts.find((p) => p.type === 'hour')!.value.replace('24', '00');
  const now = `${hh}:${parts.find((p) => p.type === 'minute')!.value}`;
  const today = hours.find((h) => h.dayOfWeek === wd);
  if (!today || today.closed) return { isOpen: false, label: 'Closed today' };
  if (today.opens === '00:00' && (today.closes === '24:00' || today.closes === '23:59')) return { isOpen: true, label: 'Open 24 hours' };
  const fmt = (t: string) => {
    const [h, m] = t.split(':').map(Number);
    const h12 = ((h + 11) % 12) + 1;
    return `${h12}${m ? `:${String(m).padStart(2, '0')}` : ''} ${h < 12 || h === 24 ? 'AM' : 'PM'}`;
  };
  if (now >= today.opens && now < today.closes) return { isOpen: true, label: `Open until ${fmt(today.closes)}` };
  if (now < today.opens) return { isOpen: false, label: `Opens at ${fmt(today.opens)}` };
  return { isOpen: false, label: 'Closed now' };
}

async function pricingCtx(deps: Deps, ctx: RequestContext): Promise<PricingContext> {
  const isNew = ctx.user ? (await deps.db.orders.count({ userId: ctx.user.id })) === 0 : true;
  return { now: new Date(), isNewCustomer: isNew, categories: await deps.db.categories.findMany() };
}

async function liveOffersFor(deps: Deps, storeIds: string[]) {
  if (storeIds.length === 0) return [];
  const offers = await deps.db.offers.findMany({ storeId: { $in: storeIds }, status: 'active' });
  const now = new Date();
  return offers.filter((o) => isOfferLive(o, now));
}

function resolveLocation(q: { lat?: number; lng?: number }) {
  return q.lat != null && q.lng != null ? { lat: q.lat, lng: q.lng } : { lat: DEFAULT_LOCATION.lat, lng: DEFAULT_LOCATION.lng };
}

export function storeCard(store: Store, distance: number | null, hours: StoreHours[]) {
  return {
    id: store.id, name: store.name, slug: store.slug, storeType: store.storeType,
    addressLine1: store.addressLine1, city: store.city, state: store.state, zip: store.zip,
    latitude: store.latitude, longitude: store.longitude,
    distanceMi: distance == null ? null : roundMi(distance),
    pickupEnabled: store.pickupEnabled, deliveryEnabled: store.deliveryEnabled,
    verified: !!store.verifiedAt, status: store.status,
    ...openStatus(store, hours),
  };
}

function listingView(l: StoreProduct, product: Product, offers: Offer[], pctx: PricingContext) {
  const dp = displayPrice(l, product, offers, pctx);
  return {
    storeProductId: l.id, priceCents: dp.priceCents, wasCents: dp.wasCents, listPriceCents: l.priceCents,
    offer: dp.offer ? { id: dp.offer.id, name: dp.offer.name, discountType: dp.offer.discountType, discountValue: dp.offer.discountValue, buyQty: dp.offer.buyQty, getQty: dp.offer.getQty, endAt: dp.offer.endAt } : null,
    quantity: l.quantity, stockStatus: stockStatus(l), minOrderQty: l.minOrderQty, maxOrderQty: l.maxOrderQty,
    updatedAt: l.updatedAt, stale: isStale(l.updatedAt),
  };
}

// ─── Locations ─────────────────────────────────────────────────────────────
export async function geocode(deps: Deps, _ctx: RequestContext, q: string) {
  if (!q || q.trim().length < 2) throw invalid('Enter a city, neighborhood or ZIP code.');
  return deps.geocoder.geocode(q);
}

export async function reverseGeocode(deps: Deps, _ctx: RequestContext, lat: number, lng: number) {
  const r = await deps.geocoder.reverse(lat, lng);
  if (!r) throw notFound('A supported location near you');
  return r;
}

export async function listMarkets(deps: Deps) {
  const markets = await deps.db.markets.findMany({}, { orderBy: [['name', 'asc']] });
  const out = [];
  for (const m of markets) out.push({ ...m, storeCount: await deps.db.stores.count({ marketId: m.id, status: 'active', deletedAt: null }) });
  return out;
}

// ─── Catalog ───────────────────────────────────────────────────────────────
export async function categoryTree(deps: Deps) {
  const all = await deps.db.categories.findMany({}, { orderBy: [['sort', 'asc'], ['name', 'asc']] });
  const roots = all.filter((c) => !c.parentId);
  return roots.map((r) => ({ ...r, children: all.filter((c) => c.parentId === r.id) }));
}

async function categoryBySlugOrId(deps: Deps, key?: string): Promise<Category | null> {
  if (!key) return null;
  return (await deps.db.categories.findOne({ slug: key })) ?? (/^[0-9a-f-]{36}$/.test(key) ? await deps.db.categories.get(key) : null);
}

export async function getProduct(deps: Deps, ctx: RequestContext, id: string) {
  const p = await deps.db.products.get(id);
  if (!p || p.deletedAt || p.status !== 'active') throw notFound('Product');
  const brand = p.brandId ? await deps.db.brands.get(p.brandId) : null;
  const category = await deps.db.categories.get(p.categoryId);
  const parent = category?.parentId ? await deps.db.categories.get(category.parentId) : null;
  const variants = await deps.db.variants.findMany({ productId: id });
  let favoriteId: string | null = null;
  if (ctx.user) favoriteId = (await deps.db.favorites.findOne({ userId: ctx.user.id, productId: id }))?.id ?? null;
  return { ...p, brand: brand?.name ?? null, category, parentCategory: parent, variants, favoriteId };
}

/** "Where can I find this item?" — every nearby store carrying the product, with price and stock. */
export async function productAvailability(deps: Deps, ctx: RequestContext, id: string, q: z.infer<typeof Schemas.geoQuery>) {
  const loc = resolveLocation(q);
  const product = await deps.db.products.get(id);
  if (!product) throw notFound('Product');
  const hits = await deps.db.searchListings({ productId: id, lat: loc.lat, lng: loc.lng, radiusMi: q.radius });
  const offers = await liveOffersFor(deps, [...new Set(hits.map((h) => h.store.id))]);
  const pctx = { ...(await pricingCtx(deps, ctx)) };
  const out = [];
  for (const h of hits) {
    const hours = await deps.db.storeHours.findMany({ storeId: h.store.id });
    out.push({ store: storeCard(h.store, h.distanceMi, hours), ...listingView(h.listing, product, offers, { ...pctx, shopperDistanceMi: h.distanceMi }) });
  }
  out.sort((a, b) => (a.stockStatus === 'out_of_stock' ? 1 : 0) - (b.stockStatus === 'out_of_stock' ? 1 : 0) || (a.store.distanceMi ?? 0) - (b.store.distanceMi ?? 0));
  const inStock = out.filter((o) => o.stockStatus !== 'out_of_stock');
  return {
    productId: id,
    center: loc,
    radiusMi: q.radius,
    listings: out,
    summary: {
      storeCount: out.length,
      inStockCount: inStock.length,
      lowestPriceCents: inStock.length ? Math.min(...inStock.map((o) => o.priceCents)) : null,
      nearestInStock: inStock[0]?.store.distanceMi ?? null,
    },
  };
}

// ─── Stores ────────────────────────────────────────────────────────────────
export async function nearbyStores(deps: Deps, _ctx: RequestContext, q: z.infer<typeof Schemas.nearbyStores>) {
  let loc = resolveLocation(q);
  const city = q.city;
  const state = q.state?.toUpperCase();
  if (city && !q.lat) {
    const g = (await deps.geocoder.geocode(`${city}${state ? `, ${state}` : ''}`))[0];
    if (g) loc = { lat: g.lat, lng: g.lng };
  }
  const hits = await deps.db.storesNear({ lat: loc.lat, lng: loc.lng, radiusMi: q.radius, storeTypes: q.type as StoreType[] | undefined, text: q.q ? cleanQuery(q.q) || undefined : undefined, city, state });
  const cards = [];
  for (const h of hits) cards.push(storeCard(h.store, h.distanceMi, await deps.db.storeHours.findMany({ storeId: h.store.id })));
  let filtered = q.openNow ? cards.filter((c) => c.isOpen) : cards;
  if (q.sort === 'name') filtered = [...filtered].sort((a, b) => a.name.localeCompare(b.name));
  const offers = await liveOffersFor(deps, filtered.map((c) => c.id));
  const withOffers = filtered.map((c) => ({ ...c, offerCount: offers.filter((o) => o.storeId === c.id).length }));
  return { center: loc, radiusMi: q.radius, ...paginate(withOffers, q.page, q.pageSize) };
}

export async function getStore(deps: Deps, ctx: RequestContext, idOrSlug: string, q: { lat?: number; lng?: number }) {
  const store = (await deps.db.stores.findOne({ slug: idOrSlug })) ?? (/^[0-9a-f-]{36}$/.test(idOrSlug) ? await deps.db.stores.get(idOrSlug) : null);
  if (!store || store.deletedAt || store.status !== 'active') throw notFound('Store');
  const hours = await deps.db.storeHours.findMany({ storeId: store.id }, { orderBy: [['dayOfWeek', 'asc']] });
  const loc = q.lat != null && q.lng != null ? { lat: q.lat, lng: q.lng } : null;
  const dist = loc ? distanceMi(loc, { lat: store.latitude, lng: store.longitude }) : null;
  const offers = (await liveOffersFor(deps, [store.id])).filter((o) => o.eligibility === 'all' || !ctx.user);
  const productCount = await deps.db.storeProducts.count({ storeId: store.id, visible: true });
  const inStockCount = (await deps.db.storeProducts.findMany({ storeId: store.id, visible: true })).filter((l) => l.quantity > 0).length;
  let favoriteId: string | null = null;
  if (ctx.user) favoriteId = (await deps.db.favorites.findOne({ userId: ctx.user.id, storeId: store.id }))?.id ?? null;
  return {
    ...storeCard(store, dist, hours),
    description: store.description, phone: store.phone, email: store.email, website: store.website, county: store.county,
    services: store.services, serviceRadiusMi: store.serviceRadiusMi, deliveryFeeCents: store.deliveryFeeCents,
    hours, offers, productCount, inStockCount, favoriteId,
    directionsUrl: `https://www.google.com/maps/dir/?api=1&destination=${store.latitude},${store.longitude}`,
  };
}

export async function storeProducts(deps: Deps, ctx: RequestContext, storeId: string, q: { category?: string; q?: string; page?: number; pageSize?: number; inStock?: boolean }) {
  const store = await deps.db.stores.get(storeId);
  if (!store || store.status !== 'active') throw notFound('Store');
  const cat = await categoryBySlugOrId(deps, q.category);
  const hits = await deps.db.searchListings({ storeIds: [storeId], text: q.q || undefined, categoryIds: cat ? [cat.id] : undefined, inStockOnly: q.inStock });
  const offers = await liveOffersFor(deps, [storeId]);
  const pctx = await pricingCtx(deps, ctx);
  const brands = new Map((await deps.db.brands.findMany()).map((b) => [b.id, b.name]));
  const items = hits
    .sort((a, b) => (q.q ? 0 : a.product.name.localeCompare(b.product.name)))
    .map((h) => ({ product: { id: h.product.id, name: h.product.name, size: h.product.size, images: h.product.images, categoryId: h.product.categoryId, brand: h.product.brandId ? brands.get(h.product.brandId) ?? null : null }, ...listingView(h.listing, h.product, offers, pctx) }));
  return paginate(items, q.page, q.pageSize ?? 48);
}

// ─── Search ────────────────────────────────────────────────────────────────
/**
 * Product search across nearby stores. Supports name/brand/category/SKU/UPC,
 * partial matches, typo tolerance, location radius, filters, sorting and paging.
 * Phase 2 can put semantic / natural-language search behind the same endpoint.
 */
export async function search(deps: Deps, ctx: RequestContext, q: z.infer<typeof Schemas.search>) {
  let loc = resolveLocation(q);
  const { radiusMi: parsedRadius, rest: afterRadius } = extractRadius(q.q);
  let radius = parsedRadius ?? q.radius;
  let rest = afterRadius;
  let placeLabel: string | null = null;
  // "… in Dallas, Texas" / "… in 75214" → search around that place instead of the shopper.
  const place = rest.match(/\bin\s+([A-Za-z .'-]+?(?:,\s*[A-Za-z .]+)?|\d{5})\s*$/i);
  if (place) {
    const g = (await deps.geocoder.geocode(place[1]))[0];
    if (g) {
      loc = { lat: g.lat, lng: g.lng };
      placeLabel = g.label;
      if (!parsedRadius && g.kind === 'city') radius = Math.max(radius, 15);
      rest = rest.slice(0, place.index).trim();
    }
  }
  const text = cleanQuery(rest);
  const cat = await categoryBySlugOrId(deps, q.category);
  const hits = await deps.db.searchListings({
    text: text || undefined, lat: loc.lat, lng: loc.lng, radiusMi: radius,
    categoryIds: cat ? [cat.id] : undefined, storeTypes: q.storeType as StoreType[] | undefined,
  });
  const offers = await liveOffersFor(deps, [...new Set(hits.map((h) => h.store.id))]);
  const pctx = await pricingCtx(deps, ctx);
  const brands = new Map((await deps.db.brands.findMany()).map((b) => [b.id, b.name]));
  const cats = new Map((await deps.db.categories.findMany()).map((c) => [c.id, c]));

  type Agg = { product: Product; score: number; listings: ReturnType<typeof listingView>[]; stores: { id: string; name: string; distanceMi: number | null; storeType: string }[] };
  const byProduct = new Map<string, Agg>();
  for (const h of hits) {
    const lv = listingView(h.listing, h.product, offers, { ...pctx, shopperDistanceMi: h.distanceMi });
    const agg = byProduct.get(h.product.id) ?? { product: h.product, score: h.score, listings: [], stores: [] };
    agg.listings.push(lv);
    agg.stores.push({ id: h.store.id, name: h.store.name, distanceMi: h.distanceMi == null ? null : roundMi(h.distanceMi), storeType: h.store.storeType });
    agg.score = Math.max(agg.score, h.score);
    byProduct.set(h.product.id, agg);
  }
  let results = [...byProduct.values()].map((a) => {
    const idx = a.listings.map((l, i) => i);
    const inStockIdx = idx.filter((i) => a.listings[i].stockStatus !== 'out_of_stock');
    const priceIdx = inStockIdx.length ? inStockIdx : idx;
    const cheapest = priceIdx.reduce((m, i) => (a.listings[i].priceCents < a.listings[m].priceCents ? i : m), priceIdx[0]);
    const nearest = (inStockIdx.length ? inStockIdx : idx).reduce((m, i) => ((a.stores[i].distanceMi ?? 1e9) < (a.stores[m].distanceMi ?? 1e9) ? i : m), (inStockIdx.length ? inStockIdx : idx)[0]);
    const c = cats.get(a.product.categoryId);
    return {
      product: { id: a.product.id, name: a.product.name, size: a.product.size, unit: a.product.unit, images: a.product.images, sku: a.product.sku, upc: a.product.upc, brand: a.product.brandId ? brands.get(a.product.brandId) ?? null : null, category: c?.name ?? null, categoryId: a.product.categoryId },
      score: a.score,
      storeCount: a.listings.length,
      inStockCount: inStockIdx.length,
      minPriceCents: a.listings[cheapest].priceCents,
      maxPriceCents: Math.max(...priceIdx.map((i) => a.listings[i].priceCents)),
      cheapestStore: a.stores[cheapest],
      nearestStore: a.stores[nearest],
      nearestDistanceMi: a.stores[nearest].distanceMi,
      onSale: a.listings.some((l) => !!l.offer || l.wasCents != null),
      bestOffer: a.listings.find((l) => l.offer)?.offer ?? null,
    };
  });
  if (q.inStock) results = results.filter((r) => r.inStockCount > 0);
  if (q.onSale) results = results.filter((r) => r.onSale);
  if (q.minPrice != null) results = results.filter((r) => r.minPriceCents >= q.minPrice! * 100);
  if (q.maxPrice != null) results = results.filter((r) => r.minPriceCents <= q.maxPrice! * 100);
  const sorters: Record<string, (a: (typeof results)[number], b: (typeof results)[number]) => number> = {
    relevance: (a, b) => b.score - a.score || (b.inStockCount > 0 ? 1 : 0) - (a.inStockCount > 0 ? 1 : 0) || (a.nearestDistanceMi ?? 0) - (b.nearestDistanceMi ?? 0),
    distance: (a, b) => (a.nearestDistanceMi ?? 1e9) - (b.nearestDistanceMi ?? 1e9),
    price_asc: (a, b) => a.minPriceCents - b.minPriceCents,
    price_desc: (a, b) => b.minPriceCents - a.minPriceCents,
  };
  results.sort(sorters[q.sort]);

  // Matching stores ("show grocery stores near me")
  const storeHits = text || placeLabel ? await deps.db.storesNear({ lat: loc.lat, lng: loc.lng, radiusMi: radius, text: text || undefined, limit: text ? 6 : 12 }) : [];
  const stores = [];
  for (const h of storeHits) stores.push(storeCard(h.store, h.distanceMi, await deps.db.storeHours.findMany({ storeId: h.store.id })));

  // Privacy: log query with coarse location only.
  await deps.db.searchEvents.insert({
    id: uuid(), userId: ctx.user?.id ?? null, query: q.q.slice(0, 120),
    latRounded: Math.round(loc.lat * 100) / 100, lngRounded: Math.round(loc.lng * 100) / 100, radiusMi: radius,
    resultCount: results.length, createdAt: nowIso(),
  });
  await deps.events.publish('search.performed', { userId: ctx.user?.id ?? null, query: q.q, resultCount: results.length });

  return { query: q.q, interpreted: { text, radiusMi: radius, category: cat?.name ?? null, place: placeLabel }, center: loc, stores, ...paginate(results, q.page, q.pageSize) };
}

// ─── Offers ────────────────────────────────────────────────────────────────
export async function nearbyOffers(deps: Deps, ctx: RequestContext, q: z.infer<typeof Schemas.geoQuery>) {
  const loc = resolveLocation(q);
  const stores = await deps.db.storesNear({ lat: loc.lat, lng: loc.lng, radiusMi: q.radius });
  const offers = await liveOffersFor(deps, stores.map((s) => s.store.id));
  const pctx = await pricingCtx(deps, ctx);
  const out = [];
  for (const o of offers) {
    const hit = stores.find((s) => s.store.id === o.storeId)!;
    if (o.geoRadiusMi != null && (hit.distanceMi ?? 0) > o.geoRadiusMi) continue;
    if (o.eligibility === 'new_customer' && !pctx.isNewCustomer) continue;
    const product = o.productId ? await deps.db.products.get(o.productId) : null;
    const category = o.categoryId ? await deps.db.categories.get(o.categoryId) : null;
    let listing = null;
    if (product) {
      const l = await deps.db.storeProducts.findOne({ storeId: o.storeId, productId: product.id });
      if (l) listing = listingView(l, product, [o], { ...pctx, shopperDistanceMi: hit.distanceMi });
    }
    out.push({
      ...o,
      store: storeCard(hit.store, hit.distanceMi, await deps.db.storeHours.findMany({ storeId: hit.store.id })),
      product: product ? { id: product.id, name: product.name, size: product.size, images: product.images } : null,
      category: category ? { id: category.id, name: category.name, slug: category.slug } : null,
      listing,
    });
  }
  out.sort((a, b) => (a.store.distanceMi ?? 0) - (b.store.distanceMi ?? 0));
  return { center: loc, radiusMi: q.radius, items: out };
}
