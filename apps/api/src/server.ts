import pino from 'pino';
import { loadConfig } from './config';
import { buildDeps } from './deps';
import { createApp } from './app';

const cfg = loadConfig();
const log = pino({ level: cfg.LOG_LEVEL, redact: ['password', 'passwordHash', 'paymentToken'] });
const { deps, pool } = buildDeps(cfg, log);
const app = createApp(deps, cfg, log, pool);
const server = app.listen(cfg.PORT, () => log.info(`RetailGeo API listening on :${cfg.PORT} (docs at /api/v1/docs)`));

const shutdown = (sig: string) => {
  log.info({ sig }, 'shutting down');
  server.close(() => pool.end().then(() => process.exit(0)));
  setTimeout(() => process.exit(1), 10_000).unref();
};
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
