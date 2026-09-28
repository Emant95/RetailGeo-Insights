import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import pino from 'pino';
import pg from 'pg';
import { loadConfig } from '../src/config';
import { buildDeps } from '../src/deps';
import { createApp } from '../src/app';
import { migrate } from '../src/migrate';
import { seed } from '../src/seed';
import { apiScenarios, type Call } from '../../../packages/core/test/scenarios';

/**
 * Integration tests against a real PostgreSQL + PostGIS database through the Express app.
 * Requires TEST_DATABASE_URL (CI provides a postgis service container).
 */
const url = process.env.TEST_DATABASE_URL;
const d = url ? describe : describe.skip;

d('API over HTTP (PostgreSQL + PostGIS)', () => {
  let app: ReturnType<typeof createApp>;
  let pool: pg.Pool;
  let outbox: ReturnType<typeof buildDeps>['email'];
  beforeAll(async () => {
    const admin = new pg.Pool({ connectionString: url });
    await admin.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
    await admin.end();
    await migrate(url!);
    await seed(url!, { iterations: 1000 });
    const cfg = loadConfig({ NODE_ENV: 'test', DATABASE_URL: url, JWT_SECRET: 'integration-secret-integration-secret', PASSWORD_ITERATIONS: '1000' } as any);
    const built = buildDeps(cfg, pino({ level: 'silent' }));
    pool = built.pool;
    outbox = built.email;
    app = createApp(built.deps, cfg, pino({ level: 'silent' }), pool);
  });
  afterAll(async () => pool?.end());

  it('serves health, readiness and OpenAPI', async () => {
    expect((await request(app).get('/health')).body.status).toBe('ok');
    expect((await request(app).get('/ready')).body.status).toBe('ready');
    const spec = await request(app).get('/api/v1/openapi.json');
    expect(spec.body.openapi).toBe('3.1.0');
  });

  it('sets security headers and request ids', async () => {
    const r = await request(app).get('/api/v1/categories');
    expect(r.headers['x-content-type-options']).toBe('nosniff');
    expect(r.headers['x-request-id']).toBeTruthy();
    expect(r.headers['x-powered-by']).toBeUndefined();
  });

  it('uses PostGIS for radius queries', async () => {
    const res = await pool.query(`SELECT count(*)::int n FROM stores WHERE ST_DWithin(location, ST_SetSRID(ST_MakePoint(-96.7475, 32.8252), 4326)::geography, 5 * 1609.344)`);
    const api = await request(app).get('/api/v1/stores').query({ lat: 32.8252, lng: -96.7475, radius: 5, pageSize: 100 });
    expect(api.body.total).toBe(res.rows[0].n - (await pool.query(`SELECT count(*)::int n FROM stores WHERE status <> 'active' AND ST_DWithin(location, ST_SetSRID(ST_MakePoint(-96.7475, 32.8252), 4326)::geography, 5 * 1609.344)`)).rows[0].n);
  });

  it('keeps the audit log append-only', async () => {
    await expect(pool.query('DELETE FROM audit_logs')).rejects.toThrow(/append-only/);
  });

  const call: Call = async (method, path, opts = {}) => {
    let req = (request(app) as any)[method.toLowerCase()](`/api/v1${path}`);
    if (opts.query) req = req.query(opts.query);
    if (opts.token) req = req.set('Authorization', `Bearer ${opts.token}`);
    for (const [k, v] of Object.entries(opts.headers ?? {})) req = req.set(k, v);
    const res = opts.body !== undefined ? await req.send(opts.body) : await req;
    return { status: res.status, body: res.body };
  };
  apiScenarios(() => call, () => outbox);
});
