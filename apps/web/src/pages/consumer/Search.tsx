import { useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { STORE_TYPES } from '@retailgeo/core';
import { useLocation as useSearchLocation } from '../../state/store';
import { useApi } from '../../lib/hooks';
import { MapView } from '../../map/MapView';
import { Icon } from '../../ui/icons';
import { Distance, Empty, ErrorNote, OfferTag, Pager, Price, ProductArt, StockPill, StoreTypeBadge, storeTypeLabel, Skeleton, usd } from '../../ui/kit';
import { miles } from '../../lib/format';

export function Search() {
  const [params, setParams] = useSearchParams();
  const { location, radius: defaultRadius } = useSearchLocation();
  const nav = useNavigate();
  const [view, setView] = useState<'list' | 'map'>('list');
  const q = params.get('q') ?? '';
  const category = params.get('category') ?? '';
  const sort = params.get('sort') ?? 'relevance';
  const inStock = params.get('inStock') === 'true';
  const onSale = params.get('onSale') === 'true';
  const types = params.get('storeType')?.split(',').filter(Boolean) ?? [];
  const radiusParam = params.get('radius');
  const radius = Number(radiusParam ?? defaultRadius);
  const page = Number(params.get('page') ?? 1);
  const set = (k: string, v: string | null) => {
    const p = new URLSearchParams(params);
    if (v == null || v === '') p.delete(k);
    else p.set(k, v);
    if (k !== 'page') p.delete('page');
    setParams(p, { replace: true });
  };
  const cats = useApi<any[]>('/categories');
  const { data, loading, error, reload } = useApi<any>('/search', { q, category, sort, inStock, onSale, storeType: types.join(','), radius, lat: location.lat, lng: location.lng, page, pageSize: 24 });
  const flatCats = useMemo(() => (cats.data ?? []).flatMap((c) => [c, ...c.children.map((x: any) => ({ ...x, name: `  ${x.name}` }))]), [cats.data]);
  const catName = flatCats.find((c) => c.slug === category)?.name?.trim();
  const heading = q ? `Results for “${q}”` : catName ?? 'Everything nearby';

  const markers = useMemo(() => {
    const m = new Map<string, any>();
    for (const r of data?.items ?? []) {
      const s = r.nearestStore;
      if (s && !m.has(s.id)) m.set(s.id, { id: s.id, lat: 0, lng: 0, title: s.name, kind: s.storeType, product: r });
    }
    return m;
  }, [data]);
  const storesForMap = useApi<any>(markers.size ? '/stores' : null, { lat: data?.center.lat ?? location.lat, lng: data?.center.lng ?? location.lng, radius: data?.interpreted.radiusMi ?? radius, pageSize: 100 });
  const mapMarkers = (storesForMap.data?.items ?? []).filter((s: any) => markers.has(s.id)).map((s: any) => ({ id: s.slug, lat: s.latitude, lng: s.longitude, title: `${s.name}, ${miles(s.distanceMi)}`, kind: s.storeType }));

  return (
    <div className="wrap page stack">
      <div className="page-h">
        <div>
          <h1 style={{ fontSize: '1.7rem' }}>{heading}</h1>
          {data && (
            <p className="muted small" style={{ marginTop: 6 }}>
              {data.total} product{data.total === 1 ? '' : 's'} within {data.interpreted.radiusMi} mi of {data.interpreted.place ?? location.label}
              {data.interpreted.text && data.interpreted.text.toLowerCase() !== q.toLowerCase() && <> · searched for “{data.interpreted.text}”</>}
            </p>
          )}
        </div>
        <div className="segmented" role="group" aria-label="Result view">
          <button aria-pressed={view === 'list'} onClick={() => setView('list')}><Icon name="list" className="icon sm" /> List</button>
          <button aria-pressed={view === 'map'} onClick={() => setView('map')}><Icon name="map" className="icon sm" /> Map</button>
        </div>
      </div>

      <div className="card pad stack tight" style={{ padding: 14 }}>
        <div className="filters">
          <label className="sr-only" htmlFor="f-cat">Category</label>
          <select id="f-cat" className="select sm" style={{ width: 'auto' }} value={category} onChange={(e) => set('category', e.target.value)}>
            <option value="">All departments</option>
            {flatCats.map((c) => <option key={c.id} value={c.slug}>{c.name}</option>)}
          </select>
          <label className="sr-only" htmlFor="f-radius">Radius</label>
          <select id="f-radius" className="select sm" style={{ width: 'auto' }} value={radiusParam ?? data?.interpreted.radiusMi ?? radius} onChange={(e) => set('radius', e.target.value)}>
            {[...new Set([2, 5, 10, 25, 50, Number(data?.interpreted.radiusMi ?? radius)])].sort((a, b) => a - b).map((r) => <option key={r} value={r}>Within {r} mi</option>)}
          </select>
          <label className="sr-only" htmlFor="f-sort">Sort</label>
          <select id="f-sort" className="select sm" style={{ width: 'auto' }} value={sort} onChange={(e) => set('sort', e.target.value)}>
            <option value="relevance">Best match</option>
            <option value="distance">Closest</option>
            <option value="price_asc">Price: low to high</option>
            <option value="price_desc">Price: high to low</option>
          </select>
          <button className="chip" aria-pressed={inStock} onClick={() => set('inStock', inStock ? null : 'true')}>In stock</button>
          <button className="chip" aria-pressed={onSale} onClick={() => set('onSale', onSale ? null : 'true')}>On sale</button>
        </div>
        <div className="filters" aria-label="Store types">
          {STORE_TYPES.map((t) => {
            const on = types.includes(t);
            return <button key={t} className="chip" aria-pressed={on} onClick={() => set('storeType', (on ? types.filter((x) => x !== t) : [...types, t]).join(','))}>{storeTypeLabel(t)}</button>;
          })}
        </div>
      </div>

      <ErrorNote error={error} onRetry={reload} />

      {data?.stores?.length > 0 && (
        <section className="stack tight" aria-labelledby="sr-h">
          <h2 id="sr-h" style={{ fontSize: '1.05rem' }}>Stores</h2>
          <div className="grid cols-3">
            {data.stores.map((s: any) => (
              <Link key={s.id} to={`/store/${s.slug}`} className="card srow">
                <StoreTypeBadge type={s.storeType} />
                <div style={{ minWidth: 0 }}>
                  <div className="name ellipsis">{s.name}</div>
                  <div className="small muted">{storeTypeLabel(s.storeType)} · {s.label}</div>
                </div>
                <Distance mi={s.distanceMi} />
              </Link>
            ))}
          </div>
        </section>
      )}

      {view === 'map' && (
        <div style={{ height: 460 }}>
          <MapView ariaLabel="Stores with matching products" center={data?.center} radiusMi={data?.interpreted.radiusMi} markers={mapMarkers} onSelect={(id) => id && nav(`/store/${id}`)} user={{ lat: location.lat, lng: location.lng }} />
        </div>
      )}

      {loading && !data ? (
        <div className="grid cols-4">{Array.from({ length: 8 }, (_, i) => <Skeleton key={i} h={260} r={10} />)}</div>
      ) : data && data.items.length === 0 ? (
        <div className="card">
          <Empty title={`Nothing within ${data.interpreted.radiusMi} miles`} action={<div className="row tight"><button className="btn" onClick={() => set('radius', String(Math.min(50, radius * 2)))}>Search {Math.min(50, radius * 2)} miles</button><Link className="btn ghost" to="/stores">Browse stores</Link></div>}>
            Try a different word, a wider radius, or fewer filters. Stores add products every day.
          </Empty>
        </div>
      ) : (
        <div className="grid cols-4">
          {data?.items.map((r: any) => (
            <Link key={r.product.id} to={`/product/${r.product.id}`} className="ptile">
              <ProductArt name={r.product.name} category={r.product.category} brand={r.product.brand} size={r.product.size} />
              <div className="body">
                <div className="row tight">
                  {r.bestOffer && <OfferTag offer={r.bestOffer} />}
                  {r.inStockCount > 0 ? <StockPill status="in_stock" /> : <StockPill status="out_of_stock" />}
                </div>
                <span className="name">{r.product.name}</span>
                <span className="meta">{[r.product.brand, r.product.size].filter(Boolean).join(' · ')}</span>
                <div className="row between" style={{ marginTop: 'auto', paddingTop: 6 }}>
                  <span>
                    <span className="xsmall faint" style={{ display: 'block' }}>{r.storeCount > 1 ? 'from' : 'at'}</span>
                    <Price cents={r.minPriceCents} />
                  </span>
                  <Distance mi={r.nearestDistanceMi} />
                </div>
                <span className="xsmall muted">{r.inStockCount} of {r.storeCount} store{r.storeCount === 1 ? '' : 's'} in stock{r.maxPriceCents > r.minPriceCents ? ` · up to ${usd(r.maxPriceCents)}` : ''}</span>
              </div>
            </Link>
          ))}
        </div>
      )}
      {data && <Pager page={data.page} totalPages={data.totalPages} total={data.total} onPage={(p) => set('page', String(p))} noun="products" />}
    </div>
  );
}
