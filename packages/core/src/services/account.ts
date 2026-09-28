import type { z } from 'zod';
import type { Deps, RequestContext } from '../context';
import type { Schemas } from '../schemas';
import { AppError, notFound } from '../errors';
import { nowIso, uuid, requireUser, audit, paginate } from '../util';
import { toPublicUser } from './auth';
import { EVENT_SCHEMA_VERSION } from '../events';

export async function updateProfile(deps: Deps, ctx: RequestContext, input: z.infer<typeof Schemas.profile>) {
  const u = requireUser(ctx);
  const user = await deps.db.users.update(u.id, { ...input, updatedAt: nowIso() });
  return toPublicUser(deps, user);
}

/** Privacy: soft-delete and anonymize personal data; orders are retained (de-identified) for accounting. */
export async function deleteAccount(deps: Deps, ctx: RequestContext) {
  const u = requireUser(ctx);
  const anon = `deleted+${u.id}@retailgeo.invalid`;
  await deps.db.users.update(u.id, {
    email: anon, fullName: 'Deleted user', phone: null, status: 'disabled', deletedAt: nowIso(),
    marketingConsent: false, locationSharing: false, passwordHash: 'deleted',
  });
  for (const a of await deps.db.addresses.findMany({ userId: u.id })) await deps.db.addresses.delete(a.id);
  for (const f of await deps.db.favorites.findMany({ userId: u.id })) await deps.db.favorites.delete(f.id);
  for (const s of await deps.db.searchEvents.findMany({ userId: u.id })) await deps.db.searchEvents.update(s.id, { userId: null });
  for (const s of await deps.db.sessions.findMany({ userId: u.id, revokedAt: null })) await deps.db.sessions.update(s.id, { revokedAt: nowIso() });
  await audit(deps, ctx, 'user.deleted', 'user', u.id, null, { anonymized: true });
  return { ok: true };
}

/** Privacy: export what we hold about the user. */
export async function exportMyData(deps: Deps, ctx: RequestContext) {
  const u = requireUser(ctx);
  return {
    profile: await toPublicUser(deps, (await deps.db.users.get(u.id))!),
    addresses: await deps.db.addresses.findMany({ userId: u.id }),
    favorites: await deps.db.favorites.findMany({ userId: u.id }),
    orders: await deps.db.orders.findMany({ userId: u.id }),
    searches: await deps.db.searchEvents.findMany({ userId: u.id }),
  };
}

export async function listAddresses(deps: Deps, ctx: RequestContext) {
  const u = requireUser(ctx);
  return deps.db.addresses.findMany({ userId: u.id }, { orderBy: [['isDefault', 'desc'], ['createdAt', 'asc']] });
}

export async function addAddress(deps: Deps, ctx: RequestContext, input: z.infer<typeof Schemas.address>) {
  const u = requireUser(ctx);
  const geo = (await deps.geocoder.geocode(input.zip))[0];
  if (input.isDefault) for (const a of await deps.db.addresses.findMany({ userId: u.id, isDefault: true })) await deps.db.addresses.update(a.id, { isDefault: false });
  const count = await deps.db.addresses.count({ userId: u.id });
  return deps.db.addresses.insert({
    id: uuid(), userId: u.id, ...input, isDefault: input.isDefault || count === 0,
    latitude: geo?.lat ?? null, longitude: geo?.lng ?? null, createdAt: nowIso(), updatedAt: nowIso(),
  });
}

export async function deleteAddress(deps: Deps, ctx: RequestContext, id: string) {
  const u = requireUser(ctx);
  const a = await deps.db.addresses.get(id);
  if (!a || a.userId !== u.id) throw notFound('Address');
  await deps.db.addresses.delete(id);
  return { ok: true };
}

export async function listFavorites(deps: Deps, ctx: RequestContext) {
  const u = requireUser(ctx);
  const favs = await deps.db.favorites.findMany({ userId: u.id }, { orderBy: [['createdAt', 'desc']] });
  const out = [];
  for (const f of favs) {
    out.push({
      ...f,
      store: f.storeId ? await deps.db.stores.get(f.storeId) : null,
      product: f.productId ? await deps.db.products.get(f.productId) : null,
    });
  }
  return out;
}

export async function addFavorite(deps: Deps, ctx: RequestContext, input: z.infer<typeof Schemas.favorite>) {
  const u = requireUser(ctx);
  const existing = await deps.db.favorites.findOne({ userId: u.id, storeId: input.storeId ?? null, productId: input.productId ?? null });
  if (existing) return existing;
  const fav = await deps.db.favorites.insert({ id: uuid(), userId: u.id, storeId: input.storeId ?? null, productId: input.productId ?? null, createdAt: nowIso() });
  await track(deps, ctx, { name: 'favorite_added', storeId: input.storeId, props: { productId: input.productId ?? null } });
  return fav;
}

export async function removeFavorite(deps: Deps, ctx: RequestContext, id: string) {
  const u = requireUser(ctx);
  const f = await deps.db.favorites.get(id);
  if (!f || f.userId !== u.id) throw notFound('Favorite');
  await deps.db.favorites.delete(id);
  return { ok: true };
}

export async function listNotifications(deps: Deps, ctx: RequestContext, q: { page?: number; pageSize?: number }) {
  const u = requireUser(ctx);
  const all = await deps.db.notifications.findMany({ userId: u.id }, { orderBy: [['createdAt', 'desc']], limit: 200 });
  return { ...paginate(all, q.page, q.pageSize ?? 30), unread: all.filter((n) => !n.readAt).length };
}

export async function markNotificationRead(deps: Deps, ctx: RequestContext, id: string) {
  const u = requireUser(ctx);
  if (id === 'all') {
    for (const n of await deps.db.notifications.findMany({ userId: u.id, readAt: null })) await deps.db.notifications.update(n.id, { readAt: nowIso() });
    return { ok: true };
  }
  const n = await deps.db.notifications.get(id);
  if (!n || n.userId !== u.id) throw notFound('Notification');
  await deps.db.notifications.update(id, { readAt: nowIso() });
  return { ok: true };
}

export async function createTicket(deps: Deps, ctx: RequestContext, input: z.infer<typeof Schemas.support>) {
  if (input.orderId) {
    const o = await deps.db.orders.get(input.orderId);
    if (!o || (ctx.user && o.userId !== ctx.user.id)) throw new AppError('VALIDATION_FAILED', 'That order is not on your account.');
  }
  const t = await deps.db.supportTickets.insert({
    id: uuid(), userId: ctx.user?.id ?? null, email: input.email, subject: input.subject, body: input.body,
    orderId: input.orderId ?? null, category: input.category, status: 'open', createdAt: nowIso(), updatedAt: nowIso(),
  });
  await deps.email.send({ to: input.email, kind: 'support', subject: `We received your request: ${input.subject}`, body: `Ticket ${t.id.slice(0, 8).toUpperCase()} is open. Our team replies within one business day.` });
  return t;
}

/** Client analytics ingestion (whitelisted event names, versioned schema). */
export async function track(deps: Deps, ctx: RequestContext, input: z.infer<typeof Schemas.track> | { name: string; storeId?: string; props: Record<string, unknown> }) {
  await deps.db.analyticsEvents.insert({
    id: uuid(), name: input.name, schemaVersion: 1, userId: ctx.user?.id ?? null, storeId: input.storeId ?? null,
    props: input.props ?? {}, createdAt: nowIso(),
  });
  return { ok: true };
}

/** Wire event-driven notifications + analytics. Channels can be added without touching publishers. */
export function registerEventHandlers(deps: Deps) {
  const { events, db } = deps;
  const notify = async (userId: string, type: string, title: string, body: string, link: string | null, storeId: string | null = null, email = false) => {
    await db.notifications.insert({ id: uuid(), userId, storeId, type, title, body, link, channel: 'in_app', readAt: null, createdAt: nowIso() });
    if (email) {
      const u = await db.users.get(userId);
      if (u && !u.deletedAt) await deps.email.send({ to: u.email, kind: type, subject: title, body });
    }
  };
  const storeStaff = async (storeId: string) => {
    const s = await db.stores.get(storeId);
    if (!s) return [];
    const owners = await db.userRoles.findMany({ role: 'merchant_admin', businessId: s.businessId });
    const staff = await db.storeUsers.findMany({ storeId });
    return [...new Set([...owners.map((o) => o.userId), ...staff.map((x) => x.userId)])];
  };
  const record = (name: string, storeId: string | null, userId: string | null, props: Record<string, unknown>) =>
    db.analyticsEvents.insert({ id: uuid(), name, schemaVersion: EVENT_SCHEMA_VERSION[name as keyof typeof EVENT_SCHEMA_VERSION] ?? 1, userId, storeId, props, createdAt: nowIso() });

  events.subscribe('order.placed', async (p) => {
    const o = await db.orders.get(p.orderId);
    await notify(p.userId, 'order_confirmation', `Order ${o?.number} confirmed`, 'The store has your order. We will tell you when it is ready.', `/account/orders/${p.orderId}`, p.storeId, true);
    for (const uid of await storeStaff(p.storeId)) await notify(uid, 'new_order', `New order ${o?.number}`, `A customer placed an order for ${(p.totalCents / 100).toFixed(2)} USD.`, `/merchant/orders/${p.orderId}`, p.storeId);
    await record('purchase', p.storeId, p.userId, { orderId: p.orderId, totalCents: p.totalCents });
  });
  events.subscribe('payment.captured', async (p) => {
    await notify(p.userId, 'payment_confirmation', 'Payment received', `We charged ${(p.amountCents / 100).toFixed(2)} USD to your card.`, `/account/orders/${p.orderId}`);
  });
  events.subscribe('payment.failed', async (p) => {
    await notify(p.userId, 'payment_failed', 'Payment did not go through', p.message, `/account/orders/${p.orderId}`);
  });
  events.subscribe('payment.refunded', async (p) => {
    await notify(p.userId, 'refund', 'Refund issued', `${(p.amountCents / 100).toFixed(2)} USD is on its way back to your card (3–5 business days).`, `/account/orders/${p.orderId}`, null, true);
  });
  events.subscribe('order.status_changed', async (p) => {
    const o = await db.orders.get(p.orderId);
    const copy: Record<string, [string, string]> = {
      processing: ['is being prepared', 'The store started preparing your order.'],
      ready: ['is ready for pickup', 'Head to the store and show your order number at the counter.'],
      out_for_delivery: ['is out for delivery', 'Your order is on its way.'],
      completed: ['is complete', 'Thanks for shopping local.'],
      cancelled: ['was cancelled', 'If you were charged, a refund has been issued.'],
    };
    const c = copy[p.to];
    if (c) await notify(p.userId, p.to === 'ready' ? 'order_ready' : p.to === 'cancelled' ? 'cancellation' : 'order_status', `Order ${o?.number} ${c[0]}`, c[1], `/account/orders/${p.orderId}`, p.storeId, p.to === 'ready' || p.to === 'cancelled');
    await record('order_status_changed', p.storeId, p.userId, { orderId: p.orderId, from: p.from, to: p.to });
  });
  events.subscribe('store_order.submitted', async (p) => {
    const so = await db.storeOrders.get(p.storeOrderId);
    const buyer = await db.stores.get(p.buyerStoreId);
    for (const uid of await storeStaff(p.sellerStoreId)) await notify(uid, 'store_order_request', `Stock request ${so?.number}`, `${buyer?.name} requested items from your store.`, `/merchant/store-orders/${p.storeOrderId}`, p.sellerStoreId, true);
    await record('store_order_submitted', p.sellerStoreId, null, { storeOrderId: p.storeOrderId, buyerStoreId: p.buyerStoreId });
  });
  events.subscribe('store_order.status_changed', async (p) => {
    const so = await db.storeOrders.get(p.storeOrderId);
    const target = ['accepted', 'rejected', 'preparing', 'ready'].includes(p.to) ? p.buyerStoreId : p.sellerStoreId;
    const other = await db.stores.get(target === p.buyerStoreId ? p.sellerStoreId : p.buyerStoreId);
    const type = p.to === 'accepted' || p.to === 'rejected' ? 'store_order_decision' : 'store_order_status';
    for (const uid of await storeStaff(target)) await notify(uid, type, `Request ${so?.number} ${p.to.replace('_', ' ')}`, `${other?.name} marked the request ${p.to.replace('_', ' ')}.`, `/merchant/store-orders/${p.storeOrderId}`, target);
    await record('store_order_status_changed', target, null, { storeOrderId: p.storeOrderId, from: p.from, to: p.to });
  });
  events.subscribe('inventory.low_stock', async (p) => {
    for (const uid of await storeStaff(p.storeId)) await notify(uid, 'low_inventory', `Low stock: ${p.productName}`, `Only ${p.quantity} left. Restock or source it from a nearby store.`, `/merchant/inventory`, p.storeId);
  });
  events.subscribe('inventory.changed', async (p) => {
    await record('inventory_changed', p.storeId, null, { storeProductId: p.storeProductId, delta: p.delta, quantityAfter: p.quantityAfter, source: p.source });
  });
  events.subscribe('business.reviewed', async (p) => {
    const approved = p.status === 'approved';
    await notify(p.ownerUserId, 'store_approval', approved ? 'Your business is approved' : 'Your application needs changes', approved ? 'Your store is live on RetailGeo. Add products to start selling.' : p.notes ?? 'Our team could not verify your application.', '/merchant', null, true);
  });
  events.subscribe('search.performed', async (p) => {
    await record('search', null, p.userId, { query: p.query, resultCount: p.resultCount });
  });
  const reindex = async (entity: 'product' | 'store', entityId: string) => {
    const m = await db.searchIndex.findOne({ entity, entityId });
    if (m) await db.searchIndex.update(m.id, { indexedAt: nowIso(), version: m.version + 1 });
    else await db.searchIndex.insert({ id: uuid(), entity, entityId, indexedAt: nowIso(), version: 1 });
  };
  events.subscribe('product.upserted', (p) => reindex('product', p.productId));
  events.subscribe('store.status_changed', (p) => reindex('store', p.storeId));
}
