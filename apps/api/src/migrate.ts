import pg from 'pg';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { ROLE_PERMISSIONS, ROLE_LABELS, PERMISSIONS, type RoleKey } from '@retailgeo/core';
import { loadConfig } from './config';

/** Forward-only SQL migrations tracked in schema_migrations, then RBAC catalog sync. */
export async function migrate(databaseUrl: string, dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../db/migrations')) {
  const pool = new pg.Pool({ connectionString: databaseUrl });
  const client = await pool.connect();
  try {
    await client.query('CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())');
    const done = new Set((await client.query('SELECT name FROM schema_migrations')).rows.map((r) => r.name));
    for (const file of readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()) {
      if (done.has(file)) continue;
      await client.query('BEGIN');
      await client.query(readFileSync(path.join(dir, file), 'utf8'));
      await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [file]);
      await client.query('COMMIT');
      console.log(`applied ${file}`);
    }
    await client.query('BEGIN');
    for (const p of PERMISSIONS) await client.query('INSERT INTO permissions (key) VALUES ($1) ON CONFLICT DO NOTHING', [p]);
    for (const [role, perms] of Object.entries(ROLE_PERMISSIONS)) {
      await client.query('INSERT INTO roles (key, label) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET label = EXCLUDED.label', [role, ROLE_LABELS[role as RoleKey]]);
      await client.query('DELETE FROM role_permissions WHERE role_key = $1', [role]);
      for (const p of perms) await client.query('INSERT INTO role_permissions (role_key, permission_key) VALUES ($1, $2)', [role, p]);
    }
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw e;
  } finally {
    client.release();
    await pool.end();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  migrate(loadConfig().DATABASE_URL).then(() => console.log('migrations complete')).catch((e) => { console.error(e); process.exit(1); });
}
