import {
  MemoryDataStore, InProcessEventBus, JwtService, Pbkdf2Hasher, MockPaymentProvider, GazetteerGeocoder, OutboxChannel,
  registerEventHandlers, generateSeed, DEMO_PASSWORD, dispatch, type Deps, type MemorySnapshot, type OutboundMessage,
} from '@retailgeo/core';
import type { Transport, TransportRequest, TransportResponse } from './transport';

const KEY = 'retailgeo.demo.v3';
const ITERATIONS = 60_000;

function load(): MemorySnapshot | null {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

/**
 * Runs the real @retailgeo/core route table and services in the browser against an in-memory
 * data store. Nothing here re-implements business rules — it is a transport, exactly like Express.
 */
export class DemoTransport implements Transport {
  readonly kind = 'demo' as const;
  private deps!: Deps;
  private ready: Promise<void>;
  private saveTimer: ReturnType<typeof setTimeout> | null = null;
  readonly outbox: OutboxChannel;
  private listeners = new Set<(m: OutboundMessage) => void>();

  constructor() {
    this.outbox = new OutboxChannel('email', (m) => this.listeners.forEach((l) => l(m)));
    this.ready = this.boot();
  }

  onEmail(fn: (m: OutboundMessage) => void) {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  }

  private async boot() {
    const hasher = new Pbkdf2Hasher(ITERATIONS);
    let snap = load();
    if (!snap) snap = generateSeed({ passwordHash: await hasher.hash(DEMO_PASSWORD) });
    const db = new MemoryDataStore(snap, () => this.scheduleSave());
    this.deps = {
      db,
      events: new InProcessEventBus((e) => console.warn('[demo] event handler failed', e)),
      hasher,
      jwt: new JwtService('demo-only-signing-key-not-a-secret-000', 3600),
      payments: new MockPaymentProvider(),
      geocoder: new GazetteerGeocoder(),
      email: this.outbox,
      config: { env: 'demo', refreshTtlDays: 30, maxFailedLogins: 5, lockMinutes: 15, adminMfa: true, publicWebUrl: location.origin + location.pathname },
    };
    registerEventHandlers(this.deps);
  }

  private scheduleSave() {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => {
      try {
        localStorage.setItem(KEY, JSON.stringify((this.deps.db as MemoryDataStore).snapshot()));
      } catch {
        /* storage full or blocked — demo keeps working in memory */
      }
    }, 600);
  }

  async request(req: TransportRequest): Promise<TransportResponse> {
    await this.ready;
    const headers: Record<string, string> = {};
    for (const [k, v] of Object.entries(req.headers ?? {})) headers[k.toLowerCase()] = v;
    headers['user-agent'] = navigator.userAgent;
    const query: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(req.query ?? {})) if (v !== undefined && v !== null && v !== '') query[k] = String(v);
    const res = await dispatch(this.deps, { method: req.method, path: req.path, query, body: req.body === undefined ? undefined : JSON.parse(JSON.stringify(req.body)), headers, ip: '127.0.0.1' });
    // Round-trip through JSON so the UI sees exactly what an HTTP client would.
    return { status: res.status, body: JSON.parse(JSON.stringify(res.body ?? null)) };
  }

  static reset() {
    try {
      localStorage.removeItem(KEY);
      localStorage.removeItem('retailgeo.session');
    } catch {
      /* ignore */
    }
  }
}
