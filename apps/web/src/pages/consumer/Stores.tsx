import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { STORE_TYPES } from '@retailgeo/core';
import { api } from '../../api';
import { useCart, useLocation as useSearchLocation, useSession, toast } from '../../state/store';
import { track, useAction, useApi, useDebounced } from '../../lib/hooks';
import { MapView } from '../../map/MapView';
import { Icon } from '../../ui/icons';
import { Distance, Empty, ErrorNote, LoadingBlock, OfferTag, Pager, Price, ProductArt, StockPill, StoreTypeBadge, storeTypeLabel, Skeleton, usd } from '../../ui/kit';
import { DAY, miles, time12 } from '../../lib/format';

export function Stores() {
  const { location, radius: r0 } = useSearchLocation();
  const [params, setParams] = useSearchParams();
  const [radius, setRadius] = useState(r0);
  const [types, setTypes] = useState<string[]>(params.get('type')?.split(',').filter(Boolean) ?? []);
  const [openNow, setOpenNow] = useState(false);
  const [q, setQ] = useState('');
  const dq = useDebounced(q);
  const [selected, setSelected] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const nav = useNavigate();
  useEffect(() => setPage(1), [radius, types, openNow, dq]);
  useEffect(() => setParams(types.length ? { type: types.join(',') } : {}, { replace: true }), [types, setParams]);
  const { data, loading, error, reload } = useApi<any>('/stores', { lat: location.lat, lng: location.lng, radius, type: types.join(','), openNow, q: dq, page, pageSize: 20 });
  const items: any[] = data?.items ?? [];

  return (
    <div className="wrap page stack">
      <div className="page-h">
        <div>
          <h1 style={{ fontSize: '1.7rem' }}>Stores near {location.label.split(',')[0]}</h1>
          <p className="small">{data ? `${data.total} participating stores within ${radius} miles` : 'Loading stores…'}</p>
        </div>
      </div>
      <div className="card pad stack tight" style={{ padding: 14 }}>
        <div className="filters">
          <label className="sr-only" htmlFor="st-q">Store name</label>
          <input id="st-q" className="input sm" style={{ width: 220 }} placeholder="Filter by store name" value={q} onChange={(e) => setQ(e.target.value)} />
          <label className="sr-only" htmlFor="st-r">Radius</label>
          <select id="st-r" className="select sm" style={{ width: 'auto' }} value={radius} onChange={(e) => setRadius(Number(e.target.value))}>
            {[2, 5, 10, 25, 50].map((r) => <option key={r} value={r}>Within {r} mi</option>)}
          </select>
          <button className="chip" aria-pressed={openNow} onClick={() => setOpenNow(!openNow)}><Icon name="clock" className="icon sm" /> Open now</button>
        </div>
        <div className="filters" aria-label="Store types">
          {STORE_TYPES.map((t) => {
            const on = types.includes(t);
            return <button key={t} className="chip" aria-pressed={on} onClick={() => setTypes(on ? types.filter((x) => x !== t) : [...types, t])}>{storeTypeLabel(t)}</button>;
          })}
        </div>
      </div>
      <ErrorNote error={error} onRetry={reload} />
      <div className="split">
        <div className="stack tight">
          <div className="card divider-list">
            {loading && !data && [0, 1, 2, 3].map((i) => <div key={i} style={{ padding: 14 }}><Skeleton h={40} /></div>)}
            {data && items.length === 0 && <Empty title="No stores match" action={<button className="btn" onClick={() => { setTypes([]); setOpenNow(false); setRadius(25); }}>Clear filters</button>}>Try a wider radius or fewer filters.</Empty>}
            {items.map((s) => (
              <Link key={s.id} to={`/store/${s.slug}`} className="srow" onMouseEnter={() => setSelected(s.slug)} style={selected === s.slug ? { background: 'var(--brand-soft)' } : undefined}>
                <StoreTypeBadge type={s.storeType} />
                <div style={{ minWidth: 0 }}>
                  <div className="name ellipsis">{s.name}</div>
                  <div className="small muted">{s.addressLine1}, {s.city}</div>
                  <div className="row tight xsmall" style={{ marginTop: 3 }}>
                    <span style={{ color: s.isOpen ? 'var(--ok)' : 'var(--ink-3)', fontWeight: 600 }}>{s.label}</span>
                    {s.offerCount > 0 && <span className="badge amber">{s.offerCount} offer{s.offerCount > 1 ? 's' : ''}</span>}
                    {s.deliveryEnabled && <span className="badge">Delivery</span>}
                    {s.verified && <span className="badge brand"><Icon name="check" className="icon sm" style={{ width: 12, height: 12 }} />Verified</span>}
                  </div>
                </div>
                <Distance mi={s.distanceMi} />
              </Link>
            ))}
          </div>
          {data && <Pager page={data.page} totalPages={data.totalPages} total={data.total} onPage={setPage} noun="stores" />}
        </div>
        <div className="sticky-map">
          <MapView
            ariaLabel="Map of stores"
            center={{ lat: location.lat, lng: location.lng }}
            radiusMi={radius}
            user={{ lat: location.lat, lng: location.lng }}
            selectedId={selected}
            onSelect={setSelected}
            markers={items.map((s) => ({ id: s.slug, lat: s.latitude, lng: s.longitude, title: `${s.name}, ${miles(s.distanceMi)}, ${s.label}`, kind: s.storeType }))}
            renderPopup={(m) => {
              const s = items.find((x) => x.slug === m.id);
              return (
                <div className="stack tight">
                  <strong>{s.name}</strong>
                  <span className="xsmall muted">{storeTypeLabel(s.storeType)} · {miles(s.distanceMi)} · {s.label}</span>
                  <button className="btn sm primary" onClick={() => nav(`/store/${s.slug}`)}>Open store</button>
                </div>
              );
            }}
          />
        </div>
      </div>
    </div>
  );
}

export function StorePage() {
  const { id } = useParams();
  const { location } = useSearchLocation();
  const user = useSession((s) => s.user);
  const nav = useNavigate();
  const store = useApi<any>(`/stores/${id}`, { lat: location.lat, lng: location.lng });
  const [cat, setCat] = useState('');
  const [q, setQ] = useState('');
  const dq = useDebounced(q);
  const [page, setPage] = useState(1);
  const cats = useApi<any[]>('/categories');
  const products = useApi<any>(store.data ? `/stores/${store.data.id}/products` : null, { category: cat, q: dq, page, pageSize: 24 });
  useEffect(() => setPage(1), [cat, dq]);
  useEffect(() => { if (store.data) track('store_view', store.data.id); }, [store.data?.id]);
  const add = useAction(async (listingId: string, name: string) => {
    if (!user) return nav(`/login?next=${encodeURIComponent(`/store/${id}`)}`);
    const cart = await api.post('/cart/items', { storeProductId: listingId, quantity: 1 });
    useCart.getState().setCount(cart.itemCount);
    toast({ tone: 'ok', title: 'Added to cart', body: name });
  });
  const fav = useAction(async () => {
    if (!user) return nav('/login');
    if (store.data.favoriteId) await api.del(`/users/me/favorites/${store.data.favoriteId}`);
    else await api.post('/users/me/favorites', { storeId: store.data.id });
    await store.reload();
  });

  if (store.error) return <div className="wrap page"><ErrorNote error={store.error} /></div>;
  const s = store.data;
  if (!s) return <div className="wrap page"><LoadingBlock rows={6} /></div>;
  const today = new Date().getDay();

  return (
    <div className="wrap page stack loose">
      <div style={{ display: 'grid', gap: 24, gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 360px), 1fr))', alignItems: 'start' }}>
        <div className="stack">
          <div className="row nowrap" style={{ alignItems: 'flex-start' }}>
            <StoreTypeBadge type={s.storeType} size={56} />
            <div className="stack tight" style={{ gap: 4, minWidth: 0 }}>
              <span className="eyebrow">{storeTypeLabel(s.storeType)}{s.verified ? ' · Verified store' : ''}</span>
              <h1>{s.name}</h1>
              <div className="row tight">
                <Distance mi={s.distanceMi} />
                <span className="badge" style={{ background: s.isOpen ? 'var(--ok-soft)' : undefined, color: s.isOpen ? 'var(--ok)' : undefined }}><span className="dot" />{s.label}</span>
                {s.pickupEnabled && <span className="badge">Pickup</span>}
                {s.deliveryEnabled && <span className="badge">Delivery within {s.serviceRadiusMi} mi · {usd(s.deliveryFeeCents)}</span>}
              </div>
            </div>
          </div>
          <p className="muted">{s.description}</p>
          <dl className="kv">
            <dt>Address</dt><dd>{s.addressLine1}, {s.city}, {s.state} {s.zip}{s.county ? ` · ${s.county} County` : ''}</dd>
            {s.phone && <><dt>Phone</dt><dd className="mono" style={{ userSelect: 'all' }}>{s.phone}</dd></>}
            {s.website && <><dt>Website</dt><dd><a href={s.website} target="_blank" rel="noreferrer">{s.website.replace(/^https?:\/\//, '')}</a></dd></>}
            {s.services?.length > 0 && <><dt>Services</dt><dd>{s.services.join(' · ')}</dd></>}
            <dt>Catalog</dt><dd>{s.productCount} products · {s.inStockCount} in stock</dd>
          </dl>
          <div className="row">
            <a className="btn primary" href={s.directionsUrl} target="_blank" rel="noreferrer"><Icon name="map" /> Directions</a>
            <button className="btn" onClick={() => fav.run()} aria-pressed={!!s.favoriteId}>
              <Icon name={s.favoriteId ? 'heart' : 'heartOutline'} style={{ color: s.favoriteId ? 'var(--bad)' : undefined }} /> {s.favoriteId ? 'Saved' : 'Save store'}
            </button>
          </div>
        </div>
        <div className="stack">
          <div style={{ height: 280 }}>
            <MapView ariaLabel={`Location of ${s.name}`} markers={[{ id: s.id, lat: s.latitude, lng: s.longitude, title: s.name, kind: s.storeType }]} center={{ lat: s.latitude, lng: s.longitude }} radiusMi={s.deliveryEnabled ? s.serviceRadiusMi : undefined} user={{ lat: location.lat, lng: location.lng }} legend={false} />
          </div>
          <div className="card">
            <div className="card-h"><h3>Hours</h3><span className="xsmall faint">Central Time</span></div>
            <table className="t" style={{ fontSize: '0.88rem' }}>
              <tbody>
                {s.hours.map((h: any) => (
                  <tr key={h.dayOfWeek} style={h.dayOfWeek === today ? { fontWeight: 700 } : undefined}>
                    <td>{DAY[h.dayOfWeek]}{h.dayOfWeek === today ? ' (today)' : ''}</td>
                    <td className="r num">{h.closed ? 'Closed' : h.opens === '00:00' && h.closes >= '23:59' ? 'Open 24 hours' : `${time12(h.opens)} – ${time12(h.closes)}`}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {s.offers?.length > 0 && (
        <section className="stack" aria-labelledby="so-h">
          <h2 id="so-h">Offers at this store</h2>
          <div className="grid cols-3">
            {s.offers.map((o: any) => (
              <div key={o.id} className="card pad stack tight" style={{ borderColor: 'color-mix(in srgb, var(--amber) 55%, var(--line))' }}>
                <div className="row between"><OfferTag offer={o} /><span className="xsmall faint">Ends {new Date(o.endAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span></div>
                <strong>{o.name}</strong>
                <span className="small muted">{o.description}</span>
                {o.eligibility === 'new_customer' && <span className="xsmall faint">First order at this store</span>}
                {o.geoRadiusMi && <span className="xsmall faint">For shoppers within {o.geoRadiusMi} mi</span>}
              </div>
            ))}
          </div>
        </section>
      )}

      <section className="stack" aria-labelledby="sp-h">
        <div className="page-h">
          <h2 id="sp-h">Shop {s.name}</h2>
          <div className="filters">
            <label className="sr-only" htmlFor="sp-q">Search this store</label>
            <input id="sp-q" className="input sm" style={{ width: 220 }} placeholder="Search this store" value={q} onChange={(e) => setQ(e.target.value)} />
            <label className="sr-only" htmlFor="sp-c">Department</label>
            <select id="sp-c" className="select sm" style={{ width: 'auto' }} value={cat} onChange={(e) => setCat(e.target.value)}>
              <option value="">All departments</option>
              {(cats.data ?? []).map((c) => <option key={c.id} value={c.slug}>{c.name}</option>)}
            </select>
          </div>
        </div>
        {products.data && products.data.items.length === 0 && <div className="card"><Empty title="No matching products at this store" /></div>}
        <div className="grid cols-4">
          {(products.data?.items ?? []).map((it: any) => (
            <div key={it.storeProductId} className="ptile">
              <Link to={`/product/${it.product.id}`} style={{ color: 'inherit', textDecoration: 'none' }}>
                <ProductArt name={it.product.name} category={(cats.data ?? []).flatMap((c) => [c, ...c.children]).find((c: any) => c.id === it.product.categoryId)?.name} brand={it.product.brand} size={it.product.size} />
              </Link>
              <div className="body">
                <div className="row tight"><StockPill status={it.stockStatus} qty={it.quantity} showQty={it.stockStatus === 'low_stock'} />{it.offer && <OfferTag offer={it.offer} />}</div>
                <Link to={`/product/${it.product.id}`} className="name" style={{ color: 'inherit', textDecoration: 'none' }}>{it.product.name}</Link>
                <span className="meta">{[it.product.brand, it.product.size].filter(Boolean).join(' · ')}</span>
                <div className="row between" style={{ marginTop: 'auto' }}>
                  <Price cents={it.priceCents} was={it.wasCents} />
                  <button className="btn sm primary" disabled={it.stockStatus === 'out_of_stock' || add.busy} onClick={() => add.run(it.storeProductId, it.product.name)} aria-label={`Add ${it.product.name} to cart`}>Add</button>
                </div>
              </div>
            </div>
          ))}
        </div>
        {products.data && <Pager page={products.data.page} totalPages={products.data.totalPages} total={products.data.total} onPage={setPage} noun="products" />}
      </section>
    </div>
  );
}

export function Offers() {
  const { location, radius: r0 } = useSearchLocation();
  const [radius, setRadius] = useState(Math.max(10, r0));
  const { data, loading, error, reload } = useApi<any>('/offers', { lat: location.lat, lng: location.lng, radius });
  return (
    <div className="wrap page stack">
      <div className="page-h">
        <div>
          <h1 style={{ fontSize: '1.7rem' }}>Offers near {location.label.split(',')[0]}</h1>
          <p className="small">Discounts from participating stores. Some offers are only for first orders or shoppers close to the store.</p>
        </div>
        <div className="segmented" role="group" aria-label="Radius">
          {[5, 10, 25, 50].map((r) => <button key={r} aria-pressed={radius === r} onClick={() => setRadius(r)}>{r} mi</button>)}
        </div>
      </div>
      <ErrorNote error={error} onRetry={reload} />
      {loading && !data && <div className="grid cols-3">{[0, 1, 2, 3, 4, 5].map((i) => <Skeleton key={i} h={140} />)}</div>}
      {data && data.items.length === 0 && <div className="card"><Empty icon="tag" title="No offers in this area right now" action={<button className="btn" onClick={() => setRadius(50)}>Search 50 miles</button>} /></div>}
      <div className="grid cols-3">
        {(data?.items ?? []).map((o: any) => (
          <div key={o.id} className="card" style={{ display: 'grid', gridTemplateColumns: '120px 1fr', overflow: 'hidden' }}>
            <ProductArt name={o.product?.name ?? o.category?.name ?? o.store.name} category={o.category?.name ?? (o.product ? undefined : 'Grocery')} size={o.product?.size} ratio="3 / 4" />
            <div className="stack tight" style={{ padding: 14 }}>
              <div className="row between"><OfferTag offer={o} /><Distance mi={o.store.distanceMi} /></div>
              <strong>{o.name}</strong>
              <span className="small muted">{o.description}</span>
              <Link to={`/store/${o.store.slug}`} className="small">{o.store.name}</Link>
              {o.listing && <Price cents={o.listing.priceCents} was={o.listing.wasCents ?? (o.listing.listPriceCents > o.listing.priceCents ? o.listing.listPriceCents : null)} />}
              <span className="xsmall faint">Ends {new Date(o.endAt).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}{o.scope === 'store' ? ' · store-wide' : o.scope === 'category' ? ` · all ${o.category?.name}` : ''}</span>
              {o.product && <Link to={`/product/${o.product.id}`} className="btn sm" style={{ alignSelf: 'flex-start' }}>Compare prices</Link>}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
