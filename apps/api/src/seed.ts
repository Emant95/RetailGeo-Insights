import pg from 'pg';
import { generateSeed, Pbkdf2Hasher, DEMO_PASSWORD, TABLE_NAMES, type TableName } from '@retailgeo/core';
import { PgDataStore } from './pg-store';
import { loadConfig } from './config';

// Insert order respects foreign keys.
const ORDER: TableName[] = [
  'markets', 'users', 'businesses', 'userRoles', 'stores', 'storeHours', 'storeUsers', 'categories', 'brands', 'products', 'variants',
  'storeProducts', 'inventoryEvents', 'offers', 'addresses', 'carts', 'cartItems', 'orders', 'orderItems', 'statusHistory', 'storeOrders',
  'storeOrderItems', 'payments', 'paymentTransactions', 'notifications', 'favorites', 'supportTickets', 'searchEvents', 'analyticsEvents',
  'auditLogs', 'settings', 'searchIndex', 'sessions', 'authTokens',
];

export async function seed(databaseUrl: string, opts: { iterations?: number; reset?: boolean } = {}) {
  if (ORDER.length !== TABLE_NAMES.length) throw new Error('seed order out of sync with TABLE_NAMES');
  const pool = new pg.Pool({ connectionString: databaseUrl });
  const db = new PgDataStore(pool);
  const passwordHash = await new Pbkdf2Hasher(opts.iterations ?? 600_000).hash(DEMO_PASSWORD);
  const data = generateSeed({ passwordHash });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    if (opts.reset) {
      await client.query('ALTER TABLE audit_logs DISABLE TRIGGER audit_logs_no_update');
      await client.query(`TRUNCATE ${['search_index_metadata', 'system_settings', 'audit_logs', 'analytics_events', 'search_events', 'support_tickets', 'favorites', 'notifications', 'payment_transactions', 'payments', 'store_order_items', 'store_orders', 'order_status_history', 'order_items', 'orders', 'cart_items', 'carts', 'addresses', 'offers', 'inventory_events', 'store_products', 'product_variants', 'products', 'brands', 'categories', 'store_users', 'store_hours', 'stores', 'user_roles', 'businesses', 'auth_tokens', 'sessions', 'users', 'geographic_markets'].join(', ')} CASCADE`);
      await client.query('ALTER TABLE audit_logs ENABLE TRIGGER audit_logs_no_update');
    }
    await client.query('COMMIT');
  } finally {
    client.release();
  }
  await db.tx(async (t) => {
    for (const name of ORDER) for (const row of (data[name] ?? []) as any[]) await (t as any)[name].insert(row);
  });
  await pool.end();
  return Object.fromEntries(ORDER.map((n) => [n, (data[n] ?? []).length]));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const cfg = loadConfig();
  seed(cfg.DATABASE_URL, { iterations: cfg.PASSWORD_ITERATIONS, reset: process.argv.includes('--reset') })
    .then((counts) => console.log('seeded', counts, `\nDemo password for *@retailgeo.demo accounts: ${DEMO_PASSWORD}`))
    .catch((e) => { console.error(e); process.exit(1); });
}
