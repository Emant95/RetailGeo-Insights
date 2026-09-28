# Phase 2 (AI agents) and Phase 3 (mobile) readiness

Phase 1 intentionally ships **no** AI features and **no** native apps. These are the seams left for them.

## Phase 2 — AI agents
| Future capability | Phase 1 foundation |
|---|---|
| Natural-language / semantic search | `/search` already interprets radius and place phrases; swap the relevance stage for embeddings without changing the contract. `search_events` logs queries (coarse location) for training and evaluation. |
| Shopping assistant, conversational ordering | Every action (search, compare, cart, checkout, order status) is a documented, machine-readable API (`docs/openapi.json`) with typed errors and idempotency — the tool surface an agent needs. |
| Product and store recommendation, personalized offers | Structured product attributes (JSON), categories, brands; `favorites`; versioned `analytics_events` (views, add-to-cart, purchases); offer eligibility and geo-radius rules in one pricing module. |
| Inventory prediction, automated restocking | Full `inventory_events` history with source and actor; low-stock events; wholesale listings. |
| Store-to-store sourcing agent | `/store-orders/sourcing` + lifecycle endpoints with actor rules; an agent acts as a store user with scoped capabilities. |
| Event consumers | `InProcessEventBus` publishes versioned domain events; replace with an outbox + SNS/SQS or EventBridge without changing publishers. |

Future AI services consume Product, Store, Inventory, Offer, Location, Order, User-preference and Search-event data through the same APIs and tables — no core redesign.

## Phase 3 — Mobile apps
```
Web application ──▶ Common API platform ◀── Mobile application
```
- The web client contains no business rules; all rules live in `@retailgeo/core` behind `/api/v1`.
- Bearer-token auth with refresh rotation works for native clients as-is.
- Responses are JSON with stable error codes; pagination, filtering and sorting are parameterized.
- Location handling is already privacy-scoped (explicit permission, coarse logging) as app stores require.
- Push notifications: add a `MessageChannel` implementation (APNs/FCM) and subscribe it to existing domain events.

## Other extension points
POS/ERP integrations (inventory `source: 'pos'`, bulk import path), delivery providers (fulfillment type `delivery` + service radius; add a `DeliveryProvider` port), tax provider (replace `taxRateFor`), data warehouse (analytics tables are append-only and versioned).
