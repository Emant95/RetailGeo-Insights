import { Fragment, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../../api';
import { useCart, useLocation as useSearchLocation, useSession, toast } from '../../state/store';
import { track, useAction, useApi } from '../../lib/hooks';
import { MapView } from '../../map/MapView';
import { Icon } from '../../ui/icons';
import { Distance, Empty, ErrorNote, LoadingBlock, OfferTag, Price, ProductArt, Qty, StockPill, StoreTypeBadge, storeTypeLabel, usd } from '../../ui/kit';
import { miles, when } from '../../lib/format';

export function Product() {
  const { id } = useParams();
  const { location, radius: r0 } = useSearchLocation();
  const [radius, setRadius] = useState(Math.max(r0, 10));
  const user = useSession((s) => s.user);
  const nav = useNavigate();
  const product = useApi<any>(`/products/${id}`);
  const avail = useApi<any>(`/products/${id}/availability`, { lat: location.lat, lng: location.lng, radius });
  const [selected, setSelected] = useState<string | null>(null);
  const [qty, setQty] = useState<Record<string, number>>({});
  useEffect(() => { if (product.data) track('product_view', undefined, { productId: product.data.id }); }, [product.data?.id]);

  const add = useAction(async (listingId: string, n: number, storeName: string) => {
    if (!user) {
      nav(`/login?next=${encodeURIComponent(`/product/${id}`)}`);
      return null;
    }
    const cart = await api.post('/cart/items', { storeProductId: listingId, quantity: n });
    useCart.getState().setCount(cart.itemCount);
    toast({ tone: 'ok', title: `Added to cart`, body: `${n} × ${product.data?.name} from ${storeName}` });
    return cart;
  });
  const fav = useAction(async () => {
    if (!user) return nav('/login');
    if (product.data.favoriteId) await api.del(`/users/me/favorites/${product.data.favoriteId}`);
    else await api.post('/users/me/favorites', { productId: product.data.id });
    await product.reload();
  });

  if (product.error) return <div className="wrap page"><ErrorNote error={product.error} /></div>;
  const p = product.data;
  if (!p) return <div className="wrap page"><LoadingBlock rows={6} /></div>;
  const listings: any[] = avail.data?.listings ?? [];
  const sum = avail.data?.summary;

  return (
    <div className="wrap page stack loose">
      <nav aria-label="Breadcrumb" className="small muted row tight">
        <Link to="/search">All</Link><span aria-hidden="true">/</span>
        {p.parentCategory && <><Link to={`/search?category=${p.parentCategory.slug}`}>{p.parentCategory.name}</Link><span aria-hidden="true">/</span></>}
        <Link to={`/search?category=${p.category.slug}`}>{p.category.name}</Link>
      </nav>

      <div style={{ display: 'grid', gap: 28, gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 340px), 1fr))', alignItems: 'start' }}>
        <div className="card" style={{ overflow: 'hidden' }}>
          <ProductArt name={p.name} category={p.category.name} brand={p.brand} size={p.size} />
        </div>
        <div className="stack">
          <div className="stack tight">
            <span className="eyebrow">{p.brand}</span>
            <h1>{p.name}</h1>
            <span className="muted">{[p.size, p.unit !== 'each' ? `sold per ${p.unit}` : null].filter(Boolean).join(' · ')}</span>
          </div>
          {sum && (
            <div className="panel" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 12 }}>
              <div><div className="xsmall faint">Lowest nearby</div><strong className="num" style={{ fontSize: '1.3rem' }}>{usd(sum.lowestPriceCents)}</strong></div>
              <div><div className="xsmall faint">In stock at</div><strong style={{ fontSize: '1.3rem' }}>{sum.inStockCount}<span className="small muted"> / {sum.storeCount} stores</span></strong></div>
              <div><div className="xsmall faint">Closest in stock</div><strong style={{ fontSize: '1.3rem' }}>{sum.nearestInStock != null ? miles(sum.nearestInStock) : '—'}</strong></div>
            </div>
          )}
          <p className="muted">{p.description}</p>
          <dl className="kv">
            <dt>SKU</dt><dd className="mono">{p.sku}</dd>
            {p.upc && <><dt>UPC</dt><dd className="mono">{p.upc}</dd></>}
            {Object.entries(p.attributes ?? {}).map(([k, v]) => <Fragment key={k}><dt>{k.replace(/([A-Z])/g, ' $1').toLowerCase()}</dt><dd>{String(v)}</dd></Fragment>)}
            {p.variants?.length > 0 && <><dt>Also comes in</dt><dd>{p.variants.map((v: any) => v.name).join(', ')}</dd></>}
          </dl>
          <div className="row">
            <button className="btn" onClick={() => fav.run()} aria-pressed={!!p.favoriteId}>
              <Icon name={p.favoriteId ? 'heart' : 'heartOutline'} style={{ color: p.favoriteId ? 'var(--bad)' : undefined }} />
              {p.favoriteId ? 'Saved' : 'Save'}
            </button>
          </div>
        </div>
      </div>

      <section className="stack" aria-labelledby="where-h">
        <div className="page-h">
          <div>
            <h2 id="where-h">Where to find it</h2>
            <p className="small">Stores within {radius} miles of {location.label}, sorted by distance. Prices and stock come from each store.</p>
          </div>
          <div className="segmented" role="group" aria-label="Radius">
            {[5, 10, 25, 50].map((r) => <button key={r} aria-pressed={radius === r} onClick={() => setRadius(r)}>{r} mi</button>)}
          </div>
        </div>
        <ErrorNote error={avail.error} onRetry={avail.reload} />
        {avail.data && listings.length === 0 ? (
          <div className="card"><Empty title="No stores nearby carry this yet" action={<button className="btn" onClick={() => setRadius(50)}>Search 50 miles</button>} /></div>
        ) : (
          <div className="split">
            <div className="table-wrap">
              <table className="t">
                <caption className="sr-only">Price and stock comparison</caption>
                <thead>
                  <tr><th>Store</th><th className="r">Price</th><th>Stock</th><th className="r"><span className="sr-only">Add</span></th></tr>
                </thead>
                <tbody>
                  {listings.map((l) => (
                    <tr key={l.storeProductId} onMouseEnter={() => setSelected(l.store.slug)} style={selected === l.store.slug ? { background: 'var(--brand-soft)' } : undefined}>
                      <td>
                        <div className="row tight nowrap" style={{ alignItems: 'flex-start' }}>
                          <StoreTypeBadge type={l.store.storeType} size={32} />
                          <div style={{ minWidth: 0 }}>
                            <Link to={`/store/${l.store.slug}`} className="rowlink">{l.store.name}</Link>
                            <div className="xsmall muted row tight"><Distance mi={l.store.distanceMi} /> {storeTypeLabel(l.store.storeType)} · {l.store.label}</div>
                            <div className="xsmall faint">Updated {when(l.updatedAt)}{l.stale && ' · may be out of date'}</div>
                          </div>
                        </div>
                      </td>
                      <td className="r">
                        <Price cents={l.priceCents} was={l.wasCents} />
                        {l.offer && <div style={{ marginTop: 4 }}><OfferTag offer={l.offer} /></div>}
                      </td>
                      <td><StockPill status={l.stockStatus} qty={l.quantity} showQty={l.stockStatus === 'low_stock'} /></td>
                      <td className="r">
                        {l.stockStatus !== 'out_of_stock' && l.store.pickupEnabled ? (
                          <div className="row tight nowrap" style={{ justifyContent: 'flex-end' }}>
                            <Qty value={qty[l.storeProductId] ?? 1} max={Math.min(l.quantity, l.maxOrderQty ?? 999)} onChange={(n) => setQty({ ...qty, [l.storeProductId]: n })} label={`Quantity at ${l.store.name}`} />
                            <button className="btn primary sm" disabled={add.busy} onClick={() => add.run(l.storeProductId, qty[l.storeProductId] ?? 1, l.store.name)} aria-label={`Add to cart from ${l.store.name}`}><Icon name="cart" className="icon sm" /></button>
                          </div>
                        ) : <span className="xsmall faint">Unavailable</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="sticky-map">
              <MapView
                ariaLabel={`Stores carrying ${p.name}`}
                center={avail.data?.center}
                radiusMi={radius}
                user={{ lat: location.lat, lng: location.lng }}
                selectedId={selected}
                onSelect={setSelected}
                markers={listings.map((l) => ({ id: l.store.slug, lat: l.store.latitude, lng: l.store.longitude, title: `${l.store.name}: ${usd(l.priceCents)}, ${l.stockStatus.replace(/_/g, ' ')}`, kind: l.store.storeType, label: usd(l.priceCents), dim: l.stockStatus === 'out_of_stock' }))}
                renderPopup={(m) => {
                  const l = listings.find((x) => x.store.slug === m.id);
                  return (
                    <div className="stack tight">
                      <strong>{l.store.name}</strong>
                      <div className="row between"><Price cents={l.priceCents} was={l.wasCents} /><StockPill status={l.stockStatus} /></div>
                      <Link to={`/store/${m.id}`} className="small">View store</Link>
                    </div>
                  );
                }}
              />
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
