import { useEffect, useState } from 'react';
import { EMPLOYEE_CAPABILITIES, STORE_TYPES, US_STATES } from '@retailgeo/core';
import { api } from '../../api';
import { useSession } from '../../state/store';
import { useAction, useApi } from '../../lib/hooks';
import { DAY, title } from '../../lib/format';
import { MapView } from '../../map/MapView';
import { AreaChart, Funnel, RankBars } from '../../ui/charts';
import { Icon } from '../../ui/icons';
import { Empty, Kpi, LoadingBlock, Modal, SelectField, StatusBadge, TextArea, TextField, storeTypeLabel, usd } from '../../ui/kit';
import { NotificationsPage } from '../consumer/Account';
import { PageHead, WithStore } from './Merchant';
import { useMerchantStores } from '../../layouts/ConsoleLayout';

const CAP_LABEL: Record<string, string> = {
  'inventory.manage': 'Update stock counts', 'orders.process': 'Process customer orders', 'orders.view': 'View orders and reports',
  'products.manage': 'Add products and change prices', 'offers.manage': 'Create offers', 'store_orders.manage': 'Store-to-store requests',
};

// ─── Store profile & hours ─────────────────────────────────────────────
export function StoreProfile() {
  return <WithStore>{(store) => <Profile store={store} />}</WithStore>;
}
function Profile({ store }: { store: any }) {
  const { reload } = useMerchantStores();
  const [f, setF] = useState({ ...store, services: (store.services ?? []).join(', '), deliveryFee: (store.deliveryFeeCents / 100).toFixed(2) });
  useEffect(() => setF({ ...store, services: (store.services ?? []).join(', '), deliveryFee: (store.deliveryFeeCents / 100).toFixed(2) }), [store]);
  const save = useAction(async () => {
    await api.patch(`/merchant/stores/${store.id}`, {
      name: f.name, description: f.description, storeType: f.storeType, addressLine1: f.addressLine1, city: f.city, state: f.state, zip: f.zip,
      phone: f.phone || null, email: f.email || null, website: f.website || null, serviceRadiusMi: Number(f.serviceRadiusMi),
      services: f.services.split(',').map((s: string) => s.trim()).filter(Boolean), pickupEnabled: f.pickupEnabled, deliveryEnabled: f.deliveryEnabled,
      deliveryFeeCents: Math.round(Number(f.deliveryFee) * 100),
    });
    await reload();
  }, { success: 'Store profile saved' });
  const e = save.error?.fields ?? {};
  return (
    <>
      <PageHead title="Store profile" sub="What shoppers see on your public store page. Changing the ZIP code re-positions your store on the map." />
      <div className="grid cols-2" style={{ alignItems: 'start' }}>
        <form className="card pad stack" onSubmit={(x) => { x.preventDefault(); void save.run(); }}>
          <div className="form-grid">
            <TextField label="Store name" value={f.name} onChange={(x) => setF({ ...f, name: x.target.value })} error={e.name} />
            <SelectField label="Store type" value={f.storeType} onChange={(x) => setF({ ...f, storeType: x.target.value })}>{STORE_TYPES.map((t) => <option key={t} value={t}>{storeTypeLabel(t)}</option>)}</SelectField>
            <TextArea label="Description" wrapClass="span-2" rows={3} value={f.description} onChange={(x) => setF({ ...f, description: x.target.value })} />
            <TextField label="Street address" wrapClass="span-2" value={f.addressLine1} onChange={(x) => setF({ ...f, addressLine1: x.target.value })} error={e.addressLine1} />
            <TextField label="City" value={f.city} onChange={(x) => setF({ ...f, city: x.target.value })} />
            <SelectField label="State" value={f.state} onChange={(x) => setF({ ...f, state: x.target.value })}>{Object.entries(US_STATES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</SelectField>
            <TextField label="ZIP code" value={f.zip} onChange={(x) => setF({ ...f, zip: x.target.value })} error={e.zip} />
            <TextField label="Phone" value={f.phone ?? ''} onChange={(x) => setF({ ...f, phone: x.target.value })} />
            <TextField label="Email" value={f.email ?? ''} onChange={(x) => setF({ ...f, email: x.target.value })} error={e.email} />
            <TextField label="Website" value={f.website ?? ''} onChange={(x) => setF({ ...f, website: x.target.value })} error={e.website} placeholder="https://" />
            <TextField label="Services" wrapClass="span-2" hint="Comma-separated, e.g. ATM, Air pump, Curbside pickup" value={f.services} onChange={(x) => setF({ ...f, services: x.target.value })} />
          </div>
          <fieldset className="panel stack tight" style={{ border: 0 }}>
            <legend className="label">Fulfillment</legend>
            <label className="check"><input type="checkbox" checked={f.pickupEnabled} onChange={(x) => setF({ ...f, pickupEnabled: x.target.checked })} /> In-store and curbside pickup</label>
            <label className="check"><input type="checkbox" checked={f.deliveryEnabled} onChange={(x) => setF({ ...f, deliveryEnabled: x.target.checked })} /> Local delivery by your staff</label>
            {f.deliveryEnabled && (
              <div className="form-grid">
                <TextField label="Delivery radius (mi)" inputMode="decimal" value={String(f.serviceRadiusMi)} onChange={(x) => setF({ ...f, serviceRadiusMi: x.target.value })} error={e.serviceRadiusMi} />
                <TextField label="Delivery fee ($)" inputMode="decimal" value={f.deliveryFee} onChange={(x) => setF({ ...f, deliveryFee: x.target.value })} error={e.deliveryFeeCents} />
              </div>
            )}
          </fieldset>
          {save.error && !Object.keys(e).length && <div className="alert bad">{save.error.message}</div>}
          <button className="btn primary" disabled={save.busy} style={{ alignSelf: 'flex-start' }}>Save profile</button>
        </form>
        <div className="stack">
          <div style={{ height: 280 }}>
            <MapView ariaLabel="Store location and delivery area" markers={[{ id: store.id, lat: store.latitude, lng: store.longitude, title: store.name, kind: store.storeType }]} center={{ lat: store.latitude, lng: store.longitude }} radiusMi={store.deliveryEnabled ? store.serviceRadiusMi : 2} legend={false} />
          </div>
          <p className="xsmall faint">Located at {store.latitude.toFixed(5)}, {store.longitude.toFixed(5)} · {store.county ? `${store.county} County · ` : ''}market assigned by RetailGeo.</p>
          <Hours storeId={store.id} />
        </div>
      </div>
    </>
  );
}

function Hours({ storeId }: { storeId: string }) {
  const { data, reload } = useApi<any[]>(`/merchant/stores/${storeId}/hours`);
  const [rows, setRows] = useState<any[]>([]);
  useEffect(() => { if (data) setRows(data.map((h) => ({ dayOfWeek: h.dayOfWeek, opens: h.opens, closes: h.closes === '24:00' ? '23:59' : h.closes, closed: h.closed }))); }, [data]);
  const save = useAction(async () => { await api.put(`/merchant/stores/${storeId}/hours`, { hours: rows }); await reload(); }, { success: 'Hours saved' });
  if (!data) return <LoadingBlock />;
  return (
    <div className="card">
      <div className="card-h"><h3>Business hours</h3><button className="btn sm primary" disabled={save.busy} onClick={() => save.run()}>Save hours</button></div>
      <table className="t">
        <tbody>
          {rows.map((h, i) => (
            <tr key={h.dayOfWeek}>
              <td style={{ width: 60 }}><strong>{DAY[h.dayOfWeek]}</strong></td>
              <td><label className="check" style={{ alignItems: 'center' }}><input type="checkbox" checked={!h.closed} onChange={(e) => setRows(rows.map((r, j) => (j === i ? { ...r, closed: !e.target.checked } : r)))} />Open</label></td>
              <td>{!h.closed && <div className="row tight nowrap"><input type="time" className="input sm" aria-label={`${DAY[h.dayOfWeek]} opens`} value={h.opens} onChange={(e) => setRows(rows.map((r, j) => (j === i ? { ...r, opens: e.target.value } : r)))} /><span>–</span><input type="time" className="input sm" aria-label={`${DAY[h.dayOfWeek]} closes`} value={h.closes} onChange={(e) => setRows(rows.map((r, j) => (j === i ? { ...r, closes: e.target.value } : r)))} /></div>}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ─── Employees ─────────────────────────────────────────────────────────
export function Employees() {
  return <WithStore>{(store) => <Staff store={store} />}</WithStore>;
}
function Staff({ store }: { store: any }) {
  const user = useSession((s) => s.user)!;
  const { data, reload } = useApi<any[]>(`/merchant/stores/${store.id}/staff`);
  const [invite, setInvite] = useState(false);
  const [edit, setEdit] = useState<any>(null);
  const isOwner = store.myRole === 'owner';
  const remove = useAction(async (id: string) => { await api.del(`/merchant/stores/${store.id}/staff/${id}`); await reload(); }, { success: 'Employee removed' });
  return (
    <>
      <PageHead title="Employees" sub="Give each person only what they need. Employees never get owner access automatically." actions={isOwner && <button className="btn primary" onClick={() => setInvite(true)}><Icon name="plus" className="icon sm" /> Add employee</button>} />
      {!data ? <LoadingBlock /> : data.length === 0 ? <div className="card"><Empty icon="users" title="No employees yet">Add staff so they can update stock and process orders from their own sign-in.</Empty></div> : (
        <div className="table-wrap">
          <table className="t">
            <thead><tr><th>Name</th><th>Role</th><th>Can</th><th>Status</th><th className="r"><span className="sr-only">Actions</span></th></tr></thead>
            <tbody>
              {data.map((s) => (
                <tr key={s.id}>
                  <td><strong>{s.fullName}</strong><div className="xsmall faint">{s.email}</div></td>
                  <td>{title(s.staffRole)}</td>
                  <td className="small">{s.staffRole === 'manager' ? 'Everything except adding staff' : s.capabilities.map((c: string) => CAP_LABEL[c]).join(' · ')}</td>
                  <td><StatusBadge status={s.status === 'pending_verification' ? 'pending' : s.status} /></td>
                  <td className="r">{s.userId !== user.id && <div className="row tight nowrap" style={{ justifyContent: 'flex-end' }}><button className="btn sm" onClick={() => setEdit(s)}>Edit</button><button className="btn sm ghost danger" onClick={() => remove.run(s.id)}>Remove</button></div>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {(invite || edit) && <StaffForm storeId={store.id} staff={edit} onClose={() => { setInvite(false); setEdit(null); }} onDone={reload} />}
    </>
  );
}

function StaffForm({ storeId, staff, onClose, onDone }: { storeId: string; staff: any; onClose: () => void; onDone: () => void }) {
  const [f, setF] = useState({ email: staff?.email ?? '', fullName: staff?.fullName ?? '', staffRole: staff?.staffRole ?? 'employee', capabilities: (staff?.capabilities ?? ['orders.view', 'orders.process']) as string[] });
  const save = useAction(async () => {
    if (staff) await api.patch(`/merchant/stores/${storeId}/staff/${staff.id}`, { staffRole: f.staffRole, capabilities: f.capabilities });
    else await api.post(`/merchant/stores/${storeId}/staff`, f);
    onDone();
    onClose();
  }, { success: staff ? 'Permissions updated' : 'Invitation sent' });
  const e = save.error?.fields ?? {};
  return (
    <Modal title={staff ? `Edit ${staff.fullName}` : 'Add an employee'} onClose={onClose} footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" disabled={save.busy} onClick={() => save.run()}>{staff ? 'Save' : 'Send invitation'}</button></>}>
      <div className="stack">
        {!staff && <><TextField label="Full name" value={f.fullName} onChange={(x) => setF({ ...f, fullName: x.target.value })} error={e.fullName} /><TextField label="Email" type="email" value={f.email} onChange={(x) => setF({ ...f, email: x.target.value })} error={e.email} /></>}
        <SelectField label="Role" value={f.staffRole} onChange={(x) => setF({ ...f, staffRole: x.target.value })}><option value="employee">Employee (choose permissions)</option><option value="manager">Manager (all store tasks)</option></SelectField>
        {f.staffRole === 'employee' && (
          <fieldset className="stack tight" style={{ border: 0, padding: 0 }}>
            <legend className="label" style={{ marginBottom: 6 }}>Permissions</legend>
            {EMPLOYEE_CAPABILITIES.map((c) => (
              <label key={c} className="check"><input type="checkbox" checked={f.capabilities.includes(c)} onChange={(x) => setF({ ...f, capabilities: x.target.checked ? [...f.capabilities, c] : f.capabilities.filter((y) => y !== c) })} />{CAP_LABEL[c]}</label>
            ))}
          </fieldset>
        )}
      </div>
    </Modal>
  );
}

// ─── Reports ───────────────────────────────────────────────────────────
export function Reports() {
  return <WithStore>{(store) => <ReportsPage store={store} />}</WithStore>;
}
function ReportsPage({ store }: { store: any }) {
  const [days, setDays] = useState(30);
  const { data } = useApi<any>(`/merchant/stores/${store.id}/reports`, { days });
  return (
    <>
      <PageHead title="Reports" sub="Sales, shopper interest and product performance for this store." actions={<div className="segmented" role="group" aria-label="Period">{[7, 30, 90].map((d) => <button key={d} aria-pressed={days === d} onClick={() => setDays(d)}>{d} days</button>)}</div>} />
      {!data ? <LoadingBlock rows={8} /> : (
        <>
          <div className="kpis">
            <Kpi label="Sales" value={usd(data.totals.salesCents)} />
            <Kpi label="Orders" value={data.totals.orders} />
            <Kpi label="Average order" value={usd(data.totals.avgOrderCents)} />
            <Kpi label="Discounts given" value={usd(data.totals.discountCents)} />
            <Kpi label="Wholesale to stores" value={usd(data.totals.b2bSalesCents)} />
            <Kpi label="Inventory changes" value={data.inventoryChanges} />
          </div>
          <div className="card"><div className="card-h"><h3>Daily sales</h3></div><div className="card-b"><AreaChart label={`Daily sales for the last ${days} days`} data={data.daily.map((d: any) => ({ day: d.day, value: d.salesCents }))} format={(v) => (v >= 100000 ? `$${(v / 100000).toFixed(1)}k` : `$${Math.round(v / 100)}`)} /></div></div>
          <div className="grid cols-2" style={{ alignItems: 'start' }}>
            <div className="card pad stack"><h3>Shopper funnel</h3><Funnel steps={[{ label: 'Store views', value: data.funnel.storeViews }, { label: 'Product views', value: data.funnel.productViews }, { label: 'Added to cart', value: data.funnel.addToCart }, { label: 'Purchased', value: data.funnel.purchases }]} /></div>
            <div className="card pad stack"><h3>Top products by revenue</h3>{data.topProducts.length ? <RankBars rows={data.topProducts.map((p: any) => ({ label: `${p.name} · ${p.units} sold`, value: p.revenueCents }))} format={usd} /> : <Empty title="No sales in this period" />}</div>
          </div>
          <div className="card pad stack tight"><h3>How shoppers get their orders</h3><RankBars rows={Object.entries(data.fulfillment).map(([k, v]) => ({ label: title(k), value: v as number }))} /></div>
        </>
      )}
    </>
  );
}

// ─── Notifications & settings ──────────────────────────────────────────
export function MerchantNotifications() {
  return (<><PageHead title="Notifications" sub="New orders, store-to-store requests, low stock and account updates." /><NotificationsPage /></>);
}

export function MerchantSettings() {
  const { businesses, stores } = useMerchantStores();
  return (
    <>
      <PageHead title="Settings" />
      <div className="grid cols-2" style={{ alignItems: 'start' }}>
        <div className="card pad stack tight">
          <h3>Business</h3>
          {businesses.map((b: any) => (
            <dl key={b.id} className="kv">
              <dt>Legal name</dt><dd>{b.legalName}</dd>
              {b.dbaName && <><dt>Doing business as</dt><dd>{b.dbaName}</dd></>}
              <dt>EIN</dt><dd className="mono">•••••{b.einLast4 ?? '—'}</dd>
              <dt>Status</dt><dd><StatusBadge status={b.status} /></dd>
              <dt>Stores</dt><dd>{stores.filter((s: any) => s.businessId === b.id).map((s: any) => s.name).join(', ')}</dd>
            </dl>
          ))}
          {businesses.length === 0 && <p className="small muted">You work at {stores.map((s: any) => s.name).join(', ')} as staff.</p>}
        </div>
        <div className="card pad stack tight">
          <h3>Inventory integrations</h3>
          <p className="small muted">In the beta, update stock by hand, with CSV bulk upload, or ask RetailGeo support for an admin import. Point-of-sale and ERP sync connect through the same inventory API and are planned for a later phase.</p>
          <div className="row tight"><span className="badge ok">Manual</span><span className="badge ok">CSV upload</span><span className="badge ok">Admin import</span><span className="badge">POS sync · planned</span></div>
        </div>
        <div className="card pad stack tight">
          <h3>Payouts</h3>
          <p className="small muted">Card payments are processed by RetailGeo's payment provider and settled to your bank account on a rolling schedule. Payout onboarding opens before general availability.</p>
        </div>
        <div className="card pad stack tight">
          <h3>Security</h3>
          <p className="small muted">Every change to prices, stock, offers and staff is recorded in the audit log with who made it and when. Remove staff access as soon as someone leaves.</p>
        </div>
      </div>
    </>
  );
}
