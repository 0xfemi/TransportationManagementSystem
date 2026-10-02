# Transportation Management System

An open-source system for planning, dispatching and tracking the movement of goods: orders in, optimized routes out, live tracking and delay detection in between, and analytics at the end.

It is a single Next.js application with a REST API, a PostgreSQL database, and no other required infrastructure.

> **Status: MVP.** The order → shipment → plan → tender → dispatch → track → deliver → analyze flow works end to end and is covered by tests. Warehousing, invoicing, carrier/customer portals and the AI features are on the [roadmap](docs/PRODUCT.md#roadmap), not in the code.

## What it does today

- **Orders and shipments** — create orders, turn one or many into a shipment, cancel and re-plan.
- **Route optimization** — a pickup-and-delivery optimizer that respects vehicle weight and volume capacity and delivery windows, and proposes alternatives for lowest cost, shortest distance or fastest completion.
- **Carriers and tendering** — contract rates, itemised and auditable quotes, tender acceptance and rejection, measured scorecards.
- **Tracking** — an API for GPS positions and stop events, idempotent on retries, plus a labelled simulator for demos.
- **ETA and delay detection** — arrival times re-projected on every tracking event; a shipment that will miss a deadline raises an exception.
- **Exception Center** — every exception states the issue, its impact and a recommended action, with an owner, a status and a timeline.
- **Command Center** — live counts, a map of shipments, vehicles and locations, and the exception feed.
- **Documents** — upload proof of delivery and other documents against shipments, orders and carriers.
- **Analytics** — on-time delivery, spend, cost per shipment and per km, carrier performance, with the calculation method shown.
- **Multi-tenant, role-based access** — seven roles, API keys, an audit log of who changed what, and an append-only domain event log.

Every number on screen is read from the database. Nothing is mocked.

## Run it

### Docker (quickest)

```bash
git clone https://github.com/0xfemi/TransportationManagementSystem.git
cd TransportationManagementSystem
docker compose up
```

Open http://localhost:3000 and sign in as `demo@northstar.example` / `northstar-demo`. The demo organization, NorthStar Distribution, comes with three weeks of delivered shipments, three on the road (one running late) and open orders waiting to be planned.

Set `SEED_DEMO_DATA=false` to start empty, and set your own `AUTH_SECRET` before exposing it to anyone else.

### Local development

Requires Node 20+ and Docker (for the database).

```bash
cp .env.example .env          # then set AUTH_SECRET (openssl rand -hex 32)
docker compose up -d db
npm install
npx prisma db push
npm run db:seed               # optional demo data
npm run dev
```

More in [DEVELOPMENT.md](DEVELOPMENT.md).

### Admin access link

Set `ADMIN_ACCESS_KEY` (32+ characters) and, optionally, `ADMIN_ACCESS_EMAIL`. Then `/api/v1/auth/access?key=<ADMIN_ACCESS_KEY>` signs you in as that admin without a password; on an empty database it creates the organization and admin first. Whoever has the link is an admin, so keep it private; changing the key revokes it. Every use is recorded in the audit log.

## Try the full flow

1. **Orders** → New order.
2. Tick the order → **Create shipment**.
3. On the shipment: **Plan route** (pick a vehicle), or leave the vehicle empty and **Tender to carrier**, then **Record acceptance**.
4. **Dispatch**.
5. Under **Simulate movement**, choose *Heavy traffic* and advance a few hours. The shipment moves on the map, its ETA slips, and a delay exception appears in the Command Center.
6. Resolve the exception, **Run to delivery**, upload a proof of delivery.
7. See the result in **Analytics**.

## API

The web app uses the same REST API available to you. The OpenAPI document is served at `/api/v1/openapi.json`; an overview is in [API.md](API.md).

```bash
curl -H "Authorization: Bearer tms_..." http://localhost:3000/api/v1/shipments?status=IN_TRANSIT
```

Create API keys under Settings.

## Documentation

| | |
|---|---|
| [docs/PRODUCT.md](docs/PRODUCT.md) | Product requirements, UI structure, roadmap |
| [ARCHITECTURE.md](ARCHITECTURE.md) | Architecture, domain model, database, technology decisions |
| [API.md](API.md) | API conventions and endpoints |
| [SECURITY.md](SECURITY.md) | Security model and how to report a vulnerability |
| [docs/TESTING.md](docs/TESTING.md) | Testing strategy |
| [docs/COMPETITIVE.md](docs/COMPETITIVE.md) | Capability map of the TMS category |
| [docs/OPEN_SOURCE.md](docs/OPEN_SOURCE.md) | Licence choice and project governance |
| [CONTRIBUTING.md](CONTRIBUTING.md) | How to contribute |

## Licence

[Apache License 2.0](LICENSE).

This is an independent implementation. It is not affiliated with, derived from, or compatible by design with any commercial transportation management product.
