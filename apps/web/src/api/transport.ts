export interface TransportRequest {
  method: string;
  path: string;
  query?: Record<string, unknown>;
  body?: unknown;
  headers?: Record<string, string>;
}
export interface TransportResponse {
  status: number;
  body: any;
}
/** How the web client reaches the API: HTTP in production, in-browser dispatch in the demo build. */
export interface Transport {
  readonly kind: 'http' | 'demo';
  request(req: TransportRequest): Promise<TransportResponse>;
}

export class HttpTransport implements Transport {
  readonly kind = 'http' as const;
  constructor(private baseUrl: string) {}
  async request(req: TransportRequest): Promise<TransportResponse> {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(req.query ?? {})) if (v !== undefined && v !== null && v !== '') qs.set(k, String(v));
    const url = `${this.baseUrl}${req.path}${qs.toString() ? `?${qs}` : ''}`;
    try {
      const res = await fetch(url, {
        method: req.method,
        headers: { ...(req.body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...req.headers },
        body: req.body !== undefined ? JSON.stringify(req.body) : undefined,
      });
      const text = await res.text();
      return { status: res.status, body: text ? JSON.parse(text) : null };
    } catch {
      return { status: 0, body: { error: { code: 'NETWORK', message: 'Cannot reach RetailGeo. Check your connection and try again.' } } };
    }
  }
}
