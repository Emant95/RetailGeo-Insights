-- RetailGeo Insights — Phase 1 schema (PostgreSQL 15+ with PostGIS 3)
-- Money is stored as integer cents. Distances are statute miles in the API; PostGIS uses meters.
-- IDs are application-generated UUIDs so every data store (Postgres, in-memory) behaves the same.

CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS citext;

-- ─── Identity & access ─────────────────────────────────────────────────────
CREATE TABLE users (
  id                uuid PRIMARY KEY,
  email             citext NOT NULL,
  password_hash     text NOT NULL,
  full_name         text NOT NULL,
  phone             text,
  status            text NOT NULL DEFAULT 'active' CHECK (status IN ('active','pending_verification','locked','disabled')),
  email_verified_at timestamptz,
  mfa_enabled       boolean NOT NULL DEFAULT false,
  failed_logins     integer NOT NULL DEFAULT 0 CHECK (failed_logins >= 0),
  locked_until      timestamptz,
  marketing_consent boolean NOT NULL DEFAULT false,
  location_sharing  boolean NOT NULL DEFAULT false,
  deleted_at        timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX users_email_uq ON users (email);

CREATE TABLE roles (
  key   text PRIMARY KEY,
  label text NOT NULL
);
CREATE TABLE permissions (
  key text PRIMARY KEY
);
CREATE TABLE role_permissions (
  role_key       text NOT NULL REFERENCES roles(key) ON DELETE CASCADE,
  permission_key text NOT NULL REFERENCES permissions(key) ON DELETE CASCADE,
  PRIMARY KEY (role_key, permission_key)
);

CREATE TABLE businesses (
  id             uuid PRIMARY KEY,
  legal_name     text NOT NULL,
  dba_name       text,
  ein_last4      char(4),
  owner_user_id  uuid NOT NULL REFERENCES users(id),
  status         text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','suspended')),
  contact_email  text NOT NULL,
  contact_phone  text,
  review_notes   text,
  reviewed_by    uuid REFERENCES users(id),
  reviewed_at    timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX businesses_status_idx ON businesses (status);

CREATE TABLE user_roles (
  id          uuid PRIMARY KEY,
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role        text NOT NULL REFERENCES roles(key),
  business_id uuid REFERENCES businesses(id) ON DELETE CASCADE,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX user_roles_uq ON user_roles (user_id, role, COALESCE(business_id, '00000000-0000-0000-0000-000000000000'::uuid));

CREATE TABLE sessions (
  id          uuid PRIMARY KEY,
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash  text NOT NULL,
  expires_at  timestamptz NOT NULL,
  revoked_at  timestamptz,
  ip          inet,
  user_agent  text,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX sessions_user_idx ON sessions (user_id) WHERE revoked_at IS NULL;

CREATE TABLE auth_tokens (
  id          uuid PRIMARY KEY,
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  purpose     text NOT NULL CHECK (purpose IN ('verify_email','reset_password','mfa')),
  token_hash  text NOT NULL,
  expires_at  timestamptz NOT NULL,
  consumed_at timestamptz,
  attempts    integer NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- ─── Geography & stores ─────────────────────────────────────────────────────
CREATE TABLE geographic_markets (
  id         uuid PRIMARY KEY,
  name       text NOT NULL,
  state      char(2) NOT NULL,
  latitude   double precision NOT NULL CHECK (latitude BETWEEN -90 AND 90),
  longitude  double precision NOT NULL CHECK (longitude BETWEEN -180 AND 180),
  center     geography(Point, 4326) GENERATED ALWAYS AS (ST_SetSRID(ST_MakePoint(longitude, latitude), 4326)::geography) STORED,
  radius_mi  double precision NOT NULL CHECK (radius_mi > 0),
  status     text NOT NULL DEFAULT 'planned' CHECK (status IN ('active','planned','paused')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE stores (
  id                 uuid PRIMARY KEY,
  business_id        uuid NOT NULL REFERENCES businesses(id),
  market_id          uuid REFERENCES geographic_markets(id),
  name               text NOT NULL,
  slug               text NOT NULL UNIQUE,
  store_type         text NOT NULL CHECK (store_type IN ('grocery','convenience','gas_station','pharmacy','specialty','retail')),
  description        text NOT NULL DEFAULT '',
  address_line1      text NOT NULL,
  city               text NOT NULL,
  county             text,
  state              char(2) NOT NULL,
  zip                text NOT NULL CHECK (zip ~ '^\d{5}(-\d{4})?$'),
  latitude           double precision NOT NULL CHECK (latitude BETWEEN -90 AND 90),
  longitude          double precision NOT NULL CHECK (longitude BETWEEN -180 AND 180),
  location           geography(Point, 4326) GENERATED ALWAYS AS (ST_SetSRID(ST_MakePoint(longitude, latitude), 4326)::geography) STORED,
  service_radius_mi  double precision NOT NULL DEFAULT 5 CHECK (service_radius_mi >= 0),
  phone              text,
  email              text,
  website            text,
  services           text[] NOT NULL DEFAULT '{}',
  pickup_enabled     boolean NOT NULL DEFAULT true,
  delivery_enabled   boolean NOT NULL DEFAULT false,
  delivery_fee_cents integer NOT NULL DEFAULT 0 CHECK (delivery_fee_cents >= 0),
  status             text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','active','suspended','closed')),
  verified_at        timestamptz,
  deleted_at         timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX stores_location_gix ON stores USING GIST (location);
CREATE INDEX stores_market_idx ON stores (market_id);
CREATE INDEX stores_status_type_idx ON stores (status, store_type) WHERE deleted_at IS NULL;
CREATE INDEX stores_city_state_idx ON stores (lower(city), state);
CREATE INDEX stores_name_trgm ON stores USING GIN (name gin_trgm_ops);

CREATE TABLE store_hours (
  id          uuid PRIMARY KEY,
  store_id    uuid NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  day_of_week smallint NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),
  opens       text NOT NULL,
  closes      text NOT NULL,
  closed      boolean NOT NULL DEFAULT false,
  UNIQUE (store_id, day_of_week)
);

CREATE TABLE store_users (
  id           uuid PRIMARY KEY,
  store_id     uuid NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  user_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  staff_role   text NOT NULL CHECK (staff_role IN ('manager','employee')),
  capabilities text[] NOT NULL DEFAULT '{}',
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (store_id, user_id)
);

-- ─── Catalog ────────────────────────────────────────────────────────────────
CREATE TABLE categories (
  id        uuid PRIMARY KEY,
  parent_id uuid REFERENCES categories(id),
  name      text NOT NULL,
  slug      text NOT NULL UNIQUE,
  sort      integer NOT NULL DEFAULT 0,
  icon      text
);

CREATE TABLE brands (
  id   uuid PRIMARY KEY,
  name text NOT NULL
);
CREATE UNIQUE INDEX brands_name_uq ON brands (lower(name));

CREATE TABLE products (
  id                  uuid PRIMARY KEY,
  category_id         uuid NOT NULL REFERENCES categories(id),
  brand_id            uuid REFERENCES brands(id),
  name                text NOT NULL,
  slug                text NOT NULL UNIQUE,
  description         text NOT NULL DEFAULT '',
  upc                 text CHECK (upc ~ '^\d{8,14}$'),
  sku                 text NOT NULL,
  unit                text NOT NULL DEFAULT 'each',
  size                text,
  attributes          jsonb NOT NULL DEFAULT '{}',
  images              text[] NOT NULL DEFAULT '{}',
  status              text NOT NULL DEFAULT 'active' CHECK (status IN ('active','pending_review','rejected','archived')),
  created_by_store_id uuid REFERENCES stores(id),
  deleted_at          timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  search_vector       tsvector GENERATED ALWAYS AS (to_tsvector('english', coalesce(name,'') || ' ' || coalesce(size,'') || ' ' || coalesce(description,''))) STORED
);
CREATE UNIQUE INDEX products_upc_uq ON products (upc) WHERE upc IS NOT NULL AND status <> 'pending_review';
CREATE UNIQUE INDEX products_sku_uq ON products (sku);
CREATE INDEX products_category_idx ON products (category_id);
CREATE INDEX products_name_trgm ON products USING GIN (name gin_trgm_ops);
CREATE INDEX products_search_idx ON products USING GIN (search_vector);

CREATE TABLE product_variants (
  id         uuid PRIMARY KEY,
  product_id uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  name       text NOT NULL,
  sku        text NOT NULL UNIQUE,
  upc        text,
  attributes jsonb NOT NULL DEFAULT '{}'
);

-- Store-specific inventory layer (price + stock) — separate from the shared catalog.
CREATE TABLE store_products (
  id                  uuid PRIMARY KEY,
  store_id            uuid NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  product_id          uuid NOT NULL REFERENCES products(id),
  variant_id          uuid REFERENCES product_variants(id),
  store_sku           text,
  price_cents         integer NOT NULL CHECK (price_cents >= 0),
  promo_price_cents   integer CHECK (promo_price_cents IS NULL OR promo_price_cents >= 0),
  quantity            integer NOT NULL DEFAULT 0 CHECK (quantity >= 0),
  low_stock_threshold integer NOT NULL DEFAULT 5 CHECK (low_stock_threshold >= 0),
  min_order_qty       integer NOT NULL DEFAULT 1 CHECK (min_order_qty >= 1),
  max_order_qty       integer CHECK (max_order_qty IS NULL OR max_order_qty >= min_order_qty),
  visible             boolean NOT NULL DEFAULT true,
  b2b_enabled         boolean NOT NULL DEFAULT false,
  b2b_price_cents     integer CHECK (b2b_price_cents IS NULL OR b2b_price_cents > 0),
  b2b_min_qty         integer NOT NULL DEFAULT 1,
  b2b_unit            text NOT NULL DEFAULT 'each',
  available_from      timestamptz,
  available_until     timestamptz,
  source              text NOT NULL DEFAULT 'manual' CHECK (source IN ('manual','csv','bulk','admin','pos')),
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX store_products_uq ON store_products (store_id, product_id, COALESCE(variant_id, '00000000-0000-0000-0000-000000000000'::uuid));
CREATE INDEX store_products_product_idx ON store_products (product_id) WHERE visible;
CREATE INDEX store_products_b2b_idx ON store_products (product_id) WHERE b2b_enabled;
CREATE INDEX store_products_stale_idx ON store_products (updated_at);

-- Retained inventory history (Phase 2 demand forecasting / automated restocking).
CREATE TABLE inventory_events (
  id                uuid PRIMARY KEY,
  store_product_id  uuid NOT NULL REFERENCES store_products(id) ON DELETE CASCADE,
  store_id          uuid NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  delta             integer NOT NULL,
  quantity_after    integer NOT NULL,
  reason            text NOT NULL,
  source            text NOT NULL,
  actor_id          uuid REFERENCES users(id),
  created_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX inventory_events_listing_idx ON inventory_events (store_product_id, created_at DESC);

-- ─── Offers ─────────────────────────────────────────────────────────────────
CREATE TABLE offers (
  id             uuid PRIMARY KEY,
  store_id       uuid NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  name           text NOT NULL,
  description    text NOT NULL DEFAULT '',
  scope          text NOT NULL CHECK (scope IN ('product','category','store')),
  product_id     uuid REFERENCES products(id),
  category_id    uuid REFERENCES categories(id),
  discount_type  text NOT NULL CHECK (discount_type IN ('percent','fixed','bxgy')),
  discount_value numeric(12,2) NOT NULL DEFAULT 0 CHECK (discount_value >= 0),
  buy_qty        integer,
  get_qty        integer,
  start_at       timestamptz NOT NULL,
  end_at         timestamptz NOT NULL,
  eligibility    text NOT NULL DEFAULT 'all' CHECK (eligibility IN ('all','new_customer')),
  geo_radius_mi  double precision,
  usage_limit    integer,
  usage_count    integer NOT NULL DEFAULT 0,
  status         text NOT NULL DEFAULT 'active' CHECK (status IN ('draft','active','paused','expired')),
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  CHECK (end_at > start_at),
  CHECK (scope <> 'product' OR product_id IS NOT NULL),
  CHECK (scope <> 'category' OR category_id IS NOT NULL)
);
CREATE INDEX offers_store_live_idx ON offers (store_id, status, end_at);

-- ─── Consumer commerce ─────────────────────────────────────────────────────
CREATE TABLE addresses (
  id         uuid PRIMARY KEY,
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  label      text NOT NULL,
  line1      text NOT NULL,
  city       text NOT NULL,
  state      char(2) NOT NULL,
  zip        text NOT NULL CHECK (zip ~ '^\d{5}(-\d{4})?$'),
  latitude   double precision,
  longitude  double precision,
  is_default boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE carts (
  id         uuid PRIMARY KEY,
  user_id    uuid NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE cart_items (
  id               uuid PRIMARY KEY,
  cart_id          uuid NOT NULL REFERENCES carts(id) ON DELETE CASCADE,
  store_product_id uuid NOT NULL REFERENCES store_products(id) ON DELETE CASCADE,
  quantity         integer NOT NULL CHECK (quantity > 0),
  created_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (cart_id, store_product_id)
);

CREATE TABLE orders (
  id               uuid PRIMARY KEY,
  number           text NOT NULL UNIQUE,
  user_id          uuid NOT NULL REFERENCES users(id),
  store_id         uuid NOT NULL REFERENCES stores(id),
  status           text NOT NULL CHECK (status IN ('pending_payment','confirmed','processing','ready','out_for_delivery','completed','cancelled','payment_failed')),
  fulfillment_type text NOT NULL CHECK (fulfillment_type IN ('pickup','curbside','delivery')),
  delivery_address jsonb,
  subtotal_cents   integer NOT NULL CHECK (subtotal_cents >= 0),
  discount_cents   integer NOT NULL DEFAULT 0 CHECK (discount_cents >= 0),
  tax_cents        integer NOT NULL DEFAULT 0 CHECK (tax_cents >= 0),
  fee_cents        integer NOT NULL DEFAULT 0 CHECK (fee_cents >= 0),
  total_cents      integer NOT NULL CHECK (total_cents >= 0),
  payment_status   text NOT NULL,
  idempotency_key  text,
  notes            text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX orders_idem_uq ON orders (user_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE INDEX orders_store_idx ON orders (store_id, created_at DESC);
CREATE INDEX orders_user_idx ON orders (user_id, created_at DESC);

CREATE TABLE order_items (
  id               uuid PRIMARY KEY,
  order_id         uuid NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  store_product_id uuid NOT NULL REFERENCES store_products(id),
  product_id       uuid NOT NULL REFERENCES products(id),
  product_name     text NOT NULL,
  unit_price_cents integer NOT NULL CHECK (unit_price_cents >= 0),
  quantity         integer NOT NULL CHECK (quantity > 0),
  discount_cents   integer NOT NULL DEFAULT 0,
  total_cents      integer NOT NULL,
  offer_id         uuid REFERENCES offers(id)
);
CREATE INDEX order_items_order_idx ON order_items (order_id);

-- Status history for both consumer orders and store-to-store orders (kind distinguishes them).
CREATE TABLE order_status_history (
  id          uuid PRIMARY KEY,
  order_id    uuid NOT NULL,
  kind        text NOT NULL CHECK (kind IN ('consumer','store')),
  from_status text,
  to_status   text NOT NULL,
  actor_id    uuid REFERENCES users(id),
  note        text,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX order_status_history_idx ON order_status_history (order_id, created_at);

-- ─── Store-to-store (B2B) — independent from consumer orders ───────────────
CREATE TABLE store_orders (
  id              uuid PRIMARY KEY,
  number          text NOT NULL UNIQUE,
  buyer_store_id  uuid NOT NULL REFERENCES stores(id),
  seller_store_id uuid NOT NULL REFERENCES stores(id),
  status          text NOT NULL CHECK (status IN ('draft','submitted','pending_acceptance','accepted','preparing','ready','completed','rejected','cancelled')),
  subtotal_cents  integer NOT NULL CHECK (subtotal_cents >= 0),
  buyer_notes     text,
  seller_notes    text,
  created_by      uuid NOT NULL REFERENCES users(id),
  partial         boolean NOT NULL DEFAULT false,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CHECK (buyer_store_id <> seller_store_id)
);
CREATE INDEX store_orders_buyer_idx ON store_orders (buyer_store_id, updated_at DESC);
CREATE INDEX store_orders_seller_idx ON store_orders (seller_store_id, updated_at DESC);

CREATE TABLE store_order_items (
  id               uuid PRIMARY KEY,
  store_order_id   uuid NOT NULL REFERENCES store_orders(id) ON DELETE CASCADE,
  store_product_id uuid NOT NULL REFERENCES store_products(id),
  product_id       uuid NOT NULL REFERENCES products(id),
  product_name     text NOT NULL,
  unit_label       text NOT NULL,
  unit_price_cents integer NOT NULL CHECK (unit_price_cents >= 0),
  requested_qty    integer NOT NULL CHECK (requested_qty > 0),
  accepted_qty     integer CHECK (accepted_qty >= 0),
  fulfilled_qty    integer CHECK (fulfilled_qty >= 0)
);

-- ─── Payments (no card data stored — provider references only) ─────────────
CREATE TABLE payments (
  id             uuid PRIMARY KEY,
  order_id       uuid NOT NULL REFERENCES orders(id),
  provider       text NOT NULL,
  provider_ref   text,
  status         text NOT NULL CHECK (status IN ('unpaid','authorized','captured','failed','refunded','partially_refunded','pay_in_store')),
  amount_cents   integer NOT NULL CHECK (amount_cents >= 0),
  refunded_cents integer NOT NULL DEFAULT 0 CHECK (refunded_cents >= 0),
  card_brand     text,
  card_last4     char(4),
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  CHECK (refunded_cents <= amount_cents)
);
CREATE INDEX payments_order_idx ON payments (order_id);

CREATE TABLE payment_transactions (
  id           uuid PRIMARY KEY,
  payment_id   uuid NOT NULL REFERENCES payments(id) ON DELETE CASCADE,
  type         text NOT NULL CHECK (type IN ('authorize','capture','refund','failure','void')),
  amount_cents integer NOT NULL,
  provider_ref text,
  success      boolean NOT NULL,
  message      text,
  created_at   timestamptz NOT NULL DEFAULT now()
);

-- ─── Engagement, ops, audit ────────────────────────────────────────────────
CREATE TABLE notifications (
  id         uuid PRIMARY KEY,
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  store_id   uuid REFERENCES stores(id) ON DELETE SET NULL,
  type       text NOT NULL,
  title      text NOT NULL,
  body       text NOT NULL,
  link       text,
  channel    text NOT NULL DEFAULT 'in_app',
  read_at    timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX notifications_user_idx ON notifications (user_id, created_at DESC);

CREATE TABLE favorites (
  id         uuid PRIMARY KEY,
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  store_id   uuid REFERENCES stores(id) ON DELETE CASCADE,
  product_id uuid REFERENCES products(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((store_id IS NULL) <> (product_id IS NULL))
);
CREATE UNIQUE INDEX favorites_uq ON favorites (user_id, COALESCE(store_id, product_id));

CREATE TABLE support_tickets (
  id         uuid PRIMARY KEY,
  user_id    uuid REFERENCES users(id) ON DELETE SET NULL,
  email      text NOT NULL,
  subject    text NOT NULL,
  body       text NOT NULL,
  order_id   uuid REFERENCES orders(id),
  status     text NOT NULL DEFAULT 'open' CHECK (status IN ('open','in_progress','resolved')),
  category   text NOT NULL DEFAULT 'other',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Coarse location only (≈1 km). Retention governed by privacy.search_log_retention_days.
CREATE TABLE search_events (
  id           uuid PRIMARY KEY,
  user_id      uuid REFERENCES users(id) ON DELETE SET NULL,
  query        text NOT NULL,
  lat_rounded  numeric(5,2),
  lng_rounded  numeric(6,2),
  radius_mi    double precision,
  result_count integer NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX search_events_created_idx ON search_events (created_at DESC);

-- Versioned analytics events for Phase 2 AI/ML consumers.
CREATE TABLE analytics_events (
  id             uuid PRIMARY KEY,
  name           text NOT NULL,
  schema_version integer NOT NULL DEFAULT 1,
  user_id        uuid REFERENCES users(id) ON DELETE SET NULL,
  store_id       uuid REFERENCES stores(id) ON DELETE SET NULL,
  props          jsonb NOT NULL DEFAULT '{}',
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX analytics_events_name_idx ON analytics_events (name, created_at DESC);
CREATE INDEX analytics_events_store_idx ON analytics_events (store_id, created_at DESC);

CREATE TABLE audit_logs (
  id          uuid PRIMARY KEY,
  actor_id    uuid REFERENCES users(id) ON DELETE SET NULL,
  actor_email text,
  action      text NOT NULL,
  entity      text NOT NULL,
  entity_id   text,
  before      jsonb,
  after       jsonb,
  ip          text,
  user_agent  text,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_logs_created_idx ON audit_logs (created_at DESC);
CREATE INDEX audit_logs_entity_idx ON audit_logs (entity, entity_id);

CREATE TABLE system_settings (
  id         text PRIMARY KEY,
  value      jsonb NOT NULL,
  updated_by uuid REFERENCES users(id),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE search_index_metadata (
  id         uuid PRIMARY KEY,
  entity     text NOT NULL,
  entity_id  uuid NOT NULL,
  indexed_at timestamptz NOT NULL,
  version    integer NOT NULL DEFAULT 1,
  UNIQUE (entity, entity_id)
);

-- Audit rows are append-only.
CREATE OR REPLACE FUNCTION audit_logs_immutable() RETURNS trigger AS $$
BEGIN RAISE EXCEPTION 'audit_logs is append-only'; END; $$ LANGUAGE plpgsql;
CREATE TRIGGER audit_logs_no_update BEFORE UPDATE OR DELETE ON audit_logs FOR EACH ROW EXECUTE FUNCTION audit_logs_immutable();
