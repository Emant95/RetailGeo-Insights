# RetailGeo Insights — Phase 1 Web Beta

A location-aware local commerce network for Desmata Inc. Shoppers find what is in stock at nearby stores, compare prices and order for pickup or delivery. Stores publish their catalog, inventory and offers, and source stock from each other.

```
Store A ─┬─ Products ─┐
         ├─ Inventory ├──▶ RETAILGEO NETWORK ◀── Store B · Gas station · Pharmacy · Convenience
         ├─ Offers    │            │
         └─ Location ─┘            ▼
                                Consumer → search · compare · visit · order · purchase
```

## What's in the repo

| Path | What it is |
|---|---|
| `packages/core` | Framework-agnostic domain layer: entities, business rules (pricing, offers, tax, order and store-to-store lifecycles), RBAC, validation schemas, services, **the single API route table**, OpenAPI generator, provider ports (payments, geocoding, email), in-memory data store and seed data. |
| `apps/api` | Node.js + Express API (`/api/v1`) on **PostgreSQL + PostGIS**. Security headers, CORS, rate limiting, structured logs, health/readiness, Swagger UI, migrations and seed. |
| `apps/web` | React + TypeScript web app: consumer marketplace, merchant portal and admin console. Responsive, WCAG 2.2 AA-oriented. Map provider abstraction (offline vector map or Leaflet/OSM tiles). |
| `docs/` | Architecture, data model, security & privacy, AWS deployment, Phase 2/3 readiness, requirements traceability, generated `openapi.json`. |
| `infra/`, `docker-compose.yml`, `.github/workflows/ci.yml` | Containers, nginx, and the CI/CD pipeline. |

One business-logic implementation serves every client: the Express server, the browser demo and future mobile or AI-agent gateways all dispatch through `dispatch()` in `packages/core/src/routes.ts`, so validation, authentication and authorization are enforced identically at the API layer.

## Quick start

### Full stack with Docker
```bash
docker compose up --build
# Web:      http://localhost:8080
# API docs: http://localhost:4000/api/v1/docs
```

### Local development
```bash
npm install
cp .env.example .env
# PostgreSQL 15+ with PostGIS required (docker compose up db)
npm run db:migrate
npm run db:seed -- --reset
npm run dev:api              # http://localhost:4000
VITE_API_URL=http://localhost:4000/api/v1 npm run dev:web   # http://localhost:5173
```

Run the web app with **no backend** (in-browser data store running the same core services):
```bash
npm run dev:web              # no VITE_API_URL → demo transport
npm run build:demo           # → apps/web/dist-demo/index.html (single self-contained file)
```

### Demo accounts
All use password `RetailGeo2026`.

| Role | Email | Notes |
|---|---|---|
| Shopper | maya@retailgeo.demo | Orders, favorites, saved locations |
| Store owner | dan@retailgeo.demo | Owns Trinity Fresh Market + Trinity Fresh Express |
| Store employee | sam@retailgeo.demo | Limited: inventory, process orders, view orders |
| Platform admin | ops@retailgeo.demo | MFA code is emailed (see the demo Email outbox / API logs) |
| Operations & support | jo@retailgeo.demo | No refunds, settings, roles or audit access |

Test cards: `4242 4242 4242 4242` (approved), `4000 0000 0000 0002` (declined).

## Tests

```bash
npm test                                            # unit + API scenarios on the in-memory store
TEST_DATABASE_URL=postgres://…/retailgeo_test npm test   # also runs the same scenarios over HTTP on PostGIS
npm run typecheck && npm run lint
```

The API scenario suite covers the spec's example queries ("bottled water within 5 miles", "grocery stores near me", "stores in Dallas, Texas", typo and SKU search), price comparison, RBAC denial paths, account lockout, refresh-token rotation, idempotent checkout with stock reservation, declined payments, merchant fulfillment with payment capture, employee capability limits, CSV import dry-run, the full store-to-store lifecycle with partial acceptance and stock transfer, admin MFA, merchant approval and the audit trail.

## Scope boundaries

Phase 1 deliberately does **not** include AI agents (Phase 2) or native mobile apps (Phase 3). The architecture leaves clean seams for both — see `docs/phase2-3-readiness.md`. Compliance items are designed for, not certified: final applicability needs qualified legal and compliance review.
