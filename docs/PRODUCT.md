# Product

## Vision

An open-source operating system for physical logistics: one place to take goods from order to delivery, and to see at a glance what is happening, what is late, what needs attention, what it costs and what to do next.

It should be deployable by a small logistics company, extensible by a developer, and integrable by an enterprise. It competes on simplicity, openness and a good API rather than on the number of configuration screens.

## Who it is for

| User | Needs |
|---|---|
| Planner | Turn orders into feasible, cheap routes quickly; choose a carrier; see alternatives. |
| Dispatcher | Release shipments, follow them, react when something slips. |
| Logistics manager | Know the state of the operation in seconds; see cost and service trends. |
| Analyst / finance | Trustworthy figures with a stated method. |
| Developer / integrator | A complete API, keys, an event log, and a one-command local setup. |
| Driver, carrier, customer | Planned portals (phase 2). Today they are represented by API keys and by staff recording their responses. |

Target organizations: distributors, retailers, manufacturers, 3PLs, and operators in markets where addresses are unreliable and connectivity is poor.

## Principles

1. **API first.** The UI is a client of the public API.
2. **No fake functionality.** A button does what it says; a number comes from the database; a simulated event is labelled as simulated.
3. **Clarity over configuration.** A new organization can run the whole flow without a setup wizard.
4. **Explain the numbers.** Costs are itemised. KPIs state their method. Estimates are called estimates.
5. **Geographically neutral.** Currency and time zone are per organization; locations are coordinates first, address text second; transport modes are not limited to trucks.
6. **Clean-room.** Built from publicly understood logistics concepts and standard industry vocabulary. No vendor's code, schema, UI or documentation is used.

## MVP requirements and status

The first release succeeds if a new user can do all of the following locally. Each is exercised by `tests/integration/flow.test.ts`.

| # | Capability | Status |
|---|---|---|
| 1 | Create an organization | Done |
| 2–5 | Add a warehouse, customer, carrier, vehicles | Done |
| 6 | Create an order | Done |
| 7 | Convert the order into a shipment | Done |
| 8–9 | Plan and optimize a route | Done |
| 10 | Assign a carrier (tender, accept/reject) | Done |
| 11 | Dispatch | Done |
| 12–13 | Simulate tracking; see the shipment move on the map | Done |
| 14 | Detect a delay | Done |
| 15 | Resolve the exception | Done |
| 16 | Complete delivery | Done |
| 17 | Upload proof of delivery | Done |
| 18 | View shipment history | Done |
| 19 | View transportation analytics | Done |

Also in the MVP: multi-tenancy, seven roles, API keys, audit log, domain event log, global search (Ctrl/Cmd+K), multi-order planning with alternatives, Docker deployment, demo data, OpenAPI document.

### Deliberately not in the MVP

Warehousing and inventory, freight audit and invoices, carrier / customer / driver portals, notifications, webhooks, what-if scenarios, AI copilot and document extraction, emissions, global trade, multi-leg shipments, OIDC sign-in. None of these has a placeholder screen.

## UI structure

```
Operate
  /command-center     Live counts, map, exception feed, 30-day KPIs
  /orders             List, create, select → create shipment
  /orders/:id         Details, goods, history
  /planning           Select orders + vehicles → alternatives → approve
  /shipments          List with status / late filters
  /shipments/:id      Map, stops, actions, simulate, timeline, cost, documents, tenders
  /exceptions         Feed; detail with owner, actions, timeline
  /analytics          KPIs, daily charts, carrier performance, method
Network
  /customers  /locations  /service-areas  /carriers  /carriers/:id  /vehicles  /drivers
  /maintenance        Vehicle work orders; starting one takes the vehicle out of service
Administration
  /users              Members, roles, permission matrix
  /audit-log
  /settings           Organization, API keys
```

Recurring patterns: a **timeline** on every important record; **issue → impact → recommended action → button** on every exception; status always shown as a labelled badge, never colour alone; empty states that say what to do next.

`/dashboard` redirects to `/command-center`.

## Roadmap

**Phase 2 — operations breadth.** Webhooks with signing, retries and delivery logs. Notifications (email, in-app). Carrier portal (answer tenders, upload POD) and customer portal (track, download documents). Driver mobile app with offline queueing. Freight audit: carrier invoices reconciled against quotes. Fuller rating: zones, accessorials, discounts, taxes. Warehouses: locations, inventory, receiving, picking, shipping. Scenario planning on a copy of the plan. Background worker. S3-compatible document storage. OIDC.

**Phase 3 — intelligence and reach.** Logistics copilot that answers from the organization's own data and separates data, inference and recommendation. Document extraction with human verification before anything is saved. Learned ETA. Anomaly detection. Emissions estimates with stated methodology. Multi-leg, multi-modal shipments. Solver-backed optimization (multi-depot, driver hours, dynamic re-routing). PostGIS geofences. Integration adapters (e-commerce, ERP, telematics). Trade-compliance framework.

**Phase 4 — autonomy.** Drone and autonomous-vehicle missions (launch and landing sites, payload, battery, flight status) on the multi-leg model. Robotics integrations. Network optimization and digital twin. Marketplace capabilities. Plugin architecture.
