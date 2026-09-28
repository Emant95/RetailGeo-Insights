import express, { type Request, type Response, type NextFunction } from 'express';
import helmet from 'helmet';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import pinoHttp from 'pino-http';
import swaggerUi from 'swagger-ui-express';
import { randomUUID } from 'node:crypto';
import type { Logger } from 'pino';
import type pg from 'pg';
import { dispatch, matchRoute, buildOpenApi, type Deps } from '@retailgeo/core';
import type { Config } from './config';

/**
 * Express transport for the shared route table. All business rules, validation and RBAC live in
 * @retailgeo/core; this layer adds HTTP concerns: security headers, CORS, rate limits, logging, health.
 */
export function createApp(deps: Deps, cfg: Config, log: Logger, pool?: pg.Pool) {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', cfg.TRUST_PROXY);
  app.use(helmet({ contentSecurityPolicy: { directives: { defaultSrc: ["'self'"], scriptSrc: ["'self'", "'unsafe-inline'"], styleSrc: ["'self'", "'unsafe-inline'"], imgSrc: ["'self'", 'data:'] } }, crossOriginResourcePolicy: { policy: 'same-site' } }));
  app.use(cors({ origin: cfg.CORS_ORIGINS.split(',').map((s) => s.trim()), credentials: false, allowedHeaders: ['Authorization', 'Content-Type', 'Idempotency-Key', 'X-Request-Id'], maxAge: 600 }));
  app.use(express.json({ limit: '2mb' }));
  app.use((req, res, next) => {
    const id = (req.headers['x-request-id'] as string) || randomUUID();
    req.headers['x-request-id'] = id;
    res.setHeader('X-Request-Id', id);
    next();
  });
  if (cfg.NODE_ENV !== 'test') app.use(pinoHttp({ logger: log, redact: ['req.headers.authorization', 'req.body.password', 'req.body.paymentToken'] }));

  const limiter = (windowMs: number, limit: number) =>
    rateLimit({ windowMs, limit, standardHeaders: 'draft-7', legacyHeaders: false, skip: () => cfg.NODE_ENV === 'test', handler: (_req, res) => res.status(429).json({ error: { code: 'RATE_LIMITED', message: 'Too many requests. Wait a minute and try again.' } }) });
  const limits = { auth: limiter(60_000, 10), write: limiter(60_000, 60), default: limiter(60_000, 600) };

  app.get('/health', (_req, res) => res.json({ status: 'ok' }));
  app.get('/ready', async (_req, res) => {
    try {
      await pool?.query('SELECT 1');
      res.json({ status: 'ready' });
    } catch {
      res.status(503).json({ status: 'unavailable' });
    }
  });

  const spec = buildOpenApi('/api/v1');
  app.get('/api/v1/openapi.json', (_req, res) => res.json(spec));
  app.use('/api/v1/docs', swaggerUi.serve, swaggerUi.setup(spec, { customSiteTitle: 'RetailGeo API' }));

  app.use('/api/v1', (req: Request, res: Response, next: NextFunction) => {
    const m = matchRoute(req.method, req.path);
    const kind = m && m !== 'method_not_allowed' ? m.def.rateLimit ?? 'default' : 'default';
    limits[kind](req, res, next);
  });

  app.all('/api/v1/*', async (req, res) => {
    const out = await dispatch(deps, {
      method: req.method,
      path: req.path.replace(/^\/api\/v1/, ''),
      query: req.query as Record<string, unknown>,
      body: req.body,
      headers: Object.fromEntries(Object.entries(req.headers).map(([k, v]) => [k, Array.isArray(v) ? v[0] : v])),
      ip: req.ip ?? null,
    });
    if (out.status >= 500) log.error({ requestId: req.headers['x-request-id'], body: out.body }, 'request failed');
    res.setHeader('Cache-Control', 'no-store');
    res.status(out.status).json(out.body);
  });

  app.use((_req, res) => res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Not found.' } }));
  return app;
}
