import { z, ZodError, type ZodTypeAny } from 'zod';
import type { Deps, RequestContext } from './context';
import type { Permission } from './rbac';
import { Schemas } from './schemas';
import { AppError } from './errors';
import { authenticate } from './services/auth';
import * as auth from './services/auth';
import * as account from './services/account';
import * as disc from './services/discovery';
import * as commerce from './services/commerce';
import * as merchant from './services/merchant';
import * as s2s from './services/store-orders';
import * as admin from './services/admin';
import { uuid } from './util';

/**
 * The single API route table (/api/v1). Transport adapters — Express for the server,
 * an in-browser adapter for the demo, and future mobile/AI gateways — all dispatch through
 * `dispatch()`, so validation, authentication and authorization are enforced identically
 * and never depend on frontend route guards.
 */
export type Method = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
export type Access = 'public' | 'optional' | 'auth' | Permission;

export interface RouteInput<Q = any, B = any> {
  params: Record<string, string>;
  query: Q;
  body: B;
}

export interface RouteDef {
  method: Method;
  path: string;
  tag: string;
  summary: string;
  access: Access;
  query?: ZodTypeAny;
  body?: ZodTypeAny;
  status?: number;
  /** Mutations that must be safe to retry require an Idempotency-Key header. */
  idempotent?: boolean;
  rateLimit?: 'auth' | 'write' | 'default';
  handler: (deps: Deps, ctx: RequestContext, input: RouteInput) => Promise<unknown> | unknown;
}

const r = (def: RouteDef) => def;
const S = Schemas;
const pageQ = z.object({ page: z.coerce.number().int().min(1).default(1), pageSize: z.coerce.number().int().min(1).max(100).default(25) });
const storeProductsQ = z.object({ category: z.string().optional(), q: z.string().max(120).optional(), inStock: z.preprocess((v) => v === 'true' || v === true, z.boolean()).optional(), page: z.coerce.number().default(1), pageSize: z.coerce.number().max(100).default(48) });

export const routes: RouteDef[] = [
  // ── Auth
  r({ method: 'POST', path: '/auth/register', tag: 'Auth', summary: 'Create a consumer account', access: 'public', body: S.register, status: 201, rateLimit: 'auth', handler: (d, c, i) => auth.register(d, c, i.body) }),
  r({ method: 'POST', path: '/auth/login', tag: 'Auth', summary: 'Sign in with email and password', access: 'public', body: S.login, rateLimit: 'auth', handler: (d, c, i) => auth.login(d, c, i.body) }),
  r({ method: 'POST', path: '/auth/mfa', tag: 'Auth', summary: 'Complete sign-in with a one-time code (administrators)', access: 'public', body: S.mfa, rateLimit: 'auth', handler: (d, c, i) => auth.verifyMfa(d, c, i.body) }),
  r({ method: 'POST', path: '/auth/refresh', tag: 'Auth', summary: 'Rotate refresh token and issue a new access token', access: 'public', body: S.refresh, rateLimit: 'auth', handler: (d, c, i) => auth.refresh(d, c, i.body) }),
  r({ method: 'POST', path: '/auth/logout', tag: 'Auth', summary: 'Revoke the current session', access: 'auth', handler: (d, c) => auth.logout(d, c) }),
  r({ method: 'GET', path: '/auth/me', tag: 'Auth', summary: 'Current user, roles and store memberships', access: 'auth', handler: (d, c) => auth.me(d, c) }),
  r({ method: 'POST', path: '/auth/verify-email', tag: 'Auth', summary: 'Confirm email address', access: 'public', body: S.token, handler: (d, c, i) => auth.verifyEmail(d, c, i.body) }),
  r({ method: 'POST', path: '/auth/resend-verification', tag: 'Auth', summary: 'Resend verification email', access: 'auth', rateLimit: 'auth', handler: (d, c) => auth.resendVerification(d, c) }),
  r({ method: 'POST', path: '/auth/forgot-password', tag: 'Auth', summary: 'Request a password reset link', access: 'public', body: S.forgot, rateLimit: 'auth', handler: (d, c, i) => auth.forgotPassword(d, c, i.body) }),
  r({ method: 'POST', path: '/auth/reset-password', tag: 'Auth', summary: 'Set a new password with a reset token', access: 'public', body: S.reset, rateLimit: 'auth', handler: (d, c, i) => auth.resetPassword(d, c, i.body) }),

  // ── Users (self-service)
  r({ method: 'PATCH', path: '/users/me', tag: 'Users', summary: 'Update profile and privacy preferences', access: 'profile.manage', body: S.profile, handler: (d, c, i) => account.updateProfile(d, c, i.body) }),
  r({ method: 'DELETE', path: '/users/me', tag: 'Users', summary: 'Delete account (anonymizes personal data)', access: 'profile.manage', handler: (d, c) => account.deleteAccount(d, c) }),
  r({ method: 'GET', path: '/users/me/export', tag: 'Users', summary: 'Export my personal data', access: 'profile.manage', handler: (d, c) => account.exportMyData(d, c) }),
  r({ method: 'GET', path: '/users/me/addresses', tag: 'Users', summary: 'Saved locations', access: 'profile.manage', handler: (d, c) => account.listAddresses(d, c) }),
  r({ method: 'POST', path: '/users/me/addresses', tag: 'Users', summary: 'Save a location', access: 'profile.manage', body: S.address, status: 201, handler: (d, c, i) => account.addAddress(d, c, i.body) }),
  r({ method: 'DELETE', path: '/users/me/addresses/:id', tag: 'Users', summary: 'Remove a saved location', access: 'profile.manage', handler: (d, c, i) => account.deleteAddress(d, c, i.params.id) }),
  r({ method: 'GET', path: '/users/me/favorites', tag: 'Users', summary: 'Favorite stores and products', access: 'favorites.manage', handler: (d, c) => account.listFavorites(d, c) }),
  r({ method: 'POST', path: '/users/me/favorites', tag: 'Users', summary: 'Add a favorite', access: 'favorites.manage', body: S.favorite, status: 201, handler: (d, c, i) => account.addFavorite(d, c, i.body) }),
  r({ method: 'DELETE', path: '/users/me/favorites/:id', tag: 'Users', summary: 'Remove a favorite', access: 'favorites.manage', handler: (d, c, i) => account.removeFavorite(d, c, i.params.id) }),

  // ── Locations
  r({ method: 'GET', path: '/locations/geocode', tag: 'Locations', summary: 'Geocode a city, neighborhood or ZIP code', access: 'public', query: z.object({ q: z.string().max(120) }), handler: (d, c, i) => disc.geocode(d, c, i.query.q) }),
  r({ method: 'GET', path: '/locations/reverse', tag: 'Locations', summary: 'Reverse-geocode coordinates', access: 'public', query: z.object({ lat: z.coerce.number().min(-90).max(90), lng: z.coerce.number().min(-180).max(180) }), handler: (d, c, i) => disc.reverseGeocode(d, c, i.query.lat, i.query.lng) }),
  r({ method: 'GET', path: '/locations/markets', tag: 'Locations', summary: 'Active geographic markets', access: 'public', handler: (d) => disc.listMarkets(d) }),

  // ── Catalog & discovery
  r({ method: 'GET', path: '/categories', tag: 'Catalog', summary: 'Category tree', access: 'public', handler: (d) => disc.categoryTree(d) }),
  r({ method: 'GET', path: '/products/:id', tag: 'Catalog', summary: 'Product details', access: 'optional', handler: (d, c, i) => disc.getProduct(d, c, i.params.id) }),
  r({ method: 'GET', path: '/products/:id/availability', tag: 'Catalog', summary: 'Nearby stores carrying this product, with price and stock', access: 'optional', query: S.geoQuery, handler: (d, c, i) => disc.productAvailability(d, c, i.params.id, i.query) }),
  r({ method: 'GET', path: '/stores', tag: 'Stores', summary: 'Nearby stores (radius, type, city/state, open now)', access: 'public', query: S.nearbyStores, handler: (d, c, i) => disc.nearbyStores(d, c, i.query) }),
  r({ method: 'GET', path: '/stores/:id', tag: 'Stores', summary: 'Public store profile', access: 'optional', query: z.object({ lat: z.coerce.number().optional(), lng: z.coerce.number().optional() }), handler: (d, c, i) => disc.getStore(d, c, i.params.id, i.query) }),
  r({ method: 'GET', path: '/stores/:id/products', tag: 'Stores', summary: 'Products sold by a store', access: 'optional', query: storeProductsQ, handler: (d, c, i) => disc.storeProducts(d, c, i.params.id, i.query) }),
  r({ method: 'GET', path: '/search', tag: 'Search', summary: 'Location-aware product and store search', access: 'optional', query: S.search, handler: (d, c, i) => disc.search(d, c, i.query) }),
  r({ method: 'GET', path: '/offers', tag: 'Offers', summary: 'Live offers near a location', access: 'optional', query: S.geoQuery, handler: (d, c, i) => disc.nearbyOffers(d, c, i.query) }),

  // ── Cart & orders
  r({ method: 'GET', path: '/cart', tag: 'Cart', summary: 'Cart grouped by store with live pricing', access: 'cart.manage', handler: (d, c) => commerce.getCart(d, c) }),
  r({ method: 'POST', path: '/cart/items', tag: 'Cart', summary: 'Add an item', access: 'cart.manage', body: S.cartAdd, handler: (d, c, i) => commerce.addToCart(d, c, i.body) }),
  r({ method: 'PATCH', path: '/cart/items/:id', tag: 'Cart', summary: 'Change quantity (0 removes)', access: 'cart.manage', body: S.cartUpdate, handler: (d, c, i) => commerce.updateCartItem(d, c, i.params.id, i.body) }),
  r({ method: 'DELETE', path: '/cart/items/:id', tag: 'Cart', summary: 'Remove an item', access: 'cart.manage', handler: (d, c, i) => commerce.removeCartItem(d, c, i.params.id) }),
  r({ method: 'POST', path: '/orders/checkout', tag: 'Orders', summary: 'Place an order for one store (validates store, stock, price, tax; authorizes payment)', access: 'orders.own', body: S.checkout, status: 201, idempotent: true, rateLimit: 'write', handler: (d, c, i) => commerce.checkout(d, c, i.body) }),
  r({ method: 'GET', path: '/orders', tag: 'Orders', summary: 'My order history', access: 'orders.own', query: pageQ, handler: (d, c, i) => commerce.listMyOrders(d, c, i.query) }),
  r({ method: 'GET', path: '/orders/:id', tag: 'Orders', summary: 'Order detail and tracking', access: 'orders.own', handler: (d, c, i) => commerce.getOrder(d, c, i.params.id) }),
  r({ method: 'POST', path: '/orders/:id/cancel', tag: 'Orders', summary: 'Cancel before the store starts preparing', access: 'orders.own', body: S.cancel, handler: (d, c, i) => commerce.cancelMyOrder(d, c, i.params.id, i.body) }),

  // ── Notifications, support, analytics
  r({ method: 'GET', path: '/notifications', tag: 'Notifications', summary: 'In-app notifications', access: 'notifications.own', query: pageQ, handler: (d, c, i) => account.listNotifications(d, c, i.query) }),
  r({ method: 'POST', path: '/notifications/:id/read', tag: 'Notifications', summary: 'Mark read (id or "all")', access: 'notifications.own', handler: (d, c, i) => account.markNotificationRead(d, c, i.params.id) }),
  r({ method: 'POST', path: '/support/tickets', tag: 'Support', summary: 'Contact support', access: 'optional', body: S.support, status: 201, rateLimit: 'write', handler: (d, c, i) => account.createTicket(d, c, i.body) }),
  r({ method: 'POST', path: '/analytics/events', tag: 'Analytics', summary: 'Record a client analytics event', access: 'optional', body: S.track, status: 202, handler: (d, c, i) => account.track(d, c, i.body) }),

  // ── Merchant
  r({ method: 'POST', path: '/merchant/applications', tag: 'Merchant', summary: 'Apply to sell on RetailGeo (business + first store)', access: 'profile.manage', body: S.application, status: 201, rateLimit: 'write', handler: (d, c, i) => merchant.applyAsMerchant(d, c, i.body) }),
  r({ method: 'GET', path: '/merchant/me', tag: 'Merchant', summary: 'My businesses and stores', access: 'merchant.access', handler: (d, c) => merchant.myBusinesses(d, c) }),
  r({ method: 'GET', path: '/merchant/stores/:storeId/dashboard', tag: 'Merchant', summary: 'Dashboard metrics', access: 'merchant.access', handler: (d, c, i) => merchant.dashboard(d, c, i.params.storeId) }),
  r({ method: 'GET', path: '/merchant/stores/:storeId/reports', tag: 'Merchant', summary: 'Sales, funnel and product reports', access: 'merchant.access', query: z.object({ days: z.coerce.number().int().min(7).max(90).default(30) }), handler: (d, c, i) => merchant.reports(d, c, i.params.storeId, i.query.days) }),
  r({ method: 'PATCH', path: '/merchant/stores/:storeId', tag: 'Merchant', summary: 'Update store profile and location', access: 'merchant.access', body: S.storeUpdate, handler: (d, c, i) => merchant.updateStore(d, c, i.params.storeId, i.body) }),
  r({ method: 'GET', path: '/merchant/stores/:storeId/hours', tag: 'Merchant', summary: 'Business hours', access: 'merchant.access', handler: (d, c, i) => merchant.getHours(d, c, i.params.storeId) }),
  r({ method: 'PUT', path: '/merchant/stores/:storeId/hours', tag: 'Merchant', summary: 'Replace business hours', access: 'merchant.access', body: S.hours, handler: (d, c, i) => merchant.setHours(d, c, i.params.storeId, i.body) }),
  r({ method: 'GET', path: '/merchant/stores/:storeId/staff', tag: 'Merchant', summary: 'Store staff', access: 'merchant.access', handler: (d, c, i) => merchant.listStaff(d, c, i.params.storeId) }),
  r({ method: 'POST', path: '/merchant/stores/:storeId/staff', tag: 'Merchant', summary: 'Invite an employee', access: 'staff.manage', body: S.employee, status: 201, handler: (d, c, i) => merchant.addStaff(d, c, i.params.storeId, i.body) }),
  r({ method: 'PATCH', path: '/merchant/stores/:storeId/staff/:staffId', tag: 'Merchant', summary: 'Change employee capabilities', access: 'merchant.access', body: S.employeeUpdate, handler: (d, c, i) => merchant.updateStaff(d, c, i.params.storeId, i.params.staffId, i.body) }),
  r({ method: 'DELETE', path: '/merchant/stores/:storeId/staff/:staffId', tag: 'Merchant', summary: 'Remove an employee', access: 'merchant.access', handler: (d, c, i) => merchant.removeStaff(d, c, i.params.storeId, i.params.staffId) }),
  r({ method: 'GET', path: '/merchant/stores/:storeId/inventory', tag: 'Inventory', summary: 'Store listings with stock status', access: 'merchant.access', query: S.listQuery, handler: (d, c, i) => merchant.listInventory(d, c, i.params.storeId, i.query) }),
  r({ method: 'PATCH', path: '/merchant/stores/:storeId/inventory/:listingId', tag: 'Inventory', summary: 'Update price, stock, visibility, B2B terms', access: 'merchant.access', body: S.listingUpdate, handler: (d, c, i) => merchant.updateListing(d, c, i.params.storeId, i.params.listingId, i.body) }),
  r({ method: 'GET', path: '/merchant/stores/:storeId/inventory/:listingId/history', tag: 'Inventory', summary: 'Inventory change history', access: 'merchant.access', handler: (d, c, i) => merchant.inventoryHistory(d, c, i.params.storeId, i.params.listingId) }),
  r({ method: 'POST', path: '/merchant/stores/:storeId/inventory/import', tag: 'Inventory', summary: 'CSV / bulk inventory upload (supports dry run)', access: 'merchant.access', body: S.inventoryImport, rateLimit: 'write', handler: (d, c, i) => merchant.importInventoryCsv(d, c, i.params.storeId, i.body) }),
  r({ method: 'POST', path: '/merchant/stores/:storeId/products', tag: 'Catalog', summary: 'Add a product (reuses catalog entry on UPC match)', access: 'merchant.access', body: S.productCreate, status: 201, handler: (d, c, i) => merchant.createProduct(d, c, i.params.storeId, i.body) }),
  r({ method: 'GET', path: '/merchant/stores/:storeId/orders', tag: 'Merchant orders', summary: 'Customer orders', access: 'merchant.access', query: S.listQuery, handler: (d, c, i) => merchant.listStoreOrders(d, c, i.params.storeId, i.query) }),
  r({ method: 'GET', path: '/merchant/stores/:storeId/orders/:orderId', tag: 'Merchant orders', summary: 'Customer order detail', access: 'merchant.access', handler: (d, c, i) => merchant.merchantOrder(d, c, i.params.storeId, i.params.orderId) }),
  r({ method: 'POST', path: '/merchant/stores/:storeId/orders/:orderId/status', tag: 'Merchant orders', summary: 'Advance fulfillment status', access: 'merchant.access', body: S.merchantOrderStatus, handler: (d, c, i) => merchant.setOrderStatus(d, c, i.params.storeId, i.params.orderId, i.body) }),
  r({ method: 'GET', path: '/merchant/stores/:storeId/offers', tag: 'Offers', summary: 'Store offers', access: 'merchant.access', handler: (d, c, i) => merchant.listOffers(d, c, i.params.storeId) }),
  r({ method: 'POST', path: '/merchant/stores/:storeId/offers', tag: 'Offers', summary: 'Create an offer', access: 'merchant.access', body: S.offer, status: 201, handler: (d, c, i) => merchant.createOffer(d, c, i.params.storeId, i.body) }),
  r({ method: 'PUT', path: '/merchant/stores/:storeId/offers/:offerId', tag: 'Offers', summary: 'Edit an offer', access: 'merchant.access', body: S.offer, handler: (d, c, i) => merchant.updateOffer(d, c, i.params.storeId, i.params.offerId, i.body) }),
  r({ method: 'POST', path: '/merchant/stores/:storeId/offers/:offerId/status', tag: 'Offers', summary: 'Pause or resume an offer', access: 'merchant.access', body: z.object({ status: z.enum(['active', 'paused']) }), handler: (d, c, i) => merchant.setOfferStatus(d, c, i.params.storeId, i.params.offerId, i.body.status) }),

  // ── Store-to-store
  r({ method: 'GET', path: '/store-orders/sourcing', tag: 'Store-to-store', summary: 'Find nearby stores offering an item wholesale', access: 'merchant.access', query: S.sourcing, handler: (d, c, i) => s2s.sourcing(d, c, i.query) }),
  r({ method: 'GET', path: '/store-orders', tag: 'Store-to-store', summary: 'Requests sent and received by a store', access: 'merchant.access', query: z.object({ storeId: z.string().uuid(), role: z.enum(['buyer', 'seller']).optional(), status: z.string().optional(), page: z.coerce.number().default(1), pageSize: z.coerce.number().default(25) }), handler: (d, c, i) => s2s.listStoreOrdersFor(d, c, i.query.storeId, i.query) }),
  r({ method: 'POST', path: '/store-orders', tag: 'Store-to-store', summary: 'Create (and optionally submit) a stock request', access: 'merchant.access', body: S.storeOrderCreate, status: 201, idempotent: true, rateLimit: 'write', handler: (d, c, i) => s2s.createStoreOrder(d, c, i.body) }),
  r({ method: 'GET', path: '/store-orders/:id', tag: 'Store-to-store', summary: 'Request detail', access: 'merchant.access', query: z.object({ storeId: z.string().uuid() }), handler: (d, c, i) => s2s.getStoreOrder(d, c, i.params.id, i.query.storeId) }),
  r({ method: 'POST', path: '/store-orders/:id/transition', tag: 'Store-to-store', summary: 'Submit, accept (with quantity adjustment), reject, prepare, fulfil, complete or cancel', access: 'merchant.access', body: S.storeOrderTransition, handler: (d, c, i) => s2s.transitionStoreOrder(d, c, i.params.id, i.body) }),

  // ── Admin
  r({ method: 'GET', path: '/admin/dashboard', tag: 'Admin', summary: 'Platform overview', access: 'admin.access', handler: (d) => admin.dashboard(d) }),
  r({ method: 'GET', path: '/admin/reports', tag: 'Admin', summary: 'Platform funnel and geography report', access: 'admin.reports', query: z.object({ days: z.coerce.number().int().min(7).max(90).default(30) }), handler: (d, _c, i) => admin.platformReport(d, i.query.days) }),
  r({ method: 'GET', path: '/admin/merchants', tag: 'Admin', summary: 'Merchant businesses and applications', access: 'admin.merchants', query: S.listQuery, handler: (d, _c, i) => admin.listMerchants(d, i.query) }),
  r({ method: 'POST', path: '/admin/merchants/:id/review', tag: 'Admin', summary: 'Approve or reject an application', access: 'admin.merchants', body: S.review, handler: (d, c, i) => admin.reviewMerchant(d, c, i.params.id, i.body) }),
  r({ method: 'POST', path: '/admin/merchants/:id/status', tag: 'Admin', summary: 'Suspend or reactivate a business', access: 'admin.stores', body: S.statusChange, handler: (d, c, i) => admin.setMerchantStatus(d, c, i.params.id, i.body) }),
  r({ method: 'GET', path: '/admin/stores', tag: 'Admin', summary: 'All stores', access: 'admin.stores', query: S.listQuery, handler: (d, _c, i) => admin.listStores(d, i.query) }),
  r({ method: 'POST', path: '/admin/stores/:id/status', tag: 'Admin', summary: 'Verify, suspend, reactivate or close a store', access: 'admin.stores', body: S.statusChange, handler: (d, c, i) => admin.setStoreStatus(d, c, i.params.id, i.body) }),
  r({ method: 'POST', path: '/admin/stores/:id/transfer', tag: 'Admin', summary: 'Transfer store ownership', access: 'admin.users', body: S.transferOwnership, handler: (d, c, i) => admin.transferStore(d, c, i.params.id, i.body) }),
  r({ method: 'GET', path: '/admin/users', tag: 'Admin', summary: 'Users', access: 'admin.users', query: S.listQuery, handler: (d, _c, i) => admin.listUsers(d, i.query) }),
  r({ method: 'PATCH', path: '/admin/users/:id', tag: 'Admin', summary: 'Enable/disable a user or change roles', access: 'admin.roles', body: S.userAdmin, handler: (d, c, i) => admin.updateUser(d, c, i.params.id, i.body) }),
  r({ method: 'GET', path: '/admin/roles', tag: 'Admin', summary: 'Role and permission matrix', access: 'admin.access', handler: () => admin.roleMatrix() }),
  r({ method: 'POST', path: '/admin/categories', tag: 'Admin', summary: 'Create a category', access: 'admin.catalog', body: S.category, status: 201, handler: (d, c, i) => admin.upsertCategory(d, c, null, i.body) }),
  r({ method: 'PUT', path: '/admin/categories/:id', tag: 'Admin', summary: 'Edit a category', access: 'admin.catalog', body: S.category, handler: (d, c, i) => admin.upsertCategory(d, c, i.params.id, i.body) }),
  r({ method: 'GET', path: '/admin/products', tag: 'Admin', summary: 'Catalog products', access: 'admin.moderation', query: S.listQuery, handler: (d, _c, i) => admin.listProducts(d, i.query) }),
  r({ method: 'POST', path: '/admin/products/:id/moderate', tag: 'Admin', summary: 'Approve, reject or archive a product', access: 'admin.moderation', body: S.moderate, handler: (d, c, i) => admin.moderateProduct(d, c, i.params.id, i.body) }),
  r({ method: 'GET', path: '/admin/products/duplicates', tag: 'Admin', summary: 'Possible duplicate products', access: 'admin.moderation', handler: (d) => admin.duplicateProducts(d) }),
  r({ method: 'GET', path: '/admin/markets', tag: 'Admin', summary: 'Markets with city/ZIP coverage', access: 'admin.access', handler: (d) => admin.marketCoverage(d) }),
  r({ method: 'POST', path: '/admin/markets', tag: 'Admin', summary: 'Create a market', access: 'admin.markets', body: S.market, status: 201, handler: (d, c, i) => admin.upsertMarket(d, c, null, i.body) }),
  r({ method: 'PUT', path: '/admin/markets/:id', tag: 'Admin', summary: 'Edit a market', access: 'admin.markets', body: S.market, handler: (d, c, i) => admin.upsertMarket(d, c, i.params.id, i.body) }),
  r({ method: 'GET', path: '/admin/orders', tag: 'Admin', summary: 'Consumer orders', access: 'admin.orders', query: S.listQuery, handler: (d, _c, i) => admin.listOrders(d, i.query) }),
  r({ method: 'GET', path: '/admin/orders/:id', tag: 'Admin', summary: 'Order detail with payment transactions', access: 'admin.orders', handler: (d, c, i) => admin.adminOrder(d, c, i.params.id) }),
  r({ method: 'POST', path: '/admin/orders/:id/status', tag: 'Admin', summary: 'Override order status (exceptions)', access: 'admin.disputes', body: S.statusChange, handler: (d, c, i) => admin.adminOrderStatus(d, c, i.params.id, i.body) }),
  r({ method: 'POST', path: '/admin/orders/:id/refund', tag: 'Admin', summary: 'Full or partial refund', access: 'admin.payments', body: S.refund, idempotent: true, handler: (d, c, i) => admin.adminRefund(d, c, i.params.id, i.body) }),
  r({ method: 'GET', path: '/admin/store-orders', tag: 'Admin', summary: 'Store-to-store orders', access: 'admin.orders', query: S.listQuery, handler: (d, _c, i) => admin.listAllStoreOrders(d, i.query) }),
  r({ method: 'GET', path: '/admin/store-orders/:id', tag: 'Admin', summary: 'Store-to-store order detail', access: 'admin.orders', handler: (d, c, i) => admin.adminStoreOrder(d, c, i.params.id) }),
  r({ method: 'GET', path: '/admin/support', tag: 'Admin', summary: 'Support tickets and disputes', access: 'admin.support', query: S.listQuery, handler: (d, _c, i) => admin.listTickets(d, i.query) }),
  r({ method: 'PATCH', path: '/admin/support/:id', tag: 'Admin', summary: 'Update ticket status', access: 'admin.support', body: S.ticketUpdate, handler: (d, c, i) => admin.updateTicket(d, c, i.params.id, i.body) }),
  r({ method: 'GET', path: '/admin/audit-logs', tag: 'Admin', summary: 'Audit trail (who, what, when, before/after, IP)', access: 'admin.audit', query: S.listQuery, handler: (d, _c, i) => admin.auditLogs(d, i.query) }),
  r({ method: 'GET', path: '/admin/settings', tag: 'Admin', summary: 'System configuration', access: 'admin.settings', handler: (d) => admin.listSettings(d) }),
  r({ method: 'PUT', path: '/admin/settings/:key', tag: 'Admin', summary: 'Update a setting', access: 'admin.settings', body: S.setting, handler: (d, c, i) => admin.updateSetting(d, c, i.params.key, i.body) }),
  r({ method: 'POST', path: '/admin/notifications/broadcast', tag: 'Admin', summary: 'Send a system notification', access: 'admin.notifications', body: S.broadcast, handler: (d, c, i) => admin.broadcast(d, c, i.body) }),
];

// ─── Dispatcher ───────────────────────────────────────────────────────────
interface Compiled {
  def: RouteDef;
  re: RegExp;
  keys: string[];
}
const compiled: Compiled[] = routes.map((def) => {
  const keys: string[] = [];
  const re = new RegExp('^' + def.path.replace(/:([A-Za-z]+)/g, (_m, k) => (keys.push(k), '([^/]+)')) + '/?$');
  return { def, re, keys };
});

export function matchRoute(method: string, path: string) {
  let pathMatched = false;
  // Static segments win over params (e.g. /admin/products/duplicates vs /admin/products/:id).
  const hits = compiled
    .map((c) => ({ c, m: path.match(c.re) }))
    .filter((x) => x.m)
    .sort((a, b) => a.c.keys.length - b.c.keys.length);
  for (const { c, m } of hits) {
    pathMatched = true;
    if (c.def.method !== method) continue;
    const params: Record<string, string> = {};
    c.keys.forEach((k, i) => (params[k] = decodeURIComponent(m![i + 1])));
    return { def: c.def, params };
  }
  return pathMatched ? 'method_not_allowed' : null;
}

export interface DispatchRequest {
  method: string;
  path: string; // relative to /api/v1
  query: Record<string, unknown>;
  body: unknown;
  headers: Record<string, string | undefined>;
  ip?: string | null;
}
export interface DispatchResponse {
  status: number;
  body: unknown;
}

function zodDetails(e: ZodError) {
  return e.issues.map((i) => ({ field: i.path.join('.'), message: i.message }));
}

export async function dispatch(deps: Deps, req: DispatchRequest): Promise<DispatchResponse> {
  const requestId = req.headers['x-request-id'] ?? uuid();
  try {
    const m = matchRoute(req.method.toUpperCase(), req.path);
    if (m === null) throw new AppError('NOT_FOUND', `No API route for ${req.path}.`);
    if (m === 'method_not_allowed') return { status: 405, body: { error: { code: 'METHOD_NOT_ALLOWED', message: `${req.method} is not supported for ${req.path}.` } } };
    const { def, params } = m;
    const bearer = req.headers.authorization?.match(/^Bearer (.+)$/i)?.[1] ?? null;
    const user = await authenticate(deps, bearer);
    if (def.access !== 'public' && def.access !== 'optional') {
      if (!user) throw new AppError('UNAUTHENTICATED', 'Sign in to continue.');
      if (def.access !== 'auth' && !user.permissions.has(def.access)) throw new AppError('FORBIDDEN', 'You do not have permission to do that.');
    }
    const idempotencyKey = req.headers['idempotency-key'] ?? null;
    if (def.idempotent && !idempotencyKey) throw new AppError('VALIDATION_FAILED', 'Idempotency-Key header is required for this request.');
    const ctx: RequestContext = { user, ip: req.ip ?? null, userAgent: req.headers['user-agent'] ?? null, requestId, idempotencyKey };
    const query = def.query ? def.query.parse(req.query ?? {}) : req.query;
    const body = def.body ? def.body.parse(req.body ?? {}) : req.body;
    const result = await def.handler(deps, ctx, { params, query, body });
    return { status: def.status ?? 200, body: result ?? { ok: true } };
  } catch (e) {
    if (e instanceof ZodError) return { status: 422, body: { error: { code: 'VALIDATION_FAILED', message: e.issues[0]?.message ?? 'Check the highlighted fields.', details: zodDetails(e) }, requestId } };
    if (e instanceof AppError) return { status: e.status, body: { ...e.toJSON(), requestId } };
    console.error('[retailgeo] unhandled', requestId, e);
    return { status: 500, body: { error: { code: 'INTERNAL', message: 'Something went wrong on our side. Try again in a moment.' }, requestId } };
  }
}
