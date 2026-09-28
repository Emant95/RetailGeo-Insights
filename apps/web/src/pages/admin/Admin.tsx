import { Fragment, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { SETTING_KEYS, STORE_TYPES } from '@retailgeo/core';
import { api } from '../../api';
import { toast } from '../../state/store';
import { useAction, useApi, useDebounced } from '../../lib/hooks';
import { dateTime, label, num, title, when } from '../../lib/format';
import { ConsoleLayout, usePermissions, type NavItem } from '../../layouts/ConsoleLayout';
import { MapView } from '../../map/MapView';
import { AreaChart, Funnel, RankBars } from '../../ui/charts';
import { Icon } from '../../ui/icons';
import { Empty, ErrorNote, Kpi, LoadingBlock, Modal, Pager, SelectField, StatusBadge, TextArea, TextField, Timeline, storeTypeLabel, usd } from '../../ui/kit';
import { NotificationsPage } from '../consumer/Account';
import { PageHead } from '../merchant/Merchant';

export function AdminShell() {
  const { data } = useApi<any>('/admin/dashboard');
  const m = data?.metrics;
  const nav: (NavItem | string)[] = [
    { to: '/admin', label: 'Dashboard', icon: 'home', end: true },
    'Network',
    { to: '/admin/merchants', label: 'Merchants', icon: 'flag', count: m?.pendingStores, permission: 'admin.merchants' },
    { to: '/admin/stores', label: 'Stores', icon: 'store', permission: 'admin.stores' },
    { to: '/admin/markets', label: 'Markets', icon: 'map' },
    { to: '/admin/catalog', label: 'Catalog', icon: 'box', permission: 'admin.moderation' },
    'Operations',
    { to: '/admin/orders', label: 'Orders', icon: 'bag', permission: 'admin.orders' },
    { to: '/admin/support', label: 'Support & disputes', icon: 'mail', permission: 'admin.support' },
    { to: '/admin/reports', label: 'Reports', icon: 'chart', permission: 'admin.reports' },
    { to: '/admin/notifications', label: 'Notifications', icon: 'bell' },
    'Security',
    { to: '/admin/users', label: 'Users', icon: 'users', permission: 'admin.users' },
    { to: '/admin/roles', label: 'Roles & permissions', icon: 'shield' },
    { to: '/admin/audit', label: 'Audit log', icon: 'doc', permission: 'admin.audit' },
    { to: '/admin/settings', label: 'System settings', icon: 'gear', permission: 'admin.settings' },
  ];
  return <ConsoleLayout title="Admin console" nav={nav} top={<span className="badge info"><Icon name="shield" className="icon sm" style={{ width: 12, height: 12 }} /> Staff area · actions are audited</span>} />;
}

// ─── Dashboard ─────────────────────────────────────────────────────────
export function AdminDashboard() {
  const { data, error, reload } = useApi<any>('/admin/dashboard');
  if (error) return <ErrorNote error={error} onRetry={reload} />;
  if (!data) return <LoadingBlock rows={8} />;
  const m = data.metrics;
  return (
    <>
      <PageHead title="Platform overview" sub="RetailGeo Phase 1 beta · all markets" />
      {data.alerts.length > 0 && (
        <div className="card divider-list" aria-label="System alerts">
          {data.alerts.map((a: any, i: number) => (
            <Link key={i} to={a.link} className="srow" style={{ gridTemplateColumns: '24px 1fr auto' }}>
              <Icon name={a.level === 'critical' ? 'alert' : a.level === 'warning' ? 'alert' : 'info'} style={{ color: a.level === 'info' ? 'var(--info)' : a.level === 'warning' ? 'var(--warn)' : 'var(--bad)' }} />
              <span>{a.message}</span>
              <Icon name="chevron" className="icon sm" />
            </Link>
          ))}
        </div>
      )}
      <div className="kpis">
        <Kpi label="Total users" value={num(m.totalUsers)} sub={`${num(m.consumers)} shoppers`} to="/admin/users" />
        <Kpi label="Active stores" value={m.activeStores} sub={`${m.markets} active markets`} to="/admin/stores" />
        <Kpi label="Pending stores" value={m.pendingStores} to="/admin/merchants" tone={m.pendingStores ? 'attn' : undefined} />
        <Kpi label="Products" value={num(m.products)} sub={`${num(m.listings)} store listings`} to="/admin/catalog" />
        <Kpi label="Orders" value={num(m.orders)} sub={`${m.ordersToday} today`} to="/admin/orders" />
        <Kpi label="Store-to-store" value={m.b2bOrders} sub={`${m.b2bOpen} open · ${usd(m.b2bVolumeCents)} completed`} to="/admin/orders" />
        <Kpi label="GMV" value={usd(m.gmvCents)} sub={`${usd(m.gmv7dCents)} last 7 days`} to="/admin/reports" />
        <Kpi label="Active offers" value={m.activeOffers} />
        <Kpi label="Searches (7d)" value={num(m.searches7d)} sub={`${m.zeroResultSearches7d} with no results`} tone={m.zeroResultSearches7d ? 'attn' : undefined} to="/admin/reports" />
        <Kpi label="Search → order" value={`${m.conversionPct}%`} sub="orders per search" />
      </div>
      <div className="grid cols-2" style={{ alignItems: 'start' }}>
        <div className="card"><div className="card-h"><h3>Gross merchandise value, 14 days</h3></div><div className="card-b"><AreaChart label="Daily GMV" data={data.trend.map((d: any) => ({ day: d.day, value: d.gmvCents }))} format={(v) => (v >= 100000 ? `$${(v / 100000).toFixed(1)}k` : `$${Math.round(v / 100)}`)} /></div></div>
        <div className="card">
          <div className="card-h"><h3>Geographic coverage</h3><Link to="/admin/markets" className="small">Markets</Link></div>
          <div style={{ height: 300, padding: 8 }}>
            <MapView ariaLabel="Markets and store coverage" legend={false} markers={data.coverage.map((c: any) => ({ id: c.id, lat: c.latitude, lng: c.longitude, title: `${c.name}: ${c.activeStores} active stores`, label: `${c.activeStores}` }))} />
          </div>
        </div>
      </div>
      <div className="grid cols-3" style={{ alignItems: 'start' }}>
        <div className="card pad stack"><h3>Markets</h3>
          <table className="t"><thead><tr><th>Market</th><th className="r">Stores</th><th className="r">Orders</th></tr></thead>
            <tbody>{data.coverage.map((c: any) => <tr key={c.id}><td>{c.name}<div className="xsmall"><StatusBadge status={c.status} /></div></td><td className="r num">{c.activeStores}{c.pendingStores ? <span className="faint"> +{c.pendingStores}</span> : ''}</td><td className="r num">{c.orders}</td></tr>)}</tbody>
          </table>
        </div>
        <div className="card pad stack"><h3>Stores by type</h3><RankBars rows={Object.entries(data.storesByType).map(([k, v]) => ({ label: storeTypeLabel(k), value: v as number }))} /></div>
        <div className="card pad stack"><h3>Top searches</h3><RankBars rows={data.topSearches.map((s: any) => ({ label: s.query, value: s.count }))} /></div>
      </div>
    </>
  );
}

// ─── Merchants ─────────────────────────────────────────────────────────
export function Merchants() {
  const [status, setStatus] = useState('pending');
  const [q, setQ] = useState('');
  const dq = useDebounced(q);
  const [page, setPage] = useState(1);
  const [review, setReview] = useState<any>(null);
  const [suspend, setSuspend] = useState<any>(null);
  const perms = usePermissions();
  useEffect(() => setPage(1), [status, dq]);
  const { data, reload } = useApi<any>('/admin/merchants', { status: status || undefined, q: dq || undefined, page });
  return (
    <>
      <PageHead title="Merchants" sub="Review applications, verify store details, and suspend or reactivate businesses." />
      <div className="row between">
        <div className="tabs" role="tablist">{[['pending', 'Applications'], ['approved', 'Approved'], ['suspended', 'Suspended'], ['rejected', 'Rejected'], ['', 'All']].map(([k, l]) => <button key={k} role="tab" aria-selected={status === k} onClick={() => setStatus(k)}>{l}</button>)}</div>
        <input className="input sm" style={{ width: 240 }} placeholder="Search business or email" aria-label="Search businesses" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      {!data ? <LoadingBlock /> : data.items.length === 0 ? <div className="card"><Empty icon="flag" title="Nothing here" /></div> : (
        <div className="stack">
          {data.items.map((b: any) => (
            <div key={b.id} className="card">
              <div className="card-h">
                <div><strong>{b.dbaName ?? b.legalName}</strong> <StatusBadge status={b.status} /><div className="xsmall faint">{b.legalName} · EIN •••{b.einLast4 ?? '—'} · applied {when(b.createdAt)}</div></div>
                <div className="row tight">
                  {b.status === 'pending' && <button className="btn primary sm" onClick={() => setReview(b)}>Review</button>}
                  {b.status === 'approved' && perms.has('admin.stores') && <button className="btn sm danger" onClick={() => setSuspend(b)}>Suspend</button>}
                  {b.status === 'suspended' && perms.has('admin.stores') && <SuspendToggle biz={b} onDone={reload} />}
                </div>
              </div>
              <div className="card-b" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 260px), 1fr))', gap: 16 }}>
                <dl className="kv"><dt>Owner</dt><dd>{b.owner?.name}<div className="xsmall faint">{b.owner?.email}</div></dd><dt>Contact</dt><dd>{b.contactEmail}{b.contactPhone ? ` · ${b.contactPhone}` : ''}</dd>{b.reviewNotes && <><dt>Notes</dt><dd>{b.reviewNotes}</dd></>}</dl>
                <div className="stack tight">{b.stores.map((s: any) => <div key={s.id} className="small"><strong>{s.name}</strong> · {storeTypeLabel(s.storeType)} <StatusBadge status={s.status} /><div className="xsmall faint">{s.addressLine1}, {s.city}, {s.state} {s.zip}</div></div>)}</div>
              </div>
            </div>
          ))}
        </div>
      )}
      {data && <Pager page={data.page} totalPages={data.totalPages} total={data.total} onPage={setPage} noun="businesses" />}
      {review && <ReviewModal biz={review} onClose={() => setReview(null)} onDone={reload} />}
      {suspend && <ReasonModal title={`Suspend ${suspend.dbaName ?? suspend.legalName}?`} body="All of this business's stores are hidden from shoppers and can't take orders until reactivated." action="Suspend" onClose={() => setSuspend(null)} onSubmit={async (reason) => { await api.post(`/admin/merchants/${suspend.id}/status`, { status: 'suspended', reason }); await reload(); }} />}
    </>
  );
}

function SuspendToggle({ biz, onDone }: { biz: any; onDone: () => void }) {
  const go = useAction(async () => { await api.post(`/admin/merchants/${biz.id}/status`, { status: 'approved' }); onDone(); }, { success: 'Business reactivated' });
  return <button className="btn sm" onClick={() => go.run()}>Reactivate</button>;
}

function ReviewModal({ biz, onClose, onDone }: { biz: any; onClose: () => void; onDone: () => void }) {
  const [notes, setNotes] = useState('');
  const [checks, setChecks] = useState({ address: false, ein: false, contact: false });
  const go = useAction(async (decision: 'approve' | 'reject') => { await api.post(`/admin/merchants/${biz.id}/review`, { decision, notes: notes || undefined }); onDone(); onClose(); }, { success: 'Decision recorded' });
  const s = biz.stores[0];
  return (
    <Modal title={`Review ${biz.dbaName ?? biz.legalName}`} wide onClose={onClose} footer={<><button className="btn danger" disabled={go.busy} onClick={() => go.run('reject')}>Reject</button><button className="btn primary" disabled={go.busy || !Object.values(checks).every(Boolean)} onClick={() => go.run('approve')}>Approve and publish</button></>}>
      <div className="grid cols-2" style={{ alignItems: 'start' }}>
        <div className="stack">
          <dl className="kv"><dt>Legal name</dt><dd>{biz.legalName}</dd><dt>EIN (last 4)</dt><dd className="mono">{biz.einLast4 ?? 'Not provided'}</dd><dt>Owner</dt><dd>{biz.owner?.name} · {biz.owner?.email}</dd><dt>Store</dt><dd>{s?.name} ({storeTypeLabel(s?.storeType)})<br />{s?.addressLine1}, {s?.city}, {s?.state} {s?.zip}</dd></dl>
          <fieldset className="panel stack tight" style={{ border: 0 }}>
            <legend className="label">Verification checklist</legend>
            <label className="check"><input type="checkbox" checked={checks.address} onChange={(e) => setChecks({ ...checks, address: e.target.checked })} /> Address matches a real storefront (map / street view)</label>
            <label className="check"><input type="checkbox" checked={checks.ein} onChange={(e) => setChecks({ ...checks, ein: e.target.checked })} /> Business registration and EIN checked</label>
            <label className="check"><input type="checkbox" checked={checks.contact} onChange={(e) => setChecks({ ...checks, contact: e.target.checked })} /> Owner reached at the contact phone or email</label>
          </fieldset>
          <TextArea label="Notes to the merchant" hint="Required when rejecting" rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} error={go.error?.fields.notes} />
        </div>
        <div style={{ height: 300 }}>{s && <MapView ariaLabel="Store location" legend={false} center={{ lat: s.latitude, lng: s.longitude }} radiusMi={1} markers={[{ id: s.id, lat: s.latitude, lng: s.longitude, title: s.name, kind: s.storeType }]} />}</div>
      </div>
    </Modal>
  );
}

function ReasonModal({ title: t, body, action, onClose, onSubmit }: { title: string; body: string; action: string; onClose: () => void; onSubmit: (reason: string) => Promise<void> }) {
  const [reason, setReason] = useState('');
  const go = useAction(async () => { await onSubmit(reason); onClose(); }, { success: 'Done' });
  return (
    <Modal title={t} onClose={onClose} footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn danger solid" disabled={!reason.trim() || go.busy} onClick={() => go.run()}>{action}</button></>}>
      <div className="stack"><p>{body}</p><TextArea label="Reason (recorded in the audit log)" rows={3} value={reason} onChange={(e) => setReason(e.target.value)} /></div>
    </Modal>
  );
}

// ─── Stores ────────────────────────────────────────────────────────────
export function AdminStores() {
  const [status, setStatus] = useState('');
  const [q, setQ] = useState('');
  const dq = useDebounced(q);
  const [page, setPage] = useState(1);
  const [action, setAction] = useState<{ store: any; status: string } | null>(null);
  useEffect(() => setPage(1), [status, dq]);
  const { data, reload } = useApi<any>('/admin/stores', { status: status || undefined, q: dq || undefined, page });
  const verify = useAction(async (s: any) => { await api.post(`/admin/stores/${s.id}/status`, { status: 'verified' }); await reload(); }, { success: 'Store verified' });
  const reactivate = useAction(async (s: any) => { await api.post(`/admin/stores/${s.id}/status`, { status: 'active' }); await reload(); }, { success: 'Store reactivated' });
  return (
    <>
      <PageHead title="Stores" sub="Every physical location on the network, with data-quality signals." />
      <div className="row between">
        <div className="tabs" role="tablist">{[['', 'All'], ['active', 'Active'], ['pending', 'Pending'], ['suspended', 'Suspended'], ['closed', 'Closed']].map(([k, l]) => <button key={k} role="tab" aria-selected={status === k} onClick={() => setStatus(k)}>{l}</button>)}</div>
        <input className="input sm" style={{ width: 240 }} placeholder="Name, city or ZIP" aria-label="Search stores" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      {!data ? <LoadingBlock /> : (
        <div className="table-wrap">
          <table className="t">
            <thead><tr><th>Store</th><th>Market</th><th>Status</th><th className="r">Listings</th><th className="r">Stale</th><th className="r">Out</th><th className="r"><span className="sr-only">Actions</span></th></tr></thead>
            <tbody>
              {data.items.map((s: any) => (
                <tr key={s.id}>
                  <td><strong>{s.name}</strong>{s.verifiedAt && <Icon name="check" className="icon sm" style={{ color: 'var(--ok)', marginLeft: 4, verticalAlign: -3 }} aria-label="Verified" />}<div className="xsmall faint">{storeTypeLabel(s.storeType)} · {s.city}, {s.state} {s.zip} · {s.businessName}</div></td>
                  <td className="small">{s.marketName ?? <span style={{ color: 'var(--warn)' }}>Unassigned</span>}</td>
                  <td><StatusBadge status={s.status} /></td>
                  <td className="r num">{s.listingCount}</td>
                  <td className="r num" style={{ color: s.staleCount > 5 ? 'var(--warn)' : undefined }}>{s.staleCount}</td>
                  <td className="r num">{s.outOfStock}</td>
                  <td className="r">
                    <div className="row tight nowrap" style={{ justifyContent: 'flex-end' }}>
                      {!s.verifiedAt && s.status !== 'pending' && <button className="btn sm" onClick={() => verify.run(s)}>Verify</button>}
                      {s.status === 'active' && <button className="btn sm danger" onClick={() => setAction({ store: s, status: 'suspended' })}>Suspend</button>}
                      {s.status === 'suspended' && <button className="btn sm" onClick={() => reactivate.run(s)}>Reactivate</button>}
                      {s.status === 'active' && <Link to={`/store/${s.slug}`} className="btn sm ghost" aria-label={`View ${s.name}`}><Icon name="external" className="icon sm" /></Link>}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {data && <Pager page={data.page} totalPages={data.totalPages} total={data.total} onPage={setPage} noun="stores" />}
      {action && <ReasonModal title={`Suspend ${action.store.name}?`} body="The store is hidden from search and can't take new orders. Open orders stay visible to the merchant." action="Suspend store" onClose={() => setAction(null)} onSubmit={async (reason) => { await api.post(`/admin/stores/${action.store.id}/status`, { status: action.status, reason }); await reload(); }} />}
    </>
  );
}

// ─── Users & roles ─────────────────────────────────────────────────────
const ROLES = ['consumer', 'merchant_admin', 'store_employee', 'platform_admin', 'platform_support'];
export function Users() {
  const [q, setQ] = useState('');
  const dq = useDebounced(q);
  const [role, setRole] = useState('');
  const [page, setPage] = useState(1);
  const [edit, setEdit] = useState<any>(null);
  const perms = usePermissions();
  useEffect(() => setPage(1), [dq, role]);
  const { data, reload } = useApi<any>('/admin/users', { q: dq || undefined, role: role || undefined, page });
  return (
    <>
      <PageHead title="Users" sub="Accounts across shoppers, merchants and staff. Role changes require the roles permission and are audited." />
      <div className="filters">
        <input className="input sm" style={{ width: 260 }} placeholder="Name or email" aria-label="Search users" value={q} onChange={(e) => setQ(e.target.value)} />
        <select className="select sm" style={{ width: 'auto' }} aria-label="Role" value={role} onChange={(e) => setRole(e.target.value)}><option value="">All roles</option>{ROLES.map((r) => <option key={r} value={r}>{title(r)}</option>)}</select>
      </div>
      {!data ? <LoadingBlock /> : (
        <div className="table-wrap">
          <table className="t">
            <thead><tr><th>User</th><th>Roles</th><th>Status</th><th>Joined</th><th className="r"><span className="sr-only">Actions</span></th></tr></thead>
            <tbody>
              {data.items.map((u: any) => (
                <tr key={u.id}>
                  <td><strong>{u.fullName}</strong><div className="xsmall faint">{u.email}</div></td>
                  <td><div className="row tight">{u.roles.map((r: string) => <span key={r} className={`badge ${r.startsWith('platform') ? 'info' : r === 'consumer' ? '' : 'brand'}`}>{label(r)}</span>)}</div></td>
                  <td><StatusBadge status={u.status} />{u.mfaEnabled && <span className="badge ok" style={{ marginLeft: 4 }}>MFA</span>}</td>
                  <td className="small muted">{when(u.createdAt)}</td>
                  <td className="r">{perms.has('admin.roles') && <button className="btn sm" onClick={() => setEdit(u)}>Manage</button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {data && <Pager page={data.page} totalPages={data.totalPages} total={data.total} onPage={setPage} noun="users" />}
      {edit && <UserModal user={edit} onClose={() => setEdit(null)} onDone={reload} />}
    </>
  );
}
function UserModal({ user, onClose, onDone }: { user: any; onClose: () => void; onDone: () => void }) {
  const [roles, setRoles] = useState<string[]>(user.roles);
  const [status, setStatus] = useState(user.status === 'disabled' ? 'disabled' : 'active');
  const go = useAction(async () => { await api.patch(`/admin/users/${user.id}`, { roles, status }); onDone(); onClose(); }, { success: 'User updated' });
  return (
    <Modal title={user.fullName} onClose={onClose} footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" disabled={go.busy} onClick={() => go.run()}>Save</button></>}>
      <div className="stack">
        <SelectField label="Account status" value={status} onChange={(e) => setStatus(e.target.value)}><option value="active">Active</option><option value="disabled">Disabled (signs out everywhere)</option></SelectField>
        <fieldset className="stack tight" style={{ border: 0, padding: 0 }}>
          <legend className="label" style={{ marginBottom: 6 }}>Platform roles</legend>
          {ROLES.map((r) => <label key={r} className="check"><input type="checkbox" checked={roles.includes(r)} onChange={(e) => setRoles(e.target.checked ? [...roles, r] : roles.filter((x) => x !== r))} />{title(r)}</label>)}
        </fieldset>
        <p className="xsmall faint">Merchant roles are normally granted through onboarding and store staff invitations, which also scope them to a business.</p>
      </div>
    </Modal>
  );
}

export function Roles() {
  const { data } = useApi<any>('/admin/roles');
  if (!data) return <LoadingBlock />;
  const groups: Record<string, string[]> = {};
  for (const p of data.permissions as string[]) (groups[p.split('.')[0]] ??= []).push(p);
  return (
    <>
      <PageHead title="Roles & permissions" sub="Enforced by the API on every request. Operations & support can handle onboarding, orders and disputes, but not refunds, settings, roles or the audit log." />
      <div className="table-wrap">
        <table className="t matrix">
          <thead><tr><th>Permission</th>{data.roles.map((r: any) => <th key={r.key}>{r.label}</th>)}</tr></thead>
          <tbody>
            {Object.entries(groups).map(([g, ps]) => (
              <Fragment key={g}>
                <tr><td colSpan={data.roles.length + 1} className="eyebrow" style={{ background: 'var(--surface-2)' }}>{g}</td></tr>
                {ps.map((p) => <tr key={p}><td className="mono xsmall">{p}</td>{data.roles.map((r: any) => <td key={r.key}>{r.permissions.includes(p) ? <Icon name="check" className="icon sm" style={{ color: 'var(--ok)' }} aria-label="Allowed" /> : <span className="faint" aria-label="Not allowed">·</span>}</td>)}</tr>)}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

// ─── Catalog ───────────────────────────────────────────────────────────
export function Catalog() {
  const [tab, setTab] = useState<'queue' | 'all' | 'dups' | 'cats'>('queue');
  const perms = usePermissions();
  return (
    <>
      <PageHead title="Catalog" sub="The shared product catalog that every store's listings point to. Clean data here powers price comparison." />
      <div className="tabs" role="tablist">
        {[['queue', 'Moderation queue'], ['all', 'All products'], ['dups', 'Possible duplicates'], ...(perms.has('admin.catalog') ? [['cats', 'Categories']] : [])].map(([k, l]) => <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k as any)}>{l}</button>)}
      </div>
      {tab === 'queue' && <ProductList status="pending_review" />}
      {tab === 'all' && <ProductList />}
      {tab === 'dups' && <Duplicates />}
      {tab === 'cats' && <Categories />}
    </>
  );
}
function ProductList({ status }: { status?: string }) {
  const [q, setQ] = useState('');
  const dq = useDebounced(q);
  const [page, setPage] = useState(1);
  const { data, reload } = useApi<any>('/admin/products', { status, q: dq || undefined, page });
  const mod = useAction(async (id: string, s: string) => { await api.post(`/admin/products/${id}/moderate`, { status: s }); await reload(); }, { success: 'Product updated' });
  return (
    <div className="stack">
      <input className="input sm" style={{ width: 280 }} placeholder="Name, SKU or UPC" aria-label="Search products" value={q} onChange={(e) => setQ(e.target.value)} />
      {!data ? <LoadingBlock /> : data.items.length === 0 ? <div className="card"><Empty icon="check" title={status ? 'Queue is clear' : 'No products'} /></div> : (
        <div className="table-wrap">
          <table className="t">
            <thead><tr><th>Product</th><th>Category</th><th>SKU / UPC</th><th className="r">Stores</th><th>Status</th><th className="r"><span className="sr-only">Actions</span></th></tr></thead>
            <tbody>
              {data.items.map((p: any) => (
                <tr key={p.id}>
                  <td><strong>{p.name}</strong><div className="xsmall faint">{[p.brand, p.size].filter(Boolean).join(' · ')}</div></td>
                  <td className="small">{p.category}</td>
                  <td className="mono xsmall">{p.sku}<div className="faint">{p.upc ?? 'no UPC'}</div></td>
                  <td className="r num">{p.storeCount}</td>
                  <td><StatusBadge status={p.status} /></td>
                  <td className="r"><div className="row tight nowrap" style={{ justifyContent: 'flex-end' }}>
                    {p.status !== 'active' && <button className="btn sm" onClick={() => mod.run(p.id, 'active')}>Approve</button>}
                    {p.status === 'pending_review' && <button className="btn sm danger" onClick={() => mod.run(p.id, 'rejected')}>Reject</button>}
                    {p.status === 'active' && <button className="btn sm ghost" onClick={() => mod.run(p.id, 'archived')}>Archive</button>}
                  </div></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {data && <Pager page={data.page} totalPages={data.totalPages} total={data.total} onPage={setPage} noun="products" />}
    </div>
  );
}
function Duplicates() {
  const { data } = useApi<any[]>('/admin/products/duplicates');
  if (!data) return <LoadingBlock />;
  if (!data.length) return <div className="card"><Empty icon="check" title="No likely duplicates" /></div>;
  return (
    <div className="stack">
      {data.map((g, i) => (
        <div key={i} className="card">
          <div className="card-h"><strong>{g.reason}</strong><span className="small muted">{g.products.length} products</span></div>
          <table className="t"><tbody>{g.products.map((p: any) => <tr key={p.id}><td>{p.name}</td><td className="mono xsmall">{p.sku}</td><td className="mono xsmall">{p.upc ?? '—'}</td><td><StatusBadge status={p.status} /></td></tr>)}</tbody></table>
        </div>
      ))}
    </div>
  );
}
function Categories() {
  const { data, reload } = useApi<any[]>('/categories');
  const [edit, setEdit] = useState<any>(null);
  if (!data) return <LoadingBlock />;
  return (
    <div className="stack">
      <button className="btn primary" style={{ alignSelf: 'flex-start' }} onClick={() => setEdit({})}><Icon name="plus" className="icon sm" /> New category</button>
      <div className="grid cols-3">
        {data.map((c) => (
          <div key={c.id} className="card">
            <div className="card-h"><strong>{c.name}</strong><button className="btn sm ghost" onClick={() => setEdit(c)}>Edit</button></div>
            <div className="card-b row tight">{c.children.map((x: any) => <button key={x.id} className="chip" onClick={() => setEdit(x)}>{x.name}</button>)}</div>
          </div>
        ))}
      </div>
      {edit && <CategoryModal cat={edit} parents={data} onClose={() => setEdit(null)} onDone={reload} />}
    </div>
  );
}
function CategoryModal({ cat, parents, onClose, onDone }: { cat: any; parents: any[]; onClose: () => void; onDone: () => void }) {
  const [f, setF] = useState({ name: cat.name ?? '', parentId: cat.parentId ?? '', sort: cat.sort ?? 0 });
  const go = useAction(async () => {
    const body = { name: f.name, parentId: f.parentId || null, sort: Number(f.sort), icon: cat.icon ?? null };
    if (cat.id) await api.put(`/admin/categories/${cat.id}`, body);
    else await api.post('/admin/categories', body);
    onDone();
    onClose();
  }, { success: 'Category saved' });
  return (
    <Modal title={cat.id ? `Edit ${cat.name}` : 'New category'} onClose={onClose} footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" disabled={go.busy} onClick={() => go.run()}>Save</button></>}>
      <div className="stack">
        <TextField label="Name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} error={go.error?.fields.name} />
        <SelectField label="Parent" value={f.parentId} onChange={(e) => setF({ ...f, parentId: e.target.value })}><option value="">Top-level department</option>{parents.filter((p) => p.id !== cat.id).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</SelectField>
        <TextField label="Sort order" inputMode="numeric" value={String(f.sort)} onChange={(e) => setF({ ...f, sort: Number(e.target.value) || 0 })} />
      </div>
    </Modal>
  );
}

// ─── Markets ───────────────────────────────────────────────────────────
export function Markets() {
  const { data, reload } = useApi<any[]>('/admin/markets');
  const [sel, setSel] = useState<string | null>(null);
  const [edit, setEdit] = useState<any>(null);
  const perms = usePermissions();
  if (!data) return <LoadingBlock />;
  const m = data.find((x) => x.id === sel) ?? data[0];
  return (
    <>
      <PageHead title="Geographic markets" sub="Markets group stores for launch, reporting and geographic promotions. Stores are assigned by distance from the market center." actions={perms.has('admin.markets') && <button className="btn primary" onClick={() => setEdit({})}><Icon name="plus" className="icon sm" /> New market</button>} />
      <div className="tabs" role="tablist">{data.map((x) => <button key={x.id} role="tab" aria-selected={m?.id === x.id} onClick={() => setSel(x.id)}>{x.name} <span className="faint">({x.activeStores})</span></button>)}</div>
      {m && (
        <div className="split">
          <div className="stack">
            <div className="card pad row between">
              <div><h2 style={{ fontSize: '1.2rem' }}>{m.name}, {m.state}</h2><span className="small muted">{m.radiusMi} mi radius · {m.storeCount} stores · {m.activeStores} active</span></div>
              <div className="row tight"><StatusBadge status={m.status} />{perms.has('admin.markets') && <button className="btn sm" onClick={() => setEdit(m)}>Edit</button>}</div>
            </div>
            <div className="card pad stack tight"><h3>Cities</h3><RankBars rows={Object.entries(m.cities).map(([k, v]) => ({ label: k, value: v as number })).sort((a, b) => b.value - a.value)} /></div>
            <div className="card pad stack tight"><h3>ZIP coverage</h3><div className="row tight">{Object.entries(m.zips).sort().map(([z, n]) => <span key={z} className="badge"><span className="mono">{z}</span> · {n as number}</span>)}{Object.keys(m.zips).length === 0 && <span className="small muted">No stores yet.</span>}</div></div>
          </div>
          <div className="sticky-map">
            <MapView ariaLabel={`${m.name} market`} center={{ lat: m.latitude, lng: m.longitude }} radiusMi={m.radiusMi} markers={m.stores.map((s: any) => ({ id: s.id, lat: s.latitude, lng: s.longitude, title: `${s.name} (${s.status})`, kind: s.storeType, dim: s.status !== 'active' }))} />
          </div>
        </div>
      )}
      {edit && <MarketModal market={edit} onClose={() => setEdit(null)} onDone={reload} />}
    </>
  );
}
function MarketModal({ market, onClose, onDone }: { market: any; onClose: () => void; onDone: () => void }) {
  const [f, setF] = useState({ name: market.name ?? '', state: market.state ?? 'TX', latitude: String(market.latitude ?? ''), longitude: String(market.longitude ?? ''), radiusMi: String(market.radiusMi ?? 25), status: market.status ?? 'planned' });
  const go = useAction(async () => {
    const body = { ...f, latitude: Number(f.latitude), longitude: Number(f.longitude), radiusMi: Number(f.radiusMi) };
    if (market.id) await api.put(`/admin/markets/${market.id}`, body);
    else await api.post('/admin/markets', body);
    onDone();
    onClose();
  }, { success: 'Market saved' });
  const e = go.error?.fields ?? {};
  return (
    <Modal title={market.id ? `Edit ${market.name}` : 'New market'} onClose={onClose} footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" disabled={go.busy} onClick={() => go.run()}>Save</button></>}>
      <div className="form-grid">
        <TextField label="Name" value={f.name} onChange={(x) => setF({ ...f, name: x.target.value })} error={e.name} />
        <TextField label="State" value={f.state} onChange={(x) => setF({ ...f, state: x.target.value.toUpperCase().slice(0, 2) })} error={e.state} />
        <TextField label="Center latitude" inputMode="decimal" value={f.latitude} onChange={(x) => setF({ ...f, latitude: x.target.value })} error={e.latitude} />
        <TextField label="Center longitude" inputMode="decimal" value={f.longitude} onChange={(x) => setF({ ...f, longitude: x.target.value })} error={e.longitude} />
        <TextField label="Radius (mi)" inputMode="numeric" value={f.radiusMi} onChange={(x) => setF({ ...f, radiusMi: x.target.value })} />
        <SelectField label="Status" value={f.status} onChange={(x) => setF({ ...f, status: x.target.value })}><option value="planned">Planned</option><option value="active">Active</option><option value="paused">Paused</option></SelectField>
      </div>
      {go.error && !Object.keys(e).length && <div className="alert bad" style={{ marginTop: 12 }}>{go.error.message}</div>}
    </Modal>
  );
}

// ─── Orders ────────────────────────────────────────────────────────────
export function AdminOrders() {
  const [kind, setKind] = useState<'consumer' | 'b2b'>('consumer');
  const [status, setStatus] = useState('');
  const [q, setQ] = useState('');
  const dq = useDebounced(q);
  const [page, setPage] = useState(1);
  useEffect(() => setPage(1), [kind, status, dq]);
  const { data } = useApi<any>(kind === 'consumer' ? '/admin/orders' : '/admin/store-orders', { status: status || undefined, q: dq || undefined, page });
  return (
    <>
      <PageHead title="Orders" sub="Consumer orders and store-to-store orders are separate workflows with separate records." />
      <div className="row between">
        <div className="tabs" role="tablist"><button role="tab" aria-selected={kind === 'consumer'} onClick={() => { setKind('consumer'); setStatus(''); }}>Consumer orders</button><button role="tab" aria-selected={kind === 'b2b'} onClick={() => { setKind('b2b'); setStatus(''); }}>Store-to-store</button></div>
        <div className="filters">
          <select className="select sm" style={{ width: 'auto' }} aria-label="Status" value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">Any status</option>
            {(kind === 'consumer' ? ['confirmed', 'processing', 'ready', 'out_for_delivery', 'completed', 'cancelled', 'payment_failed'] : ['pending_acceptance', 'accepted', 'preparing', 'ready', 'completed', 'rejected', 'cancelled']).map((s) => <option key={s} value={s}>{title(s)}</option>)}
          </select>
          {kind === 'consumer' && <input className="input sm" style={{ width: 180 }} placeholder="Order number" aria-label="Order number" value={q} onChange={(e) => setQ(e.target.value)} />}
        </div>
      </div>
      {!data ? <LoadingBlock /> : (
        <div className="table-wrap">
          <table className="t">
            {kind === 'consumer' ? (
              <>
                <thead><tr><th>Order</th><th>Store</th><th>Customer</th><th>Status</th><th>Payment</th><th className="r">Total</th><th>Placed</th></tr></thead>
                <tbody>{data.items.map((o: any) => <tr key={o.id}><td><Link to={`/admin/orders/${o.id}`} className="rowlink mono">{o.number}</Link></td><td className="small">{o.storeName}</td><td className="small">{o.customerName}</td><td><StatusBadge status={o.status} /></td><td><StatusBadge status={o.paymentStatus} /></td><td className="r num">{usd(o.totalCents)}</td><td className="small muted">{when(o.createdAt)}</td></tr>)}</tbody>
              </>
            ) : (
              <>
                <thead><tr><th>Request</th><th>From (buyer)</th><th>To (supplier)</th><th>Status</th><th className="r">Value</th><th>Created</th></tr></thead>
                <tbody>{data.items.map((s: any) => <tr key={s.id}><td><Link to={`/admin/store-orders/${s.id}`} className="rowlink mono">{s.number}</Link></td><td className="small">{s.buyerName}</td><td className="small">{s.sellerName}</td><td><StatusBadge status={s.status} /></td><td className="r num">{usd(s.subtotalCents)}</td><td className="small muted">{when(s.createdAt)}</td></tr>)}</tbody>
              </>
            )}
          </table>
        </div>
      )}
      {data && <Pager page={data.page} totalPages={data.totalPages} total={data.total} onPage={setPage} noun="orders" />}
    </>
  );
}

export function AdminOrderDetail() {
  const { id } = useParams();
  const { data: o, error, reload, setData } = useApi<any>(`/admin/orders/${id}`);
  const perms = usePermissions();
  const [refund, setRefund] = useState(false);
  const [amount, setAmount] = useState('');
  const [override, setOverride] = useState('');
  const [reason, setReason] = useState('');
  const doRefund = useAction(async () => { setData(await api.post(`/admin/orders/${id}/refund`, { amountCents: amount ? Math.round(Number(amount) * 100) : undefined }, { idempotent: true })); setRefund(false); }, { success: 'Refund issued' });
  const doStatus = useAction(async () => { setData(await api.post(`/admin/orders/${id}/status`, { status: override, reason })); setOverride(''); setReason(''); }, { success: 'Status changed' });
  if (error) return <ErrorNote error={error} onRetry={reload} />;
  if (!o) return <LoadingBlock />;
  const refundable = o.payment && ['captured', 'partially_refunded'].includes(o.payment.status);
  return (
    <>
      <Link to="/admin/orders" className="small row tight"><Icon name="back" className="icon sm" /> Orders</Link>
      <PageHead title={`Order ${o.number}`} sub={`${o.store.name} · ${o.customer?.name} (${o.customer?.email}) · ${dateTime(o.createdAt)}`} actions={<><StatusBadge status={o.status} />{refundable && perms.has('admin.payments') && <button className="btn" onClick={() => setRefund(true)}>Refund…</button>}</>} />
      <div className="grid cols-2" style={{ alignItems: 'start' }}>
        <div className="card">
          <table className="t"><thead><tr><th>Item</th><th className="r">Qty</th><th className="r">Total</th></tr></thead><tbody>{o.items.map((i: any) => <tr key={i.id}><td>{i.productName}</td><td className="r num">{i.quantity}</td><td className="r num">{usd(i.totalCents)}</td></tr>)}</tbody></table>
          <div className="card-b" style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: '4px 16px', borderTop: '1px solid var(--line)' }}>
            <span className="muted">Subtotal</span><span className="num">{usd(o.subtotalCents)}</span><span className="muted">Discounts</span><span className="num">−{usd(o.discountCents)}</span><span className="muted">Tax</span><span className="num">{usd(o.taxCents)}</span><span className="muted">Fees</span><span className="num">{usd(o.feeCents)}</span><strong>Total</strong><strong className="num">{usd(o.totalCents)}</strong>
          </div>
        </div>
        <div className="stack">
          <div className="card pad stack tight">
            <h3>Payment reconciliation</h3>
            {o.payment ? <dl className="kv"><dt>Provider</dt><dd>{o.payment.provider}</dd><dt>Status</dt><dd><StatusBadge status={o.payment.status} /></dd><dt>Card</dt><dd>{o.payment.cardBrand} ····{o.payment.cardLast4}</dd><dt>Amount</dt><dd className="num">{usd(o.payment.amountCents)}</dd><dt>Refunded</dt><dd className="num">{usd(o.payment.refundedCents)}</dd></dl> : <p className="small muted">Pay at pickup. No card on file.</p>}
            {o.transactions.length > 0 && <table className="t"><thead><tr><th>Transaction</th><th className="r">Amount</th><th>Result</th><th>Reference</th></tr></thead><tbody>{o.transactions.map((t: any) => <tr key={t.id}><td className="small">{title(t.type)}<div className="xsmall faint">{dateTime(t.createdAt)}</div></td><td className="r num">{usd(t.amountCents)}</td><td>{t.success ? <span className="badge ok">OK</span> : <span className="badge bad">{t.message ?? 'Failed'}</span>}</td><td className="mono xsmall">{t.providerRef}</td></tr>)}</tbody></table>}
          </div>
          {perms.has('admin.disputes') && o.nextStatuses.length > 0 && (
            <div className="card pad stack tight">
              <h3>Resolve an exception</h3>
              <p className="small muted">Move this order on the store's behalf. Use for disputes and stuck orders; the store and shopper are notified.</p>
              <div className="form-grid">
                <SelectField label="New status" value={override} onChange={(e) => setOverride(e.target.value)}><option value="">Choose…</option>{o.nextStatuses.map((s: string) => <option key={s} value={s}>{title(s)}</option>)}</SelectField>
                <TextField label="Reason" value={reason} onChange={(e) => setReason(e.target.value)} />
              </div>
              <button className="btn" style={{ alignSelf: 'flex-start' }} disabled={!override || !reason.trim() || doStatus.busy} onClick={() => doStatus.run()}>Apply</button>
            </div>
          )}
          <div className="card pad stack tight"><h3>History</h3><Timeline items={o.history.map((h: any) => ({ title: title(h.toStatus), sub: h.note ?? undefined, at: dateTime(h.createdAt), state: ['cancelled', 'payment_failed'].includes(h.toStatus) ? 'bad' : 'done' }))} /></div>
          {o.tickets.length > 0 && <div className="card pad stack tight"><h3>Support tickets</h3>{o.tickets.map((t: any) => <div key={t.id} className="small"><StatusBadge status={t.status} /> {t.subject}</div>)}</div>}
        </div>
      </div>
      {refund && (
        <Modal title="Issue a refund" onClose={() => setRefund(false)} footer={<><button className="btn" onClick={() => setRefund(false)}>Cancel</button><button className="btn danger solid" disabled={doRefund.busy} onClick={() => doRefund.run()}>Refund {amount ? `$${amount}` : 'remaining balance'}</button></>}>
          <div className="stack"><p>Up to {usd(o.payment.amountCents - o.payment.refundedCents)} can be refunded to {o.payment.cardBrand} ····{o.payment.cardLast4}.</p><TextField label="Amount ($)" hint="Leave blank to refund the full remaining balance" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} /></div>
        </Modal>
      )}
    </>
  );
}

export function AdminStoreOrderDetail() {
  const { id } = useParams();
  const { data: so } = useApi<any>(`/admin/store-orders/${id}`);
  if (!so) return <LoadingBlock />;
  return (
    <>
      <Link to="/admin/orders" className="small row tight"><Icon name="back" className="icon sm" /> Orders</Link>
      <PageHead title={`Store-to-store ${so.number}`} sub={`${so.buyer.name} → ${so.seller.name}`} actions={<StatusBadge status={so.status} />} />
      <div className="grid cols-2" style={{ alignItems: 'start' }}>
        <div className="card"><table className="t"><thead><tr><th>Item</th><th className="r">Req.</th><th className="r">Acc.</th><th className="r">Handed</th><th className="r">Unit</th></tr></thead><tbody>{so.items.map((i: any) => <tr key={i.id}><td>{i.productName}</td><td className="r num">{i.requestedQty}</td><td className="r num">{i.acceptedQty ?? '—'}</td><td className="r num">{i.fulfilledQty ?? '—'}</td><td className="r num">{usd(i.unitPriceCents)}</td></tr>)}</tbody></table></div>
        <div className="card pad stack tight"><h3>History</h3><Timeline items={so.history.map((h: any) => ({ title: title(h.toStatus), sub: h.note ?? undefined, at: dateTime(h.createdAt), state: ['rejected', 'cancelled'].includes(h.toStatus) ? 'bad' : 'done' }))} /></div>
      </div>
    </>
  );
}

// ─── Support ───────────────────────────────────────────────────────────
export function Support() {
  const [status, setStatus] = useState('open');
  const { data, reload } = useApi<any>('/admin/support', { status: status || undefined, pageSize: 50 });
  const upd = useAction(async (id: string, s: string) => { await api.patch(`/admin/support/${id}`, { status: s }); await reload(); }, { success: 'Ticket updated' });
  return (
    <>
      <PageHead title="Support & disputes" />
      <div className="tabs" role="tablist">{[['open', 'Open'], ['in_progress', 'In progress'], ['resolved', 'Resolved'], ['', 'All']].map(([k, l]) => <button key={k} role="tab" aria-selected={status === k} onClick={() => setStatus(k)}>{l}</button>)}</div>
      {!data ? <LoadingBlock /> : data.items.length === 0 ? <div className="card"><Empty icon="mail" title="No tickets" /></div> : (
        <div className="stack">
          {data.items.map((t: any) => (
            <div key={t.id} className="card">
              <div className="card-h"><div><strong>{t.subject}</strong> <StatusBadge status={t.status} /><div className="xsmall faint">{t.email} · {title(t.category)} · {when(t.createdAt)}{t.orderId && <> · <Link to={`/admin/orders/${t.orderId}`}>related order</Link></>}</div></div>
                <select className="select sm" style={{ width: 'auto' }} aria-label="Ticket status" value={t.status} onChange={(e) => upd.run(t.id, e.target.value)}><option value="open">Open</option><option value="in_progress">In progress</option><option value="resolved">Resolved</option></select>
              </div>
              <div className="card-b small">{t.body}</div>
            </div>
          ))}
        </div>
      )}
    </>
  );
}

// ─── Audit, settings, reports, notifications ──────────────────────────
export function Audit() {
  const [q, setQ] = useState('');
  const dq = useDebounced(q);
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState<string | null>(null);
  useEffect(() => setPage(1), [dq]);
  const { data } = useApi<any>('/admin/audit-logs', { q: dq || undefined, page, pageSize: 40 });
  return (
    <>
      <PageHead title="Audit log" sub="Append-only record of sensitive actions: who, what, when, before and after values, and request context." />
      <input className="input sm" style={{ width: 300 }} placeholder="Action, email or record id" aria-label="Search audit log" value={q} onChange={(e) => setQ(e.target.value)} />
      {!data ? <LoadingBlock /> : (
        <div className="table-wrap">
          <table className="t">
            <thead><tr><th>When</th><th>Who</th><th>Action</th><th>Record</th><th>Context</th><th className="r"><span className="sr-only">Details</span></th></tr></thead>
            <tbody>
              {data.items.map((a: any) => (
                <Fragment key={a.id}>
                  <tr>
                    <td className="small">{dateTime(a.createdAt)}</td>
                    <td className="small">{a.actorEmail ?? 'system'}</td>
                    <td><span className="mono xsmall">{a.action}</span></td>
                    <td className="small">{a.entity}<div className="mono xsmall faint">{String(a.entityId ?? '').slice(0, 13)}</div></td>
                    <td className="mono xsmall faint">{a.ip ?? '—'}</td>
                    <td className="r"><button className="btn sm ghost" aria-expanded={open === a.id} onClick={() => setOpen(open === a.id ? null : a.id)}>{open === a.id ? 'Hide' : 'Diff'}</button></td>
                  </tr>
                  {open === a.id && <tr><td colSpan={6}><div className="grid cols-2"><div><span className="eyebrow">Before</span><pre className="code-block">{JSON.stringify(a.before, null, 2)}</pre></div><div><span className="eyebrow">After</span><pre className="code-block">{JSON.stringify(a.after, null, 2)}</pre></div></div></td></tr>}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {data && <Pager page={data.page} totalPages={data.totalPages} total={data.total} onPage={setPage} noun="entries" />}
    </>
  );
}

const SETTING_HELP: Record<string, string> = {
  'tax.rates': 'Combined sales-tax estimate by state (percent). Replace with a tax provider before general availability.',
  'search.default_radius_mi': 'Default search radius for new shoppers.',
  'inventory.stale_days': 'Days before a listing is flagged as possibly out of date.',
  'checkout.delivery_enabled': 'Master switch for store delivery at checkout.',
  'notifications.sms_enabled': 'Enable SMS once consent capture and a provider are in place.',
  'privacy.search_log_retention_days': 'How long search logs are kept.',
  'maintenance.banner': 'Message shown across the site. Leave empty for none.',
};
export function Settings() {
  const { data, reload } = useApi<any[]>('/admin/settings');
  const [draft, setDraft] = useState<Record<string, string>>({});
  const save = useAction(async (key: string) => {
    let value: unknown;
    try { value = JSON.parse(draft[key]); } catch { throw new Error('Enter valid JSON, e.g. 10, true, "text" or {"TX": 8.25}.'); }
    await api.put(`/admin/settings/${key}`, { value });
    setDraft((d) => { const n = { ...d }; delete n[key]; return n; });
    await reload();
  }, { success: 'Setting saved' });
  if (!data) return <LoadingBlock />;
  const byKey = new Map(data.map((s) => [s.id, s]));
  return (
    <>
      <PageHead title="System settings" sub="Changes take effect immediately and are recorded in the audit log." />
      <div className="stack">
        {SETTING_KEYS.map((k) => {
          const s = byKey.get(k);
          const val = draft[k] ?? JSON.stringify(s?.value ?? null);
          return (
            <div key={k} className="card pad" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 280px), 1fr))', gap: 16, alignItems: 'center' }}>
              <div><div className="mono small" style={{ fontWeight: 700 }}>{k}</div><div className="xsmall muted">{SETTING_HELP[k]}</div>{s && <div className="xsmall faint">Updated {when(s.updatedAt)}</div>}</div>
              <div className="row tight nowrap"><input className="input sm mono" aria-label={k} value={val} onChange={(e) => setDraft({ ...draft, [k]: e.target.value })} /><button className="btn sm primary" disabled={draft[k] === undefined || save.busy} onClick={() => save.run(k)}>Save</button></div>
            </div>
          );
        })}
      </div>
    </>
  );
}

export function PlatformReports() {
  const [days, setDays] = useState(30);
  const { data } = useApi<any>('/admin/reports', { days });
  return (
    <>
      <PageHead title="Platform reports" sub="Funnel, geography and search gaps. Event data is versioned for Phase 2 analytics and AI." actions={<div className="segmented" role="group" aria-label="Period">{[7, 30, 90].map((d) => <button key={d} aria-pressed={days === d} onClick={() => setDays(d)}>{d} days</button>)}</div>} />
      {!data ? <LoadingBlock rows={8} /> : (
        <>
          <div className="kpis"><Kpi label="GMV" value={usd(data.gmvCents)} /><Kpi label="Purchases" value={data.funnel.purchases} /><Kpi label="Cancelled" value={data.cancelled} /><Kpi label="Payment failures" value={data.paymentFailures} tone={data.paymentFailures ? 'attn' : undefined} /></div>
          <div className="grid cols-2" style={{ alignItems: 'start' }}>
            <div className="card pad stack"><h3>Shopper funnel</h3><Funnel steps={[{ label: 'Searches', value: data.funnel.searches }, { label: 'Product views', value: data.funnel.productViews }, { label: 'Added to cart', value: data.funnel.addToCart }, { label: 'Checkout started', value: data.funnel.checkoutStarted }, { label: 'Purchased', value: data.funnel.purchases }]} /></div>
            <div className="card pad stack"><h3>GMV by city</h3><RankBars rows={data.byCity.map((c: any) => ({ label: `${c.city} · ${c.orders} orders`, value: c.gmvCents }))} format={usd} /></div>
          </div>
          <div className="card pad stack tight"><h3>Searches with no results</h3><p className="small muted">Demand the network can't meet yet. Share with merchants or recruit stores that carry these.</p>{data.zeroResultQueries.length ? <RankBars rows={data.zeroResultQueries.map((z: any) => ({ label: `“${z.query}”`, value: z.count }))} /> : <Empty icon="check" title="Every search found something" />}</div>
        </>
      )}
    </>
  );
}

export function AdminNotifications() {
  const perms = usePermissions();
  const [f, setF] = useState({ audience: 'merchants', title: '', body: '' });
  const send = useAction(async () => { const r = await api.post('/admin/notifications/broadcast', f); toast({ tone: 'ok', title: `Sent to ${r.recipients} people` }); setF({ ...f, title: '', body: '' }); });
  return (
    <>
      <PageHead title="Notifications" />
      <div className="grid cols-2" style={{ alignItems: 'start' }}>
        <NotificationsPage />
        {perms.has('admin.notifications') && (
          <form className="card pad stack" onSubmit={(e) => { e.preventDefault(); void send.run(); }}>
            <h3>Send a system notification</h3>
            <SelectField label="Audience" value={f.audience} onChange={(e) => setF({ ...f, audience: e.target.value })}><option value="merchants">Merchants and store staff</option><option value="consumers">Shoppers</option><option value="all">Everyone</option></SelectField>
            <TextField label="Title" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} error={send.error?.fields.title} />
            <TextArea label="Message" rows={4} value={f.body} onChange={(e) => setF({ ...f, body: e.target.value })} error={send.error?.fields.body} />
            <p className="xsmall faint">In-app only. Email and SMS broadcasts need marketing consent checks and are not enabled in the beta.</p>
            <button className="btn primary" disabled={send.busy} style={{ alignSelf: 'flex-start' }}>Send</button>
          </form>
        )}
      </div>
    </>
  );
}

export { STORE_TYPES };
