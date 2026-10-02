# Capability map of the TMS category

**Read this first.** This is a summary of what transportation management and visibility products are generally understood to offer, written from general industry knowledge. It was **not** compiled from a fresh review of each vendor's current documentation, and no vendor material was copied. Treat product-specific statements as approximate and verify them before relying on them, for example in a sales comparison. Its purpose here is narrower: to decide what an open-source TMS must have, and where it can be better.

## Industry-standard capabilities

These appear, in some form, across enterprise TMS suites (Oracle Transportation Management, SAP Transportation Management, Manhattan Active Transportation Management, Blue Yonder Transportation Management) and mid-market or cloud-native ones (for example Shipwell). They are category requirements, not any one vendor's invention.

| Area | Standard capability | In this project |
|---|---|---|
| Order management | Capture transport demand with origin, destination, dates, quantities | Yes |
| Planning | Consolidate orders into shipments; sequence stops; respect capacity and time windows | Yes (heuristic) |
| Carrier management | Carrier master data, contract rates, service levels, lanes | Carriers and a single contract rate; no lanes or service levels yet |
| Rating | Calculate freight cost from contract rates, surcharges, accessorials | Base, distance, weight, minimum, fuel; no zones or accessorials |
| Tendering | Offer shipments to carriers; record acceptance or rejection | Yes; no automatic waterfall or spot bidding |
| Execution | Dispatch, status milestones, proof of delivery | Yes |
| Visibility | Position tracking, ETA, late alerts | Yes; ETA is rule-based |
| Exception management | Detect and work off deviations | Yes |
| Settlement | Freight invoice audit and payment | No (phase 2) |
| Analytics | Spend, service and carrier performance reporting | Core KPIs |
| Multi-modal | Road, rail, ocean, air, parcel; multi-leg moves | Modes modelled; multi-leg not built |
| Integration | ERP/WMS connectivity, EDI, APIs | REST API and event log; no EDI |

## Where categories of product tend to differ

- **Enterprise suites** are broad and deeply configurable, cover global and multi-modal operations and trade compliance, and are typically implemented over months with specialist help. Their strength is depth; their cost is complexity.
- **Visibility platforms** (project44 and similar) concentrate on aggregating carrier and telematics data across many networks to provide tracking and predictive ETAs, usually alongside a TMS rather than instead of one.
- **Fleet and telematics platforms** (Samsara and similar) start from the vehicle: hardware, GPS, driver safety and compliance, with dispatch features growing outward from there.
- **Cloud-native mid-market TMS** products emphasise faster onboarding, a modern interface and built-in carrier connectivity.

Vendor-specific elements — proprietary data models, rule and workflow configuration languages, particular optimization engines, carrier networks, and any vendor's screens or terminology — are deliberately out of scope and are not reproduced here.

## Opportunities for an open-source TMS

1. **Time to first shipment.** A new organization should complete order-to-delivery in minutes without consultants. *Addressed:* no required setup beyond adding locations, a customer and a vehicle or carrier.
2. **A self-hostable option.** There is little open-source choice in this category for an organization that wants to own its deployment and data. *Addressed:* `docker compose up`.
3. **API parity.** The API is often a subset of what the UI can do. *Addressed:* the UI is built on the public API.
4. **Explainable numbers.** Cost and KPI calculations are frequently opaque. *Addressed:* itemised charges; methodology shown beside analytics.
5. **Exceptions that say what to do.** Alerts often state a fact and stop. *Addressed:* issue, impact, recommended action and an action on every exception.
6. **Emerging-market fit.** Many products assume reliable street addresses, constant connectivity and truck-only fleets. *Partly addressed:* coordinates-first locations, per-organization currency and time zone, motorcycle and drone modes. Offline driver workflows are not built.
7. **Developer experience.** Local setup, test data and an event stream for integrators. *Partly addressed:* one-command setup, seeded demo, polling event log. Webhooks and SDKs are not built.

## Where this project is behind, honestly

Optimization quality on large problems, multi-leg planning, rating depth, settlement, carrier connectivity (EDI, carrier APIs), compliance, and everything that needs years of operational hardening.
