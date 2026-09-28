import { Fragment, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../api';
import { toast } from '../../state/store';
import { useAction, useApi, useDebounced } from '../../lib/hooks';
import { dateTime, label, when } from '../../lib/format';
import { Icon } from '../../ui/icons';
import { Empty, ErrorNote, LoadingBlock, Modal, Pager, ProductArt, SelectField, StatusBadge, StockPill, TextArea, TextField, usd } from '../../ui/kit';
import { PageHead, WithStore } from './Merchant';

const dollars = (c: number | null | undefined) => (c == null ? '' : (c / 100).toFixed(2));
const cents = (s: string) => (s.trim() === '' ? null : Math.round(Number(s.replace(/[$,]/g, '')) * 100));

function useCategories() {
  const { data } = useApi<any[]>('/categories');
  return useMemo(() => (data ?? []).flatMap((c) => c.children.map((x: any) => ({ ...x, group: c.name }))), [data]);
}

// ─── Products ───────────────────────────────────────────────────────────
export function MerchantProducts() {
  return <WithStore>{(store) => <Products store={store} />}</WithStore>;
}
function Products({ store }: { store: any }) {
  const [q, setQ] = useState('');
  const dq = useDebounced(q);
  const [page, setPage] = useState(1);
  const [adding, setAdding] = useState(false);
  const [csv, setCsv] = useState(false);
  useEffect(() => setPage(1), [dq]);
  const { data, error, reload } = useApi<any>(`/merchant/stores/${store.id}/inventory`, { q: dq || undefined, page, pageSize: 24 });
  const toggle = useAction(async (row: any) => { await api.patch(`/merchant/stores/${store.id}/inventory/${row.id}`, { visible: !row.visible }); await reload(); }, { success: 'Visibility updated' });
  return (
    <>
      <PageHead title="Products" sub="Your store's catalog. Products link to the shared RetailGeo catalog so shoppers can compare stores." actions={<><button className="btn" onClick={() => setCsv(true)}><Icon name="upload" className="icon sm" /> Bulk upload</button><button className="btn primary" onClick={() => setAdding(true)}><Icon name="plus" className="icon sm" /> Add product</button></>} />
      <input className="input" placeholder="Search by name, SKU, UPC or store SKU" aria-label="Search products" value={q} onChange={(e) => setQ(e.target.value)} style={{ maxWidth: 420 }} />
      <ErrorNote error={error} onRetry={reload} />
      {!data ? <LoadingBlock /> : data.items.length === 0 ? <div className="card"><Empty icon="box" title="No products found" action={<button className="btn primary" onClick={() => setAdding(true)}>Add your first product</button>} /></div> : (
        <div className="table-wrap">
          <table className="t">
            <thead><tr><th>Product</th><th>Category</th><th>SKU / UPC</th><th className="r">Price</th><th>Stock</th><th>Shown to shoppers</th></tr></thead>
            <tbody>
              {data.items.map((r: any) => (
                <tr key={r.id}>
                  <td>
                    <div className="row nowrap" style={{ gap: 10 }}>
                      <div style={{ width: 40, borderRadius: 6, overflow: 'hidden', flex: 'none' }}><ProductArt name={r.product.name} category={r.category} ratio="1 / 1" /></div>
                      <div style={{ minWidth: 0 }}><Link className="rowlink" to={`/product/${r.product.id}`}>{r.product.name}</Link><div className="xsmall faint">{[r.brand, r.product.size].filter(Boolean).join(' · ')}</div></div>
                    </div>
                  </td>
                  <td className="small">{r.category}</td>
                  <td className="mono xsmall">{r.product.sku}<div className="faint">{r.product.upc ?? '—'}</div></td>
                  <td className="r num">{usd(r.promoPriceCents ?? r.priceCents)}{r.promoPriceCents && <div className="xsmall faint" style={{ textDecoration: 'line-through' }}>{usd(r.priceCents)}</div>}</td>
                  <td><StockPill status={r.stockStatus} qty={r.quantity} showQty /></td>
                  <td><label className="check" style={{ alignItems: 'center' }}><input type="checkbox" checked={r.visible} onChange={() => toggle.run(r)} aria-label={`Show ${r.product.name} to shoppers`} />{r.visible ? 'Visible' : 'Hidden'}</label></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {data && <Pager page={data.page} totalPages={data.totalPages} total={data.total} onPage={setPage} noun="products" />}
      {adding && <AddProduct storeId={store.id} onClose={() => setAdding(false)} onDone={reload} />}
      {csv && <CsvImport storeId={store.id} onClose={() => setCsv(false)} onDone={reload} />}
    </>
  );
}

function AddProduct({ storeId, onClose, onDone }: { storeId: string; onClose: () => void; onDone: () => void }) {
  const cats = useCategories();
  const [f, setF] = useState({ name: '', brand: '', categoryId: '', upc: '', sku: '', size: '', unit: 'each', description: '', price: '', quantity: '10', low: '5', variants: '' });
  const save = useAction(async () => {
    const r = await api.post(`/merchant/stores/${storeId}/products`, {
      name: f.name, brand: f.brand || undefined, categoryId: f.categoryId, upc: f.upc || undefined, sku: f.sku, size: f.size || undefined, unit: f.unit,
      description: f.description,
      variants: f.variants.split(',').map((v) => v.trim()).filter(Boolean).map((v, i) => ({ name: v, sku: `${f.sku}-V${i + 1}` })),
      listing: { priceCents: cents(f.price) ?? 0, quantity: Number(f.quantity) || 0, lowStockThreshold: Number(f.low) || 0 },
    });
    toast({ tone: 'ok', title: r.reusedCatalogEntry ? 'Listed an existing catalog product' : 'Product added', body: r.reusedCatalogEntry ? `UPC matched “${r.product.name}”, so shoppers can compare your price with other stores.` : r.product.name });
    onDone();
    onClose();
  });
  const e = save.error?.fields ?? {};
  return (
    <Modal title="Add a product" wide onClose={onClose} footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" disabled={save.busy} onClick={() => save.run()}>Add product</button></>}>
      <div className="stack">
        <div className="alert info small"><Icon name="info" className="icon sm" /><span>Enter the UPC from the package first. If the product is already in the RetailGeo catalog we'll reuse it, so you only set your price and stock.</span></div>
        {save.error && !Object.keys(e).length && <div className="alert bad">{save.error.message}</div>}
        <div className="form-grid">
          <TextField label="UPC / barcode" inputMode="numeric" value={f.upc} onChange={(x) => setF({ ...f, upc: x.target.value.replace(/\D/g, '') })} error={e.upc} hint="8–14 digits" />
          <TextField label="SKU" value={f.sku} onChange={(x) => setF({ ...f, sku: x.target.value })} error={e.sku} hint="Your product code" />
          <TextField label="Product name" wrapClass="span-2" value={f.name} onChange={(x) => setF({ ...f, name: x.target.value })} error={e.name} />
          <TextField label="Brand" value={f.brand} onChange={(x) => setF({ ...f, brand: x.target.value })} />
          <SelectField label="Category" value={f.categoryId} onChange={(x) => setF({ ...f, categoryId: x.target.value })} error={e.categoryId}>
            <option value="">Choose…</option>
            {Object.entries(cats.reduce<Record<string, any[]>>((a, c) => ((a[c.group] = [...(a[c.group] ?? []), c]), a), {})).map(([g, cs]) => (
              <optgroup key={g} label={g}>{cs.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</optgroup>
            ))}
          </SelectField>
          <TextField label="Size" placeholder="e.g. 20 fl oz" value={f.size} onChange={(x) => setF({ ...f, size: x.target.value })} />
          <SelectField label="Sold by" value={f.unit} onChange={(x) => setF({ ...f, unit: x.target.value })}>{['each', 'pack', 'case', 'lb', 'bottle', 'box'].map((u) => <option key={u}>{u}</option>)}</SelectField>
          <TextArea label="Description" wrapClass="span-2" rows={2} value={f.description} onChange={(x) => setF({ ...f, description: x.target.value })} />
          <TextField label="Variants (optional)" wrapClass="span-2" placeholder="Comma-separated, e.g. Small, Medium, Large" value={f.variants} onChange={(x) => setF({ ...f, variants: x.target.value })} />
          <TextField label="Your price ($)" inputMode="decimal" value={f.price} onChange={(x) => setF({ ...f, price: x.target.value })} error={e['listing.priceCents']} />
          <TextField label="Quantity on hand" inputMode="numeric" value={f.quantity} onChange={(x) => setF({ ...f, quantity: x.target.value })} error={e['listing.quantity']} />
          <TextField label="Low-stock alert at" inputMode="numeric" value={f.low} onChange={(x) => setF({ ...f, low: x.target.value })} />
        </div>
      </div>
    </Modal>
  );
}

const SAMPLE_CSV = 'sku,upc,price,quantity,promo_price,name,category,brand,size\nRG-GRO-101,,5.79,48,,,,,\n,084000310215,2.19,30,1.99,,,,\nLOCAL-TAMALES-12,,11.99,20,,Pork Tamales 12-Pack,Frozen & Ice,Abuela Rosa,12 ct\n';

function CsvImport({ storeId, onClose, onDone }: { storeId: string; onClose: () => void; onDone: () => void }) {
  const [text, setText] = useState('');
  const [preview, setPreview] = useState<any>(null);
  const run = useAction(async (dryRun: boolean) => {
    const r = await api.post(`/merchant/stores/${storeId}/inventory/import`, { csv: text, dryRun });
    setPreview(r);
    if (!dryRun) {
      toast({ tone: 'ok', title: 'Import complete', body: `${r.summary.updated} updated · ${r.summary.created} added · ${r.summary.skipped} skipped` });
      onDone();
    }
  });
  const onFile = (file: File | undefined) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => { setText(String(reader.result)); setPreview(null); };
    reader.readAsText(file);
  };
  return (
    <Modal title="Bulk upload from CSV" wide onClose={onClose} footer={<><button className="btn" onClick={onClose}>Close</button><button className="btn" disabled={!text || run.busy} onClick={() => run.run(true)}>Check file</button><button className="btn primary" disabled={!preview?.dryRun || run.busy} onClick={() => run.run(false)}>Import {preview?.dryRun ? `${preview.summary.updated + preview.summary.created} rows` : ''}</button></>}>
      <div className="stack">
        <p className="small muted">Columns: <span className="mono">sku</span> or <span className="mono">upc</span>, plus <span className="mono">price</span> and/or <span className="mono">quantity</span>. Optional: promo_price, low_stock_threshold, visible. To add a new product also include name, category and brand. Check the file first; nothing changes until you import.</p>
        <div className="row">
          <label className="btn"><Icon name="upload" className="icon sm" /> Choose CSV file<input type="file" accept=".csv,text/csv" className="sr-only" onChange={(e) => onFile(e.target.files?.[0])} /></label>
          <button className="btn ghost" onClick={() => { setText(SAMPLE_CSV); setPreview(null); }}>Use sample rows</button>
        </div>
        <TextArea label="CSV contents" rows={6} value={text} onChange={(e) => { setText(e.target.value); setPreview(null); }} className="mono" style={{ fontFamily: 'var(--font-mono)', fontSize: '0.8rem' }} />
        {preview && (
          <div className="stack tight">
            <div className="row tight"><span className="badge ok">{preview.summary.updated} update</span><span className="badge info">{preview.summary.created} new</span><span className={`badge ${preview.summary.skipped ? 'bad' : ''}`}>{preview.summary.skipped} skipped</span>{!preview.dryRun && <span className="badge brand">Imported</span>}</div>
            <div className="table-wrap" style={{ maxHeight: 240, overflowY: 'auto' }}>
              <table className="t"><thead><tr><th>Row</th><th>SKU / UPC</th><th>Result</th><th>Detail</th></tr></thead>
                <tbody>{preview.results.map((r: any) => <tr key={r.row}><td className="num">{r.row}</td><td className="mono xsmall">{r.sku}</td><td><span className={`badge ${r.action === 'skipped' ? 'bad' : r.action === 'created' ? 'info' : 'ok'}`}>{r.action}</span></td><td className="small">{r.message}</td></tr>)}</tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}

// ─── Inventory ──────────────────────────────────────────────────────────
export function MerchantInventory() {
  return <WithStore>{(store) => <Inventory store={store} />}</WithStore>;
}
function Inventory({ store }: { store: any }) {
  const [status, setStatus] = useState('');
  const [q, setQ] = useState('');
  const dq = useDebounced(q);
  const [page, setPage] = useState(1);
  const [edit, setEdit] = useState<any>(null);
  const [hist, setHist] = useState<any>(null);
  const [draft, setDraft] = useState<Record<string, string>>({});
  useEffect(() => setPage(1), [status, dq]);
  const { data, error, reload } = useApi<any>(`/merchant/stores/${store.id}/inventory`, { status: status || undefined, q: dq || undefined, page, pageSize: 50 });
  const saveQty = useAction(async (row: any) => {
    const v = Number(draft[row.id]);
    if (!Number.isInteger(v) || v < 0) throw new Error('Quantity must be a whole number, 0 or more.');
    await api.patch(`/merchant/stores/${store.id}/inventory/${row.id}`, { quantity: v, reason: 'stock count' });
    setDraft((d) => { const n = { ...d }; delete n[row.id]; return n; });
    await reload();
  }, { success: 'Stock updated' });
  const s = data?.summary;
  return (
    <>
      <PageHead title="Inventory" sub="Keep counts current. Listings older than 7 days are flagged to shoppers as possibly out of date." actions={<Link to="/merchant/store-orders/new" className="btn"><Icon name="swap" className="icon sm" /> Source from nearby stores</Link>} />
      {s && (
        <div className="filters">
          {[['', `All ${s.total}`], ['in_stock', 'In stock'], ['low_stock', `Low ${s.lowStock}`], ['out_of_stock', `Out ${s.outOfStock}`], ['stale', `Stale ${s.stale}`], ['hidden', 'Hidden'], ['b2b', 'Wholesale']].map(([k, l]) => <button key={k} className="chip" aria-pressed={status === k} onClick={() => setStatus(k)}>{l}</button>)}
          <input className="input sm" style={{ width: 220, marginLeft: 'auto' }} placeholder="Find product or SKU" aria-label="Find product or SKU" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
      )}
      <ErrorNote error={error} onRetry={reload} />
      {!data ? <LoadingBlock /> : (
        <div className="table-wrap">
          <table className="t">
            <thead><tr><th>Product</th><th>Status</th><th className="r">On hand</th><th className="r">Price</th><th>Wholesale</th><th>Updated</th><th className="r"><span className="sr-only">Actions</span></th></tr></thead>
            <tbody>
              {data.items.map((r: any) => (
                <tr key={r.id}>
                  <td><strong>{r.product.name}</strong><div className="xsmall faint mono">{r.product.sku}{r.storeSku ? ` · ${r.storeSku}` : ''}</div></td>
                  <td><StockPill status={r.stockStatus} />{!r.visible && <div className="xsmall faint">Hidden</div>}</td>
                  <td className="r">
                    <div className="row tight nowrap" style={{ justifyContent: 'flex-end' }}>
                      <input className="input sm inline-edit num" style={{ width: 76, textAlign: 'right' }} aria-label={`Quantity of ${r.product.name}`} value={draft[r.id] ?? String(r.quantity)} onChange={(e) => setDraft({ ...draft, [r.id]: e.target.value.replace(/\D/g, '') })} onKeyDown={(e) => e.key === 'Enter' && saveQty.run(r)} />
                      {draft[r.id] !== undefined && draft[r.id] !== String(r.quantity) && <button className="btn sm primary" onClick={() => saveQty.run(r)}>Save</button>}
                    </div>
                    <div className="xsmall faint">alert at {r.lowStockThreshold}</div>
                  </td>
                  <td className="r num">{usd(r.priceCents)}{r.promoPriceCents != null && <div className="xsmall" style={{ color: 'var(--amber-text)' }}>sale {usd(r.promoPriceCents)}</div>}</td>
                  <td className="small">{r.b2bEnabled ? <span className="badge brand">{usd(r.b2bPriceCents)} / {r.b2bUnit} · min {r.b2bMinQty}</span> : <span className="faint">Off</span>}</td>
                  <td className="small" style={{ color: r.stale ? 'var(--warn)' : undefined }}>{when(r.updatedAt)}{r.stale && <div className="xsmall">Needs a recount</div>}<div className="xsmall faint">{label(r.source)}</div></td>
                  <td className="r"><div className="row tight nowrap" style={{ justifyContent: 'flex-end' }}><button className="btn sm" onClick={() => setEdit(r)}>Edit</button><button className="btn sm ghost" onClick={() => setHist(r)}>History</button></div></td>
                </tr>
              ))}
            </tbody>
          </table>
          {data.items.length === 0 && <Empty title="No listings match" />}
        </div>
      )}
      {data && <Pager page={data.page} totalPages={data.totalPages} total={data.total} onPage={setPage} noun="listings" />}
      {edit && <EditListing storeId={store.id} row={edit} onClose={() => setEdit(null)} onDone={reload} />}
      {hist && <History storeId={store.id} row={hist} onClose={() => setHist(null)} />}
    </>
  );
}

function EditListing({ storeId, row, onClose, onDone }: { storeId: string; row: any; onClose: () => void; onDone: () => void }) {
  const [f, setF] = useState({ price: dollars(row.priceCents), promo: dollars(row.promoPriceCents), quantity: String(row.quantity), low: String(row.lowStockThreshold), max: row.maxOrderQty ? String(row.maxOrderQty) : '', visible: row.visible, b2b: row.b2bEnabled, b2bPrice: dollars(row.b2bPriceCents), b2bMin: String(row.b2bMinQty), b2bUnit: row.b2bUnit, storeSku: row.storeSku ?? '' });
  const save = useAction(async () => {
    await api.patch(`/merchant/stores/${storeId}/inventory/${row.id}`, {
      priceCents: cents(f.price) ?? undefined, promoPriceCents: cents(f.promo), quantity: Number(f.quantity), lowStockThreshold: Number(f.low),
      maxOrderQty: f.max ? Number(f.max) : null, visible: f.visible, storeSku: f.storeSku || null,
      b2bEnabled: f.b2b, b2bPriceCents: f.b2b ? cents(f.b2bPrice) : null, b2bMinQty: Number(f.b2bMin) || 1, b2bUnit: f.b2bUnit || 'each', reason: 'listing edit',
    });
    onDone();
    onClose();
  }, { success: 'Listing saved' });
  const e = save.error?.fields ?? {};
  return (
    <Modal title={row.product.name} onClose={onClose} footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" disabled={save.busy} onClick={() => save.run()}>Save</button></>}>
      <div className="stack">
        {save.error && !Object.keys(e).length && <div className="alert bad">{save.error.message}</div>}
        <div className="form-grid">
          <TextField label="Regular price ($)" inputMode="decimal" value={f.price} onChange={(x) => setF({ ...f, price: x.target.value })} error={e.priceCents} />
          <TextField label="Sale price ($)" hint="Leave blank for none" inputMode="decimal" value={f.promo} onChange={(x) => setF({ ...f, promo: x.target.value })} error={e.promoPriceCents} />
          <TextField label="On hand" inputMode="numeric" value={f.quantity} onChange={(x) => setF({ ...f, quantity: x.target.value })} error={e.quantity} />
          <TextField label="Low-stock alert at" inputMode="numeric" value={f.low} onChange={(x) => setF({ ...f, low: x.target.value })} />
          <TextField label="Limit per order" hint="Blank = no limit" inputMode="numeric" value={f.max} onChange={(x) => setF({ ...f, max: x.target.value })} />
          <TextField label="Store SKU" value={f.storeSku} onChange={(x) => setF({ ...f, storeSku: x.target.value })} />
        </div>
        <label className="check"><input type="checkbox" checked={f.visible} onChange={(x) => setF({ ...f, visible: x.target.checked })} /> Show this product to shoppers</label>
        <fieldset className="panel stack tight" style={{ border: 0 }}>
          <label className="check"><input type="checkbox" checked={f.b2b} onChange={(x) => setF({ ...f, b2b: x.target.checked })} /> <span><strong>Offer to other stores (wholesale)</strong><br /><span className="xsmall faint">Nearby RetailGeo stores can request this item. You approve every request.</span></span></label>
          {f.b2b && (
            <div className="form-grid">
              <TextField label="Wholesale price ($)" inputMode="decimal" value={f.b2bPrice} onChange={(x) => setF({ ...f, b2bPrice: x.target.value })} error={e.b2bPriceCents} />
              <TextField label="Minimum request" inputMode="numeric" value={f.b2bMin} onChange={(x) => setF({ ...f, b2bMin: x.target.value })} />
              <TextField label="Unit" value={f.b2bUnit} onChange={(x) => setF({ ...f, b2bUnit: x.target.value })} hint="e.g. pack, case, each" />
            </div>
          )}
        </fieldset>
      </div>
    </Modal>
  );
}

function History({ storeId, row, onClose }: { storeId: string; row: any; onClose: () => void }) {
  const { data } = useApi<any[]>(`/merchant/stores/${storeId}/inventory/${row.id}/history`);
  return (
    <Modal title={`Stock history: ${row.product.name}`} onClose={onClose}>
      {!data ? <LoadingBlock /> : (
        <table className="t"><thead><tr><th>When</th><th className="r">Change</th><th className="r">After</th><th>Reason</th></tr></thead>
          <tbody>{data.map((e) => <tr key={e.id}><td className="small">{dateTime(e.createdAt)}</td><td className="r num" style={{ color: e.delta < 0 ? 'var(--bad)' : 'var(--ok)' }}>{e.delta > 0 ? '+' : ''}{e.delta}</td><td className="r num">{e.quantityAfter}</td><td className="small">{e.reason}<div className="xsmall faint">{label(e.source)}</div></td></tr>)}</tbody>
        </table>
      )}
    </Modal>
  );
}

// ─── Offers ─────────────────────────────────────────────────────────────
export function MerchantOffers() {
  return <WithStore>{(store) => <OffersPage store={store} />}</WithStore>;
}
function OffersPage({ store }: { store: any }) {
  const { data, reload } = useApi<any[]>(`/merchant/stores/${store.id}/offers`);
  const [edit, setEdit] = useState<any>(null);
  const toggle = useAction(async (o: any) => { await api.post(`/merchant/stores/${store.id}/offers/${o.id}/status`, { status: o.status === 'active' ? 'paused' : 'active' }); await reload(); }, { success: 'Offer updated' });
  const kind = (o: any) => (o.discountType === 'percent' ? `${o.discountValue}% off` : o.discountType === 'fixed' ? `${usd(o.discountValue)} off each` : `Buy ${o.buyQty} get ${o.getQty}`);
  return (
    <>
      <PageHead title="Offers" sub="Discounts apply automatically at checkout. Shoppers nearby see them on your store page and in Deals." actions={<button className="btn primary" onClick={() => setEdit({})}><Icon name="plus" className="icon sm" /> New offer</button>} />
      {!data ? <LoadingBlock /> : data.length === 0 ? <div className="card"><Empty icon="tag" title="No offers yet" action={<button className="btn primary" onClick={() => setEdit({})}>Create an offer</button>} /></div> : (
        <div className="table-wrap">
          <table className="t">
            <thead><tr><th>Offer</th><th>Applies to</th><th>Discount</th><th>Runs</th><th className="r">Used</th><th>Status</th><th className="r"><span className="sr-only">Actions</span></th></tr></thead>
            <tbody>
              {data.map((o) => (
                <tr key={o.id}>
                  <td><strong>{o.name}</strong><div className="xsmall faint">{o.eligibility === 'new_customer' ? 'First order only' : 'All shoppers'}{o.geoRadiusMi ? ` · within ${o.geoRadiusMi} mi` : ''}</div></td>
                  <td className="small">{o.scope === 'store' ? 'Whole store' : o.scope === 'category' ? `Category: ${o.categoryName}` : o.productName}</td>
                  <td className="small">{kind(o)}</td>
                  <td className="small">{new Date(o.startAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} – {new Date(o.endAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</td>
                  <td className="r num">{o.usageCount}{o.usageLimit ? ` / ${o.usageLimit}` : ''}</td>
                  <td><StatusBadge status={o.effectiveStatus} /></td>
                  <td className="r"><div className="row tight nowrap" style={{ justifyContent: 'flex-end' }}><button className="btn sm" onClick={() => setEdit(o)}>Edit</button>{['active', 'paused'].includes(o.status) && o.effectiveStatus !== 'expired' && <button className="btn sm ghost" onClick={() => toggle.run(o)}>{o.status === 'active' ? 'Pause' : 'Resume'}</button>}</div></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {edit && <OfferForm store={store} offer={edit} onClose={() => setEdit(null)} onDone={reload} />}
    </>
  );
}

function OfferForm({ store, offer, onClose, onDone }: { store: any; offer: any; onClose: () => void; onDone: () => void }) {
  const cats = useCategories();
  const inv = useApi<any>(`/merchant/stores/${store.id}/inventory`, { pageSize: 100 });
  const today = new Date().toISOString().slice(0, 10);
  const inTwoWeeks = new Date(Date.now() + 14 * 86400000).toISOString().slice(0, 10);
  const [f, setF] = useState({
    name: offer.name ?? '', description: offer.description ?? '', scope: offer.scope ?? 'product', productId: offer.productId ?? '', categoryId: offer.categoryId ?? '',
    discountType: offer.discountType ?? 'percent', value: offer.discountType === 'fixed' ? dollars(offer.discountValue) : String(offer.discountValue ?? 10), buyQty: String(offer.buyQty ?? 1), getQty: String(offer.getQty ?? 1),
    start: (offer.startAt ?? today).slice(0, 10), end: (offer.endAt ?? inTwoWeeks).slice(0, 10), eligibility: offer.eligibility ?? 'all', geo: offer.geoRadiusMi ? String(offer.geoRadiusMi) : '', limit: offer.usageLimit ? String(offer.usageLimit) : '', status: offer.status === 'draft' ? 'draft' : 'active',
  });
  const save = useAction(async () => {
    const body = {
      name: f.name, description: f.description, scope: f.scope, productId: f.scope === 'product' ? f.productId || null : null, categoryId: f.scope === 'category' ? f.categoryId || null : null,
      discountType: f.discountType, discountValue: f.discountType === 'fixed' ? cents(f.value) ?? 0 : f.discountType === 'percent' ? Number(f.value) : 0,
      buyQty: f.discountType === 'bxgy' ? Number(f.buyQty) : null, getQty: f.discountType === 'bxgy' ? Number(f.getQty) : null,
      startAt: new Date(`${f.start}T00:00:00`).toISOString(), endAt: new Date(`${f.end}T23:59:00`).toISOString(), eligibility: f.eligibility,
      geoRadiusMi: f.geo ? Number(f.geo) : null, usageLimit: f.limit ? Number(f.limit) : null, status: f.status,
    };
    if (offer.id) await api.put(`/merchant/stores/${store.id}/offers/${offer.id}`, body);
    else await api.post(`/merchant/stores/${store.id}/offers`, body);
    onDone();
    onClose();
  }, { success: offer.id ? 'Offer saved' : 'Offer created' });
  const e = save.error?.fields ?? {};
  return (
    <Modal title={offer.id ? 'Edit offer' : 'New offer'} wide onClose={onClose} footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" disabled={save.busy} onClick={() => save.run()}>{offer.id ? 'Save offer' : 'Create offer'}</button></>}>
      <div className="form-grid">
        <TextField label="Offer name" wrapClass="span-2" value={f.name} onChange={(x) => setF({ ...f, name: x.target.value })} error={e.name} placeholder="e.g. Weekend water sale" />
        <TextField label="Short description" wrapClass="span-2" value={f.description} onChange={(x) => setF({ ...f, description: x.target.value })} />
        <SelectField label="Applies to" value={f.scope} onChange={(x) => setF({ ...f, scope: x.target.value })}><option value="product">One product</option><option value="category">A category</option><option value="store">Everything in the store</option></SelectField>
        {f.scope === 'product' && (
          <SelectField label="Product" value={f.productId} onChange={(x) => setF({ ...f, productId: x.target.value })} error={e.productId}>
            <option value="">Choose…</option>
            {(inv.data?.items ?? []).map((r: any) => <option key={r.id} value={r.product.id}>{r.product.name} ({usd(r.priceCents)})</option>)}
          </SelectField>
        )}
        {f.scope === 'category' && (
          <SelectField label="Category" value={f.categoryId} onChange={(x) => setF({ ...f, categoryId: x.target.value })} error={e.categoryId}>
            <option value="">Choose…</option>{cats.map((c) => <option key={c.id} value={c.id}>{c.group} › {c.name}</option>)}
          </SelectField>
        )}
        <SelectField label="Discount type" value={f.discountType} onChange={(x) => setF({ ...f, discountType: x.target.value })}><option value="percent">Percent off</option><option value="fixed">Dollar amount off each</option><option value="bxgy">Buy X, get Y free</option></SelectField>
        {f.discountType === 'bxgy' ? (
          <Fragment>
            <TextField label="Buy" inputMode="numeric" value={f.buyQty} onChange={(x) => setF({ ...f, buyQty: x.target.value })} error={e.buyQty} />
            <TextField label="Get free" inputMode="numeric" value={f.getQty} onChange={(x) => setF({ ...f, getQty: x.target.value })} />
          </Fragment>
        ) : <TextField label={f.discountType === 'percent' ? 'Percent off' : 'Amount off ($)'} inputMode="decimal" value={f.value} onChange={(x) => setF({ ...f, value: x.target.value })} error={e.discountValue} />}
        <TextField label="Starts" type="date" value={f.start} onChange={(x) => setF({ ...f, start: x.target.value })} error={e.startAt} />
        <TextField label="Ends" type="date" value={f.end} onChange={(x) => setF({ ...f, end: x.target.value })} error={e.endAt} />
        <SelectField label="Who can use it" value={f.eligibility} onChange={(x) => setF({ ...f, eligibility: x.target.value })}><option value="all">All shoppers</option><option value="new_customer">First order at your store</option></SelectField>
        <TextField label="Only for shoppers within (mi)" hint="Optional geographic promotion" inputMode="numeric" value={f.geo} onChange={(x) => setF({ ...f, geo: x.target.value })} error={e.geoRadiusMi} />
        <TextField label="Total uses allowed" hint="Optional" inputMode="numeric" value={f.limit} onChange={(x) => setF({ ...f, limit: x.target.value })} />
        <SelectField label="Publish" value={f.status} onChange={(x) => setF({ ...f, status: x.target.value })}><option value="active">Active on the start date</option><option value="draft">Save as draft</option></SelectField>
      </div>
    </Modal>
  );
}
