import { Link, useNavigate } from 'react-router-dom';
import { useLocation as useSearchLocation } from '../../state/store';
import { useApi } from '../../lib/hooks';
import { SearchBar } from '../../layouts/ConsumerLayout';
import { MapView } from '../../map/MapView';
import { Icon } from '../../ui/icons';
import { Distance, OfferTag, ProductArt, Price, StoreTypeBadge, storeTypeLabel, Skeleton } from '../../ui/kit';
import { miles } from '../../lib/format';

const EXAMPLES = ['bottled water within 5 miles', 'ibuprofen', 'kolaches', 'bagged ice', 'phone charger', 'dog food'];

export function Home() {
  const { location, radius } = useSearchLocation();
  const nav = useNavigate();
  const stores = useApi<any>('/stores', { lat: location.lat, lng: location.lng, radius, pageSize: 12 });
  const offers = useApi<any>('/offers', { lat: location.lat, lng: location.lng, radius: Math.max(radius, 10) });
  const cats = useApi<any[]>('/categories');
  const nearest = (stores.data?.items ?? []).slice(0, 3);

  return (
    <>
      <section className="hero" aria-labelledby="hero-h">
        <div className="wrap">
          <div>
            <span className="eyebrow" style={{ color: 'inherit', opacity: 0.8 }}>Dallas–Fort Worth · Houston · Austin</span>
            <h1 id="hero-h" style={{ marginTop: 10 }}>What you need, on a shelf near you.</h1>
            <p className="lead">See which nearby stores have it in stock right now, compare prices, then pick it up today or order ahead. Every listing comes from the store itself.</p>
            <SearchBar big />
            <div className="chips" aria-label="Example searches">
              {EXAMPLES.map((e) => <button key={e} onClick={() => nav(`/search?q=${encodeURIComponent(e)}`)}>{e}</button>)}
            </div>
          </div>
          <div className="hero-sign" aria-label="Nearest stores">
            <div className="row between" style={{ marginBottom: 6 }}>
              <span style={{ font: '800 0.8rem/1 var(--font-display)', letterSpacing: '0.14em' }}>NEAREST STORES</span>
              <span className="xsmall" style={{ opacity: 0.8 }}>{location.label.split(',')[0]}</span>
            </div>
            {stores.loading && !stores.data ? (
              <div className="stack tight">{[0, 1, 2].map((i) => <Skeleton key={i} h={44} />)}</div>
            ) : nearest.length === 0 ? (
              <p className="small" style={{ padding: '10px 0' }}>No stores within {radius} miles yet. Try a wider radius.</p>
            ) : (
              nearest.map((s: any) => (
                <Link key={s.id} to={`/store/${s.slug}`} className="line" style={{ color: 'inherit', textDecoration: 'none' }}>
                  <span style={{ minWidth: 0 }}>
                    <span className="ellipsis" style={{ display: 'block' }}>{s.name}</span>
                    <small>{storeTypeLabel(s.storeType)} · {s.label}</small>
                  </span>
                  <span className="mi">{miles(s.distanceMi)}</span>
                </Link>
              ))
            )}
          </div>
        </div>
      </section>

      <div className="wrap page stack loose">
        <section aria-labelledby="cat-h" className="stack">
          <div className="row between"><h2 id="cat-h">Shop by department</h2></div>
          <div className="grid cols-4">
            {(cats.data ?? []).map((c) => (
              <Link key={c.id} to={`/search?category=${c.slug}`} className="ptile" style={{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 10 }}>
                <div style={{ width: 64, flex: 'none', borderRadius: 8, overflow: 'hidden' }}><ProductArt name={c.name} category={c.name} ratio="1 / 1" /></div>
                <div className="stack tight" style={{ gap: 2 }}>
                  <strong>{c.name}</strong>
                  <span className="xsmall faint">{c.children.slice(0, 3).map((x: any) => x.name).join(', ')}</span>
                </div>
              </Link>
            ))}
          </div>
        </section>

        <section aria-labelledby="deals-h" className="stack">
          <div className="row between">
            <h2 id="deals-h">Deals near you</h2>
            <Link to="/offers" className="btn sm">All offers <Icon name="chevron" className="icon sm" /></Link>
          </div>
          <div className="grid cols-3">
            {(offers.data?.items ?? []).slice(0, 6).map((o: any) => (
              <Link key={o.id} to={o.product ? `/product/${o.product.id}` : `/store/${o.store.slug}`} className="ptile" style={{ flexDirection: 'row' }}>
                <div style={{ width: 110, flex: 'none' }}><ProductArt name={o.product?.name ?? o.category?.name ?? o.store.name} category={o.category?.name ?? 'Grocery'} size={o.product?.size} ratio="1 / 1" /></div>
                <div className="body">
                  <div className="row tight"><OfferTag offer={o} /><Distance mi={o.store.distanceMi} /></div>
                  <span className="name">{o.name}</span>
                  <span className="meta">{o.store.name}</span>
                  {o.listing && <Price cents={o.listing.priceCents} was={o.listing.wasCents} />}
                </div>
              </Link>
            ))}
            {offers.loading && !offers.data && [0, 1, 2].map((i) => <Skeleton key={i} h={110} />)}
          </div>
        </section>

        <section aria-labelledby="near-h" className="stack">
          <div className="row between">
            <h2 id="near-h">Stores within {radius} miles</h2>
            <Link to="/stores" className="btn sm">Explore the map <Icon name="chevron" className="icon sm" /></Link>
          </div>
          <div className="split">
            <div className="card divider-list">
              {(stores.data?.items ?? []).slice(0, 7).map((s: any) => (
                <Link key={s.id} to={`/store/${s.slug}`} className="srow">
                  <StoreTypeBadge type={s.storeType} />
                  <div style={{ minWidth: 0 }}>
                    <div className="name ellipsis">{s.name}</div>
                    <div className="small muted">{storeTypeLabel(s.storeType)} · <span style={{ color: s.isOpen ? 'var(--ok)' : 'var(--ink-3)' }}>{s.label}</span></div>
                  </div>
                  <Distance mi={s.distanceMi} />
                </Link>
              ))}
            </div>
            <div style={{ height: 420 }}>
              <MapView
                ariaLabel="Map of nearby stores"
                center={{ lat: location.lat, lng: location.lng }}
                radiusMi={radius}
                user={location.source !== 'default' ? { lat: location.lat, lng: location.lng } : null}
                markers={(stores.data?.items ?? []).map((s: any) => ({ id: s.slug, lat: s.latitude, lng: s.longitude, title: `${s.name}, ${miles(s.distanceMi)}`, kind: s.storeType }))}
                onSelect={(id) => id && nav(`/store/${id}`)}
              />
            </div>
          </div>
        </section>

        <section className="card pad" style={{ display: 'grid', gap: 20, gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 280px), 1fr))', alignItems: 'center' }} aria-labelledby="sell-h">
          <div className="stack tight">
            <span className="eyebrow">For store owners</span>
            <h2 id="sell-h">Put your shelves on the map</h2>
            <p className="muted">List products and live stock, run offers for shoppers nearby, and source inventory from other RetailGeo stores when you run low. Grocery, convenience, gas stations, pharmacies and specialty shops welcome.</p>
          </div>
          <div className="row" style={{ justifyContent: 'flex-end' }}>
            <Link to="/sell" className="btn primary lg">Apply to sell</Link>
            <Link to="/merchant" className="btn lg">Merchant sign in</Link>
          </div>
        </section>
      </div>
    </>
  );
}
