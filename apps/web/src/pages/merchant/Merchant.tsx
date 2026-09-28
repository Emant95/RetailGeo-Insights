import { useEffect, useState, type ReactNode } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../../api';
import { useAction, useApi } from '../../lib/hooks';
import { dateTime, label, title, when } from '../../lib/format';
import { ConsoleLayout, StoreSwitcher, useMerchantStores, type NavItem } from '../../layouts/ConsoleLayout';
import { BarChart } from '../../ui/charts';
import { Icon } from '../../ui/icons';
import { Empty, ErrorNote, Kpi, LoadingBlock, Modal, Pager, StatusBadge, StockPill, TextArea, Timeline, usd } from '../../ui/kit';

export function MerchantShell() {
  const { store } = useMerchantStores();
  const dash = useApi<any>(store ? `/merchant/stores/${store.id}/dashboard` : null);
  const m = dash.data?.metrics;
  const nav: (NavItem | string)[] = [
    { to: '/merchant', label: 'Overview', icon: 'home', end: true },
    'Catalog',
    { to: '/merchant/products', label: 'Products', icon: 'box' },
    { to: '/merchant/inventory', label: 'Inventory', icon: 'list', count: m?.lowStockProducts },
    { to: '/merchant/offers', label: 'Offers', icon: 'tag' },
    'Orders',
    { to: '/merchant/orders', label: 'Customer orders', icon: 'bag', count: m?.pendingOrders },
    { to: '/merchant/store-orders', label: 'Store-to-store', icon: 'swap', count: m?.storeOrdersIncoming },
    'Business',
    { to: '/merchant/reports', label: 'Reports', icon: 'chart' },
    { to: '/merchant/profile', label: 'Store profile', icon: 'store' },
    { to: '/merchant/employees', label: 'Employees', icon: 'users' },
    { to: '/merchant/notifications', label: 'Notifications', icon: 'bell' },
    { to: '/merchant/settings', label: 'Settings', icon: 'gear' },
  ];
  return <ConsoleLayout title="Merchant portal" nav={nav} top={<StoreSwitcher />} />;
}

/** Wraps merchant pages so they only render once a store is selected. */
export function WithStore({ children }: { children: (store: any) => ReactNode }) {
  const { store, loading, error, businesses } = useMerchantStores();
  if (error) return <ErrorNote error={error} />;
  if (loading && !store) return <LoadingBlock rows={6} />;
  if (!store) {
    return (
      <div className="card"><Empty icon="store" title="No stores yet" action={<Link to="/sell" className="btn primary">Apply to sell</Link>}>{businesses.length ? 'Your application is under review.' : 'Register your business and first store to get started.'}</Empty></div>
    );
  }
  return (
    <>
      {store.status === 'pending' && <div className="alert warn"><Icon name="clock" className="icon sm" /><div><strong>{store.name} is waiting for verification.</strong> You can build your catalog now. Shoppers will see the store once RetailGeo approves it, usually within two business days.</div></div>}
      {store.status === 'suspended' && <div className="alert bad"><Icon name="alert" className="icon sm" /><div><strong>This store is suspended</strong> and hidden from shoppers. Contact RetailGeo support.</div></div>}
      {children(store)}
    </>
  );
}

export function PageHead({ title: t, sub, actions }: { title: string; sub?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="page-h">
      <div><h1 style={{ fontSize: '1.6rem' }}>{t}</h1>{sub && <p>{sub}</p>}</div>
      {actions && <div className="row">{actions}</div>}
    </div>
  );
}

// ─── Overview ───────────────────────────────────────────────────────────
export function MerchantOverview() {
  return <WithStore>{(store) => <Overview store={store} />}</WithStore>;
}
function Overview({ store }: { store: any }) {
  const { data, error, reload } = useApi<any>(`/merchant/stores/${store.id}/dashboard`);
  const nav = useNavigate();
  if (error) return <ErrorNote error={error} onRetry={reload} />;
  if (!data) return <LoadingBlock rows={8} />;
  const m = data.metrics;
  return (
    <>
      <PageHead title={store.name} sub={<>{data.store.label} · {store.addressLine1}, {store.city} {store.verified || data.store.verified ? '· Verified' : ''}</>} actions={<Link to={`/store/${store.slug}`} className="btn sm"><Icon name="external" className="icon sm" /> View public page</Link>} />
      <div className="kpis">
        <Kpi label="Orders today" value={m.ordersToday} to="/merchant/orders" />
        <Kpi label="Waiting on you" value={m.pendingOrders} sub="confirmed or preparing" to="/merchant/orders" tone={m.pendingOrders ? 'attn' : undefined} />
        <Kpi label="Sales today" value={usd(m.salesTodayCents)} sub={`${usd(m.sales7dCents)} last 7 days`} to="/merchant/reports" />
        <Kpi label="Active products" value={m.activeProducts} sub={`${m.staleListings} not updated in 7+ days`} to="/merchant/products" />
        <Kpi label="Low or out of stock" value={m.lowStockProducts} to="/merchant/inventory" tone={m.lowStockProducts ? 'alert' : undefined} />
        <Kpi label="Active offers" value={m.activeOffers} to="/merchant/offers" />
        <Kpi label="Store visibility" value={m.storeViews7d + m.productViews7d} sub={`${m.storeViews7d} store · ${m.productViews7d} product views (7d)`} />
        <Kpi label="Store-to-store" value={m.storeOrdersIncoming} sub={`new requests · ${m.storeOrdersOpen} in progress`} to="/merchant/store-orders" tone={m.storeOrdersIncoming ? 'attn' : undefined} />
      </div>
      <div className="grid cols-2" style={{ alignItems: 'start' }}>
        <div className="card">
          <div className="card-h"><h3>Sales, last 14 days</h3><span className="small muted">{usd(data.salesTrend.reduce((s: number, d: any) => s + d.salesCents, 0))}</span></div>
          <div className="card-b"><BarChart label="Daily sales for the last 14 days" data={data.salesTrend.map((d: any) => ({ day: d.day, value: d.salesCents }))} format={(v) => (v >= 100000 ? `$${Math.round(v / 100000)}k` : `$${Math.round(v / 100)}`)} /></div>
        </div>
        <div className="card">
          <div className="card-h"><h3>Needs restocking</h3><Link to="/merchant/inventory" className="small">All inventory</Link></div>
          {data.lowStock.length === 0 ? <Empty icon="check" title="Everything is in stock" /> : (
            <div className="divider-list">
              {data.lowStock.map((l: any) => (
                <div key={l.storeProductId} className="row between" style={{ padding: '10px 18px' }}>
                  <div style={{ minWidth: 0 }} className="grow"><div className="ellipsis" style={{ fontWeight: 600 }}>{l.name}</div><StockPill status={l.status} qty={l.quantity} showQty /></div>
                  <button className="btn sm" onClick={() => nav(`/merchant/store-orders/new?q=${encodeURIComponent(l.name)}`)}><Icon name="swap" className="icon sm" /> Source nearby</button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
      <div className="card">
        <div className="card-h"><h3>Recent orders</h3><Link to="/merchant/orders" className="small">All orders</Link></div>
        <OrderTable rows={data.recentOrders} />
      </div>
    </>
  );
}

function OrderTable({ rows }: { rows: any[] }) {
  if (!rows.length) return <Empty icon="bag" title="No orders yet" />;
  return (
    <div style={{ overflowX: 'auto' }}>
      <table className="t">
        <thead><tr><th>Order</th><th>Status</th><th>Type</th>{rows[0].customerName !== undefined && <th>Customer</th>}<th className="r">Total</th><th>Placed</th></tr></thead>
        <tbody>
          {rows.map((o) => (
            <tr key={o.id}>
              <td><Link className="rowlink mono" to={`/merchant/orders/${o.id}`}>{o.number}</Link></td>
              <td><StatusBadge status={o.status} /></td>
              <td>{label(o.fulfillmentType)}</td>
              {o.customerName !== undefined && <td>{o.customerName}<div className="xsmall faint">{o.itemCount} items</div></td>}
              <td className="r num">{usd(o.totalCents)}</td>
              <td className="small muted">{when(o.createdAt)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ─── Customer orders ────────────────────────────────────────────────────
export function MerchantOrders() {
  return <WithStore>{(store) => <OrdersList store={store} />}</WithStore>;
}
function OrdersList({ store }: { store: any }) {
  const [status, setStatus] = useState('open');
  const [page, setPage] = useState(1);
  const [q, setQ] = useState('');
  useEffect(() => setPage(1), [status, q]);
  const { data, error, reload } = useApi<any>(`/merchant/stores/${store.id}/orders`, { status: status === 'all' ? undefined : status, page, pageSize: 20, q: q || undefined });
  return (
    <>
      <PageHead title="Customer orders" sub="Move each order along as you prepare it. Shoppers get a notification at every step." />
      <div className="row between">
        <div className="tabs" role="tablist">
          {[['open', 'Open'], ['all', 'All'], ['completed', 'Completed'], ['cancelled', 'Cancelled']].map(([k, l]) => <button key={k} role="tab" aria-selected={status === k} onClick={() => setStatus(k)}>{l}</button>)}
        </div>
        <input className="input sm" style={{ width: 200 }} placeholder="Find order number" aria-label="Find order number" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      <ErrorNote error={error} onRetry={reload} />
      <div className="card">{data ? <OrderTable rows={data.items} /> : <div className="card-b"><LoadingBlock /></div>}</div>
      {data && <Pager page={data.page} totalPages={data.totalPages} total={data.total} onPage={setPage} noun="orders" />}
    </>
  );
}

const NEXT_LABEL: Record<string, string> = { processing: 'Start preparing', ready: 'Mark ready for pickup', out_for_delivery: 'Send out for delivery', completed: 'Mark completed', cancelled: 'Cancel order' };

export function MerchantOrderDetail() {
  return <WithStore>{(store) => <OrderDetail store={store} />}</WithStore>;
}
function OrderDetail({ store }: { store: any }) {
  const { orderId } = useParams();
  const { data: o, error, reload, setData } = useApi<any>(`/merchant/stores/${store.id}/orders/${orderId}`);
  const [cancel, setCancel] = useState(false);
  const [reason, setReason] = useState('');
  const move = useAction(async (status: string, note?: string) => setData(await api.post(`/merchant/stores/${store.id}/orders/${orderId}/status`, { status, note })), { success: 'Order updated', onDone: () => { setCancel(false); void reload(); } });
  if (error) return <ErrorNote error={error} onRetry={reload} />;
  if (!o) return <LoadingBlock />;
  return (
    <>
      <Link to="/merchant/orders" className="small row tight"><Icon name="back" className="icon sm" /> Orders</Link>
      <PageHead title={`Order ${o.number}`} sub={`${title(o.fulfillmentType)} · placed ${dateTime(o.createdAt)}`} actions={<StatusBadge status={o.status} />} />
      {o.nextStatuses.length > 0 && (
        <div className="card pad row">
          <span className="grow small muted">Next step for this {o.fulfillmentType} order:</span>
          {o.nextStatuses.filter((s: string) => s !== 'cancelled').map((s: string) => <button key={s} className="btn primary" disabled={move.busy} onClick={() => move.run(s)}>{NEXT_LABEL[s] ?? title(s)}</button>)}
          {o.nextStatuses.includes('cancelled') && <button className="btn danger" onClick={() => setCancel(true)}>Cancel</button>}
        </div>
      )}
      <div className="grid cols-2" style={{ alignItems: 'start' }}>
        <div className="card">
          <div className="card-h"><h3>Items to pick</h3><span className="small muted">{o.items.reduce((s: number, i: any) => s + i.quantity, 0)} units</span></div>
          <table className="t">
            <thead><tr><th>Item</th><th className="r">Qty</th><th className="r">Total</th></tr></thead>
            <tbody>{o.items.map((it: any) => <tr key={it.id}><td>{it.productName}{it.discountCents ? <div className="xsmall" style={{ color: 'var(--ok)' }}>Offer −{usd(it.discountCents)}</div> : null}</td><td className="r num" style={{ fontWeight: 700 }}>{it.quantity}</td><td className="r num">{usd(it.totalCents)}</td></tr>)}</tbody>
          </table>
          <div className="card-b" style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: '4px 16px', borderTop: '1px solid var(--line)', fontSize: '0.9rem' }}>
            <span className="muted">Subtotal</span><span className="num">{usd(o.subtotalCents)}</span>
            <span className="muted">Discounts</span><span className="num">−{usd(o.discountCents)}</span>
            <span className="muted">Tax</span><span className="num">{usd(o.taxCents)}</span>
            {o.feeCents > 0 && <><span className="muted">Delivery fee</span><span className="num">{usd(o.feeCents)}</span></>}
            <strong>Total</strong><strong className="num">{usd(o.totalCents)}</strong>
          </div>
        </div>
        <div className="stack">
          <div className="card pad stack tight">
            <h3>Customer</h3>
            <dl className="kv">
              <dt>Name</dt><dd>{o.customer?.name}</dd>
              <dt>Phone</dt><dd className="mono">{o.customer?.phone ?? '—'}</dd>
              {o.deliveryAddress && <><dt>Deliver to</dt><dd>{o.deliveryAddress.line1}, {o.deliveryAddress.city}, {o.deliveryAddress.state} {o.deliveryAddress.zip}</dd></>}
              {o.notes && <><dt>Notes</dt><dd>{o.notes}</dd></>}
              <dt>Payment</dt><dd>{o.payment ? `${o.payment.cardBrand ?? 'Card'} ····${o.payment.cardLast4 ?? ''} · ${label(o.payment.status)}` : 'Collect at pickup'}</dd>
            </dl>
            {o.payment?.status === 'authorized' && <p className="xsmall faint">The card is charged automatically when you mark the order ready.</p>}
          </div>
          <div className="card pad stack tight">
            <h3>History</h3>
            <Timeline items={o.history.map((h: any) => ({ title: title(h.toStatus), sub: h.note ?? undefined, at: dateTime(h.createdAt), state: ['cancelled', 'payment_failed'].includes(h.toStatus) ? 'bad' : 'done' }))} />
          </div>
        </div>
      </div>
      {cancel && (
        <Modal title="Cancel this order?" onClose={() => setCancel(false)} footer={<><button className="btn" onClick={() => setCancel(false)}>Keep order</button><button className="btn danger solid" disabled={!reason.trim() || move.busy} onClick={() => move.run('cancelled', reason)}>Cancel and refund</button></>}>
          <div className="stack">
            <p>Stock returns to inventory and the shopper's card authorization is released or refunded.</p>
            <TextArea label="Reason (shared with the shopper)" value={reason} onChange={(e) => setReason(e.target.value)} rows={3} />
          </div>
        </Modal>
      )}
    </>
  );
}
