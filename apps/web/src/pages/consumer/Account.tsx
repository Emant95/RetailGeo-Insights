import { useState } from 'react';
import { Link, NavLink, Outlet, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { US_STATES } from '@retailgeo/core';
import { api } from '../../api';
import { useSession, toast, useCart } from '../../state/store';
import { useAction, useApi } from '../../lib/hooks';
import { dateTime, label, when } from '../../lib/format';
import { Icon } from '../../ui/icons';
import { Empty, ErrorNote, LoadingBlock, Modal, Pager, ProductArt, SelectField, StatusBadge, Steps, StoreTypeBadge, TextArea, TextField, Timeline, usd } from '../../ui/kit';

export function AccountLayout() {
  const user = useSession((s) => s.user)!;
  return (
    <div className="wrap page stack">
      <div className="stack tight">
        <span className="eyebrow">Your account</span>
        <h1 style={{ fontSize: '1.7rem' }}>Hi, {user.fullName.split(' ')[0]}</h1>
      </div>
      <nav className="tabs" aria-label="Account sections">
        {[['orders', 'Orders'], ['favorites', 'Favorites'], ['locations', 'Saved locations'], ['notifications', 'Notifications'], ['profile', 'Profile & privacy']].map(([to, l]) => (
          <NavLink key={to} to={`/account/${to}`} className={({ isActive }) => (isActive ? 'active' : '')}>{l}</NavLink>
        ))}
      </nav>
      <Outlet />
    </div>
  );
}

export function Orders() {
  const [page, setPage] = useState(1);
  const { data, loading, error, reload } = useApi<any>('/orders', { page, pageSize: 10 });
  if (loading && !data) return <LoadingBlock />;
  return (
    <div className="stack">
      <ErrorNote error={error} onRetry={reload} />
      {data?.items.length === 0 && <div className="card"><Empty icon="bag" title="No orders yet" action={<Link to="/" className="btn primary">Start shopping</Link>} /></div>}
      <div className="card divider-list">
        {data?.items.map((o: any) => (
          <Link key={o.id} to={`/account/orders/${o.id}`} className="srow" style={{ gridTemplateColumns: 'minmax(0,1fr) auto' }}>
            <div style={{ minWidth: 0 }}>
              <div className="row tight"><strong className="mono">{o.number}</strong><StatusBadge status={o.status} /></div>
              <div className="small muted ellipsis">{o.storeName} · {o.itemCount} item{o.itemCount === 1 ? '' : 's'} · {label(o.fulfillmentType)}</div>
              <div className="xsmall faint ellipsis">{o.preview.join(', ')}</div>
            </div>
            <div style={{ textAlign: 'right' }}>
              <strong className="num">{usd(o.totalCents)}</strong>
              <div className="xsmall faint">{when(o.createdAt)}</div>
            </div>
          </Link>
        ))}
      </div>
      {data && <Pager page={data.page} totalPages={data.totalPages} total={data.total} onPage={setPage} noun="orders" />}
    </div>
  );
}

const PICKUP_STEPS = [{ key: 'confirmed', label: 'Confirmed' }, { key: 'processing', label: 'Preparing' }, { key: 'ready', label: 'Ready' }, { key: 'completed', label: 'Picked up' }];
const DELIVERY_STEPS = [{ key: 'confirmed', label: 'Confirmed' }, { key: 'processing', label: 'Preparing' }, { key: 'out_for_delivery', label: 'On the way' }, { key: 'completed', label: 'Delivered' }];

export function OrderDetail() {
  const { id } = useParams();
  const [params] = useSearchParams();
  const { data: o, error, reload, setData } = useApi<any>(`/orders/${id}`);
  const [cancel, setCancel] = useState(false);
  const doCancel = useAction(async () => setData(await api.post(`/orders/${id}/cancel`, { reason: 'Changed my mind' })), { success: 'Order cancelled', onDone: () => setCancel(false) });
  if (error) return <ErrorNote error={error} onRetry={reload} />;
  if (!o) return <LoadingBlock />;
  const steps = o.fulfillmentType === 'delivery' ? DELIVERY_STEPS : PICKUP_STEPS;
  const failed = ['cancelled', 'payment_failed'].includes(o.status);
  return (
    <div className="stack">
      {params.get('placed') && <div className="alert ok"><Icon name="check" className="icon sm" /><div><strong>Thanks! Your order is in.</strong> We'll notify you as {o.store.name} prepares it.</div></div>}
      <div className="card pad stack">
        <div className="row between">
          <div className="stack tight" style={{ gap: 2 }}>
            <span className="eyebrow">Order</span>
            <h2 className="mono" style={{ fontSize: '1.4rem' }}>{o.number}</h2>
            <span className="small muted">Placed {dateTime(o.createdAt)}</span>
          </div>
          <div className="row"><StatusBadge status={o.status} />{o.canCancel && <button className="btn danger sm" onClick={() => setCancel(true)}>Cancel order</button>}</div>
        </div>
        {!failed ? <Steps steps={steps} current={o.status === 'pending_payment' ? 'confirmed' : o.status} /> : <div className="alert bad">{o.status === 'cancelled' ? 'This order was cancelled. Any card authorization was released or refunded.' : 'Payment did not go through. Nothing was charged.'}</div>}
        {o.status === 'ready' && <div className="alert ok"><Icon name="store" className="icon sm" /><div><strong>Ready for {o.fulfillmentType === 'curbside' ? 'curbside pickup' : 'pickup'}.</strong> Show order number <span className="mono">{o.number}</span> at {o.store.name}, {o.store.addressLine1}.</div></div>}
      </div>
      <div style={{ display: 'grid', gap: 16, gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 320px), 1fr))', alignItems: 'start' }}>
        <div className="card">
          <div className="card-h">
            <div className="row nowrap"><StoreTypeBadge type={o.store.storeType} size={32} /><Link to={`/store/${o.store.slug}`} style={{ fontWeight: 700 }}>{o.store.name}</Link></div>
            <span className="small muted">{label(o.fulfillmentType)}</span>
          </div>
          <div className="divider-list">
            {o.items.map((it: any) => (
              <div key={it.id} style={{ display: 'grid', gridTemplateColumns: '44px 1fr auto', gap: 12, padding: '10px 18px', alignItems: 'center' }}>
                <div style={{ borderRadius: 6, overflow: 'hidden' }}><ProductArt name={it.productName} ratio="1 / 1" /></div>
                <div><div style={{ fontWeight: 600 }}>{it.productName}</div><div className="xsmall muted">{it.quantity} × {usd(it.unitPriceCents)}{it.discountCents ? ` · saved ${usd(it.discountCents)}` : ''}</div></div>
                <span className="num">{usd(it.totalCents)}</span>
              </div>
            ))}
          </div>
          <div className="card-b" style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: '4px 16px', borderTop: '1px solid var(--line)', fontSize: '0.92rem' }}>
            <span className="muted">Subtotal</span><span className="num">{usd(o.subtotalCents)}</span>
            {o.discountCents > 0 && <><span className="muted">Offers</span><span className="num">−{usd(o.discountCents)}</span></>}
            <span className="muted">Tax</span><span className="num">{usd(o.taxCents)}</span>
            {o.feeCents > 0 && <><span className="muted">Delivery</span><span className="num">{usd(o.feeCents)}</span></>}
            <strong>Total</strong><strong className="num">{usd(o.totalCents)}</strong>
            <span className="muted small">Payment</span><span className="small">{o.payment ? `${o.payment.cardBrand ?? 'Card'} ····${o.payment.cardLast4 ?? ''} · ${label(o.payment.status)}` : 'Pay at pickup'}</span>
          </div>
        </div>
        <div className="card pad stack">
          <h3>Tracking</h3>
          <Timeline items={o.history.map((h: any, i: number) => ({ title: label(h.toStatus).replace(/^\w/, (c: string) => c.toUpperCase()), sub: h.note ?? undefined, at: dateTime(h.createdAt), state: ['cancelled', 'payment_failed'].includes(h.toStatus) ? 'bad' : i === o.history.length - 1 && o.status !== 'completed' ? 'current' : 'done' }))} />
          {o.deliveryAddress && <p className="small muted">Delivering to {o.deliveryAddress.line1}, {o.deliveryAddress.city}, {o.deliveryAddress.state} {o.deliveryAddress.zip}</p>}
          <Link to={`/support?order=${o.id}`} className="btn sm" style={{ alignSelf: 'flex-start' }}>Get help with this order</Link>
        </div>
      </div>
      {cancel && (
        <Modal title="Cancel this order?" onClose={() => setCancel(false)} footer={<><button className="btn" onClick={() => setCancel(false)}>Keep order</button><button className="btn danger solid" disabled={doCancel.busy} onClick={() => doCancel.run()}>Cancel order</button></>}>
          <p>{o.store.name} hasn't started preparing it yet. We'll release the hold on your card right away.</p>
        </Modal>
      )}
    </div>
  );
}

export function Favorites() {
  const { data, reload } = useApi<any[]>('/users/me/favorites');
  const remove = useAction(async (id: string) => { await api.del(`/users/me/favorites/${id}`); await reload(); }, { success: 'Removed from favorites' });
  if (!data) return <LoadingBlock />;
  const stores = data.filter((f) => f.store);
  const products = data.filter((f) => f.product);
  return (
    <div className="stack loose">
      {data.length === 0 && <div className="card"><Empty icon="heart" title="Nothing saved yet">Tap Save on a store or product to keep it here.</Empty></div>}
      {stores.length > 0 && (
        <section className="stack tight"><h2 style={{ fontSize: '1.05rem' }}>Stores</h2>
          <div className="card divider-list">
            {stores.map((f) => (
              <div key={f.id} className="srow">
                <StoreTypeBadge type={f.store.storeType} />
                <Link to={`/store/${f.store.slug}`} style={{ minWidth: 0 }}><div className="name">{f.store.name}</div><div className="small muted">{f.store.addressLine1}, {f.store.city}</div></Link>
                <button className="btn ghost sm" onClick={() => remove.run(f.id)}>Remove</button>
              </div>
            ))}
          </div>
        </section>
      )}
      {products.length > 0 && (
        <section className="stack tight"><h2 style={{ fontSize: '1.05rem' }}>Products</h2>
          <div className="grid cols-4">
            {products.map((f) => (
              <div key={f.id} className="ptile">
                <Link to={`/product/${f.product.id}`}><ProductArt name={f.product.name} size={f.product.size} /></Link>
                <div className="body"><Link to={`/product/${f.product.id}`} className="name" style={{ color: 'inherit' }}>{f.product.name}</Link><span className="meta">{f.product.size}</span>
                  <div className="row between"><Link to={`/product/${f.product.id}`} className="btn sm">Compare prices</Link><button className="btn ghost sm" onClick={() => remove.run(f.id)}>Remove</button></div>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

export function Locations() {
  const { data, reload } = useApi<any[]>('/users/me/addresses');
  const [form, setForm] = useState({ label: 'Home', line1: '', city: '', state: 'TX', zip: '', isDefault: false });
  const add = useAction(async () => { await api.post('/users/me/addresses', form); setForm({ ...form, line1: '', zip: '' }); await reload(); }, { success: 'Location saved' });
  const del = useAction(async (id: string) => { await api.del(`/users/me/addresses/${id}`); await reload(); });
  const f = add.error?.fields ?? {};
  return (
    <div className="grid cols-2" style={{ alignItems: 'start' }}>
      <div className="card divider-list">
        {data?.length === 0 && <Empty icon="pin" title="No saved locations">Saved locations make checkout and nearby search faster.</Empty>}
        {data?.map((a) => (
          <div key={a.id} className="srow" style={{ gridTemplateColumns: '24px 1fr auto' }}>
            <Icon name="pin" />
            <div><strong>{a.label}</strong>{a.isDefault && <span className="badge brand" style={{ marginLeft: 8 }}>Default</span>}<div className="small muted">{a.line1}, {a.city}, {a.state} {a.zip}</div></div>
            <button className="btn ghost sm" onClick={() => del.run(a.id)} aria-label={`Delete ${a.label}`}>Delete</button>
          </div>
        ))}
      </div>
      <form className="card pad stack" onSubmit={(e) => { e.preventDefault(); void add.run(); }}>
        <h3>Add a location</h3>
        <div className="form-grid">
          <TextField label="Label" value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} error={f.label} />
          <TextField label="Street address" value={form.line1} onChange={(e) => setForm({ ...form, line1: e.target.value })} error={f.line1} autoComplete="street-address" />
          <TextField label="City" value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} error={f.city} />
          <SelectField label="State" value={form.state} onChange={(e) => setForm({ ...form, state: e.target.value })}>{Object.entries(US_STATES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</SelectField>
          <TextField label="ZIP code" value={form.zip} onChange={(e) => setForm({ ...form, zip: e.target.value })} error={f.zip} inputMode="numeric" />
        </div>
        <label className="check"><input type="checkbox" checked={form.isDefault} onChange={(e) => setForm({ ...form, isDefault: e.target.checked })} /> Make this my default</label>
        <button className="btn primary" disabled={add.busy}>Save location</button>
      </form>
    </div>
  );
}

export function NotificationsPage() {
  const { data, reload } = useApi<any>('/notifications', { pageSize: 50 });
  const nav = useNavigate();
  const readAll = useAction(async () => { await api.post('/notifications/all/read'); await reload(); });
  const open = async (n: any) => {
    if (!n.readAt) await api.post(`/notifications/${n.id}/read`).catch(() => undefined);
    if (n.link) nav(n.link);
    else void reload();
  };
  if (!data) return <LoadingBlock />;
  return (
    <div className="stack">
      <div className="row between"><span className="small muted">{data.unread} unread</span>{data.unread > 0 && <button className="btn sm" onClick={() => readAll.run()}>Mark all read</button>}</div>
      <div className="card divider-list">
        {data.items.length === 0 && <Empty icon="bell" title="You're all caught up" />}
        {data.items.map((n: any) => (
          <button key={n.id} onClick={() => open(n)} className="srow" style={{ gridTemplateColumns: '10px 1fr auto', width: '100%', border: 0, background: n.readAt ? 'transparent' : 'color-mix(in srgb, var(--brand-soft) 50%, transparent)', textAlign: 'left', cursor: 'pointer' }}>
            <span style={{ width: 8, height: 8, borderRadius: 4, background: n.readAt ? 'transparent' : 'var(--brand)' }} aria-label={n.readAt ? undefined : 'Unread'} />
            <div style={{ minWidth: 0 }}><div style={{ fontWeight: n.readAt ? 500 : 700 }}>{n.title}</div><div className="small muted">{n.body}</div></div>
            <span className="xsmall faint">{when(n.createdAt)}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

export function Profile() {
  const user = useSession((s) => s.user)!;
  const [form, setForm] = useState({ fullName: user.fullName, phone: user.phone ?? '', marketingConsent: user.marketingConsent, locationSharing: user.locationSharing });
  const [exportData, setExportData] = useState<any>(null);
  const [del, setDel] = useState(false);
  const [confirm, setConfirm] = useState('');
  const nav = useNavigate();
  const save = useAction(async () => {
    const u = await api.patch('/users/me', { ...form, phone: form.phone || null });
    api.setSession({ ...api.current!, user: u });
  }, { success: 'Profile saved' });
  const doExport = useAction(async () => setExportData(await api.get('/users/me/export')));
  const doDelete = useAction(async () => {
    await api.del('/users/me');
    api.setSession(null);
    useCart.getState().setCount(0);
    toast({ tone: 'ok', title: 'Your account was deleted' });
    nav('/');
  });
  const f = save.error?.fields ?? {};
  return (
    <div className="grid cols-2" style={{ alignItems: 'start' }}>
      <form className="card pad stack" onSubmit={(e) => { e.preventDefault(); void save.run(); }}>
        <h3>Profile</h3>
        <TextField label="Full name" value={form.fullName} onChange={(e) => setForm({ ...form, fullName: e.target.value })} error={f.fullName} autoComplete="name" />
        <TextField label="Email" value={user.email} disabled hint={user.emailVerifiedAt ? 'Verified' : 'Not verified yet. Check your inbox.'} />
        <TextField label="Mobile phone (optional)" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} error={f.phone} autoComplete="tel" inputMode="tel" />
        <fieldset className="stack tight" style={{ border: 0, padding: 0, margin: 0 }}>
          <legend className="label" style={{ marginBottom: 8 }}>Privacy & communications</legend>
          <label className="check"><input type="checkbox" checked={form.locationSharing} onChange={(e) => setForm({ ...form, locationSharing: e.target.checked })} /><span>Allow RetailGeo to use my device location for nearby search<br /><span className="xsmall faint">We only ask when you tap "Use my current location", and we never save your exact position.</span></span></label>
          <label className="check"><input type="checkbox" checked={form.marketingConsent} onChange={(e) => setForm({ ...form, marketingConsent: e.target.checked })} /><span>Email me offers from stores near me<br /><span className="xsmall faint">Order updates are always sent. You can change this any time.</span></span></label>
        </fieldset>
        <button className="btn primary" disabled={save.busy}>Save changes</button>
      </form>
      <div className="stack">
        <div className="card pad stack tight">
          <h3>Your data</h3>
          <p className="small muted">See everything RetailGeo holds about you: profile, saved locations, favorites, orders and search history (stored with approximate location only).</p>
          <button className="btn" onClick={() => doExport.run()} disabled={doExport.busy} style={{ alignSelf: 'flex-start' }}>View my data</button>
        </div>
        <div className="card pad stack tight" style={{ borderColor: 'color-mix(in srgb, var(--bad) 35%, var(--line))' }}>
          <h3>Delete account</h3>
          <p className="small muted">Removes your profile, saved locations, favorites and sign-in. Order records are kept without your name for tax and accounting purposes.</p>
          <button className="btn danger" onClick={() => setDel(true)} style={{ alignSelf: 'flex-start' }}>Delete my account</button>
        </div>
      </div>
      {exportData && (
        <Modal title="Your data" wide onClose={() => setExportData(null)} footer={<button className="btn" onClick={() => { void navigator.clipboard?.writeText(JSON.stringify(exportData, null, 2)).then(() => toast({ tone: 'ok', title: 'Copied to clipboard' }), () => toast({ tone: 'bad', title: 'Copy was blocked. Select the text instead.' })); }}>Copy JSON</button>}>
          <p className="small muted" style={{ marginBottom: 10 }}>{exportData.orders.length} orders · {exportData.addresses.length} saved locations · {exportData.favorites.length} favorites · {exportData.searches.length} searches</p>
          <pre className="code-block" style={{ maxHeight: 360 }}>{JSON.stringify(exportData, null, 2)}</pre>
        </Modal>
      )}
      {del && (
        <Modal title="Delete your account?" onClose={() => setDel(false)} footer={<><button className="btn" onClick={() => setDel(false)}>Keep my account</button><button className="btn danger solid" disabled={confirm !== 'DELETE' || doDelete.busy} onClick={() => doDelete.run()}>Delete account</button></>}>
          <div className="stack">
            <p>This can't be undone. Type <strong className="mono">DELETE</strong> to confirm.</p>
            <TextField label="Confirmation" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="off" />
          </div>
        </Modal>
      )}
    </div>
  );
}

export function Support() {
  const user = useSession((s) => s.user);
  const [params] = useSearchParams();
  const orders = useApi<any>(user ? '/orders' : null, { pageSize: 20 });
  const [form, setForm] = useState({ email: user?.email ?? '', subject: '', body: '', orderId: params.get('order') ?? '', category: params.get('order') ? 'order' : 'other' });
  const [sent, setSent] = useState<any>(null);
  const send = useAction(async () => setSent(await api.post('/support/tickets', { ...form, orderId: form.orderId || undefined })));
  const f = send.error?.fields ?? {};
  return (
    <div className="wrap page" style={{ maxWidth: 760 }}>
      <div className="stack">
        <h1 style={{ fontSize: '1.7rem' }}>Help & support</h1>
        <p className="muted">Questions about an order, a store listing or your account? Our team replies within one business day. For anything about the items themselves, the store can help fastest.</p>
        {sent ? (
          <div className="card pad stack">
            <div className="alert ok"><Icon name="check" className="icon sm" /><div><strong>Request received.</strong> Ticket <span className="mono">{sent.id.slice(0, 8).toUpperCase()}</span>. We emailed a copy to {sent.email}.</div></div>
            <Link to="/" className="btn" style={{ alignSelf: 'flex-start' }}>Back to shopping</Link>
          </div>
        ) : (
          <form className="card pad stack" onSubmit={(e) => { e.preventDefault(); void send.run(); }}>
            <div className="form-grid">
              <TextField label="Email" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} error={f.email} autoComplete="email" />
              <SelectField label="Topic" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
                <option value="order">An order</option><option value="payment">A charge or refund</option><option value="store">A store or listing</option><option value="account">My account</option><option value="other">Something else</option>
              </SelectField>
              {user && (
                <SelectField label="Related order (optional)" wrapClass="span-2" value={form.orderId} onChange={(e) => setForm({ ...form, orderId: e.target.value })}>
                  <option value="">None</option>
                  {orders.data?.items.map((o: any) => <option key={o.id} value={o.id}>{o.number} · {o.storeName} · {usd(o.totalCents)}</option>)}
                </SelectField>
              )}
              <TextField label="Subject" wrapClass="span-2" value={form.subject} onChange={(e) => setForm({ ...form, subject: e.target.value })} error={f.subject} />
              <TextArea label="How can we help?" wrapClass="span-2" rows={5} value={form.body} onChange={(e) => setForm({ ...form, body: e.target.value })} error={f.body} hint="Include what you expected and what happened." />
            </div>
            <button className="btn primary" disabled={send.busy} style={{ alignSelf: 'flex-start' }}>Send request</button>
          </form>
        )}
      </div>
    </div>
  );
}

export function Legal({ kind }: { kind: 'privacy' | 'terms' }) {
  return (
    <div className="wrap page" style={{ maxWidth: 760 }}>
      <div className="stack">
        <span className="badge warn" style={{ alignSelf: 'flex-start' }}>Draft · pending legal review</span>
        <h1 style={{ fontSize: '1.7rem' }}>{kind === 'privacy' ? 'Privacy notice' : 'Terms of service'}</h1>
        {kind === 'privacy' ? (
          <>
            <p>RetailGeo collects the minimum data needed to show nearby stores and fulfill orders: your account details, orders, saved locations you choose to add, and searches.</p>
            <p><strong>Location.</strong> We only request device location when you ask us to. Your current search location stays in your browser session and is kept separate from saved addresses. Search logs keep an approximate area (about 1 km), not your exact position, and are retained for 180 days.</p>
            <p><strong>Payments.</strong> Card details go directly to our payment processor. We store only a reference, the card brand and last four digits.</p>
            <p><strong>Your choices.</strong> You can view your data, turn off marketing email, and delete your account from Profile & privacy at any time.</p>
          </>
        ) : (
          <>
            <p>RetailGeo is a marketplace. Each participating store sets its own prices, stock, offers and fulfillment, and is the seller of record for its orders.</p>
            <p>Availability shown is reported by the store and can change between your search and your visit. Card authorizations are captured when the store marks an order ready.</p>
          </>
        )}
        <p className="small faint">This beta text is a placeholder. Final policies require review by qualified legal and compliance professionals, including applicable state privacy laws.</p>
      </div>
    </div>
  );
}
