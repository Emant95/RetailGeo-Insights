import type { PublicUser } from '@retailgeo/core';
import type { Transport } from './transport';

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string, public details?: any) {
    super(message);
  }
  /** Field-level messages keyed by dotted path ("store.zip"). */
  get fields(): Record<string, string> {
    const out: Record<string, string> = {};
    if (Array.isArray(this.details)) for (const d of this.details) if (d.field && !out[d.field]) out[d.field] = d.message;
    if (this.details?.field) out[this.details.field] = this.message;
    return out;
  }
}

export interface Session {
  accessToken: string;
  refreshToken: string;
  user: PublicUser;
}

type Listener = (s: Session | null) => void;
const SESSION_KEY = 'retailgeo.session';

/**
 * Thin API client: bearer auth, transparent refresh-token rotation on 401, typed errors,
 * and Idempotency-Key generation for retry-safe mutations.
 */
export class ApiClient {
  private session: Session | null = null;
  private listeners = new Set<Listener>();
  private refreshing: Promise<boolean> | null = null;

  constructor(public transport: Transport) {
    try {
      const raw = localStorage.getItem(SESSION_KEY);
      if (raw) this.session = JSON.parse(raw);
    } catch {
      /* ignore */
    }
  }

  get current() {
    return this.session;
  }

  subscribe(fn: Listener) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  setSession(s: Session | null) {
    this.session = s;
    try {
      if (s) localStorage.setItem(SESSION_KEY, JSON.stringify(s));
      else localStorage.removeItem(SESSION_KEY);
    } catch {
      /* ignore */
    }
    this.listeners.forEach((l) => l(s));
  }

  private async tryRefresh(): Promise<boolean> {
    if (!this.session) return false;
    this.refreshing ??= (async () => {
      const r = await this.transport.request({ method: 'POST', path: '/auth/refresh', body: { refreshToken: this.session!.refreshToken } });
      this.refreshing = null;
      if (r.status === 200) {
        this.setSession(r.body);
        return true;
      }
      this.setSession(null);
      return false;
    })();
    return this.refreshing;
  }

  async request<T = any>(method: string, path: string, opts: { query?: Record<string, unknown>; body?: unknown; idempotent?: boolean; auth?: boolean } = {}): Promise<T> {
    const headers: Record<string, string> = {};
    if (opts.idempotent) headers['Idempotency-Key'] = crypto.randomUUID();
    const send = () => {
      if (this.session && opts.auth !== false) headers.Authorization = `Bearer ${this.session.accessToken}`;
      return this.transport.request({ method, path, query: opts.query, body: opts.body, headers });
    };
    let res = await send();
    if (res.status === 401 && this.session && path !== '/auth/refresh' && (await this.tryRefresh())) res = await send();
    if (res.status >= 400 || res.status === 0) {
      const e = res.body?.error ?? {};
      throw new ApiError(res.status, e.code ?? 'ERROR', e.message ?? 'Something went wrong.', e.details);
    }
    return res.body as T;
  }

  get<T = any>(path: string, query?: Record<string, unknown>) {
    return this.request<T>('GET', path, { query });
  }
  post<T = any>(path: string, body?: unknown, opts: { idempotent?: boolean } = {}) {
    return this.request<T>('POST', path, { body: body ?? {}, ...opts });
  }
  patch<T = any>(path: string, body: unknown) {
    return this.request<T>('PATCH', path, { body });
  }
  put<T = any>(path: string, body: unknown) {
    return this.request<T>('PUT', path, { body });
  }
  del<T = any>(path: string) {
    return this.request<T>('DELETE', path);
  }
}
