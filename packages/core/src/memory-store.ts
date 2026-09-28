import type { DataStore, FindOpts, ListingHit, ListingQuery, NearbyStoreQuery, Op, StoreHit, Table, TableName, Where } from './db';
import { TABLE_NAMES } from './db';
import { distanceMi } from './geo';
import { scoreText } from './text-match';
import { notFound } from './errors';

type Row = { id: string } & Record<string, unknown>;
export type MemorySnapshot = Partial<Record<TableName, Row[]>>;

const clone = <V>(v: V): V => (v == null ? v : (JSON.parse(JSON.stringify(v)) as V));

function isOp(v: unknown): v is Op<unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v) && Object.keys(v).some((k) => k.startsWith('$'));
}

function matches(row: Row, where?: Where<Row>): boolean {
  if (!where) return true;
  for (const [k, cond] of Object.entries(where)) {
    if (cond === undefined) continue;
    const v = row[k];
    if (isOp(cond)) {
      const c = cond as Op<any>;
      if (c.$ne !== undefined && v === c.$ne) return false;
      if (c.$gte !== undefined && !((v as any) >= c.$gte)) return false;
      if (c.$lte !== undefined && !((v as any) <= c.$lte)) return false;
      if (c.$gt !== undefined && !((v as any) > c.$gt)) return false;
      if (c.$lt !== undefined && !((v as any) < c.$lt)) return false;
      if (c.$in !== undefined && !c.$in.includes(v)) return false;
      if (c.$null !== undefined && (v == null) !== c.$null) return false;
      if (c.$ilike !== undefined) {
        const needle = c.$ilike.replace(/%/g, '').toLowerCase();
        if (!String(v ?? '').toLowerCase().includes(needle)) return false;
      }
    } else if (cond === null) {
      if (v != null) return false;
    } else if (v !== cond) return false;
  }
  return true;
}

class MemoryTable<R extends Row> implements Table<R> {
  constructor(private rows: R[], private onChange: () => void) {}
  async get(id: string) {
    return clone(this.rows.find((r) => r.id === id) ?? null);
  }
  async findOne(where: Where<R>) {
    return clone(this.rows.find((r) => matches(r, where as Where<Row>)) ?? null);
  }
  async findMany(where?: Where<R>, opts?: FindOpts<R>) {
    let out = this.rows.filter((r) => matches(r, where as Where<Row>));
    if (opts?.orderBy?.length) {
      out = [...out].sort((a, b) => {
        for (const [k, dir] of opts.orderBy!) {
          const av = a[k] as any;
          const bv = b[k] as any;
          if (av === bv) continue;
          if (av == null) return 1;
          if (bv == null) return -1;
          return (av < bv ? -1 : 1) * (dir === 'desc' ? -1 : 1);
        }
        return 0;
      });
    }
    const off = opts?.offset ?? 0;
    out = out.slice(off, opts?.limit != null ? off + opts.limit : undefined);
    return clone(out);
  }
  async count(where?: Where<R>) {
    return this.rows.filter((r) => matches(r, where as Where<Row>)).length;
  }
  async insert(row: R) {
    this.rows.push(clone(row));
    this.onChange();
    return clone(row);
  }
  async update(id: string, patch: Partial<R>) {
    const r = this.rows.find((x) => x.id === id);
    if (!r) throw notFound('Record');
    for (const [k, v] of Object.entries(patch)) if (v !== undefined) (r as any)[k] = clone(v);
    this.onChange();
    return clone(r);
  }
  async delete(id: string) {
    const i = this.rows.findIndex((x) => x.id === id);
    if (i >= 0) this.rows.splice(i, 1);
    this.onChange();
  }
}

/**
 * In-memory DataStore. Used by the browser demo (so the web app runs the exact same
 * services as the API) and by fast unit tests.
 */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type, @typescript-eslint/no-unsafe-declaration-merging
export interface MemoryDataStore extends DataStore {}
// eslint-disable-next-line @typescript-eslint/no-unsafe-declaration-merging
export class MemoryDataStore {
  private data: Record<TableName, Row[]>;

  constructor(snapshot: MemorySnapshot = {}, private onChange: () => void = () => {}) {
    this.data = {} as Record<TableName, Row[]>;
    for (const t of TABLE_NAMES) {
      this.data[t] = clone(snapshot[t] ?? []);
      (this as any)[t] = new MemoryTable(this.data[t], () => this.onChange());
    }
  }

  snapshot(): MemorySnapshot {
    return clone(this.data);
  }

  async storesNear(q: NearbyStoreQuery): Promise<StoreHit[]> {
    const statuses = q.statuses ?? ['active'];
    const hits: StoreHit[] = [];
    for (const s of this.data.stores as any[]) {
      if (s.deletedAt || !statuses.includes(s.status)) continue;
      if (q.storeTypes?.length && !q.storeTypes.includes(s.storeType)) continue;
      if (q.marketId && s.marketId !== q.marketId) continue;
      if (q.city && s.city.toLowerCase() !== q.city.toLowerCase()) continue;
      if (q.state && s.state !== q.state) continue;
      if (q.text && scoreText(q.text, [{ text: s.name, weight: 1 }, { text: s.storeType.replace('_', ' '), weight: 0.7 }, { text: s.city, weight: 0.5 }]) === 0) continue;
      const d = distanceMi({ lat: q.lat, lng: q.lng }, { lat: s.latitude, lng: s.longitude });
      if (!q.city && d > q.radiusMi) continue;
      hits.push({ store: clone(s), distanceMi: d });
    }
    hits.sort((a, b) => (a.distanceMi ?? 0) - (b.distanceMi ?? 0));
    return hits.slice(0, q.limit ?? 200);
  }

  async searchListings(q: ListingQuery): Promise<ListingHit[]> {
    const products = new Map((this.data.products as any[]).map((p) => [p.id, p]));
    const stores = new Map((this.data.stores as any[]).map((s) => [s.id, s]));
    const brands = new Map((this.data.brands as any[]).map((b) => [b.id, b.name]));
    const cats = new Map((this.data.categories as any[]).map((c) => [c.id, c]));
    const catName = (id: string) => {
      const c = cats.get(id);
      const parent = c?.parentId ? cats.get(c.parentId) : null;
      return [c?.name, parent?.name].filter(Boolean).join(' ');
    };
    const now = Date.now();
    const out: ListingHit[] = [];
    for (const l of this.data.storeProducts as any[]) {
      if (!l.visible) continue;
      if (l.availableUntil && new Date(l.availableUntil).getTime() < now) continue;
      if (l.availableFrom && new Date(l.availableFrom).getTime() > now) continue;
      const p = products.get(l.productId);
      const s = stores.get(l.storeId);
      if (!p || !s || p.status !== 'active' || p.deletedAt || s.status !== 'active' || s.deletedAt) continue;
      if (q.productId && p.id !== q.productId) continue;
      if (q.storeIds && !q.storeIds.includes(s.id)) continue;
      if (q.excludeStoreId && s.id === q.excludeStoreId) continue;
      if (q.storeTypes?.length && !q.storeTypes.includes(s.storeType)) continue;
      if (q.inStockOnly && l.quantity <= 0) continue;
      if (q.b2bOnly && !l.b2bEnabled) continue;
      if (q.categoryIds?.length) {
        const c = cats.get(p.categoryId);
        if (!q.categoryIds.includes(p.categoryId) && !(c?.parentId && q.categoryIds.includes(c.parentId))) continue;
      }
      let d: number | null = null;
      if (q.lat != null && q.lng != null) {
        d = distanceMi({ lat: q.lat, lng: q.lng }, { lat: s.latitude, lng: s.longitude });
        if (q.radiusMi != null && d > q.radiusMi) continue;
      }
      let score = 1;
      if (q.text) {
        const t = q.text.trim().toLowerCase();
        if (t === String(p.sku).toLowerCase() || t === p.upc || t === String(l.storeSku ?? '').toLowerCase()) score = 1;
        else {
          score = scoreText(q.text, [
            { text: `${p.name} ${p.size ?? ''}`, weight: 1 },
            { text: brands.get(p.brandId) ?? '', weight: 0.8 },
            { text: catName(p.categoryId), weight: 0.6 },
            { text: `${p.sku} ${p.upc ?? ''}`, weight: 0.9 },
            { text: s.name, weight: 0.5 },
          ]);
          if (score === 0) continue;
        }
      }
      out.push({ listing: clone(l), product: clone(p), store: clone(s), distanceMi: d, score });
    }
    out.sort((a, b) => b.score - a.score || (a.distanceMi ?? 0) - (b.distanceMi ?? 0));
    return out.slice(0, q.limit ?? 500);
  }

  async decrementStock(id: string, qty: number): Promise<boolean> {
    const l = (this.data.storeProducts as any[]).find((x) => x.id === id);
    if (!l || l.quantity < qty) return false;
    l.quantity -= qty;
    l.updatedAt = new Date().toISOString();
    this.onChange();
    return true;
  }

  async tx<R>(fn: (db: DataStore) => Promise<R>): Promise<R> {
    const before = clone(this.data);
    try {
      return await fn(this);
    } catch (e) {
      for (const t of TABLE_NAMES) this.data[t].splice(0, this.data[t].length, ...before[t]);
      throw e;
    }
  }
}
