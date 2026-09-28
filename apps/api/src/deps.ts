import pg from 'pg';
import {
  InProcessEventBus, JwtService, Pbkdf2Hasher, MockPaymentProvider, StripePaymentProvider, GazetteerGeocoder,
  MapboxGeocoder, OutboxChannel, registerEventHandlers, type Deps,
} from '@retailgeo/core';
import { PgDataStore } from './pg-store';
import type { Config } from './config';
import type { Logger } from 'pino';

export function buildDeps(cfg: Config, log: Logger, pool = new pg.Pool({ connectionString: cfg.DATABASE_URL, max: 20 })) {
  const events = new InProcessEventBus((e, name) => log.error({ err: e, event: name }, 'event handler failed'));
  // Email channel: swap OutboxChannel for an SES adapter in production (see docs/architecture.md).
  const email = new OutboxChannel('email', (m) => log.info({ to: m.to, kind: m.kind }, 'email queued'));
  const deps: Deps = {
    db: new PgDataStore(pool),
    events,
    hasher: new Pbkdf2Hasher(cfg.PASSWORD_ITERATIONS),
    jwt: new JwtService(cfg.JWT_SECRET, cfg.ACCESS_TOKEN_TTL_SEC),
    payments: cfg.PAYMENT_PROVIDER === 'stripe' ? new StripePaymentProvider(cfg.STRIPE_SECRET_KEY!) : new MockPaymentProvider(),
    geocoder: cfg.GEOCODER === 'mapbox' && cfg.MAPBOX_TOKEN ? new MapboxGeocoder(cfg.MAPBOX_TOKEN) : new GazetteerGeocoder(),
    email,
    config: {
      env: cfg.NODE_ENV,
      refreshTtlDays: cfg.REFRESH_TOKEN_TTL_DAYS,
      maxFailedLogins: 5,
      lockMinutes: 15,
      adminMfa: cfg.ADMIN_MFA === 'true',
      publicWebUrl: cfg.PUBLIC_WEB_URL,
    },
  };
  registerEventHandlers(deps);
  return { deps, pool, email };
}
