import pg from 'pg';
import type { DataStore, FindOpts, ListingHit, ListingQuery, NearbyStoreQuery, Op, StoreHit, Table, TableName, Where } from '@retailgeo/core';
import { MI_TO_M, notFound } from '@retailgeo/core';

// Return timestamps as ISO strings, numerics as numbers, bigint counts as numbers.
pg.types.setTypeParser(1184, (v) => new Date(v).toISOString()); // timestamptz
pg.types.setTypeParser(1114, (v) => new Date(`${v}Z`).toISOString()); // timestamp
pg.types.setTypeParser(1700, (v) => Number(v)); // numeric
pg.types.setTypeParser(20, (v) => Number(v)); // int8

const TABLES: Record<TableName, { sql: string; json?: string[]; readonlyCols?: string[] }> = {
  users: { sql: 'users' },
  userRoles: { sql: 'user_roles' },
  sessions: { sql: 'sessions' },
  authTokens: { sql: 'auth_tokens' },
  businesses: { sql: 'businesses' },
  stores: { sql: 'stores' },
  storeHours: { sql: 'store_hours' },
  storeUsers: { sql: 'store_users' },
  markets: { sql: 'geographic_markets' },
  categories: { sql: 'categories' },
  brands: { sql: 'brands' },
  products: { sql: 'products', json: ['attributes'] },
  variants: { sql: 'product_variants', json: ['attributes'] },
  storeProducts: { sql: 'store_products' },
  inventoryEvents: { sql: 'inventory_events' },
  offers: { sql: 'offers' },
  addresses: { sql: 'addresses' },
  carts: { sql: 'carts' },
  cartItems: { sql: 'cart_items' },
  orders: { sql: 'orders', json: ['deliveryAddress'] },
  orderItems: { sql: 'order_items' },
  statusHistory: { sql: 'order_status_history' },
  storeOrders: { sql: 'store_orders' },
  storeOrderItems: { sql: 'store_order_items' },
  payments: { sql: 'payments' },
  paymentTransactions: { sql: 'payment_transactions' },
  notifications: { sql: 'notifications' },
  favorites: { sql: 'favorites' },
  supportTickets: { sql: 'support_tickets' },
  searchEvents: { sql: 'search_events' },
  analyticsEvents: { sql: 'analytics_events', json: ['props'] },
  auditLogs: { sql: 'audit_logs', json: ['before', 'after'] },
  settings: { sql: 'system_settings', json: ['value'] },
  searchIndex: { sql: 'search_index_metadata' },
};
// Generated / internal columns never returned to the domain layer.
const HIDDEN = new Set(['location', 'center', 'search_vector']);

const snake = (s: string) => s.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
const camel = (s: string) => s.replace(/_([a-z0-9])/g, (_m, c) => c.toUpperCase());
const ident = (s: string) => {
  if (!/^[a-z_][a-z0-9_]*$/.test(s)) throw new Error(`Unsafe identifier ${s}`);
  return `"${s}"`;
};

type Queryable = pg.Pool | pg.PoolClient;

function fromRow(row: Record<string, unknown>) {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) if (!HIDDEN.has(k)) out[camel(k)] = v;
  return out;
}

function isOp(v: unknown): v is Op<unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v) && Object.keys(v).some((k) => k.startsWith('$'));
}

class PgTable<R extends { id: string }> implements Table<R> {
  constructor(private q: () => Queryable, private name: string, private json: Set<string>) {}

  private enc(key: string, v: unknown) {
    if (v === undefined) return undefined;
    if (this.json.has(key)) return v === null ? null : JSON.stringify(v);
    return v;
  }

  private where(where: Where<R> | undefined, params: unknown[]) {
    const clauses: string[] = [];
    for (const [k, cond] of Object.entries(where ?? {})) {
      if (cond === undefined) continue;
      const col = ident(snake(k));
      if (cond === null) clauses.push(`${col} IS NULL`);
      else if (isOp(cond)) {
        const c = cond as Op<unknown>;
        const add = (sql: string, v: unknown) => (params.push(v), clauses.push(sql.replace('?', `$${params.length}`)));
        if (c.$ne !== undefined) add(`${col} IS DISTINCT FROM ?`, c.$ne);
        if (c.$gte !== undefined) add(`${col} >= ?`, c.$gte);
        if (c.$lte !== undefined) add(`${col} <= ?`, c.$lte);
        if (c.$gt !== undefined) add(`${col} > ?`, c.$gt);
        if (c.$lt !== undefined) add(`${col} < ?`, c.$lt);
        if (c.$ilike !== undefined) add(`${col}::text ILIKE ?`, `%${c.$ilike.replace(/[%_]/g, '')}%`);
        if (c.$in !== undefined) {
          if (c.$in.length === 0) clauses.push('FALSE');
          else add(`${col} = ANY(?)`, c.$in);
        }
        if (c.$null !== undefined) clauses.push(`${col} IS ${c.$null ? '' : 'NOT '}NULL`);
      } else {
        params.push(this.enc(k, cond));
        clauses.push(`${col} = $${params.length}`);
      }
    }
    return clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  }

  async get(id: string) {
    const r = await this.q().query(`SELECT * FROM ${this.name} WHERE id = $1`, [id]);
    return (r.rows[0] ? fromRow(r.rows[0]) : null) as R | null;
  }
  async findOne(where: Where<R>) {
    return (await this.findMany(where, { limit: 1 }))[0] ?? null;
  }
  async findMany(where?: Where<R>, opts?: FindOpts<R>) {
    const params: unknown[] = [];
    let sql = `SELECT * FROM ${this.name} ${this.where(where, params)}`;
    if (opts?.orderBy?.length) sql += ` ORDER BY ${opts.orderBy.map(([k, d]) => `${ident(snake(k))} ${d === 'desc' ? 'DESC' : 'ASC'} NULLS LAST`).join(', ')}`;
    if (opts?.limit != null) sql += ` LIMIT ${Math.max(0, Math.floor(opts.limit))}`;
    if (opts?.offset) sql += ` OFFSET ${Math.max(0, Math.floor(opts.offset))}`;
    const r = await this.q().query(sql, params);
    return r.rows.map(fromRow) as R[];
  }
  async count(where?: Where<R>) {
    const params: unknown[] = [];
    const r = await this.q().query(`SELECT count(*)::int AS n FROM ${this.name} ${this.where(where, params)}`, params);
    return r.rows[0].n as number;
  }
  async insert(row: R) {
    const entries = Object.entries(row).filter(([, v]) => v !== undefined);
    const cols = entries.map(([k]) => ident(snake(k))).join(', ');
    const vals = entries.map((_e, i) => `$${i + 1}`).join(', ');
    const r = await this.q().query(`INSERT INTO ${this.name} (${cols}) VALUES (${vals}) RETURNING *`, entries.map(([k, v]) => this.enc(k, v)));
    return fromRow(r.rows[0]) as R;
  }
  async update(id: string, patch: Partial<R>) {
    const entries = Object.entries(patch).filter(([k, v]) => v !== undefined && k !== 'id');
    if (entries.length === 0) {
      const cur = await this.get(id);
      if (!cur) throw notFound('Record');
      return cur;
    }
    const sets = entries.map(([k], i) => `${ident(snake(k))} = $${i + 2}`).join(', ');
    const r = await this.q().query(`UPDATE ${this.name} SET ${sets} WHERE id = $1 RETURNING *`, [id, ...entries.map(([k, v]) => this.enc(k, v))]);
    if (!r.rows[0]) throw notFound('Record');
    return fromRow(r.rows[0]) as R;
  }
  async delete(id: string) {
    await this.q().query(`DELETE FROM ${this.name} WHERE id = $1`, [id]);
  }
}

/** PostgreSQL + PostGIS implementation of the DataStore port. */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type, @typescript-eslint/no-unsafe-declaration-merging
export interface PgDataStore extends DataStore {}
// eslint-disable-next-line @typescript-eslint/no-unsafe-declaration-merging
export class PgDataStore {
  constructor(private pool: pg.Pool, private client: pg.PoolClient | null = null) {
    const q = () => this.client ?? this.pool;
    for (const [key, def] of Object.entries(TABLES)) (this as any)[key] = new PgTable(q, def.sql, new Set(def.json ?? []));
  }

  private get db(): Queryable {
    return this.client ?? this.pool;
  }

  async storesNear(q: NearbyStoreQuery): Promise<StoreHit[]> {
    const params: unknown[] = [q.lng, q.lat];
    const where = ['s.deleted_at IS NULL'];
    const add = (sql: string, v: unknown) => (params.push(v), where.push(sql.replace('?', `$${params.length}`)));
    add('s.status = ANY(?)', q.statuses ?? ['active']);
    if (!q.city) add('ST_DWithin(s.location, ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography, ?)', q.radiusMi * MI_TO_M);
    if (q.storeTypes?.length) add('s.store_type = ANY(?)', q.storeTypes);
    if (q.marketId) add('s.market_id = ?', q.marketId);
    if (q.city) add('lower(s.city) = lower(?)', q.city);
    if (q.state) add('s.state = ?', q.state);
    if (q.text) {
      params.push(q.text);
      const t = `$${params.length}`;
      where.push(`(s.name ILIKE '%' || ${t} || '%' OR word_similarity(lower(${t}), lower(s.name)) > 0.5 OR replace(s.store_type, '_', ' ') ILIKE '%' || ${t} || '%' OR lower(s.city) = lower(${t}))`);
    }
    const sql = `SELECT s.*, ST_Distance(s.location, ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography) / ${MI_TO_M} AS distance_mi
      FROM stores s WHERE ${where.join(' AND ')} ORDER BY distance_mi ASC LIMIT ${q.limit ?? 200}`;
    const r = await this.db.query(sql, params);
    return r.rows.map((row) => {
      const { distanceMi, ...store } = fromRow(row) as any;
      return { store, distanceMi: Number(distanceMi) };
    });
  }

  async searchListings(q: ListingQuery): Promise<ListingHit[]> {
    const params: unknown[] = [];
    const where = [
      'sp.visible', 'p.deleted_at IS NULL', "p.status = 'active'", "s.status = 'active'", 's.deleted_at IS NULL',
      '(sp.available_from IS NULL OR sp.available_from <= now())', '(sp.available_until IS NULL OR sp.available_until >= now())',
    ];
    const add = (sql: string, ...vals: unknown[]) => {
      let out = sql;
      for (const v of vals) {
        params.push(v);
        out = out.replace('?', `$${params.length}`);
      }
      where.push(out);
    };
    let distanceSql = 'NULL::double precision';
    if (q.lat != null && q.lng != null) {
      params.push(q.lng, q.lat);
      const pt = `ST_SetSRID(ST_MakePoint($${params.length - 1}, $${params.length}), 4326)::geography`;
      distanceSql = `ST_Distance(s.location, ${pt}) / ${MI_TO_M}`;
      if (q.radiusMi != null) add(`ST_DWithin(s.location, ${pt}, ?)`, q.radiusMi * MI_TO_M);
    }
    if (q.productId) add('p.id = ?', q.productId);
    if (q.storeIds) add('s.id = ANY(?)', q.storeIds);
    if (q.excludeStoreId) add('s.id <> ?', q.excludeStoreId);
    if (q.storeTypes?.length) add('s.store_type = ANY(?)', q.storeTypes);
    if (q.inStockOnly) where.push('sp.quantity > 0');
    if (q.b2bOnly) where.push('sp.b2b_enabled');
    if (q.categoryIds?.length) add('(p.category_id = ANY(?) OR c.parent_id = ANY(?))', q.categoryIds, q.categoryIds);
    let scoreSql = '1.0';
    if (q.text) {
      // Exact SKU/UPC → 1.0; full-text match; trigram similarity for partial + typo tolerance.
      params.push(q.text);
      const t = `$${params.length}`;
      scoreSql = `GREATEST(
        CASE WHEN lower(p.sku) = lower(${t}) OR p.upc = ${t} OR lower(coalesce(sp.store_sku,'')) = lower(${t}) THEN 1.0 ELSE 0 END,
        CASE WHEN p.search_vector @@ plainto_tsquery('english', ${t}) THEN 0.7 + 0.3 * ts_rank(p.search_vector, plainto_tsquery('english', ${t})) ELSE 0 END,
        word_similarity(lower(${t}), lower(p.name)) * 0.9,
        word_similarity(lower(${t}), lower(coalesce(b.name,''))) * 0.8,
        word_similarity(lower(${t}), lower(c.name || ' ' || coalesce(pc.name,''))) * 0.6,
        word_similarity(lower(${t}), lower(s.name)) * 0.5
      )`;
      where.push(`${scoreSql} >= 0.45`);
    }
    const sql = `SELECT row_to_json(sp.*) AS listing, row_to_json(p.*) AS product, row_to_json(s.*) AS store,
        ${distanceSql} AS distance_mi, ${scoreSql} AS score
      FROM store_products sp
      JOIN products p ON p.id = sp.product_id
      JOIN stores s ON s.id = sp.store_id
      JOIN categories c ON c.id = p.category_id
      LEFT JOIN categories pc ON pc.id = c.parent_id
      LEFT JOIN brands b ON b.id = p.brand_id
      WHERE ${where.join(' AND ')}
      ORDER BY score DESC, distance_mi ASC NULLS LAST
      LIMIT ${q.limit ?? 500}`;
    const r = await this.db.query(sql, params);
    const norm = (o: Record<string, unknown>) => {
      const out = fromRow(o) as any;
      for (const k of Object.keys(out)) if (typeof out[k] === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?[+-]\d{2}:\d{2}$/.test(out[k])) out[k] = new Date(out[k]).toISOString();
      return out;
    };
    return r.rows.map((row) => ({
      listing: norm(row.listing),
      product: norm(row.product),
      store: norm(row.store),
      distanceMi: row.distance_mi == null ? null : Number(row.distance_mi),
      score: Math.min(1, Number(row.score)),
    }));
  }

  async decrementStock(id: string, qty: number) {
    const r = await this.db.query('UPDATE store_products SET quantity = quantity - $2, updated_at = now() WHERE id = $1 AND quantity >= $2', [id, qty]);
    return (r.rowCount ?? 0) > 0;
  }

  async tx<R>(fn: (db: DataStore) => Promise<R>): Promise<R> {
    if (this.client) return fn(this); // already inside a transaction
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await fn(new PgDataStore(this.pool, client));
      await client.query('COMMIT');
      return result;
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  }
}
