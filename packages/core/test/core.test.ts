import { beforeAll, describe, expect, it } from 'vitest';
import {
  MemoryDataStore, InProcessEventBus, JwtService, Pbkdf2Hasher, MockPaymentProvider, GazetteerGeocoder, OutboxChannel,
  registerEventHandlers, generateSeed, DEMO_PASSWORD, dispatch, distanceMi, priceLine, computeTotals, offerDiscount,
  assertStoreOrderTransition, assertOrderTransition, scoreText, extractRadius, parseCsv, can, buildOpenApi, routes, type Deps, type Offer,
} from '../src';
import { apiScenarios, type Call } from './scenarios';

describe('geo', () => {
  it('computes great-circle miles (Dallas → Fort Worth ≈ 30 mi)', () => {
    expect(distanceMi({ lat: 32.7767, lng: -96.797 }, { lat: 32.7555, lng: -97.3308 })).toBeCloseTo(31.1, 0);
  });
  it('parses radius phrases', () => {
    expect(extractRadius('find bottled water within 5 miles')).toEqual({ radiusMi: 5, rest: 'find bottled water' });
  });
});

describe('pricing', () => {
  const base = { id: 'l', storeId: 's', productId: 'p', priceCents: 300, promoPriceCents: null } as any;
  const product = { id: 'p', categoryId: 'c' } as any;
  const offer = (o: Partial<Offer>): Offer => ({ id: 'o', storeId: 's', name: '', description: '', scope: 'product', productId: 'p', categoryId: null, discountType: 'percent', discountValue: 10, buyQty: null, getQty: null, startAt: '2000-01-01T00:00:00Z', endAt: '2999-01-01T00:00:00Z', eligibility: 'all', geoRadiusMi: null, usageLimit: null, usageCount: 0, status: 'active', createdAt: '', updatedAt: '', ...o });
  const ctx = { now: new Date(), isNewCustomer: false };
  it('applies percent, fixed and buy-X-get-Y', () => {
    expect(offerDiscount(offer({ discountType: 'percent', discountValue: 25 }), 300, 2)).toBe(150);
    expect(offerDiscount(offer({ discountType: 'fixed', discountValue: 100 }), 300, 3)).toBe(300);
    expect(offerDiscount(offer({ discountType: 'bxgy', buyQty: 2, getQty: 1 }), 300, 6)).toBe(600);
  });
  it('picks the best offer and respects eligibility and geography', () => {
    const offers = [offer({ id: 'a', discountValue: 10 }), offer({ id: 'b', discountValue: 20, eligibility: 'new_customer' }), offer({ id: 'c', discountValue: 30, geoRadiusMi: 2 })];
    expect(priceLine(base, product, 1, offers, { ...ctx, shopperDistanceMi: 5 }).offer?.id).toBe('a');
    expect(priceLine(base, product, 1, offers, { ...ctx, isNewCustomer: true, shopperDistanceMi: 5 }).offer?.id).toBe('b');
    expect(priceLine(base, product, 1, offers, { ...ctx, shopperDistanceMi: 1 }).offer?.id).toBe('c');
  });
  it('computes Texas sales tax on the discounted subtotal', () => {
    const t = computeTotals([{ unitCents: 1000, listUnitCents: 1000, quantity: 2, discountCents: 200, totalCents: 1800, offer: null }], { state: 'TX', feeCents: 499 });
    expect(t).toMatchObject({ subtotalCents: 2000, discountCents: 200, taxCents: 149, totalCents: 1800 + 149 + 499 });
  });
});

describe('lifecycles', () => {
  it('guards consumer order transitions', () => {
    expect(() => assertOrderTransition('confirmed', 'completed', 'pickup')).toThrow();
    expect(() => assertOrderTransition('processing', 'out_for_delivery', 'pickup')).toThrow();
    expect(() => assertOrderTransition('processing', 'ready', 'pickup')).not.toThrow();
  });
  it('guards who can move store-to-store orders', () => {
    expect(() => assertStoreOrderTransition('pending_acceptance', 'accepted', 'buyer')).toThrow(/supplying/);
    expect(() => assertStoreOrderTransition('pending_acceptance', 'accepted', 'seller')).not.toThrow();
    expect(() => assertStoreOrderTransition('ready', 'completed', 'buyer')).not.toThrow();
    expect(() => assertStoreOrderTransition('completed', 'cancelled', 'seller')).toThrow();
  });
});

describe('search + csv + rbac', () => {
  it('scores partial and typo matches', () => {
    expect(scoreText('ibuprofn', [{ text: 'Ibuprofen 200 mg Tablets', weight: 1 }])).toBeGreaterThan(0);
    expect(scoreText('wat', [{ text: 'Spring Water', weight: 1 }])).toBeGreaterThan(0);
    expect(scoreText('kimchi', [{ text: 'Motor Oil', weight: 1 }])).toBe(0);
  });
  it('parses quoted CSV', () => {
    expect(parseCsv('a,b\n"x, y","z""q"\n')).toEqual([['a', 'b'], ['x, y', 'z"q']]);
  });
  it('keeps support away from financial and security permissions', () => {
    expect(can(['platform_support'], 'admin.payments')).toBe(false);
    expect(can(['platform_support'], 'admin.roles')).toBe(false);
    expect(can(['store_employee'], 'offers.manage')).toBe(false);
    expect(can(['platform_admin'], 'admin.audit')).toBe(true);
  });
  it('documents every route in OpenAPI', () => {
    const spec = buildOpenApi();
    const ops = Object.values(spec.paths).reduce((n, p) => n + Object.keys(p).length, 0);
    expect(ops).toBe(routes.length);
  });
});

describe('API scenarios (in-memory data store)', () => {
  let deps: Deps;
  const outbox = new OutboxChannel('email');
  beforeAll(async () => {
    const hasher = new Pbkdf2Hasher(1000);
    const db = new MemoryDataStore(generateSeed({ passwordHash: await hasher.hash(DEMO_PASSWORD) }));
    deps = {
      db, events: new InProcessEventBus(), hasher, jwt: new JwtService('test-secret-test-secret-test-secret!!'), payments: new MockPaymentProvider(),
      geocoder: new GazetteerGeocoder(), email: outbox,
      config: { env: 'test', refreshTtlDays: 30, maxFailedLogins: 5, lockMinutes: 15, adminMfa: true, publicWebUrl: 'http://localhost' },
    };
    registerEventHandlers(deps);
  });
  const call: Call = async (method, path, opts = {}) => {
    const res = await dispatch(deps, {
      method, path, query: Object.fromEntries(Object.entries(opts.query ?? {}).map(([k, v]) => [k, String(v)])), body: opts.body,
      headers: { ...(opts.token ? { authorization: `Bearer ${opts.token}` } : {}), ...Object.fromEntries(Object.entries(opts.headers ?? {}).map(([k, v]) => [k.toLowerCase(), v])) },
    });
    return { status: res.status, body: JSON.parse(JSON.stringify(res.body)) };
  };
  apiScenarios(() => call, () => outbox);
});
