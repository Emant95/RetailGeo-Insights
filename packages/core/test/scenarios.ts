import { expect, it } from 'vitest';
import type { OutboxChannel } from '../src/providers/channels';

/**
 * End-to-end API scenarios. The same suite runs against the in-memory store (core) and against
 * PostgreSQL + PostGIS through Express (apps/api), proving both data stores behave identically.
 */
export type Call = (method: string, path: string, opts?: { body?: unknown; query?: Record<string, unknown>; token?: string; headers?: Record<string, string> }) => Promise<{ status: number; body: any }>;

export function apiScenarios(getCall: () => Call, getOutbox: () => OutboxChannel) {
  const PW = 'RetailGeo2026';
  const LAKEWOOD = { lat: 32.8252, lng: -96.7475 };
  const login = async (email: string) => {
    const call = getCall();
    const r = await call('POST', '/auth/login', { body: { email, password: PW } });
    if (r.body.mfaRequired) {
      const msg = getOutbox().sent.filter((m) => m.to === email && m.kind === 'mfa').at(-1)!;
      const code = msg.body.match(/(\d{6})/)![1];
      const r2 = await call('POST', '/auth/mfa', { body: { challengeId: r.body.challengeId, code } });
      expect(r2.status).toBe(200);
      return r2.body.accessToken as string;
    }
    expect(r.status).toBe(200);
    return r.body.accessToken as string;
  };

  it('finds bottled water within 5 miles, sorted by distance', async () => {
    const r = await getCall()('GET', '/search', { query: { q: 'bottled water within 5 miles', ...LAKEWOOD, sort: 'distance' } });
    expect(r.status).toBe(200);
    expect(r.body.interpreted.radiusMi).toBe(5);
    expect(r.body.items.length).toBeGreaterThan(0);
    expect(r.body.items.some((i: any) => i.product.name.includes('Spring Water'))).toBe(true);
    const d = r.body.items.map((i: any) => i.nearestDistanceMi);
    expect([...d].sort((a, b) => a - b)).toEqual(d);
    expect(Math.max(...d)).toBeLessThanOrEqual(5);
  });

  it('tolerates typos and matches SKU / UPC exactly', async () => {
    const call = getCall();
    const typo = await call('GET', '/search', { query: { q: 'ibuprofn', ...LAKEWOOD, radius: 25 } });
    expect(typo.body.items[0]?.product.name).toMatch(/Ibuprofen/);
    const sku = typo.body.items[0].product.sku;
    const bySku = await call('GET', '/search', { query: { q: sku, ...LAKEWOOD, radius: 25 } });
    expect(bySku.body.items[0].product.sku).toBe(sku);
  });

  it('shows grocery stores near me and stores in Dallas, Texas', async () => {
    const call = getCall();
    const g = await call('GET', '/stores', { query: { ...LAKEWOOD, radius: 10, type: 'grocery' } });
    expect(g.body.items.length).toBeGreaterThan(2);
    expect(g.body.items.every((s: any) => s.storeType === 'grocery')).toBe(true);
    const dallas = await call('GET', '/search', { query: { q: 'Show stores in Dallas, Texas' } });
    expect(dallas.body.interpreted.place).toMatch(/Dallas/);
    expect(dallas.body.stores.length).toBeGreaterThan(3);
  });

  it('compares one product across nearby stores', async () => {
    const call = getCall();
    const s = await call('GET', '/search', { query: { q: 'classic cola 20', ...LAKEWOOD, radius: 10 } });
    const cola = s.body.items.find((i: any) => i.product.name === 'Classic Cola');
    const a = await call('GET', `/products/${cola.product.id}/availability`, { query: { ...LAKEWOOD, radius: 10 } });
    expect(a.status).toBe(200);
    expect(a.body.listings.length).toBeGreaterThanOrEqual(3);
    expect(a.body.summary.lowestPriceCents).toBeLessThanOrEqual(Math.min(...a.body.listings.filter((l: any) => l.stockStatus !== 'out_of_stock').map((l: any) => l.priceCents)));
  });

  it('enforces authentication and role permissions at the API', async () => {
    const call = getCall();
    expect((await call('GET', '/cart')).status).toBe(401);
    const maya = await login('maya@retailgeo.demo');
    expect((await call('GET', '/admin/dashboard', { token: maya })).status).toBe(403);
    expect((await call('GET', '/merchant/me', { token: maya })).status).toBe(403);
    const support = await login('jo@retailgeo.demo');
    expect((await call('GET', '/admin/dashboard', { token: support })).status).toBe(200);
    expect((await call('GET', '/admin/settings', { token: support })).status).toBe(403);
    expect((await call('GET', '/admin/audit-logs', { token: support })).status).toBe(403);
  });

  it('validates input with field-level errors', async () => {
    const r = await getCall()('POST', '/auth/register', { body: { email: 'not-an-email', password: 'short', fullName: 'X' } });
    expect(r.status).toBe(422);
    expect(r.body.error.code).toBe('VALIDATION_FAILED');
    expect(r.body.error.details.map((d: any) => d.field)).toEqual(expect.arrayContaining(['email', 'password']));
  });

  it('registers, locks after repeated failures', async () => {
    const call = getCall();
    const email = `tester${Date.now()}@example.com`;
    const reg = await call('POST', '/auth/register', { body: { email, password: 'Sup3rsecretpw', fullName: 'Test Shopper' } });
    expect(reg.status).toBe(201);
    expect(reg.body.user.roles).toEqual(['consumer']);
    for (let i = 0; i < 5; i++) expect((await call('POST', '/auth/login', { body: { email, password: 'wrong-password1' } })).status).toBe(401);
    const locked = await call('POST', '/auth/login', { body: { email, password: 'Sup3rsecretpw' } });
    expect(locked.status).toBe(423);
  });

  it('rotates refresh tokens and rejects reuse', async () => {
    const call = getCall();
    const r = await call('POST', '/auth/login', { body: { email: 'maya@retailgeo.demo', password: PW } });
    const r1 = await call('POST', '/auth/refresh', { body: { refreshToken: r.body.refreshToken } });
    expect(r1.status).toBe(200);
    const reuse = await call('POST', '/auth/refresh', { body: { refreshToken: r.body.refreshToken } });
    expect(reuse.status).toBe(401);
  });

  let orderId = '';
  let listingId = '';
  let stockBefore = 0;
  let storeId = '';

  it('checks out with idempotency, reserves stock and authorizes payment', async () => {
    const call = getCall();
    const maya = await login('maya@retailgeo.demo');
    const stores = await call('GET', '/stores', { query: { ...LAKEWOOD, radius: 2, q: 'Trinity Fresh Market' } });
    storeId = stores.body.items.find((s: any) => s.name === 'Trinity Fresh Market').id;
    const products = await call('GET', `/stores/${storeId}/products`, { query: { inStock: 'true', q: 'eggs' } });
    const item = products.body.items.find((i: any) => i.quantity >= 3);
    listingId = item.storeProductId;
    stockBefore = item.quantity;
    const cart = await call('POST', '/cart/items', { token: maya, body: { storeProductId: listingId, quantity: 2 } });
    expect(cart.status).toBe(200);
    const group = cart.body.groups.find((g: any) => g.store.id === storeId);
    const expected = group.totals.totalCents;
    expect(group.totals.taxRate).toBe(8.25);
    // Missing idempotency key is rejected
    expect((await call('POST', '/orders/checkout', { token: maya, body: { storeId, fulfillmentType: 'pickup', paymentToken: 'tok_visa' } })).status).toBe(422);
    const key = `idem-${Date.now()}`;
    const o = await call('POST', '/orders/checkout', { token: maya, headers: { 'Idempotency-Key': key }, body: { storeId, fulfillmentType: 'pickup', paymentMethod: 'card', paymentToken: 'tok_visa', expectedTotalCents: expected } });
    expect(o.status).toBe(201);
    expect(o.body.status).toBe('confirmed');
    expect(o.body.paymentStatus).toBe('authorized');
    orderId = o.body.id;
    const again = await call('POST', '/orders/checkout', { token: maya, headers: { 'Idempotency-Key': key }, body: { storeId, fulfillmentType: 'pickup', paymentMethod: 'card', paymentToken: 'tok_visa' } });
    expect(again.body.id).toBe(orderId);
    const after = await call('GET', `/stores/${storeId}/products`, { query: { q: 'eggs' } });
    expect(after.body.items.find((i: any) => i.storeProductId === listingId).quantity).toBe(stockBefore - 2);
    const notes = await call('GET', '/notifications', { token: maya });
    expect(notes.body.items.some((n: any) => n.type === 'order_confirmation')).toBe(true);
  });

  it('restores stock when a card is declined', async () => {
    const call = getCall();
    const maya = await login('maya@retailgeo.demo');
    await call('POST', '/cart/items', { token: maya, body: { storeProductId: listingId, quantity: 1 } });
    const before = (await call('GET', `/stores/${storeId}/products`, { query: { q: 'eggs' } })).body.items.find((i: any) => i.storeProductId === listingId).quantity;
    const r = await call('POST', '/orders/checkout', { token: maya, headers: { 'Idempotency-Key': `dec-${Date.now()}` }, body: { storeId, fulfillmentType: 'pickup', paymentToken: 'tok_chargeDeclined' } });
    expect(r.status).toBe(402);
    const after = (await call('GET', `/stores/${storeId}/products`, { query: { q: 'eggs' } })).body.items.find((i: any) => i.storeProductId === listingId).quantity;
    expect(after).toBe(before);
  });

  it('lets the merchant fulfil the order and captures payment on ready', async () => {
    const call = getCall();
    const dan = await login('dan@retailgeo.demo');
    const me = await call('GET', '/merchant/me', { token: dan });
    expect(me.body.stores.map((s: any) => s.id)).toContain(storeId);
    const dash = await call('GET', `/merchant/stores/${storeId}/dashboard`, { token: dan });
    expect(dash.body.metrics.pendingOrders).toBeGreaterThan(0);
    for (const status of ['processing', 'ready']) {
      const r = await call('POST', `/merchant/stores/${storeId}/orders/${orderId}/status`, { token: dan, body: { status } });
      expect(r.status).toBe(200);
    }
    const bad = await call('POST', `/merchant/stores/${storeId}/orders/${orderId}/status`, { token: dan, body: { status: 'processing' } });
    expect(bad.status).toBe(409);
    const maya = await login('maya@retailgeo.demo');
    const o = await call('GET', `/orders/${orderId}`, { token: maya });
    expect(o.body.status).toBe('ready');
    expect(o.body.paymentStatus).toBe('captured');
    expect(o.body.history.map((h: any) => h.toStatus)).toEqual(['pending_payment', 'confirmed', 'processing', 'ready']);
  });

  it('restricts employees to their assigned capabilities', async () => {
    const call = getCall();
    const sam = await login('sam@retailgeo.demo');
    const inv = await call('GET', `/merchant/stores/${storeId}/inventory`, { token: sam, query: { q: 'eggs' } });
    expect(inv.status).toBe(200);
    const row = inv.body.items[0];
    const upd = await call('PATCH', `/merchant/stores/${storeId}/inventory/${row.id}`, { token: sam, body: { quantity: row.quantity + 5, reason: 'delivery received' } });
    expect(upd.status).toBe(200);
    const price = await call('PATCH', `/merchant/stores/${storeId}/inventory/${row.id}`, { token: sam, body: { priceCents: row.priceCents + 10 } });
    expect(price.status).toBe(403);
    const offer = await call('POST', `/merchant/stores/${storeId}/offers`, { token: sam, body: { name: 'Staff discount', scope: 'store', discountType: 'percent', discountValue: 10, startAt: new Date().toISOString(), endAt: new Date(Date.now() + 86400000).toISOString() } });
    expect(offer.status).toBe(403);
    const hist = await call('GET', `/merchant/stores/${storeId}/inventory/${row.id}/history`, { token: sam });
    expect(hist.body[0].reason).toBe('delivery received');
  });

  it('imports inventory from CSV with a dry run first', async () => {
    const call = getCall();
    const dan = await login('dan@retailgeo.demo');
    const inv = await call('GET', `/merchant/stores/${storeId}/inventory`, { token: dan, query: { pageSize: 2 } });
    const [a, b] = inv.body.items;
    const csv = `sku,price,quantity\n${a.product.sku},${(a.priceCents / 100).toFixed(2)},77\n${b.product.sku},abc,5\nNEW-SKU-1,3.99,10\n`;
    const dry = await call('POST', `/merchant/stores/${storeId}/inventory/import`, { token: dan, body: { csv, dryRun: true } });
    expect(dry.body.summary).toEqual({ updated: 1, created: 0, skipped: 2 });
    const real = await call('POST', `/merchant/stores/${storeId}/inventory/import`, { token: dan, body: { csv, dryRun: false } });
    expect(real.body.summary.updated).toBe(1);
    const check = await call('GET', `/merchant/stores/${storeId}/inventory`, { token: dan, query: { q: a.product.sku } });
    expect(check.body.items[0].quantity).toBe(77);
    expect(check.body.items[0].source).toBe('csv');
  });

  it('runs the store-to-store sourcing lifecycle and moves stock between stores', async () => {
    const call = getCall();
    const dan = await login('dan@retailgeo.demo');
    const src = await call('GET', '/store-orders/sourcing', { token: dan, query: { storeId, q: 'spring water 24', radius: 10 } });
    expect(src.status).toBe(200);
    const water = src.body.items.find((i: any) => i.product.name === 'Spring Water 24-Pack');
    const supplier = water.suppliers.find((s: any) => s.storeName === 'Greenville Avenue Grocer');
    expect(supplier.available).toBeGreaterThanOrEqual(20);
    const created = await call('POST', '/store-orders', { token: dan, headers: { 'Idempotency-Key': `s2s-${Date.now()}` }, body: { buyerStoreId: storeId, sellerStoreId: supplier.storeId, items: [{ storeProductId: supplier.storeProductId, quantity: 20 }], notes: 'Heat wave' } });
    expect(created.status).toBe(201);
    expect(created.body.status).toBe('pending_acceptance');
    const soId = created.body.id;
    const itemId = created.body.items[0].id;
    // Buyer cannot accept its own request
    expect((await call('POST', `/store-orders/${soId}/transition`, { token: dan, body: { storeId, status: 'accepted' } })).status).toBe(409);
    const sellerOwner = await login('owner6@example.com');
    const acc = await call('POST', `/store-orders/${soId}/transition`, { token: sellerOwner, body: { storeId: supplier.storeId, status: 'accepted', quantities: { [itemId]: 15 } } });
    expect(acc.status).toBe(200);
    expect(acc.body.partial).toBe(true);
    await call('POST', `/store-orders/${soId}/transition`, { token: sellerOwner, body: { storeId: supplier.storeId, status: 'preparing' } });
    const ready = await call('POST', `/store-orders/${soId}/transition`, { token: sellerOwner, body: { storeId: supplier.storeId, status: 'ready' } });
    expect(ready.body.items[0].fulfilledQty).toBe(15);
    const invBefore = (await call('GET', `/merchant/stores/${storeId}/inventory`, { token: dan, query: { q: 'Spring Water 24' } })).body.items[0].quantity;
    const done = await call('POST', `/store-orders/${soId}/transition`, { token: dan, body: { storeId, status: 'completed' } });
    expect(done.body.status).toBe('completed');
    const invAfter = (await call('GET', `/merchant/stores/${storeId}/inventory`, { token: dan, query: { q: 'Spring Water 24' } })).body.items[0].quantity;
    expect(invAfter).toBe(invBefore + 15);
  });

  it('requires admin MFA, approves a merchant and records the audit trail', async () => {
    const call = getCall();
    const first = await call('POST', '/auth/login', { body: { email: 'ops@retailgeo.demo', password: PW } });
    expect(first.body.mfaRequired).toBe(true);
    expect((await call('POST', '/auth/mfa', { body: { challengeId: first.body.challengeId, code: '000000' } })).status).toBe(401);
    const admin = await login('ops@retailgeo.demo');
    const pending = await call('GET', '/admin/merchants', { token: admin, query: { status: 'pending' } });
    expect(pending.body.total).toBeGreaterThanOrEqual(1);
    const biz = pending.body.items[0];
    const noNote = await call('POST', `/admin/merchants/${biz.id}/review`, { token: admin, body: { decision: 'reject' } });
    expect(noNote.status).toBe(422);
    const ok = await call('POST', `/admin/merchants/${biz.id}/review`, { token: admin, body: { decision: 'approve' } });
    expect(ok.body.status).toBe('approved');
    const logs = await call('GET', '/admin/audit-logs', { token: admin, query: { q: 'merchant.approved' } });
    expect(logs.body.items.some((l: any) => l.entityId === biz.id && l.actorEmail === 'ops@retailgeo.demo')).toBe(true);
    const dash = await call('GET', '/admin/dashboard', { token: admin });
    expect(dash.body.metrics.activeStores).toBeGreaterThan(30);
    const dups = await call('GET', '/admin/products/duplicates', { token: admin });
    expect(dups.body.length).toBeGreaterThan(0);
  });
}
