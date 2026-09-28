import { useEffect, useState, type ReactNode } from 'react';
import { Link, NavLink, Navigate, Outlet, useLocation, useNavigate } from 'react-router-dom';
import type { Permission, RoleKey } from '@retailgeo/core';
import { permissionsFor } from '@retailgeo/core';
import { api } from '../api';
import { useMerchant, useSession } from '../state/store';
import { useApi } from '../lib/hooks';
import { Icon, type IconName } from '../ui/icons';
import { Logo, LoadingBlock, Empty } from '../ui/kit';
import { DemoBar } from './DemoBar';

export interface NavItem {
  to: string;
  label: string;
  icon: IconName;
  count?: number;
  end?: boolean;
  permission?: Permission;
}

/** Route guard for UX only — every API route enforces the same permission server-side. */
export function RequireRoles({ roles, children }: { roles: RoleKey[]; children: ReactNode }) {
  const user = useSession((s) => s.user);
  const loc = useLocation();
  if (!user) return <Navigate to={`/login?next=${encodeURIComponent(loc.pathname)}`} replace />;
  if (!user.roles.some((r) => roles.includes(r))) {
    return (
      <div className="auth-shell">
        <div className="card pad auth-card">
          <Empty icon="shield" title="You don't have access to this area" action={<Link className="btn" to="/">Go to the marketplace</Link>}>
            Signed in as {user.email}. Ask an administrator for access, or switch accounts.
          </Empty>
        </div>
      </div>
    );
  }
  return <>{children}</>;
}

export function usePermissions() {
  const user = useSession((s) => s.user);
  return permissionsFor(user?.roles ?? []);
}

export function ConsoleLayout({ nav, title, top }: { nav: (NavItem | string)[]; title: string; top?: ReactNode }) {
  const [open, setOpen] = useState(false);
  const user = useSession((s) => s.user)!;
  const navTo = useNavigate();
  const loc = useLocation();
  const perms = usePermissions();
  const { data: notes } = useApi<any>('/notifications', { pageSize: 1 });
  useEffect(() => setOpen(false), [loc.pathname]);
  return (
    <>
      <a href="#main" className="skip">Skip to content</a>
      <DemoBar />
      <div className="console">
        {open && <div className="scrim" onClick={() => setOpen(false)} />}
        <aside className={`sidenav ${open ? 'open' : ''}`} aria-label={`${title} navigation`}>
          <Link to="/" style={{ textDecoration: 'none' }}><Logo sub={title} /></Link>
          {nav.map((n, i) =>
            typeof n === 'string' ? (
              <span key={i} className="eyebrow sect">{n}</span>
            ) : n.permission && !perms.has(n.permission) ? null : (
              <NavLink key={n.to} to={n.to} end={n.end} className={({ isActive }) => `nav ${isActive ? 'active' : ''}`}>
                <Icon name={n.icon} className="icon sm" />
                {n.label}
                {n.count ? <span className="cnt">{n.count}</span> : null}
              </NavLink>
            ),
          )}
          <span style={{ flex: 1 }} />
          <Link to="/" className="nav" style={{ display: 'flex', gap: 10, padding: '8px 10px', color: 'var(--ink-2)', textDecoration: 'none', fontWeight: 600, fontSize: '0.9rem' }}>
            <Icon name="external" className="icon sm" /> Consumer marketplace
          </Link>
        </aside>
        <div className="console-main">
          <div className="console-top">
            <button className="icon-btn menu-btn" onClick={() => setOpen(true)} aria-label="Open navigation"><Icon name="menu" /></button>
            {top}
            <span style={{ flex: 1 }} />
            <Link to={title === 'Merchant portal' ? '/merchant/notifications' : '/admin/notifications'} className="icon-btn" aria-label={`Notifications${notes?.unread ? `, ${notes.unread} unread` : ''}`}>
              <Icon name="bell" />
              {notes?.unread ? <span className="count-dot">{notes.unread}</span> : null}
            </Link>
            <div className="row tight nowrap hide-sm" style={{ lineHeight: 1.2 }}>
              <div style={{ textAlign: 'right' }}>
                <div className="small" style={{ fontWeight: 700 }}>{user.fullName}</div>
                <div className="xsmall faint">{user.roles.filter((r) => r !== 'consumer').map((r) => r.replace('_', ' ')).join(', ')}</div>
              </div>
            </div>
            <button className="icon-btn" aria-label="Sign out" title="Sign out" onClick={async () => { await api.post('/auth/logout').catch(() => undefined); api.setSession(null); navTo('/login'); }}>
              <Icon name="logout" />
            </button>
          </div>
          <main id="main" className="console-body" tabIndex={-1} style={{ outline: 'none' }}>
            <Outlet />
          </main>
        </div>
      </div>
    </>
  );
}

/** Merchant store context: loads the stores this user can manage and keeps one active. */
export function useMerchantStores() {
  const { data, loading, error, reload } = useApi<any>('/merchant/me');
  const { storeId, setStoreId } = useMerchant();
  const stores: any[] = data?.stores ?? [];
  const active = stores.find((s) => s.id === storeId) ?? stores.find((s) => s.status === 'active') ?? stores[0] ?? null;
  useEffect(() => {
    if (active && active.id !== storeId) setStoreId(active.id);
  }, [active, storeId, setStoreId]);
  return { stores, store: active, loading, error, reload, businesses: data?.businesses ?? [] };
}

export function StoreSwitcher() {
  const { stores, store, loading } = useMerchantStores();
  const setStoreId = useMerchant((s) => s.setStoreId);
  if (loading && !store) return <div style={{ width: 200 }}><LoadingBlock rows={1} /></div>;
  if (!store) return null;
  return (
    <div className="row tight nowrap" style={{ minWidth: 0 }}>
      <label htmlFor="store-switch" className="sr-only">Active store</label>
      <select id="store-switch" className="select sm" style={{ maxWidth: 300, fontWeight: 700 }} value={store.id} onChange={(e) => setStoreId(e.target.value)}>
        {stores.map((s) => <option key={s.id} value={s.id}>{s.name}{s.status !== 'active' ? ` (${s.status})` : ''}</option>)}
      </select>
      <span className="badge hide-sm">{store.myRole === 'owner' ? 'Owner' : store.myRole === 'manager' ? 'Manager' : 'Employee'}</span>
    </div>
  );
}
