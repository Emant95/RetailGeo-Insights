import type { z } from 'zod';
import type { Deps, RequestContext } from '../context';
import type { Schemas } from '../schemas';
import type { Order, OrderStatus, Payment, StoreProduct, Product } from '../types';
import { AppError, notFound, invalid, forbidden } from '../errors';
import { priceLine, computeTotals, stockStatus, isOfferLive, type LinePrice } from '../pricing';
import { assertOrderTransition, nextOrderStatuses } from '../lifecycle';
import { distanceMi } from '../geo';
import { nowIso, uuid, requireUser, orderNumber, paginate, audit } from '../util';
import { storeCard } from './discovery';

async function getOrCreateCart(deps: Deps, userId: string) {
  const cart = await deps.db.carts.findOne({ userId });
  if (cart) return cart;
  return deps.db.carts.insert({ id: uuid(), userId, createdAt: nowIso(), updatedAt: nowIso() });
}

async function taxOverrides(deps: Deps): Promise<Record<string, number> | undefined> {
  return ((await deps.db.settings.get('tax.rates'))?.value as Record<string, number>) ?? undefined;
}

interface PricedLine {
  cartItemId: string;
  listing: StoreProduct;
  product: Product;
  line: LinePrice;
  issue: string | null;
}

async function priceStoreCart(deps: Deps, userId: string, storeId: string, items: { id: string; storeProductId: string; quantity: number }[]) {
  const store = await deps.db.stores.get(storeId);
  const isNew = (await deps.db.orders.count({ userId, status: { $in: ['confirmed', 'processing', 'ready', 'out_for_delivery', 'completed'] } })) === 0;
  const offers = (await deps.db.offers.findMany({ storeId, status: 'active' })).filter((o) => isOfferLive(o, new Date()));
  const categories = await deps.db.categories.findMany();
  const lines: PricedLine[] = [];
  for (const it of items) {
    const listing = await deps.db.storeProducts.get(it.storeProductId);
    const product = listing ? await deps.db.products.get(listing.productId) : null;
    if (!listing || !product) continue;
    let issue: string | null = null;
    if (!listing.visible || product.status !== 'active') issue = 'No longer available at this store.';
    else if (listing.quantity <= 0) issue = 'Out of stock.';
    else if (it.quantity > listing.quantity) issue = `Only ${listing.quantity} available.`;
    else if (it.quantity < listing.minOrderQty) issue = `Minimum order is ${listing.minOrderQty}.`;
    else if (listing.maxOrderQty && it.quantity > listing.maxOrderQty) issue = `Limit ${listing.maxOrderQty} per order.`;
    const line = priceLine(listing, product, it.quantity, offers, { now: new Date(), isNewCustomer: isNew, categories });
    lines.push({ cartItemId: it.id, listing, product, line, issue });
  }
  return { store: store!, lines, isNew };
}

export async function getCart(deps: Deps, ctx: RequestContext) {
  const u = requireUser(ctx);
  const cart = await getOrCreateCart(deps, u.id);
  const items = await deps.db.cartItems.findMany({ cartId: cart.id }, { orderBy: [['createdAt', 'asc']] });
  const byStore = new Map<string, typeof items>();
  for (const it of items) {
    const l = await deps.db.storeProducts.get(it.storeProductId);
    if (!l) {
      await deps.db.cartItems.delete(it.id);
      continue;
    }
    byStore.set(l.storeId, [...(byStore.get(l.storeId) ?? []), it]);
  }
  const rates = await taxOverrides(deps);
  const groups = [];
  for (const [storeId, its] of byStore) {
    const { store, lines } = await priceStoreCart(deps, u.id, storeId, its);
    const hours = await deps.db.storeHours.findMany({ storeId });
    const totals = computeTotals(lines.map((l) => l.line), { state: store.state, feeCents: 0, taxRates: rates });
    groups.push({
      store: { ...storeCard(store, null, hours), deliveryFeeCents: store.deliveryFeeCents, serviceRadiusMi: store.serviceRadiusMi },
      items: lines.map((l) => ({
        id: l.cartItemId,
        storeProductId: l.listing.id,
        product: { id: l.product.id, name: l.product.name, size: l.product.size, images: l.product.images },
        quantity: l.line.quantity,
        unitCents: l.line.unitCents,
        listUnitCents: l.listing.priceCents,
        discountCents: l.line.discountCents,
        totalCents: l.line.totalCents,
        offer: l.line.offer ? { id: l.line.offer.id, name: l.line.offer.name } : null,
        stockStatus: stockStatus(l.listing),
        available: l.listing.quantity,
        issue: l.issue,
      })),
      totals,
      hasIssues: lines.some((l) => l.issue),
    });
  }
  const count = items.reduce((s, i) => s + i.quantity, 0);
  return { id: cart.id, itemCount: count, groups };
}

export async function addToCart(deps: Deps, ctx: RequestContext, input: z.infer<typeof Schemas.cartAdd>) {
  const u = requireUser(ctx);
  const listing = await deps.db.storeProducts.get(input.storeProductId);
  if (!listing || !listing.visible) throw notFound('Product listing');
  const store = await deps.db.stores.get(listing.storeId);
  if (!store || store.status !== 'active') throw invalid('This store is not taking orders right now.');
  const cart = await getOrCreateCart(deps, u.id);
  const existing = await deps.db.cartItems.findOne({ cartId: cart.id, storeProductId: listing.id });
  const qty = (existing?.quantity ?? 0) + input.quantity;
  if (qty > listing.quantity) throw new AppError('INSUFFICIENT_STOCK', listing.quantity > 0 ? `Only ${listing.quantity} in stock at ${store.name}.` : `Out of stock at ${store.name}.`);
  if (listing.maxOrderQty && qty > listing.maxOrderQty) throw invalid(`Limit ${listing.maxOrderQty} per order.`);
  if (existing) await deps.db.cartItems.update(existing.id, { quantity: qty });
  else await deps.db.cartItems.insert({ id: uuid(), cartId: cart.id, storeProductId: listing.id, quantity: Math.max(qty, listing.minOrderQty), createdAt: nowIso() });
  await deps.db.carts.update(cart.id, { updatedAt: nowIso() });
  await deps.db.analyticsEvents.insert({ id: uuid(), name: 'add_to_cart', schemaVersion: 1, userId: u.id, storeId: listing.storeId, props: { storeProductId: listing.id, productId: listing.productId, quantity: input.quantity }, createdAt: nowIso() });
  return getCart(deps, ctx);
}

export async function updateCartItem(deps: Deps, ctx: RequestContext, id: string, input: z.infer<typeof Schemas.cartUpdate>) {
  const u = requireUser(ctx);
  const cart = await getOrCreateCart(deps, u.id);
  const it = await deps.db.cartItems.get(id);
  if (!it || it.cartId !== cart.id) throw notFound('Cart item');
  if (input.quantity === 0) await deps.db.cartItems.delete(id);
  else {
    const listing = await deps.db.storeProducts.get(it.storeProductId);
    if (listing && input.quantity > listing.quantity) throw new AppError('INSUFFICIENT_STOCK', `Only ${listing.quantity} in stock.`);
    await deps.db.cartItems.update(id, { quantity: input.quantity });
  }
  return getCart(deps, ctx);
}

export async function removeCartItem(deps: Deps, ctx: RequestContext, id: string) {
  return updateCartItem(deps, ctx, id, { quantity: 0 });
}

// ─── Checkout ─────────────────────────────────────────────────────────────
/**
 * Cart → Address/Pickup → Store validation → Inventory validation → Price validation →
 * Taxes/Fees → Payment authorization → Order confirmation. Idempotent per Idempotency-Key.
 */
export async function checkout(deps: Deps, ctx: RequestContext, input: z.infer<typeof Schemas.checkout>) {
  const u = requireUser(ctx);
  const idem = ctx.idempotencyKey;
  if (idem) {
    const prior = await deps.db.orders.findOne({ userId: u.id, idempotencyKey: idem });
    if (prior) return getOrder(deps, ctx, prior.id);
  }
  const cart = await getOrCreateCart(deps, u.id);
  const all = await deps.db.cartItems.findMany({ cartId: cart.id });
  const items = [];
  for (const it of all) {
    const l = await deps.db.storeProducts.get(it.storeProductId);
    if (l?.storeId === input.storeId) items.push(it);
  }
  if (items.length === 0) throw invalid('Your cart has no items from this store.');

  // Store validation
  const { store, lines, isNew } = await priceStoreCart(deps, u.id, input.storeId, items);
  if (store.status !== 'active') throw invalid(`${store.name} is not accepting orders right now.`);

  // Fulfillment / address validation
  let fee = 0;
  if (input.fulfillmentType === 'delivery') {
    if (!store.deliveryEnabled) throw invalid(`${store.name} does not offer delivery. Choose pickup.`);
    if (!input.deliveryAddress) throw invalid('Enter a delivery address.', { field: 'deliveryAddress' });
    const g = (await deps.geocoder.geocode(input.deliveryAddress.zip))[0];
    if (!g) throw invalid('We could not locate that ZIP code.', { field: 'deliveryAddress.zip' });
    const d = distanceMi(g, { lat: store.latitude, lng: store.longitude });
    if (d > store.serviceRadiusMi) throw invalid(`That address is ${d.toFixed(1)} mi away. ${store.name} delivers within ${store.serviceRadiusMi} mi.`);
    fee = store.deliveryFeeCents;
  } else if (!store.pickupEnabled) {
    throw invalid(`${store.name} does not offer pickup.`);
  }

  // Inventory validation
  const problems = lines.filter((l) => l.issue).map((l) => ({ storeProductId: l.listing.id, product: l.product.name, issue: l.issue }));
  if (problems.length) throw new AppError('INSUFFICIENT_STOCK', 'Some items changed since you added them. Review your cart.', problems);

  // Price validation + taxes/fees
  const totals = computeTotals(lines.map((l) => l.line), { state: store.state, feeCents: fee, taxRates: await taxOverrides(deps) });
  if (input.expectedTotalCents != null && input.expectedTotalCents !== totals.totalCents) {
    throw new AppError('CONFLICT', 'Prices changed since you opened checkout. Review the new total.', { totalCents: totals.totalCents });
  }
  if (input.paymentMethod === 'card' && !input.paymentToken) throw invalid('Add a payment card.', { field: 'paymentToken' });
  if (input.paymentMethod === 'pay_in_store' && input.fulfillmentType === 'delivery') throw invalid('Delivery orders must be paid online.');

  // Reserve stock and create the order atomically
  const order = await deps.db.tx(async (db) => {
    const o: Order = {
      id: uuid(), number: orderNumber('RG'), userId: u.id, storeId: store.id, status: 'pending_payment',
      fulfillmentType: input.fulfillmentType, deliveryAddress: input.fulfillmentType === 'delivery' ? input.deliveryAddress! : null,
      ...{ subtotalCents: totals.subtotalCents, discountCents: totals.discountCents, taxCents: totals.taxCents, feeCents: totals.feeCents, totalCents: totals.totalCents },
      paymentStatus: 'unpaid', idempotencyKey: idem, notes: input.notes ?? null, createdAt: nowIso(), updatedAt: nowIso(),
    };
    await db.orders.insert(o);
    for (const l of lines) {
      const ok = await db.decrementStock(l.listing.id, l.line.quantity);
      if (!ok) throw new AppError('INSUFFICIENT_STOCK', `${l.product.name} just sold out. Review your cart.`);
      await db.orderItems.insert({
        id: uuid(), orderId: o.id, storeProductId: l.listing.id, productId: l.product.id, productName: `${l.product.name}${l.product.size ? ` (${l.product.size})` : ''}`,
        unitPriceCents: l.line.unitCents, quantity: l.line.quantity, discountCents: l.line.discountCents, totalCents: l.line.totalCents, offerId: l.line.offer?.id ?? null,
      });
      await db.inventoryEvents.insert({ id: uuid(), storeProductId: l.listing.id, storeId: store.id, delta: -l.line.quantity, quantityAfter: l.listing.quantity - l.line.quantity, reason: `order ${o.number}`, source: 'manual', actorId: u.id, createdAt: nowIso() });
    }
    await db.statusHistory.insert({ id: uuid(), orderId: o.id, kind: 'consumer', fromStatus: null, toStatus: 'pending_payment', actorId: u.id, note: null, createdAt: nowIso() });
    return o;
  });

  // Payment
  let payment: Payment | null = null;
  if (input.paymentMethod === 'card') {
    const res = await deps.payments.authorize({ amountCents: order.totalCents, currency: 'usd', paymentToken: input.paymentToken!, idempotencyKey: `auth-${order.id}`, metadata: { orderId: order.id, orderNumber: order.number } });
    payment = await deps.db.payments.insert({
      id: uuid(), orderId: order.id, provider: deps.payments.name, providerRef: res.ref, status: res.ok ? 'authorized' : 'failed',
      amountCents: order.totalCents, refundedCents: 0, cardBrand: res.cardBrand ?? null, cardLast4: res.cardLast4 ?? null, createdAt: nowIso(), updatedAt: nowIso(),
    });
    await deps.db.paymentTransactions.insert({ id: uuid(), paymentId: payment.id, type: res.ok ? 'authorize' : 'failure', amountCents: order.totalCents, providerRef: res.ref, success: res.ok, message: res.message, createdAt: nowIso() });
    if (!res.ok) {
      await restock(deps, order.id, 'payment failed');
      await deps.db.orders.update(order.id, { status: 'payment_failed', paymentStatus: 'failed', updatedAt: nowIso() });
      await deps.db.statusHistory.insert({ id: uuid(), orderId: order.id, kind: 'consumer', fromStatus: 'pending_payment', toStatus: 'payment_failed', actorId: null, note: res.message, createdAt: nowIso() });
      await deps.events.publish('payment.failed', { orderId: order.id, userId: u.id, message: res.message ?? 'Payment failed.' });
      throw new AppError('PAYMENT_FAILED', `${res.message ?? 'Payment failed.'} Try another card or choose pay in store.`, { orderId: order.id });
    }
  }
  await deps.db.orders.update(order.id, { status: 'confirmed', paymentStatus: payment ? 'authorized' : 'pay_in_store', updatedAt: nowIso() });
  await deps.db.statusHistory.insert({ id: uuid(), orderId: order.id, kind: 'consumer', fromStatus: 'pending_payment', toStatus: 'confirmed', actorId: null, note: null, createdAt: nowIso() });
  for (const it of items) await deps.db.cartItems.delete(it.id);
  for (const offerId of new Set(lines.map((l) => l.line.offer?.id).filter(Boolean) as string[])) {
    const o = await deps.db.offers.get(offerId);
    if (o) await deps.db.offers.update(o.id, { usageCount: o.usageCount + 1 });
  }
  void isNew;
  await deps.events.publish('order.placed', { orderId: order.id, userId: u.id, storeId: store.id, totalCents: order.totalCents });
  return getOrder(deps, ctx, order.id);
}

async function restock(deps: Deps, orderId: string, reason: string) {
  for (const it of await deps.db.orderItems.findMany({ orderId })) {
    const l = await deps.db.storeProducts.get(it.storeProductId);
    if (!l) continue;
    await deps.db.storeProducts.update(l.id, { quantity: l.quantity + it.quantity, updatedAt: nowIso() });
    await deps.db.inventoryEvents.insert({ id: uuid(), storeProductId: l.id, storeId: l.storeId, delta: it.quantity, quantityAfter: l.quantity + it.quantity, reason, source: 'manual', actorId: null, createdAt: nowIso() });
  }
}

export async function getOrder(deps: Deps, ctx: RequestContext, id: string, opts: { asMerchant?: boolean; asAdmin?: boolean } = {}) {
  const u = requireUser(ctx);
  const o = await deps.db.orders.get(id);
  if (!o) throw notFound('Order');
  if (!opts.asMerchant && !opts.asAdmin && o.userId !== u.id) throw notFound('Order');
  const store = (await deps.db.stores.get(o.storeId))!;
  const items = await deps.db.orderItems.findMany({ orderId: id });
  const history = await deps.db.statusHistory.findMany({ orderId: id, kind: 'consumer' }, { orderBy: [['createdAt', 'asc']] });
  const payment = await deps.db.payments.findOne({ orderId: id });
  const customer = opts.asMerchant || opts.asAdmin ? await deps.db.users.get(o.userId) : null;
  const hours = await deps.db.storeHours.findMany({ storeId: store.id });
  return {
    ...o,
    idempotencyKey: undefined,
    store: storeCard(store, null, hours),
    items,
    history,
    payment: payment ? { status: payment.status, provider: payment.provider, cardBrand: payment.cardBrand, cardLast4: payment.cardLast4, amountCents: payment.amountCents, refundedCents: payment.refundedCents } : null,
    customer: customer ? { id: customer.id, name: customer.fullName, email: customer.email, phone: customer.phone } : null,
    nextStatuses: nextOrderStatuses(o.status, o.fulfillmentType),
    canCancel: o.userId === u.id && o.status === 'confirmed',
  };
}

export async function listMyOrders(deps: Deps, ctx: RequestContext, q: { page?: number; pageSize?: number }) {
  const u = requireUser(ctx);
  const orders = await deps.db.orders.findMany({ userId: u.id }, { orderBy: [['createdAt', 'desc']] });
  const out = [];
  for (const o of orders) {
    const s = await deps.db.stores.get(o.storeId);
    const items = await deps.db.orderItems.findMany({ orderId: o.id });
    out.push({ ...o, idempotencyKey: undefined, storeName: s?.name ?? '', itemCount: items.reduce((a, i) => a + i.quantity, 0), preview: items.slice(0, 3).map((i) => i.productName) });
  }
  return paginate(out, q.page, q.pageSize ?? 20);
}

/** Single place that moves a consumer order and keeps payments + stock consistent. */
export async function transitionOrder(deps: Deps, ctx: RequestContext, orderId: string, to: OrderStatus, note?: string) {
  const o = await deps.db.orders.get(orderId);
  if (!o) throw notFound('Order');
  assertOrderTransition(o.status, to, o.fulfillmentType);
  const payment = await deps.db.payments.findOne({ orderId });
  let paymentStatus = o.paymentStatus;
  if (payment && (to === 'ready' || to === 'out_for_delivery') && payment.status === 'authorized') {
    const r = await deps.payments.capture(payment.providerRef!, payment.amountCents);
    await deps.db.paymentTransactions.insert({ id: uuid(), paymentId: payment.id, type: 'capture', amountCents: payment.amountCents, providerRef: r.ref, success: r.ok, message: r.message, createdAt: nowIso() });
    if (!r.ok) throw new AppError('PAYMENT_FAILED', `Could not capture payment: ${r.message}`);
    await deps.db.payments.update(payment.id, { status: 'captured', updatedAt: nowIso() });
    paymentStatus = 'captured';
    await deps.events.publish('payment.captured', { orderId, userId: o.userId, amountCents: payment.amountCents });
  }
  if (to === 'cancelled') {
    await restock(deps, orderId, `order ${o.number} cancelled`);
    if (payment?.status === 'authorized') {
      await deps.payments.void(payment.providerRef!);
      await deps.db.paymentTransactions.insert({ id: uuid(), paymentId: payment.id, type: 'void', amountCents: payment.amountCents, providerRef: payment.providerRef, success: true, message: null, createdAt: nowIso() });
      await deps.db.payments.update(payment.id, { status: 'refunded', refundedCents: payment.amountCents, updatedAt: nowIso() });
      paymentStatus = 'refunded';
    } else if (payment?.status === 'captured') {
      await refundPayment(deps, ctx, payment, payment.amountCents - payment.refundedCents, o.userId);
      paymentStatus = 'refunded';
    }
  }
  if (to === 'completed' && o.paymentStatus === 'pay_in_store') paymentStatus = 'pay_in_store';
  await deps.db.orders.update(orderId, { status: to, paymentStatus, updatedAt: nowIso() });
  await deps.db.statusHistory.insert({ id: uuid(), orderId, kind: 'consumer', fromStatus: o.status, toStatus: to, actorId: ctx.user?.id ?? null, note: note ?? null, createdAt: nowIso() });
  await deps.events.publish('order.status_changed', { orderId, userId: o.userId, storeId: o.storeId, from: o.status, to });
  return o;
}

export async function refundPayment(deps: Deps, ctx: RequestContext, payment: Payment, amountCents: number, userId: string) {
  const remaining = payment.amountCents - payment.refundedCents;
  if (amountCents <= 0 || amountCents > remaining) throw invalid(`Refund must be between $0.01 and ${(remaining / 100).toFixed(2)}.`);
  const r = await deps.payments.refund(payment.providerRef!, amountCents, `refund-${payment.id}-${payment.refundedCents + amountCents}`);
  await deps.db.paymentTransactions.insert({ id: uuid(), paymentId: payment.id, type: 'refund', amountCents, providerRef: r.ref, success: r.ok, message: r.message, createdAt: nowIso() });
  if (!r.ok) throw new AppError('PAYMENT_FAILED', `Refund failed: ${r.message}`);
  const refunded = payment.refundedCents + amountCents;
  const status = refunded >= payment.amountCents ? 'refunded' : 'partially_refunded';
  await deps.db.payments.update(payment.id, { refundedCents: refunded, status, updatedAt: nowIso() });
  await deps.db.orders.update(payment.orderId, { paymentStatus: status, updatedAt: nowIso() });
  await audit(deps, ctx, 'payment.refund', 'payment', payment.id, { refundedCents: payment.refundedCents }, { refundedCents: refunded });
  await deps.events.publish('payment.refunded', { orderId: payment.orderId, userId, amountCents });
}

export async function cancelMyOrder(deps: Deps, ctx: RequestContext, id: string, input: z.infer<typeof Schemas.cancel>) {
  const u = requireUser(ctx);
  const o = await deps.db.orders.get(id);
  if (!o || o.userId !== u.id) throw notFound('Order');
  if (o.status !== 'confirmed') throw forbidden('The store has started this order. Contact the store or support to cancel.');
  await transitionOrder(deps, ctx, id, 'cancelled', input.reason ?? 'Cancelled by customer');
  return getOrder(deps, ctx, id);
}
