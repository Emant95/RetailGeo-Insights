import type { z } from 'zod';
import type { Deps, RequestContext } from '../context';
import type { Schemas } from '../schemas';
import type { StoreOrderStatus } from '../types';
import { AppError, notFound, invalid, forbidden } from '../errors';
import { assertStoreOrderTransition, STORE_ORDER_TRANSITIONS, STORE_ORDER_ACTOR } from '../lifecycle';
import { roundMi } from '../geo';
import { nowIso, uuid, assertStoreAccess, accessibleStoreIds, orderNumber, audit, paginate, requireUser } from '../util';

/**
 * Store-to-store (B2B) sourcing. Deliberately separate tables, lifecycle and endpoints
 * from consumer orders so wholesale capabilities (net terms, invoicing, logistics) can evolve independently.
 */
export async function sourcing(deps: Deps, ctx: RequestContext, q: z.infer<typeof Schemas.sourcing>) {
  const buyer = await assertStoreAccess(deps, ctx, q.storeId, 'store_orders.manage');
  const hits = await deps.db.searchListings({ text: q.q || undefined, lat: buyer.latitude, lng: buyer.longitude, radiusMi: q.radius, b2bOnly: true, excludeStoreId: buyer.id });
  const byProduct = new Map<string, { product: { id: string; name: string; size: string | null; sku: string; upc: string | null }; suppliers: any[] }>();
  for (const h of hits) {
    const entry = byProduct.get(h.product.id) ?? { product: { id: h.product.id, name: h.product.name, size: h.product.size, sku: h.product.sku, upc: h.product.upc }, suppliers: [] };
    const unitsAvailable = Math.floor(h.listing.quantity / 1);
    entry.suppliers.push({
      storeProductId: h.listing.id, storeId: h.store.id, storeName: h.store.name, storeType: h.store.storeType, city: h.store.city,
      distanceMi: h.distanceMi == null ? null : roundMi(h.distanceMi), available: unitsAvailable, unitLabel: h.listing.b2bUnit,
      unitPriceCents: h.listing.b2bPriceCents ?? h.listing.priceCents, minQty: h.listing.b2bMinQty, latitude: h.store.latitude, longitude: h.store.longitude,
    });
    byProduct.set(h.product.id, entry);
  }
  const items = [...byProduct.values()].map((e) => ({ ...e, suppliers: e.suppliers.sort((a, b) => (b.available > 0 ? 1 : 0) - (a.available > 0 ? 1 : 0) || a.distanceMi - b.distanceMi) }));
  return { buyerStore: { id: buyer.id, name: buyer.name, latitude: buyer.latitude, longitude: buyer.longitude }, radiusMi: q.radius, items };
}

export async function createStoreOrder(deps: Deps, ctx: RequestContext, input: z.infer<typeof Schemas.storeOrderCreate>) {
  const u = requireUser(ctx);
  const buyer = await assertStoreAccess(deps, ctx, input.buyerStoreId, 'store_orders.manage');
  const seller = await deps.db.stores.get(input.sellerStoreId);
  if (!seller || seller.status !== 'active') throw notFound('Supplying store');
  if (seller.id === buyer.id) throw invalid('A store cannot request stock from itself.');
  let subtotal = 0;
  const lines: { l: import('../types').StoreProduct; p: import('../types').Product; unit: number; qty: number }[] = [];
  for (const it of input.items) {
    const l = await deps.db.storeProducts.get(it.storeProductId);
    if (!l || l.storeId !== seller.id || !l.b2bEnabled) throw invalid('One of the items is not offered for store-to-store orders.', { storeProductId: it.storeProductId });
    const p = (await deps.db.products.get(l.productId))!;
    if (it.quantity < l.b2bMinQty) throw invalid(`${p.name}: minimum request is ${l.b2bMinQty} (${l.b2bUnit}).`);
    if (it.quantity > l.quantity) throw new AppError('INSUFFICIENT_STOCK', `${seller.name} has ${l.quantity} of ${p.name} available.`);
    const unit = l.b2bPriceCents ?? l.priceCents;
    subtotal += unit * it.quantity;
    lines.push({ l, p, unit, qty: it.quantity });
  }
  const so = await deps.db.tx(async (db) => {
    const status: StoreOrderStatus = input.submit ? 'pending_acceptance' : 'draft';
    const order = await db.storeOrders.insert({
      id: uuid(), number: orderNumber('S2S'), buyerStoreId: buyer.id, sellerStoreId: seller.id, status, subtotalCents: subtotal,
      buyerNotes: input.notes ?? null, sellerNotes: null, createdBy: u.id, partial: false, createdAt: nowIso(), updatedAt: nowIso(),
    });
    for (const x of lines) {
      await db.storeOrderItems.insert({ id: uuid(), storeOrderId: order.id, storeProductId: x.l.id, productId: x.p.id, productName: `${x.p.name}${x.p.size ? ` (${x.p.size})` : ''}`, unitLabel: x.l.b2bUnit, unitPriceCents: x.unit, requestedQty: x.qty, acceptedQty: null, fulfilledQty: null });
    }
    await db.statusHistory.insert({ id: uuid(), orderId: order.id, kind: 'store', fromStatus: null, toStatus: 'draft', actorId: u.id, note: null, createdAt: nowIso() });
    if (input.submit) {
      await db.statusHistory.insert({ id: uuid(), orderId: order.id, kind: 'store', fromStatus: 'draft', toStatus: 'submitted', actorId: u.id, note: input.notes ?? null, createdAt: nowIso() });
      await db.statusHistory.insert({ id: uuid(), orderId: order.id, kind: 'store', fromStatus: 'submitted', toStatus: 'pending_acceptance', actorId: null, note: null, createdAt: nowIso() });
    }
    return order;
  });
  await audit(deps, ctx, 'store_order.created', 'store_order', so.id, null, { number: so.number, subtotalCents: subtotal, status: so.status });
  if (input.submit) await deps.events.publish('store_order.submitted', { storeOrderId: so.id, buyerStoreId: buyer.id, sellerStoreId: seller.id });
  return getStoreOrder(deps, ctx, so.id, buyer.id);
}

export async function listStoreOrdersFor(deps: Deps, ctx: RequestContext, storeId: string, q: { role?: string; status?: string; page?: number; pageSize?: number }) {
  await assertStoreAccess(deps, ctx, storeId, 'orders.view');
  const asBuyer = q.role !== 'seller' ? await deps.db.storeOrders.findMany({ buyerStoreId: storeId }) : [];
  const asSeller = q.role !== 'buyer' ? await deps.db.storeOrders.findMany({ sellerStoreId: storeId }) : [];
  let all = [...asBuyer, ...asSeller].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  if (q.status === 'open') all = all.filter((s) => !['completed', 'rejected', 'cancelled'].includes(s.status));
  else if (q.status) all = all.filter((s) => s.status === q.status);
  const stores = new Map((await deps.db.stores.findMany({ id: { $in: [...new Set(all.flatMap((s) => [s.buyerStoreId, s.sellerStoreId]))] } })).map((s) => [s.id, s.name]));
  const page = paginate(all, q.page, q.pageSize ?? 25);
  return {
    ...page,
    items: page.items.map((s) => ({ ...s, direction: s.buyerStoreId === storeId ? 'outgoing' : 'incoming', counterparty: stores.get(s.buyerStoreId === storeId ? s.sellerStoreId : s.buyerStoreId) ?? '' })),
  };
}

export async function getStoreOrder(deps: Deps, ctx: RequestContext, id: string, storeId: string, opts: { admin?: boolean } = {}) {
  const so = await deps.db.storeOrders.get(id);
  if (!so) throw notFound('Store order');
  if (!opts.admin) {
    await assertStoreAccess(deps, ctx, storeId, 'orders.view');
    if (so.buyerStoreId !== storeId && so.sellerStoreId !== storeId) throw notFound('Store order');
  }
  const buyer = await deps.db.stores.get(so.buyerStoreId);
  const seller = await deps.db.stores.get(so.sellerStoreId);
  const items = await deps.db.storeOrderItems.findMany({ storeOrderId: id });
  const history = await deps.db.statusHistory.findMany({ orderId: id, kind: 'store' }, { orderBy: [['createdAt', 'asc']] });
  const role = so.buyerStoreId === storeId ? 'buyer' : 'seller';
  const allowed = STORE_ORDER_TRANSITIONS[so.status].filter((s) => {
    const who = STORE_ORDER_ACTOR[s];
    if (s === 'pending_acceptance') return false;
    if (s === 'cancelled' && role === 'buyer' && so.status === 'preparing') return false;
    return who === 'either' || who === role;
  });
  const pick = (s: typeof buyer) => (s ? { id: s.id, name: s.name, city: s.city, state: s.state, addressLine1: s.addressLine1, phone: s.phone, latitude: s.latitude, longitude: s.longitude } : null);
  return { ...so, buyer: pick(buyer), seller: pick(seller), items, history, viewerRole: opts.admin ? 'admin' : role, allowedTransitions: opts.admin ? [] : allowed };
}

export async function transitionStoreOrder(deps: Deps, ctx: RequestContext, id: string, input: z.infer<typeof Schemas.storeOrderTransition>) {
  await assertStoreAccess(deps, ctx, input.storeId, 'store_orders.manage');
  const so = await deps.db.storeOrders.get(id);
  if (!so) throw notFound('Store order');
  const role = so.buyerStoreId === input.storeId ? 'buyer' : so.sellerStoreId === input.storeId ? 'seller' : null;
  if (!role) throw forbidden();
  const to = input.status;
  // Draft submit collapses to pending_acceptance.
  const target: StoreOrderStatus = to === 'submitted' ? 'pending_acceptance' : to;
  if (to === 'submitted') assertStoreOrderTransition(so.status, 'submitted', role);
  else assertStoreOrderTransition(so.status, target, role);

  const items = await deps.db.storeOrderItems.findMany({ storeOrderId: id });
  let subtotal = so.subtotalCents;
  let partial = so.partial;
  await deps.db.tx(async (db) => {
    if (target === 'accepted') {
      subtotal = 0;
      for (const it of items) {
        const q = input.quantities?.[it.id] ?? it.requestedQty;
        if (q > it.requestedQty) throw invalid(`You can accept at most ${it.requestedQty} of ${it.productName}.`);
        const l = await db.storeProducts.get(it.storeProductId);
        if (l && q > l.quantity) throw new AppError('INSUFFICIENT_STOCK', `You only have ${l.quantity} of ${it.productName}.`);
        if (q < it.requestedQty) partial = true;
        await db.storeOrderItems.update(it.id, { acceptedQty: q });
        subtotal += q * it.unitPriceCents;
      }
      if (subtotal === 0) throw invalid('Accept at least one item, or reject the request.');
    }
    if (target === 'ready') {
      // Seller hands over stock: decrement seller inventory by fulfilled quantities.
      subtotal = 0;
      for (const it of items) {
        const accepted = it.acceptedQty ?? it.requestedQty;
        const q = input.quantities?.[it.id] ?? accepted;
        if (q > accepted) throw invalid(`You accepted ${accepted} of ${it.productName}.`);
        if (q < accepted) partial = true;
        if (q > 0 && !(await db.decrementStock(it.storeProductId, q))) throw new AppError('INSUFFICIENT_STOCK', `Not enough ${it.productName} on hand.`);
        const l = await db.storeProducts.get(it.storeProductId);
        if (q > 0) await db.inventoryEvents.insert({ id: uuid(), storeProductId: it.storeProductId, storeId: so.sellerStoreId, delta: -q, quantityAfter: l?.quantity ?? 0, reason: `store order ${so.number}`, source: 'manual', actorId: ctx.user?.id ?? null, createdAt: nowIso() });
        await db.storeOrderItems.update(it.id, { fulfilledQty: q });
        subtotal += q * it.unitPriceCents;
      }
    }
    if (target === 'completed') {
      // Buyer receives stock: add to buyer's listing if it carries the product.
      for (const it of items) {
        const q = it.fulfilledQty ?? 0;
        const l = await db.storeProducts.findOne({ storeId: so.buyerStoreId, productId: it.productId });
        if (l && q > 0) {
          const received = q;
          await db.storeProducts.update(l.id, { quantity: l.quantity + received, updatedAt: nowIso() });
          await db.inventoryEvents.insert({ id: uuid(), storeProductId: l.id, storeId: so.buyerStoreId, delta: received, quantityAfter: l.quantity + received, reason: `received ${so.number}`, source: 'manual', actorId: ctx.user?.id ?? null, createdAt: nowIso() });
        }
      }
    }
    const patch: Record<string, unknown> = { status: target, subtotalCents: subtotal, partial, updatedAt: nowIso() };
    if (input.note) patch[role === 'buyer' ? 'buyerNotes' : 'sellerNotes'] = input.note;
    await db.storeOrders.update(id, patch);
    if (to === 'submitted') await db.statusHistory.insert({ id: uuid(), orderId: id, kind: 'store', fromStatus: so.status, toStatus: 'submitted', actorId: ctx.user?.id ?? null, note: input.note ?? null, createdAt: nowIso() });
    await db.statusHistory.insert({ id: uuid(), orderId: id, kind: 'store', fromStatus: to === 'submitted' ? 'submitted' : so.status, toStatus: target, actorId: ctx.user?.id ?? null, note: to === 'submitted' ? null : input.note ?? null, createdAt: nowIso() });
  });
  await audit(deps, ctx, 'store_order.transition', 'store_order', id, { status: so.status }, { status: target, quantities: input.quantities ?? null });
  if (to === 'submitted') await deps.events.publish('store_order.submitted', { storeOrderId: id, buyerStoreId: so.buyerStoreId, sellerStoreId: so.sellerStoreId });
  else await deps.events.publish('store_order.status_changed', { storeOrderId: id, buyerStoreId: so.buyerStoreId, sellerStoreId: so.sellerStoreId, from: so.status, to: target });
  return getStoreOrder(deps, ctx, id, input.storeId);
}

export async function myStoreIds(deps: Deps, ctx: RequestContext) {
  return accessibleStoreIds(deps, ctx);
}
