# Requirements traceability — Master Development Prompt, Phase 1

Status key: **Done** = implemented and tested · **Built** = implemented, not covered by automated tests · **Seam** = interface/architecture in place, production adapter still to be written · **Doc** = documented plan only.

| § | Requirement | Status | Where |
|---|---|---|---|
| 2 | Network: stores publish, consumers search/compare/visit/order | Done | Whole platform |
| 3.1 | Consumer web application | Done | `apps/web/src/pages/consumer` |
| 3.2 | Store/merchant portal | Done | `apps/web/src/pages/merchant` |
| 3.3 | Platform administration console | Done | `apps/web/src/pages/admin` |
| 3.4 | Backend/API platform | Done | `packages/core/src/routes.ts`, `apps/api` |
| 3.5–3.7 | Product catalog, inventory, store/location management | Done | `services/merchant.ts`, `services/discovery.ts` |
| 3.8 | Geographic search and mapping | Done | PostGIS queries in `pg-store.ts`; `map/MapView.tsx` |
| 3.9 | Offers/promotions | Done | `pricing.ts`, merchant offers |
| 3.10–3.11 | Consumer discovery and ordering | Done | search, product availability, cart, checkout |
| 3.12 | Store-to-store ordering | Done | `services/store-orders.ts` |
| 3.13 | User and role management | Done | `rbac.ts`, admin users/roles, merchant employees |
| 3.14 | Notifications | Done (in-app), Seam (email/SMS delivery) | `registerEventHandlers`, `providers/channels.ts` |
| 3.15 | Reporting and basic analytics | Done | merchant reports, admin dashboard/reports |
| 3.16 | Payment integration architecture | Done (mock), Built (Stripe adapter) | `providers/payments.ts` |
| 3.17–3.18 | Security controls, audit logging | Done | `security-privacy.md`, `audit_logs` |
| 3.19–3.20 | Monitoring, DevOps, CI/CD | Built | health/ready, pino logs, `ci.yml`, Dockerfiles |
| 4 | Consumer functionality list (landing → contact/support) | Done | incl. current-location detection, saved locations, favorites, order tracking |
| 4 | Merchant functionality list (registration → settings) | Done | incl. variants, SKU, images (URL), CSV, business hours |
| 4 | Platform administration list | Done | incl. content (category) management, geographic markets, system configuration |
| 5 | Five roles with scoped permissions; employees not auto-admin; support without financial/security privileges | Done | `rbac.ts`, `assertStoreAccess`, tests |
| 6 | Store geographic fields; country/state/county/city/ZIP/lat-lng/radius/service area | Done | `stores` table |
| 6 | Queries: "bottled water within 5 miles", "grocery stores near me", "this product within 10 miles", "discounts within 25 miles", "stores in Dallas, Texas" | Done | `search`, `/stores`, `/products/:id/availability`, `/offers`; scenario tests |
| 7 | Map provider abstracted; markers, user location, radius, clustering, directions link, geocoding, reverse geocoding, geographic filtering, distance | Done | `MapView` (schematic + Leaflet), `GazetteerGeocoder` / `MapboxGeocoder` (Built) |
| 7 | PostgreSQL + PostGIS: points, radius, distance, geo indexing, service areas | Done | migration + `storesNear`/`searchListings` |
| 8 | Category → subcategory → product with brand, SKU, UPC, description, images, attributes, unit, variants, status; product separate from store inventory | Done | `products`, `product_variants`, `store_products` |
| 9 | Inventory fields incl. promo price, availability dates, timestamps, min/max qty, store SKU, barcode, source | Done | `store_products` |
| 9 | Updates via manual, CSV, bulk, admin | Done (manual, CSV incl. new products, admin via same API) | inventory endpoints |
| 9 | POS/ERP later | Seam | `source: 'pos'`, import pipeline |
| 10 | S2S lifecycle, rejection, cancellation, partial, quantity adjustment, notes, notifications, history; separate model | Done | tests cover partial acceptance and stock transfer |
| 11 | Discovery by product/location/store/category/offer/distance/availability | Done | |
| 12 | Search: name, store, category, brand, SKU, barcode, location, partial, typo tolerance, filters, sorting, relevance | Done | Postgres FTS + trigram |
| 12 | OpenSearch index | Seam | `search_index_metadata`, compose profile |
| 13 | Checkout chain with store, inventory, price validation, taxes/fees, payment, confirmation, processing, ready/out for delivery, completed; pickup/store pickup/delivery; no fleet | Done | `commerce.ts` |
| 14 | Auth, capture, failure, refunds, partial refunds, references, status, reconciliation; no raw card data | Done | payments + admin order view |
| 15 | Percentage, fixed, BOGO, product, category, store-wide, time-limited, geographic, new-customer offers with limits and status | Done | `pricing.ts`, unit tests |
| 16 | Public store profile fields | Done | `StorePage` |
| 17 | Merchant dashboard sections and metrics | Done | `MerchantOverview` |
| 18 | Admin dashboard, merchant/product/geographic/order/audit management | Done | admin console |
| 19 | Password hashing, email verification, reset, admin MFA, refresh/session management, lockout/rate limiting, RBAC at API level | Done | `services/auth.ts` |
| 19 | Optional social authentication | Doc | `security-privacy.md` |
| 20–21 | React + TypeScript, Node + Express, PostgreSQL/PostGIS | Done | |
| 20–21 | Redis, S3, managed AWS services | Doc / Seam | compose includes Redis; `deployment-aws.md` |
| 22 | Versioned REST endpoints, validation, auth, pagination, filtering, sorting, error standards, rate limiting, idempotency, OpenAPI/Swagger | Done | `/api/v1/docs`, `docs/openapi.json` |
| 23 | Data model tables and constraints | Done | 37 tables incl. Roles/Permissions/UserRoles |
| 24 | Data quality: address, ZIP, coordinates, duplicate store/product detection, SKU, price, inventory, offer dates, stale inventory | Done | schemas, merchant/admin services |
| 25 | Notification events for consumer and merchant; event-driven | Done | `events.ts` |
| 26 | Analytics tracking for consumer, store, platform | Done | `analytics_events`, `search_events` |
| 27–28 | Phase 2 AI and Phase 3 mobile readiness | Doc + Seam | `phase2-3-readiness.md` |
| 29–30 | UX principles, primary flows, responsive design | Done | verified at 390 px and 1360 px |
| 31 | WCAG 2.2 AA baseline: keyboard, screen reader labels, contrast, focus, semantic HTML, forms, errors, alt text, accessible modals, map alternatives | Built | Needs a formal audit with assistive technology before launch |
| 32 | Security areas | Built | Pen test required pre-production |
| 33–34 | Compliance and privacy-by-design | Built / Doc | Legal review required |
| 35 | CI/CD pipeline | Built | `.github/workflows/ci.yml` |

## Known gaps before general availability
1. Production adapters: SES/SNS channels, OpenSearch search adapter, Redis-backed rate limit store, S3 pre-signed image uploads.
2. Stripe adapter needs end-to-end testing with Stripe Elements in the web checkout (the beta uses test tokens).
3. Tax: replace the state rate table with a tax provider.
4. Formal accessibility audit, penetration test, and legal/compliance sign-off.
5. Infrastructure as code (Terraform/CDK) for the AWS topology in `deployment-aws.md`.
