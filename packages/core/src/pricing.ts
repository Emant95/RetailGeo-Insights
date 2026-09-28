import type { Offer, Product, StoreProduct, Category, StockStatus } from './types';
import { DEFAULT_TAX_RATES, FALLBACK_TAX_RATE } from './geo';

export interface PricingContext {
  now: Date;
  isNewCustomer: boolean;
  /** Distance from shopper to store, when known — used for geographic promotions. */
  shopperDistanceMi?: number | null;
  categories?: Category[];
}

export function isOfferLive(o: Offer, now: Date): boolean {
  return (
    o.status === 'active' &&
    new Date(o.startAt) <= now &&
    new Date(o.endAt) > now &&
    (o.usageLimit == null || o.usageCount < o.usageLimit)
  );
}

function categoryMatches(offerCat: string, productCat: string, categories?: Category[]) {
  if (offerCat === productCat) return true;
  const c = categories?.find((x) => x.id === productCat);
  return !!c && c.parentId === offerCat;
}

export function offerAppliesTo(o: Offer, product: Product, ctx: PricingContext): boolean {
  if (!isOfferLive(o, ctx.now)) return false;
  if (o.eligibility === 'new_customer' && !ctx.isNewCustomer) return false;
  if (o.geoRadiusMi != null && ctx.shopperDistanceMi != null && ctx.shopperDistanceMi > o.geoRadiusMi) return false;
  if (o.scope === 'product') return o.productId === product.id;
  if (o.scope === 'category') return !!o.categoryId && categoryMatches(o.categoryId, product.categoryId, ctx.categories);
  return true; // store-wide
}

export function baseUnitPrice(sp: Pick<StoreProduct, 'priceCents' | 'promoPriceCents'>): number {
  return sp.promoPriceCents != null && sp.promoPriceCents < sp.priceCents ? sp.promoPriceCents : sp.priceCents;
}

export function offerDiscount(o: Offer, unitCents: number, qty: number): number {
  switch (o.discountType) {
    case 'percent':
      return Math.round((unitCents * qty * Math.min(100, Math.max(0, o.discountValue))) / 100);
    case 'fixed':
      return Math.min(o.discountValue, unitCents) * qty;
    case 'bxgy': {
      const buy = o.buyQty ?? 1;
      const get = o.getQty ?? 1;
      const free = Math.floor(qty / (buy + get)) * get;
      return free * unitCents;
    }
  }
}

export interface LinePrice {
  unitCents: number;
  listUnitCents: number;
  quantity: number;
  discountCents: number;
  totalCents: number;
  offer: Offer | null;
}

export function priceLine(sp: StoreProduct, product: Product, qty: number, offers: Offer[], ctx: PricingContext): LinePrice {
  const unit = baseUnitPrice(sp);
  let best: Offer | null = null;
  let bestDiscount = 0;
  for (const o of offers) {
    if (o.storeId !== sp.storeId || !offerAppliesTo(o, product, ctx)) continue;
    const d = offerDiscount(o, unit, qty);
    if (d > bestDiscount) {
      best = o;
      bestDiscount = d;
    }
  }
  return {
    unitCents: unit,
    listUnitCents: sp.priceCents,
    quantity: qty,
    discountCents: bestDiscount,
    totalCents: unit * qty - bestDiscount,
    offer: best,
  };
}

/** Display price for one unit, after the best single-unit offer (percent/fixed only). */
export function displayPrice(sp: StoreProduct, product: Product, offers: Offer[], ctx: PricingContext) {
  const line = priceLine(sp, product, 1, offers.filter((o) => o.discountType !== 'bxgy'), ctx);
  const bxgy = offers.find((o) => o.discountType === 'bxgy' && o.storeId === sp.storeId && offerAppliesTo(o, product, ctx));
  return {
    priceCents: line.totalCents,
    wasCents: line.totalCents < sp.priceCents ? sp.priceCents : null,
    offer: line.offer ?? bxgy ?? null,
  };
}

export function taxRateFor(state: string, overrides?: Record<string, number>): number {
  return overrides?.[state] ?? DEFAULT_TAX_RATES[state] ?? FALLBACK_TAX_RATE;
}

export function computeTotals(lines: LinePrice[], opts: { state: string; feeCents: number; taxRates?: Record<string, number> }) {
  const subtotal = lines.reduce((s, l) => s + l.unitCents * l.quantity, 0);
  const discount = lines.reduce((s, l) => s + l.discountCents, 0);
  const taxable = subtotal - discount;
  const tax = Math.round((taxable * taxRateFor(opts.state, opts.taxRates)) / 100);
  return {
    subtotalCents: subtotal,
    discountCents: discount,
    taxCents: tax,
    feeCents: opts.feeCents,
    totalCents: taxable + tax + opts.feeCents,
    taxRate: taxRateFor(opts.state, opts.taxRates),
  };
}

export function stockStatus(sp: Pick<StoreProduct, 'quantity' | 'lowStockThreshold'>): StockStatus {
  if (sp.quantity <= 0) return 'out_of_stock';
  if (sp.quantity <= sp.lowStockThreshold) return 'low_stock';
  return 'in_stock';
}

/** Inventory older than this is flagged as stale (data quality). */
export const STALE_INVENTORY_DAYS = 7;
export function isStale(updatedAt: string, now = new Date()): boolean {
  return now.getTime() - new Date(updatedAt).getTime() > STALE_INVENTORY_DAYS * 86400_000;
}

export const formatUSD = (cents: number) =>
  (cents / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD' });
