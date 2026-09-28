import type * as T from './types';

/**
 * Persistence port. Services depend only on this interface; the API binds it to
 * PostgreSQL + PostGIS (apps/api/src/pg-store.ts) and the web demo binds it to an
 * in-memory store (memory-store.ts). Geo and search queries are explicit methods so each
 * store can use its native strengths (ST_DWithin / pg_trgm on Postgres).
 */
export type Op<V> = { $ne?: V; $gte?: V; $lte?: V; $gt?: V; $lt?: V; $ilike?: string; $null?: boolean; $in?: V[] };
export type Where<R> = { [K in keyof R]?: R[K] | Op<R[K]> };
export interface FindOpts<R> {
  orderBy?: [keyof R & string, 'asc' | 'desc'][];
  limit?: number;
  offset?: number;
}

export interface Table<R extends { id: string }> {
  get(id: string): Promise<R | null>;
  findOne(where: Where<R>): Promise<R | null>;
  findMany(where?: Where<R>, opts?: FindOpts<R>): Promise<R[]>;
  count(where?: Where<R>): Promise<number>;
  insert(row: R): Promise<R>;
  update(id: string, patch: Partial<R>): Promise<R>;
  delete(id: string): Promise<void>;
}

export interface NearbyStoreQuery {
  lat: number;
  lng: number;
  radiusMi: number;
  storeTypes?: T.StoreType[];
  text?: string;
  marketId?: string;
  city?: string;
  state?: string;
  statuses?: T.StoreStatus[];
  limit?: number;
}
export interface StoreHit {
  store: T.Store;
  distanceMi: number | null;
}

export interface ListingQuery {
  text?: string;
  productId?: string;
  categoryIds?: string[];
  storeIds?: string[];
  storeTypes?: T.StoreType[];
  lat?: number;
  lng?: number;
  radiusMi?: number;
  inStockOnly?: boolean;
  b2bOnly?: boolean;
  excludeStoreId?: string;
  limit?: number;
}
export interface ListingHit {
  listing: T.StoreProduct;
  product: T.Product;
  store: T.Store;
  distanceMi: number | null;
  /** Relevance 0..1 (1 = exact SKU/UPC or exact name). */
  score: number;
}

export interface DataStore {
  users: Table<T.User>;
  userRoles: Table<T.UserRole>;
  sessions: Table<T.Session>;
  authTokens: Table<T.AuthToken>;
  businesses: Table<T.Business>;
  stores: Table<T.Store>;
  storeHours: Table<T.StoreHours>;
  storeUsers: Table<T.StoreUser>;
  markets: Table<T.GeographicMarket>;
  categories: Table<T.Category>;
  brands: Table<T.Brand>;
  products: Table<T.Product>;
  variants: Table<T.ProductVariant>;
  storeProducts: Table<T.StoreProduct>;
  inventoryEvents: Table<T.InventoryEvent>;
  offers: Table<T.Offer>;
  addresses: Table<T.Address>;
  carts: Table<T.Cart>;
  cartItems: Table<T.CartItem>;
  orders: Table<T.Order>;
  orderItems: Table<T.OrderItem>;
  statusHistory: Table<T.StatusHistory>;
  storeOrders: Table<T.StoreOrder>;
  storeOrderItems: Table<T.StoreOrderItem>;
  payments: Table<T.Payment>;
  paymentTransactions: Table<T.PaymentTransaction>;
  notifications: Table<T.Notification>;
  favorites: Table<T.Favorite>;
  supportTickets: Table<T.SupportTicket>;
  searchEvents: Table<T.SearchEvent>;
  analyticsEvents: Table<T.AnalyticsEvent>;
  auditLogs: Table<T.AuditLog>;
  settings: Table<T.SystemSetting>;
  searchIndex: Table<T.SearchIndexMetadata>;

  storesNear(q: NearbyStoreQuery): Promise<StoreHit[]>;
  searchListings(q: ListingQuery): Promise<ListingHit[]>;
  /** Atomically decrement stock; returns false if not enough quantity. */
  decrementStock(storeProductId: string, qty: number): Promise<boolean>;
  /** Run fn in a transaction. The DataStore passed to fn must be used for all work inside. */
  tx<R>(fn: (db: DataStore) => Promise<R>): Promise<R>;
}

export const TABLE_NAMES = [
  'users', 'userRoles', 'sessions', 'authTokens', 'businesses', 'stores', 'storeHours', 'storeUsers', 'markets',
  'categories', 'brands', 'products', 'variants', 'storeProducts', 'inventoryEvents', 'offers', 'addresses',
  'carts', 'cartItems', 'orders', 'orderItems', 'statusHistory', 'storeOrders', 'storeOrderItems', 'payments',
  'paymentTransactions', 'notifications', 'favorites', 'supportTickets', 'searchEvents', 'analyticsEvents',
  'auditLogs', 'settings', 'searchIndex',
] as const;
export type TableName = (typeof TABLE_NAMES)[number];
