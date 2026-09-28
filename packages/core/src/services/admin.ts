import type { z } from 'zod';
import type { Deps, RequestContext } from '../context';
import type { Schemas } from '../schemas';
import type { BusinessStatus, OrderStatus, ProductStatus, RoleKey, StoreStatus } from '../types';
import { AppError, notFound, invalid, forbidden } from '../errors';
import { ROLE_PERMISSIONS, ROLE_LABELS, PERMISSIONS } from '../rbac';
import { distanceMi } from '../geo';
import { stockStatus, isStale } from '../pricing';
import { normalize, levenshtein } from '../text-match';
import { nowIso, uuid, paginate, audit, slugify, requireUser } from '../util';
import { toPublicUser } from './auth';
import { getOrder, transitionOrder, refundPayment } from './commerce';
import { getStoreOrder } from './store-orders';

type ListQ = z.infer<typeof Schemas.listQuery>;
const since = (days: number) => Date.now() - days * 86400_000;

export async function dashboard(deps: Deps) {
  const [users, stores, products, orders, storeOrders, offers, markets, tickets, businesses] = await Promise.all([
    deps.db.users.findMany({ deletedAt: null }), deps.db.stores.findMany({ deletedAt: null }), deps.db.products.findMany({ deletedAt: null }),
    deps.db.orders.findMany(), deps.db.storeOrders.findMany(), deps.db.offers.findMany({ status: 'active' }), deps.db.markets.findMany(),
    deps.db.supportTickets.findMany({ status: { $ne: 'resolved' } }), deps.db.businesses.findMany({ status: 'pending' }),
  ]);
  const paid = orders.filter((o) => !['pending_payment', 'payment_failed', 'cancelled'].includes(o.status));
  const listings = await deps.db.storeProducts.findMany();
  const searches = await deps.db.searchEvents.findMany();
  const trend: { day: string; orders: number; gmvCents: number; b2b: number }[] = [];
  for (let i = 13; i >= 0; i--) {
    const d = new Date(Date.now() - i * 86400_000).toISOString().slice(0, 10);
    const dayOrders = paid.filter((o) => o.createdAt.slice(0, 10) === d);
    trend.push({ day: d, orders: dayOrders.length, gmvCents: dayOrders.reduce((s, o) => s + o.totalCents, 0), b2b: storeOrders.filter((s) => s.createdAt.slice(0, 10) === d).length });
  }
  const alerts: { level: 'critical' | 'warning' | 'info'; message: string; link: string }[] = [];
  if (businesses.length) alerts.push({ level: 'warning', message: `${businesses.length} merchant application${businesses.length > 1 ? 's' : ''} waiting for review`, link: '/admin/merchants' });
  const stale = listings.filter((l) => isStale(l.updatedAt)).length;
  if (stale) alerts.push({ level: 'info', message: `${stale} inventory listings not updated in 7+ days`, link: '/admin/stores' });
  const failed = orders.filter((o) => o.status === 'payment_failed' && new Date(o.createdAt).getTime() > since(1)).length;
  if (failed) alerts.push({ level: 'warning', message: `${failed} failed payment${failed > 1 ? 's' : ''} in the last 24 hours`, link: '/admin/orders' });
  const stuck = storeOrders.filter((s) => s.status === 'pending_acceptance' && new Date(s.createdAt).getTime() < since(2)).length;
  if (stuck) alerts.push({ level: 'warning', message: `${stuck} store-to-store request${stuck > 1 ? 's' : ''} pending for over 48 hours`, link: '/admin/orders' });
  const pendingProducts = products.filter((p) => p.status === 'pending_review').length;
  if (pendingProducts) alerts.push({ level: 'info', message: `${pendingProducts} product${pendingProducts > 1 ? 's' : ''} awaiting moderation`, link: '/admin/catalog' });
  if (tickets.length) alerts.push({ level: 'info', message: `${tickets.length} open support ticket${tickets.length > 1 ? 's' : ''}`, link: '/admin/support' });
  const coverage = markets.map((m) => {
    const ms = stores.filter((s) => s.marketId === m.id);
    return { id: m.id, name: m.name, state: m.state, status: m.status, activeStores: ms.filter((s) => s.status === 'active').length, pendingStores: ms.filter((s) => s.status === 'pending').length, orders: paid.filter((o) => ms.some((s) => s.id === o.storeId)).length, latitude: m.latitude, longitude: m.longitude, radiusMi: m.radiusMi };
  });
  const byType: Record<string, number> = {};
  for (const s of stores.filter((x) => x.status === 'active')) byType[s.storeType] = (byType[s.storeType] ?? 0) + 1;
  return {
    metrics: {
      totalUsers: users.length,
      consumers: (await deps.db.userRoles.findMany({ role: 'consumer' })).length,
      activeStores: stores.filter((s) => s.status === 'active').length,
      pendingStores: stores.filter((s) => s.status === 'pending').length,
      products: products.length,
      listings: listings.length,
      outOfStockListings: listings.filter((l) => stockStatus(l) === 'out_of_stock').length,
      orders: paid.length,
      ordersToday: paid.filter((o) => o.createdAt.slice(0, 10) === nowIso().slice(0, 10)).length,
      b2bOrders: storeOrders.length,
      b2bOpen: storeOrders.filter((s) => !['completed', 'rejected', 'cancelled', 'draft'].includes(s.status)).length,
      gmvCents: paid.reduce((s, o) => s + o.totalCents, 0),
      gmv7dCents: paid.filter((o) => new Date(o.createdAt).getTime() > since(7)).reduce((s, o) => s + o.totalCents, 0),
      b2bVolumeCents: storeOrders.filter((s) => s.status === 'completed').reduce((a, s) => a + s.subtotalCents, 0),
      activeOffers: offers.length,
      markets: markets.filter((m) => m.status === 'active').length,
      searches7d: searches.filter((s) => new Date(s.createdAt).getTime() > since(7)).length,
      zeroResultSearches7d: searches.filter((s) => s.resultCount === 0 && new Date(s.createdAt).getTime() > since(7)).length,
      conversionPct: searches.length ? Math.round((paid.length / searches.length) * 1000) / 10 : 0,
    },
    trend,
    coverage,
    storesByType: byType,
    alerts,
    topSearches: Object.entries(searches.reduce<Record<string, number>>((acc, s) => ((acc[s.query.toLowerCase()] = (acc[s.query.toLowerCase()] ?? 0) + 1), acc), {}))
      .filter(([q]) => q).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([query, count]) => ({ query, count })),
  };
}

// ─── Merchants & stores ───────────────────────────────────────────────────
export async function listMerchants(deps: Deps, q: ListQ) {
  let all = await deps.db.businesses.findMany({}, { orderBy: [['createdAt', 'desc']] });
  if (q.status) all = all.filter((b) => b.status === q.status);
  if (q.q) all = all.filter((b) => `${b.legalName} ${b.dbaName ?? ''} ${b.contactEmail}`.toLowerCase().includes(q.q!.toLowerCase()));
  const page = paginate(all, q.page, q.pageSize);
  const items = [];
  for (const b of page.items) {
    const owner = await deps.db.users.get(b.ownerUserId);
    const stores = await deps.db.stores.findMany({ businessId: b.id });
    items.push({ ...b, owner: owner ? { id: owner.id, name: owner.fullName, email: owner.email } : null, stores: stores.map((s) => ({ id: s.id, name: s.name, status: s.status, city: s.city, state: s.state, zip: s.zip, storeType: s.storeType, addressLine1: s.addressLine1, latitude: s.latitude, longitude: s.longitude, verified: !!s.verifiedAt })) });
  }
  return { ...page, items };
}

export async function reviewMerchant(deps: Deps, ctx: RequestContext, id: string, input: z.infer<typeof Schemas.review>) {
  const b = await deps.db.businesses.get(id);
  if (!b) throw notFound('Business');
  if (b.status !== 'pending') throw new AppError('INVALID_STATE', `This application was already ${b.status}.`);
  const status: BusinessStatus = input.decision === 'approve' ? 'approved' : 'rejected';
  if (status === 'rejected' && !input.notes) throw invalid('Tell the merchant what to fix.', { field: 'notes' });
  await deps.db.businesses.update(id, { status, reviewNotes: input.notes ?? null, reviewedBy: ctx.user!.id, reviewedAt: nowIso(), updatedAt: nowIso() });
  for (const s of await deps.db.stores.findMany({ businessId: id, status: 'pending' })) {
    await deps.db.stores.update(s.id, { status: status === 'approved' ? 'active' : 'pending', verifiedAt: status === 'approved' ? nowIso() : null, updatedAt: nowIso() });
    await deps.events.publish('store.status_changed', { storeId: s.id, status: status === 'approved' ? 'active' : 'pending' });
  }
  await audit(deps, ctx, `merchant.${status}`, 'business', id, { status: b.status }, { status, notes: input.notes ?? null });
  await deps.events.publish('business.reviewed', { businessId: id, ownerUserId: b.ownerUserId, status, notes: input.notes ?? null });
  return deps.db.businesses.get(id);
}

export async function setMerchantStatus(deps: Deps, ctx: RequestContext, id: string, input: z.infer<typeof Schemas.statusChange>) {
  const b = await deps.db.businesses.get(id);
  if (!b) throw notFound('Business');
  if (!['approved', 'suspended'].includes(input.status)) throw invalid('Status must be approved or suspended.');
  if (input.status === 'suspended' && !input.reason) throw invalid('Give a reason for the suspension.', { field: 'reason' });
  await deps.db.businesses.update(id, { status: input.status as BusinessStatus, reviewNotes: input.reason ?? b.reviewNotes, updatedAt: nowIso() });
  for (const s of await deps.db.stores.findMany({ businessId: id })) {
    if (input.status === 'suspended' && s.status === 'active') await deps.db.stores.update(s.id, { status: 'suspended', updatedAt: nowIso() });
    if (input.status === 'approved' && s.status === 'suspended') await deps.db.stores.update(s.id, { status: 'active', updatedAt: nowIso() });
  }
  await audit(deps, ctx, `merchant.${input.status}`, 'business', id, { status: b.status }, { status: input.status, reason: input.reason ?? null });
  return deps.db.businesses.get(id);
}

export async function listStores(deps: Deps, q: ListQ) {
  let all = await deps.db.stores.findMany({ deletedAt: null }, { orderBy: [['name', 'asc']] });
  if (q.status) all = all.filter((s) => s.status === q.status);
  if (q.q) all = all.filter((s) => `${s.name} ${s.city} ${s.zip}`.toLowerCase().includes(q.q!.toLowerCase()));
  const page = paginate(all, q.page, q.pageSize);
  const markets = new Map((await deps.db.markets.findMany()).map((m) => [m.id, m.name]));
  const items = [];
  for (const s of page.items) {
    const listings = await deps.db.storeProducts.findMany({ storeId: s.id });
    const b = await deps.db.businesses.get(s.businessId);
    items.push({ ...s, businessName: b?.dbaName ?? b?.legalName ?? '', marketName: s.marketId ? markets.get(s.marketId) ?? null : null, listingCount: listings.length, staleCount: listings.filter((l) => isStale(l.updatedAt)).length, outOfStock: listings.filter((l) => l.quantity <= 0).length });
  }
  return { ...page, items };
}

export async function setStoreStatus(deps: Deps, ctx: RequestContext, id: string, input: z.infer<typeof Schemas.statusChange>) {
  const s = await deps.db.stores.get(id);
  if (!s) throw notFound('Store');
  const allowed: StoreStatus[] = ['active', 'suspended', 'closed'];
  if (!allowed.includes(input.status as StoreStatus) && input.status !== 'verified') throw invalid('Unknown store status.');
  if (input.status === 'suspended' && !input.reason) throw invalid('Give a reason for the suspension.', { field: 'reason' });
  const patch = input.status === 'verified' ? { verifiedAt: nowIso(), updatedAt: nowIso() } : { status: input.status as StoreStatus, updatedAt: nowIso() };
  await deps.db.stores.update(id, patch);
  await audit(deps, ctx, `store.${input.status}`, 'store', id, { status: s.status, verifiedAt: s.verifiedAt }, { ...patch, reason: input.reason ?? null });
  await deps.events.publish('store.status_changed', { storeId: id, status: input.status });
  return deps.db.stores.get(id);
}

export async function transferStore(deps: Deps, ctx: RequestContext, id: string, input: z.infer<typeof Schemas.transferOwnership>) {
  const s = await deps.db.stores.get(id);
  if (!s) throw notFound('Store');
  const b = await deps.db.businesses.get(input.businessId);
  if (!b || b.status !== 'approved') throw invalid('Choose an approved business.');
  await deps.db.stores.update(id, { businessId: b.id, updatedAt: nowIso() });
  await audit(deps, ctx, 'store.ownership_transferred', 'store', id, { businessId: s.businessId }, { businessId: b.id });
  return deps.db.stores.get(id);
}

// ─── Users & roles ────────────────────────────────────────────────────────
export async function listUsers(deps: Deps, q: ListQ) {
  let all = await deps.db.users.findMany({ deletedAt: null }, { orderBy: [['createdAt', 'desc']] });
  if (q.q) all = all.filter((u) => `${u.fullName} ${u.email}`.toLowerCase().includes(q.q!.toLowerCase()));
  if (q.status) all = all.filter((u) => u.status === q.status);
  let pub = [];
  for (const u of all) pub.push(await toPublicUser(deps, u));
  if (q.role) pub = pub.filter((u) => u.roles.includes(q.role as RoleKey));
  return paginate(pub, q.page, q.pageSize);
}

export async function updateUser(deps: Deps, ctx: RequestContext, id: string, input: z.infer<typeof Schemas.userAdmin>) {
  const actor = requireUser(ctx);
  const u = await deps.db.users.get(id);
  if (!u) throw notFound('User');
  if (id === actor.id && (input.status === 'disabled' || (input.roles && !input.roles.includes('platform_admin')))) throw forbidden('You cannot disable or demote your own account.');
  const beforeRoles = (await deps.db.userRoles.findMany({ userId: id })).map((r) => r.role);
  if (input.status) {
    await deps.db.users.update(id, { status: input.status, updatedAt: nowIso() });
    if (input.status === 'disabled') for (const s of await deps.db.sessions.findMany({ userId: id, revokedAt: null })) await deps.db.sessions.update(s.id, { revokedAt: nowIso() });
  }
  if (input.roles) {
    const current = await deps.db.userRoles.findMany({ userId: id });
    for (const r of current) if (!input.roles.includes(r.role)) await deps.db.userRoles.delete(r.id);
    for (const role of input.roles) if (!current.some((r) => r.role === role)) await deps.db.userRoles.insert({ id: uuid(), userId: id, role, businessId: null, createdAt: nowIso() });
  }
  await audit(deps, ctx, 'user.updated', 'user', id, { status: u.status, roles: beforeRoles }, { status: input.status ?? u.status, roles: input.roles ?? beforeRoles });
  return toPublicUser(deps, (await deps.db.users.get(id))!);
}

export function roleMatrix() {
  return {
    permissions: PERMISSIONS,
    roles: (Object.keys(ROLE_PERMISSIONS) as RoleKey[]).map((r) => ({ key: r, label: ROLE_LABELS[r], permissions: ROLE_PERMISSIONS[r] })),
  };
}

// ─── Catalog ──────────────────────────────────────────────────────────────
export async function upsertCategory(deps: Deps, ctx: RequestContext, id: string | null, input: z.infer<typeof Schemas.category>) {
  if (input.parentId && !(await deps.db.categories.get(input.parentId))) throw invalid('Parent category not found.');
  if (id) {
    const c = await deps.db.categories.get(id);
    if (!c) throw notFound('Category');
    if (input.parentId === id) throw invalid('A category cannot be its own parent.');
    const updated = await deps.db.categories.update(id, { ...input, slug: slugify(input.name) });
    await audit(deps, ctx, 'category.updated', 'category', id, c, updated);
    return updated;
  }
  const slug = slugify(input.name);
  if (await deps.db.categories.findOne({ slug })) throw new AppError('CONFLICT', 'A category with this name already exists.');
  const c = await deps.db.categories.insert({ id: uuid(), ...input, slug });
  await audit(deps, ctx, 'category.created', 'category', c.id, null, c);
  return c;
}

export async function listProducts(deps: Deps, q: ListQ) {
  let all = await deps.db.products.findMany({ deletedAt: null }, { orderBy: [['name', 'asc']] });
  if (q.status) all = all.filter((p) => p.status === q.status);
  if (q.q) all = all.filter((p) => `${p.name} ${p.sku} ${p.upc ?? ''}`.toLowerCase().includes(q.q!.toLowerCase()));
  const page = paginate(all, q.page, q.pageSize);
  const brands = new Map((await deps.db.brands.findMany()).map((b) => [b.id, b.name]));
  const cats = new Map((await deps.db.categories.findMany()).map((c) => [c.id, c.name]));
  const items = [];
  for (const p of page.items) items.push({ ...p, brand: p.brandId ? brands.get(p.brandId) ?? null : null, category: cats.get(p.categoryId) ?? null, storeCount: await deps.db.storeProducts.count({ productId: p.id }) });
  return { ...page, items };
}

export async function moderateProduct(deps: Deps, ctx: RequestContext, id: string, input: z.infer<typeof Schemas.moderate>) {
  const p = await deps.db.products.get(id);
  if (!p) throw notFound('Product');
  await deps.db.products.update(id, { status: input.status as ProductStatus, updatedAt: nowIso() });
  await audit(deps, ctx, 'product.moderated', 'product', id, { status: p.status }, { status: input.status, notes: input.notes ?? null });
  await deps.events.publish('product.upserted', { productId: id });
  return deps.db.products.get(id);
}

/** Duplicate detection: same UPC, or near-identical normalized names within the same category. */
export async function duplicateProducts(deps: Deps) {
  const all = await deps.db.products.findMany({ deletedAt: null });
  const groups: { reason: string; products: { id: string; name: string; sku: string; upc: string | null; status: string }[] }[] = [];
  const pick = (p: (typeof all)[number]) => ({ id: p.id, name: p.name, sku: p.sku, upc: p.upc, status: p.status });
  const byUpc = new Map<string, typeof all>();
  for (const p of all) if (p.upc) byUpc.set(p.upc, [...(byUpc.get(p.upc) ?? []), p]);
  for (const [upc, ps] of byUpc) if (ps.length > 1) groups.push({ reason: `Same UPC ${upc}`, products: ps.map(pick) });
  for (let i = 0; i < all.length; i++) {
    for (let j = i + 1; j < all.length; j++) {
      const a = all[i], b = all[j];
      if (a.categoryId !== b.categoryId || (a.upc && a.upc === b.upc)) continue;
      const na = normalize(`${a.name} ${a.size ?? ''}`), nb = normalize(`${b.name} ${b.size ?? ''}`);
      if (na === nb || (na.length > 8 && levenshtein(na, nb, 2) <= 2)) groups.push({ reason: 'Near-identical name', products: [pick(a), pick(b)] });
    }
  }
  return groups;
}

// ─── Markets ──────────────────────────────────────────────────────────────
export async function upsertMarket(deps: Deps, ctx: RequestContext, id: string | null, input: z.infer<typeof Schemas.market>) {
  if (id) {
    const m = await deps.db.markets.get(id);
    if (!m) throw notFound('Market');
    const updated = await deps.db.markets.update(id, { ...input, updatedAt: nowIso() });
    await audit(deps, ctx, 'market.updated', 'market', id, m, updated);
    return updated;
  }
  const m = await deps.db.markets.insert({ id: uuid(), ...input, createdAt: nowIso(), updatedAt: nowIso() });
  // Assign unassigned stores that fall inside the new market.
  for (const s of await deps.db.stores.findMany({ marketId: null })) {
    if (distanceMi({ lat: s.latitude, lng: s.longitude }, { lat: m.latitude, lng: m.longitude }) <= m.radiusMi) await deps.db.stores.update(s.id, { marketId: m.id });
  }
  await audit(deps, ctx, 'market.created', 'market', m.id, null, m);
  return m;
}

export async function marketCoverage(deps: Deps) {
  const markets = await deps.db.markets.findMany();
  const stores = await deps.db.stores.findMany({ deletedAt: null });
  return markets.map((m) => {
    const ms = stores.filter((s) => s.marketId === m.id);
    const byCity: Record<string, number> = {};
    const byZip: Record<string, number> = {};
    for (const s of ms) {
      byCity[`${s.city}, ${s.state}`] = (byCity[`${s.city}, ${s.state}`] ?? 0) + 1;
      byZip[s.zip] = (byZip[s.zip] ?? 0) + 1;
    }
    return { ...m, storeCount: ms.length, activeStores: ms.filter((s) => s.status === 'active').length, cities: byCity, zips: byZip, stores: ms.map((s) => ({ id: s.id, name: s.name, latitude: s.latitude, longitude: s.longitude, status: s.status, storeType: s.storeType, serviceRadiusMi: s.serviceRadiusMi })) };
  });
}

// ─── Orders & disputes ────────────────────────────────────────────────────
export async function listOrders(deps: Deps, q: ListQ) {
  let all = await deps.db.orders.findMany({}, { orderBy: [['createdAt', 'desc']] });
  if (q.status) all = all.filter((o) => o.status === q.status);
  if (q.storeId) all = all.filter((o) => o.storeId === q.storeId);
  if (q.q) all = all.filter((o) => o.number.toLowerCase().includes(q.q!.toLowerCase()));
  const page = paginate(all, q.page, q.pageSize);
  const stores = new Map((await deps.db.stores.findMany()).map((s) => [s.id, s.name]));
  const items = [];
  for (const o of page.items) {
    const u = await deps.db.users.get(o.userId);
    items.push({ ...o, idempotencyKey: undefined, storeName: stores.get(o.storeId) ?? '', customerName: u?.fullName ?? '', customerEmail: u?.email ?? '' });
  }
  return { ...page, items };
}

export async function adminOrder(deps: Deps, ctx: RequestContext, id: string) {
  const o = await getOrder(deps, ctx, id, { asAdmin: true });
  const txs = [];
  const p = await deps.db.payments.findOne({ orderId: id });
  if (p) txs.push(...(await deps.db.paymentTransactions.findMany({ paymentId: p.id }, { orderBy: [['createdAt', 'asc']] })));
  return { ...o, transactions: txs, tickets: await deps.db.supportTickets.findMany({ orderId: id }) };
}

export async function adminOrderStatus(deps: Deps, ctx: RequestContext, id: string, input: z.infer<typeof Schemas.statusChange>) {
  const o = await deps.db.orders.get(id);
  if (!o) throw notFound('Order');
  await transitionOrder(deps, ctx, id, input.status as OrderStatus, input.reason ?? 'Updated by RetailGeo operations');
  await audit(deps, ctx, 'order.admin_status', 'order', id, { status: o.status }, { status: input.status, reason: input.reason ?? null });
  return adminOrder(deps, ctx, id);
}

export async function adminRefund(deps: Deps, ctx: RequestContext, id: string, input: z.infer<typeof Schemas.refund>) {
  const o = await deps.db.orders.get(id);
  if (!o) throw notFound('Order');
  const p = await deps.db.payments.findOne({ orderId: id });
  if (!p || p.status !== 'captured' && p.status !== 'partially_refunded') throw invalid('Only captured card payments can be refunded. Cancel the order to release an authorization.');
  await refundPayment(deps, ctx, p, input.amountCents ?? p.amountCents - p.refundedCents, o.userId);
  return adminOrder(deps, ctx, id);
}

export async function listAllStoreOrders(deps: Deps, q: ListQ) {
  let all = await deps.db.storeOrders.findMany({}, { orderBy: [['createdAt', 'desc']] });
  if (q.status) all = all.filter((s) => s.status === q.status);
  const stores = new Map((await deps.db.stores.findMany()).map((s) => [s.id, s.name]));
  const page = paginate(all, q.page, q.pageSize);
  return { ...page, items: page.items.map((s) => ({ ...s, buyerName: stores.get(s.buyerStoreId) ?? '', sellerName: stores.get(s.sellerStoreId) ?? '' })) };
}

export async function adminStoreOrder(deps: Deps, ctx: RequestContext, id: string) {
  return getStoreOrder(deps, ctx, id, '', { admin: true });
}

export async function listTickets(deps: Deps, q: ListQ) {
  let all = await deps.db.supportTickets.findMany({}, { orderBy: [['createdAt', 'desc']] });
  if (q.status) all = all.filter((t) => t.status === q.status);
  return paginate(all, q.page, q.pageSize);
}

export async function updateTicket(deps: Deps, ctx: RequestContext, id: string, input: z.infer<typeof Schemas.ticketUpdate>) {
  const t = await deps.db.supportTickets.get(id);
  if (!t) throw notFound('Ticket');
  await audit(deps, ctx, 'ticket.status', 'support_ticket', id, { status: t.status }, input);
  return deps.db.supportTickets.update(id, { status: input.status, updatedAt: nowIso() });
}

// ─── Audit, settings, notifications ──────────────────────────────────────
export async function auditLogs(deps: Deps, q: ListQ & { entity?: string }) {
  let all = await deps.db.auditLogs.findMany({}, { orderBy: [['createdAt', 'desc']], limit: 2000 });
  if (q.q) all = all.filter((a) => `${a.action} ${a.actorEmail ?? ''} ${a.entity} ${a.entityId ?? ''}`.toLowerCase().includes(q.q!.toLowerCase()));
  return paginate(all, q.page, q.pageSize);
}

export const SETTING_KEYS = ['tax.rates', 'search.default_radius_mi', 'inventory.stale_days', 'checkout.delivery_enabled', 'notifications.sms_enabled', 'privacy.search_log_retention_days', 'maintenance.banner'] as const;

export async function listSettings(deps: Deps) {
  return deps.db.settings.findMany({}, { orderBy: [['id', 'asc']] });
}

export async function updateSetting(deps: Deps, ctx: RequestContext, key: string, input: z.infer<typeof Schemas.setting>) {
  if (!(SETTING_KEYS as readonly string[]).includes(key)) throw invalid('Unknown setting.');
  const existing = await deps.db.settings.get(key);
  const row = { id: key, value: input.value, updatedBy: ctx.user!.id, updatedAt: nowIso() };
  if (existing) await deps.db.settings.update(key, row);
  else await deps.db.settings.insert(row);
  await audit(deps, ctx, 'setting.updated', 'system_setting', key, existing?.value ?? null, input.value);
  return row;
}

export async function broadcast(deps: Deps, ctx: RequestContext, input: z.infer<typeof Schemas.broadcast>) {
  const roles = await deps.db.userRoles.findMany();
  const target = new Set<string>();
  for (const r of roles) {
    if (input.audience === 'all' || (input.audience === 'consumers' && r.role === 'consumer') || (input.audience === 'merchants' && (r.role === 'merchant_admin' || r.role === 'store_employee'))) target.add(r.userId);
  }
  for (const uid of target) await deps.db.notifications.insert({ id: uuid(), userId: uid, storeId: null, type: 'system', title: input.title, body: input.body, link: null, channel: 'in_app', readAt: null, createdAt: nowIso() });
  await audit(deps, ctx, 'notification.broadcast', 'notification', null, null, { ...input, recipients: target.size });
  return { recipients: target.size };
}

export async function platformReport(deps: Deps, days = 30) {
  const from = since(days);
  const orders = (await deps.db.orders.findMany()).filter((o) => new Date(o.createdAt).getTime() > from);
  const paid = orders.filter((o) => !['pending_payment', 'payment_failed', 'cancelled'].includes(o.status));
  const events = (await deps.db.analyticsEvents.findMany()).filter((e) => new Date(e.createdAt).getTime() > from);
  const searches = (await deps.db.searchEvents.findMany()).filter((s) => new Date(s.createdAt).getTime() > from);
  const stores = new Map((await deps.db.stores.findMany()).map((s) => [s.id, s]));
  const byCity: Record<string, { orders: number; gmvCents: number; searches: number }> = {};
  for (const o of paid) {
    const s = stores.get(o.storeId);
    const k = s ? `${s.city}, ${s.state}` : 'Unknown';
    byCity[k] = byCity[k] ?? { orders: 0, gmvCents: 0, searches: 0 };
    byCity[k].orders++;
    byCity[k].gmvCents += o.totalCents;
  }
  const count = (n: string) => events.filter((e) => e.name === n).length;
  return {
    days,
    funnel: { searches: searches.length, productViews: count('product_view'), addToCart: count('add_to_cart'), checkoutStarted: count('checkout_started'), purchases: paid.length },
    gmvCents: paid.reduce((s, o) => s + o.totalCents, 0),
    cancelled: orders.filter((o) => o.status === 'cancelled').length,
    paymentFailures: orders.filter((o) => o.status === 'payment_failed').length,
    byCity: Object.entries(byCity).map(([city, v]) => ({ city, ...v })).sort((a, b) => b.gmvCents - a.gmvCents),
    zeroResultQueries: Object.entries(searches.filter((s) => s.resultCount === 0).reduce<Record<string, number>>((a, s) => ((a[s.query] = (a[s.query] ?? 0) + 1), a), {})).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([query, count]) => ({ query, count })),
  };
}
