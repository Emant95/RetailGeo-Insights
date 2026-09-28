import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, NavLink, Outlet, useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../api';
import { useCart, useLocation as useSearchLocation, useSession } from '../state/store';
import { useApi } from '../lib/hooks';
import { Icon } from '../ui/icons';
import { Logo } from '../ui/kit';
import { DemoBar } from './DemoBar';
import { LocationPicker } from './LocationPicker';

export function SearchBar({ big }: { big?: boolean }) {
  const [params] = useSearchParams();
  const [q, setQ] = useState(params.get('q') ?? '');
  const [picker, setPicker] = useState(false);
  const loc = useSearchLocation((s) => s.location);
  const nav = useNavigate();
  useEffect(() => setQ(params.get('q') ?? ''), [params]);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    nav(`/search?q=${encodeURIComponent(q.trim())}`);
  };
  return (
    <>
      <form className="searchbar" role="search" onSubmit={submit}>
        <button type="button" className="loc" onClick={() => setPicker(true)} aria-label={`Change location. Current: ${loc.label}`}>
          <Icon name="pin" className="icon sm" />
          <span>{loc.label.split(',')[0]}</span>
        </button>
        <label htmlFor={big ? 'q-hero' : 'q'} className="sr-only">Search products and stores</label>
        <input id={big ? 'q-hero' : 'q'} value={q} onChange={(e) => setQ(e.target.value)} placeholder={big ? 'Try "bottled water within 5 miles"' : 'Search products, brands, SKUs or stores'} autoComplete="off" />
        <button className="go" type="submit" aria-label="Search"><Icon name="search" /></button>
      </form>
      {picker && <LocationPicker onClose={() => setPicker(false)} />}
    </>
  );
}

function AccountMenu() {
  const user = useSession((s) => s.user)!;
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const nav = useNavigate();
  useEffect(() => {
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);
  const isMerchant = user.roles.includes('merchant_admin') || user.roles.includes('store_employee');
  const isAdmin = user.roles.includes('platform_admin') || user.roles.includes('platform_support');
  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button className="icon-btn" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)} aria-label="Account menu">
        <Icon name="user" />
      </button>
      {open && (
        <div className="card raised" role="menu" style={{ position: 'absolute', right: 0, top: 46, width: 240, padding: 6, zIndex: 40 }} onClick={() => setOpen(false)}>
          <div style={{ padding: '8px 10px 10px' }}>
            <strong>{user.fullName}</strong>
            <div className="xsmall faint ellipsis">{user.email}</div>
          </div>
          <hr className="rule" />
          {[
            ['/account/orders', 'Orders'], ['/account/favorites', 'Favorites'], ['/account/locations', 'Saved locations'], ['/account/notifications', 'Notifications'], ['/account/profile', 'Profile & privacy'],
            ...(isMerchant ? [['/merchant', 'Merchant portal']] : [['/sell', 'Sell on RetailGeo']]),
            ...(isAdmin ? [['/admin', 'Admin console']] : []),
          ].map(([to, l]) => (
            <Link key={to} to={to} role="menuitem" className="btn ghost block" style={{ justifyContent: 'flex-start' }}>{l}</Link>
          ))}
          <hr className="rule" />
          <button role="menuitem" className="btn ghost block" style={{ justifyContent: 'flex-start' }} onClick={async () => { await api.post('/auth/logout').catch(() => undefined); api.setSession(null); useCart.getState().setCount(0); nav('/'); }}>
            Sign out
          </button>
        </div>
      )}
    </div>
  );
}

export function ConsumerLayout() {
  const user = useSession((s) => s.user);
  const count = useCart((s) => s.count);
  const { data: cats } = useApi<any[]>('/categories');
  const { data: notes } = useApi<any>(user ? '/notifications' : null, { pageSize: 1 });
  const [params] = useSearchParams();
  const activeCat = params.get('category');
  useEffect(() => {
    void useCart.getState().refresh();
  }, [user]);
  return (
    <>
      <a href="#main" className="skip">Skip to content</a>
      <DemoBar />
      <header className="site-h">
        <div className="wrap">
          <Link to="/" aria-label="RetailGeo home" style={{ textDecoration: 'none' }}><Logo /></Link>
          <SearchBar />
          <nav className="nav-actions" aria-label="Account">
            <NavLink to="/offers" className="btn ghost sm hide-sm">Offers</NavLink>
            <NavLink to="/stores" className="btn ghost sm hide-sm">Stores</NavLink>
            {user && (
              <Link to="/account/notifications" className="icon-btn" aria-label={`Notifications${notes?.unread ? `, ${notes.unread} unread` : ''}`}>
                <Icon name="bell" />
                {notes?.unread ? <span className="count-dot">{notes.unread}</span> : null}
              </Link>
            )}
            <Link to="/cart" className="icon-btn" aria-label={`Cart, ${count} items`}>
              <Icon name="cart" />
              {count > 0 && <span className="count-dot">{count}</span>}
            </Link>
            {user ? <AccountMenu /> : <Link to="/login" className="btn sm primary">Sign in</Link>}
          </nav>
        </div>
        <nav className="catnav" aria-label="Categories">
          <div className="wrap">
            <NavLink to="/stores" className="hide-lg">Nearby stores</NavLink>
            {cats?.map((c) => <Link key={c.id} to={`/search?category=${c.slug}`} className={activeCat === c.slug ? 'active' : ''} aria-current={activeCat === c.slug ? 'page' : undefined}>{c.name}</Link>)}
            <NavLink to="/offers">Deals near you</NavLink>
          </div>
        </nav>
      </header>
      <main id="main" tabIndex={-1} style={{ outline: 'none' }}>
        <Outlet />
      </main>
      <footer className="site-f">
        <div className="wrap">
          <div className="stack tight" style={{ maxWidth: 380 }}>
            <Logo sub="Local commerce network" />
            <p className="small">Prices, stock and offers are set by each participating store. Availability can change between your search and your visit.</p>
            <p className="xsmall faint">© {new Date().getFullYear()} Desmata Inc. Phase 1 web beta.</p>
          </div>
          <div className="row" style={{ alignItems: 'flex-start', gap: 40 }}>
            <div className="stack tight">
              <span className="eyebrow">Shop</span>
              <Link to="/stores">Stores near you</Link>
              <Link to="/offers">Offers</Link>
              <Link to="/account/orders">Your orders</Link>
            </div>
            <div className="stack tight">
              <span className="eyebrow">Business</span>
              <Link to="/sell">Sell on RetailGeo</Link>
              <Link to="/merchant">Merchant portal</Link>
              <Link to="/support">Help & support</Link>
            </div>
            <div className="stack tight">
              <span className="eyebrow">Legal</span>
              <Link to="/legal/privacy">Privacy</Link>
              <Link to="/legal/terms">Terms</Link>
            </div>
          </div>
        </div>
      </footer>
    </>
  );
}
