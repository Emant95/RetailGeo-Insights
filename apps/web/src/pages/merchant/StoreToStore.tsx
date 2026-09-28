import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { api } from '../../api';
import { toast } from '../../state/store';
import { useAction, useApi, useDebounced } from '../../lib/hooks';
import { dateTime, title, when } from '../../lib/format';
import { MapView } from '../../map/MapView';
import { Icon } from '../../ui/icons';
import { Distance, Empty, ErrorNote, LoadingBlock, Modal, Pager, StatusBadge, Steps, TextArea, Timeline, usd, storeTypeLabel } from '../../ui/kit';
import { PageHead, WithStore } from './Merchant';

const S2S_STEPS = [
  { key: 'draft', label: 'Draft' }, { key: 'pending_acceptance', label: 'Awaiting supplier' }, { key: 'accepted', label: 'Accepted' },
  { key: 'preparing', label: 'Preparing' }, { key: 'ready', label: 'Ready' }, { key: 'completed', label: 'Received' },
];

export function StoreOrders() {
  return <WithStore>{(store) => <List store={store} />}</WithStore>;
}
function List({ store }: { store: any }) {
  const [role, setRole] = useState<'' | 'buyer' | 'seller'>('');
  const [status, setStatus] = useState('open');
  const [page, setPage] = useState(1);
  useEffect(() => setPage(1), [role, status]);
  const { data, error, reload } = useApi<any>('/store-orders', { storeId: store.id, role: role || undefined, status: status || undefined, page });
  return (
    <>
      <PageHead title="Store-to-store" sub="Request stock from nearby RetailGeo stores, and fill requests from stores near you. Wholesale orders are kept separate from customer orders." actions={<Link to="/merchant/store-orders/new" className="btn primary"><Icon name="search" className="icon sm" /> Find stock nearby</Link>} />
      <div className="row between">
        <div className="tabs" role="tablist">
          {[['', 'All'], ['seller', 'Requests to us'], ['buyer', 'Our requests']].map(([k, l]) => <button key={k} role="tab" aria-selected={role === k} onClick={() => setRole(k as any)}>{l}</button>)}
        </div>
        <select className="select sm" style={{ width: 'auto' }} aria-label="Status" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="open">Open</option><option value="">Any status</option><option value="pending_acceptance">Awaiting supplier</option><option value="completed">Completed</option><option value="rejected">Rejected</option><option value="cancelled">Cancelled</option>
        </select>
      </div>
      <ErrorNote error={error} onRetry={reload} />
      {!data ? <LoadingBlock /> : data.items.length === 0 ? <div className="card"><Empty icon="swap" title="No requests here" action={<Link to="/merchant/store-orders/new" className="btn">Find stock nearby</Link>} /></div> : (
        <div className="table-wrap">
          <table className="t">
            <thead><tr><th>Request</th><th>Direction</th><th>Other store</th><th>Status</th><th className="r">Value</th><th>Updated</th></tr></thead>
            <tbody>
              {data.items.map((s: any) => (
                <tr key={s.id}>
                  <td><Link to={`/merchant/store-orders/${s.id}`} className="rowlink mono">{s.number}</Link>{s.partial && <div className="xsmall faint">Partial</div>}</td>
                  <td>{s.direction === 'incoming' ? <span className="badge amber">Incoming</span> : <span className="badge info">Outgoing</span>}</td>
                  <td>{s.counterparty}</td>
                  <td><StatusBadge status={s.status} /></td>
                  <td className="r num">{usd(s.subtotalCents)}</td>
                  <td className="small muted">{when(s.updatedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {data && <Pager page={data.page} totalPages={data.totalPages} total={data.total} onPage={setPage} noun="requests" />}
    </>
  );
}

export function Sourcing() {
  return <WithStore>{(store) => <SourcingPage store={store} />}</WithStore>;
}
function SourcingPage({ store }: { store: any }) {
  const [params] = useSearchParams();
  const [q, setQ] = useState(params.get('q') ?? '');
  const dq = useDebounced(q, 300);
  const [radius, setRadius] = useState(10);
  const [pick, setPick] = useState<{ supplier: any; product: any } | null>(null);
  const [selectedStore, setSelectedStore] = useState<string | null>(null);
  const { data, error, loading } = useApi<any>('/store-orders/sourcing', { storeId: store.id, q: dq, radius });
  const suppliers = useMemo(() => {
    const m = new Map<string, any>();
    for (const it of data?.items ?? []) for (const s of it.suppliers) if (!m.has(s.storeId)) m.set(s.storeId, s);
    return [...m.values()];
  }, [data]);
  return (
    <>
      <Link to="/merchant/store-orders" className="small row tight"><Icon name="back" className="icon sm" /> Store-to-store</Link>
      <PageHead title="Find stock at nearby stores" sub={`Stores within ${radius} miles of ${store.name} that sell wholesale to other RetailGeo stores.`} />
      <div className="filters">
        <input className="input" style={{ maxWidth: 380 }} placeholder='e.g. "spring water 24", "ice", a SKU or UPC' aria-label="What do you need?" value={q} onChange={(e) => setQ(e.target.value)} autoFocus />
        <div className="segmented" role="group" aria-label="Radius">{[5, 10, 25, 50].map((r) => <button key={r} aria-pressed={radius === r} onClick={() => setRadius(r)}>{r} mi</button>)}</div>
      </div>
      <ErrorNote error={error} />
      <div className="split">
        <div className="stack">
          {loading && !data && <LoadingBlock />}
          {data && data.items.length === 0 && <div className="card"><Empty title="No wholesale listings match" action={<button className="btn" onClick={() => setRadius(50)}>Search 50 miles</button>}>Try a broader term or a wider radius.</Empty></div>}
          {data?.items.map((it: any) => (
            <div key={it.product.id} className="card">
              <div className="card-h"><div><strong>{it.product.name}</strong><div className="xsmall faint mono">{it.product.size} · {it.product.sku}</div></div><span className="small muted">{it.suppliers.length} supplier{it.suppliers.length > 1 ? 's' : ''}</span></div>
              <div className="divider-list">
                {it.suppliers.map((s: any) => (
                  <div key={s.storeProductId} className="row between" style={{ padding: '10px 18px', background: selectedStore === s.storeId ? 'var(--brand-soft)' : undefined }} onMouseEnter={() => setSelectedStore(s.storeId)}>
                    <div style={{ minWidth: 0 }} className="grow">
                      <div className="row tight"><strong>{s.storeName}</strong><Distance mi={s.distanceMi} /></div>
                      <div className="xsmall muted">{storeTypeLabel(s.storeType)} · {s.city} · <strong style={{ color: s.available > 0 ? 'var(--ok)' : 'var(--bad)' }}>{s.available} available</strong> · min {s.minQty} {s.unitLabel}</div>
                    </div>
                    <div className="row tight nowrap">
                      <span className="num" style={{ fontWeight: 800 }}>{usd(s.unitPriceCents)}<span className="xsmall faint"> /{s.unitLabel}</span></span>
                      <button className="btn sm primary" disabled={s.available < s.minQty} onClick={() => setPick({ supplier: s, product: it.product })}>Request</button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
        <div className="sticky-map">
          <MapView
            ariaLabel="Supplier stores"
            center={data ? { lat: data.buyerStore.latitude, lng: data.buyerStore.longitude } : undefined}
            radiusMi={radius}
            user={data ? { lat: data.buyerStore.latitude, lng: data.buyerStore.longitude } : null}
            selectedId={selectedStore}
            onSelect={setSelectedStore}
            markers={suppliers.map((s) => ({ id: s.storeId, lat: s.latitude, lng: s.longitude, title: `${s.storeName}, ${s.distanceMi} mi`, kind: s.storeType }))}
            renderPopup={(m) => <strong>{suppliers.find((s) => s.storeId === m.id)?.storeName}</strong>}
          />
        </div>
      </div>
      {pick && <RequestModal store={store} pick={pick} onClose={() => setPick(null)} />}
    </>
  );
}

function RequestModal({ store, pick, onClose }: { store: any; pick: { supplier: any; product: any }; onClose: () => void }) {
  const nav = useNavigate();
  const [qty, setQty] = useState(String(Math.max(pick.supplier.minQty, Math.min(20, pick.supplier.available))));
  const [notes, setNotes] = useState('');
  const send = useAction(async (submit: boolean) => {
    const so = await api.post('/store-orders', { buyerStoreId: store.id, sellerStoreId: pick.supplier.storeId, items: [{ storeProductId: pick.supplier.storeProductId, quantity: Number(qty) }], notes: notes || undefined, submit }, { idempotent: true });
    toast({ tone: 'ok', title: submit ? `Request ${so.number} sent` : `Draft ${so.number} saved`, body: submit ? `${pick.supplier.storeName} will accept or decline it.` : undefined });
    nav(`/merchant/store-orders/${so.id}`);
  });
  const n = Number(qty) || 0;
  return (
    <Modal title={`Request from ${pick.supplier.storeName}`} onClose={onClose} footer={<><button className="btn" onClick={() => send.run(false)} disabled={send.busy}>Save draft</button><button className="btn primary" onClick={() => send.run(true)} disabled={send.busy || n < pick.supplier.minQty || n > pick.supplier.available}>Send request · {usd(n * pick.supplier.unitPriceCents)}</button></>}>
      <div className="stack">
        <div className="panel"><strong>{pick.product.name}</strong><div className="small muted">{pick.product.size} · {usd(pick.supplier.unitPriceCents)} per {pick.supplier.unitLabel} · {pick.supplier.available} available · {pick.supplier.distanceMi} mi away</div></div>
        <div className="field">
          <label htmlFor="req-q">Quantity ({pick.supplier.unitLabel})</label>
          <input id="req-q" className="input num" inputMode="numeric" value={qty} onChange={(e) => setQty(e.target.value.replace(/\D/g, ''))} aria-invalid={n < pick.supplier.minQty || n > pick.supplier.available} />
          <span className="hint">Minimum {pick.supplier.minQty}, up to {pick.supplier.available}.</span>
        </div>
        <TextArea label="Note to the supplier (optional)" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="When you need it, pickup plans…" />
        <p className="xsmall faint">The supplier can accept all or part of the request. Stock moves into your inventory when you confirm receipt. Settlement happens directly between stores in the beta.</p>
      </div>
    </Modal>
  );
}

export function StoreOrderDetail() {
  return <WithStore>{(store) => <Detail store={store} />}</WithStore>;
}
function Detail({ store }: { store: any }) {
  const { id } = useParams();
  const { data: so, error, reload, setData } = useApi<any>(`/store-orders/${id}`, { storeId: store.id });
  const [dialog, setDialog] = useState<null | 'accepted' | 'rejected' | 'ready' | 'cancelled'>(null);
  const [qty, setQty] = useState<Record<string, string>>({});
  const [note, setNote] = useState('');
  const move = useAction(async (status: string, withQty = false) => {
    const quantities = withQty ? Object.fromEntries(Object.entries(qty).map(([k, v]) => [k, Number(v)])) : undefined;
    setData(await api.post(`/store-orders/${id}/transition`, { storeId: store.id, status, note: note || undefined, quantities }));
    setDialog(null);
    setNote('');
  }, { success: 'Request updated' });
  useEffect(() => {
    if (so) setQty(Object.fromEntries(so.items.map((i: any) => [i.id, String(dialog === 'ready' ? i.acceptedQty ?? i.requestedQty : i.requestedQty)])));
  }, [so, dialog]);
  if (error) return <ErrorNote error={error} onRetry={reload} />;
  if (!so) return <LoadingBlock />;
  const failed = ['rejected', 'cancelled'].includes(so.status);
  const other = so.viewerRole === 'buyer' ? so.seller : so.buyer;
  const can = (s: string) => so.allowedTransitions.includes(s);
  return (
    <>
      <Link to="/merchant/store-orders" className="small row tight"><Icon name="back" className="icon sm" /> Store-to-store</Link>
      <PageHead title={`Request ${so.number}`} sub={so.viewerRole === 'buyer' ? `You requested stock from ${so.seller.name}` : `${so.buyer.name} requested stock from you`} actions={<StatusBadge status={so.status} />} />
      <div className="card pad stack">
        {!failed ? <Steps steps={S2S_STEPS} current={so.status === 'submitted' ? 'pending_acceptance' : so.status} /> : <div className="alert bad">This request was {so.status}.{so.sellerNotes ? ` Supplier note: “${so.sellerNotes}”` : ''}</div>}
        <div className="row">
          {can('submitted') && <button className="btn primary" onClick={() => move.run('submitted')}>Send request</button>}
          {can('accepted') && <button className="btn primary" onClick={() => setDialog('accepted')}>Accept…</button>}
          {can('rejected') && <button className="btn danger" onClick={() => setDialog('rejected')}>Decline</button>}
          {can('preparing') && <button className="btn primary" onClick={() => move.run('preparing')}>Start preparing</button>}
          {can('ready') && <button className="btn primary" onClick={() => setDialog('ready')}>Mark ready for handoff…</button>}
          {can('completed') && <button className="btn primary" onClick={() => move.run('completed')}>Confirm received</button>}
          {can('cancelled') && <button className="btn ghost danger" onClick={() => setDialog('cancelled')}>Cancel request</button>}
          {so.allowedTransitions.length === 0 && !failed && so.status !== 'completed' && <span className="small muted">Waiting on {other.name}.</span>}
        </div>
      </div>
      <div className="grid cols-2" style={{ alignItems: 'start' }}>
        <div className="card">
          <div className="card-h"><h3>Items</h3><span className="num">{usd(so.subtotalCents)}</span></div>
          <table className="t">
            <thead><tr><th>Item</th><th className="r">Requested</th><th className="r">Accepted</th><th className="r">Handed over</th><th className="r">Unit</th></tr></thead>
            <tbody>{so.items.map((i: any) => <tr key={i.id}><td>{i.productName}</td><td className="r num">{i.requestedQty}</td><td className="r num">{i.acceptedQty ?? '—'}</td><td className="r num">{i.fulfilledQty ?? '—'}</td><td className="r num">{usd(i.unitPriceCents)}<div className="xsmall faint">/{i.unitLabel}</div></td></tr>)}</tbody>
          </table>
          {(so.buyerNotes || so.sellerNotes) && (
            <div className="card-b stack tight" style={{ borderTop: '1px solid var(--line)' }}>
              {so.buyerNotes && <div className="small"><strong>{so.buyer.name}:</strong> {so.buyerNotes}</div>}
              {so.sellerNotes && <div className="small"><strong>{so.seller.name}:</strong> {so.sellerNotes}</div>}
            </div>
          )}
        </div>
        <div className="stack">
          <div className="card pad stack tight">
            <h3>{so.viewerRole === 'buyer' ? 'Supplier' : 'Requesting store'}</h3>
            <strong>{other.name}</strong>
            <span className="small muted">{other.addressLine1}, {other.city}, {other.state}</span>
            {other.phone && <span className="small mono" style={{ userSelect: 'all' }}>{other.phone}</span>}
          </div>
          <div className="card pad stack tight">
            <h3>History</h3>
            <Timeline items={so.history.map((h: any) => ({ title: title(h.toStatus), sub: h.note ?? undefined, at: dateTime(h.createdAt), state: ['rejected', 'cancelled'].includes(h.toStatus) ? 'bad' : 'done' }))} />
          </div>
        </div>
      </div>
      {(dialog === 'accepted' || dialog === 'ready') && (
        <Modal title={dialog === 'accepted' ? 'Accept request' : 'Hand over stock'} onClose={() => setDialog(null)} footer={<><button className="btn" onClick={() => setDialog(null)}>Cancel</button><button className="btn primary" disabled={move.busy} onClick={() => move.run(dialog, true)}>{dialog === 'accepted' ? 'Accept' : 'Mark ready'}</button></>}>
          <div className="stack">
            <p className="small muted">{dialog === 'accepted' ? 'Adjust quantities if you can only fill part of the request. The requesting store is notified.' : 'Enter what you are actually handing over. These units leave your inventory now.'}</p>
            {so.items.map((i: any) => (
              <div key={i.id} className="row between">
                <span className="grow">{i.productName}<div className="xsmall faint">{dialog === 'accepted' ? `requested ${i.requestedQty}` : `accepted ${i.acceptedQty ?? i.requestedQty}`}</div></span>
                <input className="input sm num" style={{ width: 90, textAlign: 'right' }} inputMode="numeric" aria-label={`Quantity for ${i.productName}`} value={qty[i.id] ?? ''} onChange={(e) => setQty({ ...qty, [i.id]: e.target.value.replace(/\D/g, '') })} />
              </div>
            ))}
            <TextArea label="Note (optional)" rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
          </div>
        </Modal>
      )}
      {(dialog === 'rejected' || dialog === 'cancelled') && (
        <Modal title={dialog === 'rejected' ? 'Decline request' : 'Cancel request'} onClose={() => setDialog(null)} footer={<><button className="btn" onClick={() => setDialog(null)}>Back</button><button className="btn danger solid" disabled={move.busy || !note.trim()} onClick={() => move.run(dialog)}>{dialog === 'rejected' ? 'Decline' : 'Cancel request'}</button></>}>
          <TextArea label={`Reason shared with ${other.name}`} rows={3} value={note} onChange={(e) => setNote(e.target.value)} />
        </Modal>
      )}
    </>
  );
}
