import { z } from 'zod';

/** Twelve-factor configuration. Secrets come from the environment (AWS Secrets Manager in production). */
const Env = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().default(4000),
  DATABASE_URL: z.string().default('postgres://retailgeo:retailgeo@localhost:5432/retailgeo'),
  JWT_SECRET: z.string().min(32).default('dev-only-secret-change-me-dev-only-secret'),
  ACCESS_TOKEN_TTL_SEC: z.coerce.number().default(900),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().default(30),
  PASSWORD_ITERATIONS: z.coerce.number().default(600_000),
  CORS_ORIGINS: z.string().default('http://localhost:5173'),
  PUBLIC_WEB_URL: z.string().default('http://localhost:5173'),
  PAYMENT_PROVIDER: z.enum(['mock', 'stripe']).default('mock'),
  STRIPE_SECRET_KEY: z.string().optional(),
  GEOCODER: z.enum(['gazetteer', 'mapbox']).default('gazetteer'),
  MAPBOX_TOKEN: z.string().optional(),
  ADMIN_MFA: z.enum(['true', 'false']).default('true'),
  TRUST_PROXY: z.coerce.number().default(1),
  LOG_LEVEL: z.string().default('info'),
});

export type Config = z.infer<typeof Env>;

export function loadConfig(env = process.env): Config {
  const cfg = Env.parse(env);
  if (cfg.NODE_ENV === 'production') {
    if (cfg.JWT_SECRET.startsWith('dev-only')) throw new Error('JWT_SECRET must be set in production');
    if (cfg.PAYMENT_PROVIDER === 'stripe' && !cfg.STRIPE_SECRET_KEY) throw new Error('STRIPE_SECRET_KEY is required');
  }
  return cfg;
}
