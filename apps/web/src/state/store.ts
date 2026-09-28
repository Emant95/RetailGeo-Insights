import { create } from 'zustand';
import { DEFAULT_LOCATION, type PublicUser } from '@retailgeo/core';
import { api } from '../api';

// ─── Session ────────────────────────────────────────────────────────────
interface SessionState {
  user: PublicUser | null;
  setUser: (u: PublicUser | null) => void;
}
export const useSession = create<SessionState>((set) => ({
  user: api.current?.user ?? null,
  setUser: (user) => set({ user }),
}));
api.subscribe((s) => useSession.getState().setUser(s?.user ?? null));

// ─── Search location (privacy: kept separate from saved addresses; stays in this browser) ──
export interface SearchLocation {
  lat: number;
  lng: number;
  label: string;
  source: 'default' | 'device' | 'search' | 'saved';
}
interface LocationState {
  location: SearchLocation;
  radius: number;
  setLocation: (l: SearchLocation) => void;
  setRadius: (r: number) => void;
}
const LOC_KEY = 'retailgeo.location';
const initialLoc = (): { location: SearchLocation; radius: number } => {
  try {
    const raw = sessionStorage.getItem(LOC_KEY);
    if (raw) return JSON.parse(raw);
  } catch {
    /* ignore */
  }
  return { location: { lat: 32.8252, lng: -96.7475, label: 'Lakewood, Dallas, TX 75214', source: 'default' }, radius: 10 };
};
export const useLocation = create<LocationState>((set, get) => ({
  ...initialLoc(),
  setLocation: (location) => {
    set({ location });
    persist({ location, radius: get().radius });
  },
  setRadius: (radius) => {
    set({ radius });
    persist({ location: get().location, radius });
  },
}));
function persist(v: unknown) {
  try {
    sessionStorage.setItem(LOC_KEY, JSON.stringify(v));
  } catch {
    /* ignore */
  }
}
export const FALLBACK_LOCATION = DEFAULT_LOCATION;

// ─── Cart badge ─────────────────────────────────────────────────────────
interface CartState {
  count: number;
  setCount: (n: number) => void;
  refresh: () => Promise<void>;
}
export const useCart = create<CartState>((set) => ({
  count: 0,
  setCount: (count) => set({ count }),
  refresh: async () => {
    if (!api.current) return set({ count: 0 });
    try {
      const c = await api.get('/cart');
      set({ count: c.itemCount });
    } catch {
      set({ count: 0 });
    }
  },
}));

// ─── Merchant: active store ─────────────────────────────────────────────
interface MerchantState {
  storeId: string | null;
  setStoreId: (id: string) => void;
}
export const useMerchant = create<MerchantState>((set) => ({
  storeId: (() => {
    try {
      return localStorage.getItem('retailgeo.merchant.store');
    } catch {
      return null;
    }
  })(),
  setStoreId: (storeId) => {
    try {
      localStorage.setItem('retailgeo.merchant.store', storeId);
    } catch {
      /* ignore */
    }
    set({ storeId });
  },
}));

// ─── Toasts ─────────────────────────────────────────────────────────────
export interface Toast {
  id: number;
  tone: 'ok' | 'bad' | 'info';
  title: string;
  body?: string;
}
interface ToastState {
  toasts: Toast[];
  push: (t: Omit<Toast, 'id'>) => void;
  dismiss: (id: number) => void;
}
let tid = 0;
export const useToasts = create<ToastState>((set) => ({
  toasts: [],
  push: (t) => {
    const id = ++tid;
    set((s) => ({ toasts: [...s.toasts.slice(-3), { ...t, id }] }));
    setTimeout(() => set((s) => ({ toasts: s.toasts.filter((x) => x.id !== id) })), t.tone === 'bad' ? 7000 : 4500);
  },
  dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((x) => x.id !== id) })),
}));
export const toast = (t: Omit<Toast, 'id'>) => useToasts.getState().push(t);
