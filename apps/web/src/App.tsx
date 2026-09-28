import { useEffect, type ReactNode } from 'react';
import { HashRouter, Navigate, Route, Routes, useLocation, Link } from 'react-router-dom';
import { useSession } from './state/store';
import { Toasts, Empty } from './ui/kit';
import { ConsumerLayout } from './layouts/ConsumerLayout';
import { RequireRoles } from './layouts/ConsoleLayout';
import { Home } from './pages/consumer/Home';
import { Search } from './pages/consumer/Search';
import { Product } from './pages/consumer/Product';
import { Stores, StorePage, Offers } from './pages/consumer/Stores';
import { Cart, Checkout } from './pages/consumer/Cart';
import { AccountLayout, Orders, OrderDetail, Favorites, Locations, NotificationsPage, Profile, Support, Legal } from './pages/consumer/Account';
import { Login, Register, Forgot, Reset, Verify, Sell } from './pages/auth/Auth';
import { MerchantShell, MerchantOverview, MerchantOrders, MerchantOrderDetail } from './pages/merchant/Merchant';
import { MerchantProducts, MerchantInventory, MerchantOffers } from './pages/merchant/Catalog';
import { StoreOrders, Sourcing, StoreOrderDetail } from './pages/merchant/StoreToStore';
import { StoreProfile, Employees, Reports, MerchantNotifications, MerchantSettings } from './pages/merchant/Business';
import * as A from './pages/admin/Admin';

function RequireAuth({ children }: { children: ReactNode }) {
  const user = useSession((s) => s.user);
  const loc = useLocation();
  if (!user) return <Navigate to={`/login?next=${encodeURIComponent(loc.pathname + loc.search)}`} replace />;
  return <>{children}</>;
}

function ScrollTop() {
  const { pathname } = useLocation();
  useEffect(() => {
    window.scrollTo(0, 0);
    document.getElementById('main')?.focus({ preventScroll: true });
  }, [pathname]);
  return null;
}

function NotFound() {
  return <div className="wrap page"><div className="card"><Empty icon="map" title="That page isn't on the map" action={<Link to="/" className="btn primary">Go home</Link>}>Check the address, or search for what you need.</Empty></div></div>;
}

const MERCHANT_ROLES = ['merchant_admin', 'store_employee', 'platform_admin'] as const;
const ADMIN_ROLES = ['platform_admin', 'platform_support'] as const;

export function App() {
  return (
    <HashRouter>
      <ScrollTop />
      <Routes>
        <Route element={<ConsumerLayout />}>
          <Route index element={<Home />} />
          <Route path="search" element={<Search />} />
          <Route path="stores" element={<Stores />} />
          <Route path="store/:id" element={<StorePage />} />
          <Route path="product/:id" element={<Product />} />
          <Route path="offers" element={<Offers />} />
          <Route path="cart" element={<RequireAuth><Cart /></RequireAuth>} />
          <Route path="checkout/:storeId" element={<RequireAuth><Checkout /></RequireAuth>} />
          <Route path="account" element={<RequireAuth><AccountLayout /></RequireAuth>}>
            <Route index element={<Navigate to="orders" replace />} />
            <Route path="orders" element={<Orders />} />
            <Route path="orders/:id" element={<OrderDetail />} />
            <Route path="favorites" element={<Favorites />} />
            <Route path="locations" element={<Locations />} />
            <Route path="notifications" element={<NotificationsPage />} />
            <Route path="profile" element={<Profile />} />
          </Route>
          <Route path="support" element={<Support />} />
          <Route path="sell" element={<Sell />} />
          <Route path="legal/privacy" element={<Legal kind="privacy" />} />
          <Route path="legal/terms" element={<Legal kind="terms" />} />
          <Route path="login" element={<Login />} />
          <Route path="register" element={<Register />} />
          <Route path="forgot" element={<Forgot />} />
          <Route path="reset" element={<Reset />} />
          <Route path="verify" element={<Verify />} />
          <Route path="*" element={<NotFound />} />
        </Route>

        <Route path="merchant" element={<RequireRoles roles={[...MERCHANT_ROLES]}><MerchantShell /></RequireRoles>}>
          <Route index element={<MerchantOverview />} />
          <Route path="products" element={<MerchantProducts />} />
          <Route path="inventory" element={<MerchantInventory />} />
          <Route path="orders" element={<MerchantOrders />} />
          <Route path="orders/:orderId" element={<MerchantOrderDetail />} />
          <Route path="store-orders" element={<StoreOrders />} />
          <Route path="store-orders/new" element={<Sourcing />} />
          <Route path="store-orders/:id" element={<StoreOrderDetail />} />
          <Route path="offers" element={<MerchantOffers />} />
          <Route path="profile" element={<StoreProfile />} />
          <Route path="employees" element={<Employees />} />
          <Route path="reports" element={<Reports />} />
          <Route path="notifications" element={<MerchantNotifications />} />
          <Route path="settings" element={<MerchantSettings />} />
        </Route>

        <Route path="admin" element={<RequireRoles roles={[...ADMIN_ROLES]}><A.AdminShell /></RequireRoles>}>
          <Route index element={<A.AdminDashboard />} />
          <Route path="merchants" element={<A.Merchants />} />
          <Route path="stores" element={<A.AdminStores />} />
          <Route path="users" element={<A.Users />} />
          <Route path="roles" element={<A.Roles />} />
          <Route path="catalog" element={<A.Catalog />} />
          <Route path="markets" element={<A.Markets />} />
          <Route path="orders" element={<A.AdminOrders />} />
          <Route path="orders/:id" element={<A.AdminOrderDetail />} />
          <Route path="store-orders/:id" element={<A.AdminStoreOrderDetail />} />
          <Route path="support" element={<A.Support />} />
          <Route path="audit" element={<A.Audit />} />
          <Route path="settings" element={<A.Settings />} />
          <Route path="reports" element={<A.PlatformReports />} />
          <Route path="notifications" element={<A.AdminNotifications />} />
        </Route>
      </Routes>
      <Toasts />
    </HashRouter>
  );
}
