import { useCallback, useEffect, useRef, useState } from 'react';
import { api, ApiError } from '../api';
import { toast } from '../state/store';

/** Fetch an API resource; re-runs when `key` changes. */
export function useApi<T = any>(path: string | null, query?: Record<string, unknown>) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [loading, setLoading] = useState(!!path);
  const key = path ? `${path}?${JSON.stringify(query ?? {})}` : null;
  const seq = useRef(0);
  const load = useCallback(async () => {
    if (!path) return;
    const n = ++seq.current;
    setLoading(true);
    try {
      const d = await api.get<T>(path, query);
      if (n === seq.current) {
        setData(d);
        setError(null);
      }
    } catch (e) {
      if (n === seq.current) setError(e as ApiError);
    } finally {
      if (n === seq.current) setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  useEffect(() => {
    void load();
  }, [load]);
  return { data, error, loading, reload: load, setData };
}

/** Wrap a mutation with busy state, success toast and error capture. */
export function useAction<A extends unknown[], R>(fn: (...args: A) => Promise<R>, opts: { success?: string | ((r: R) => string); onDone?: (r: R) => void } = {}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const run = async (...args: A): Promise<R | undefined> => {
    setBusy(true);
    setError(null);
    try {
      const r = await fn(...args);
      if (opts.success) toast({ tone: 'ok', title: typeof opts.success === 'function' ? opts.success(r) : opts.success });
      opts.onDone?.(r);
      return r;
    } catch (e) {
      const err = e instanceof ApiError ? e : new ApiError(0, 'ERROR', (e as Error).message);
      setError(err);
      if (!Object.keys(err.fields).length) toast({ tone: 'bad', title: err.message });
      return undefined;
    } finally {
      setBusy(false);
    }
  };
  return { run, busy, error, setError };
}

export function useDebounced<T>(value: T, ms = 250) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

export function track(name: string, storeId?: string, props: Record<string, string | number | boolean | null> = {}) {
  void api.post('/analytics/events', { name, storeId, props }).catch(() => undefined);
}
