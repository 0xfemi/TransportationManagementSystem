# API

Base path: `/api/v1`. The machine-readable specification is at **`/api/v1/openapi.json`** (OpenAPI 3.1, generated from the validation schemas the routes use, so request bodies in it are always current).

## Authentication

| Method | How | For |
|---|---|---|
| API key | `Authorization: Bearer tms_…` | Server-to-server integrations |
| Session cookie | `POST /auth/login` sets `tms_session` | The web app |

Create keys under **Settings → API keys**. A key belongs to one organization and carries a role; it can do what that role can do. The full key is shown once.

Cookie-authenticated requests that change data must carry an `Origin` header matching the host (browsers send it automatically). API-key requests are exempt.

## Conventions

- JSON in, JSON out. Timestamps are ISO 8601 UTC. Weights are kilograms, volumes cubic metres, distances kilometres. Money is a number in the organization's currency.
- Lists return `{ "data": [...], "total": n, "limit": n, "offset": n }` and accept `limit` (max 200), `offset` and usually `q`.
- Errors return `{ "error": { "code", "message", "details" } }`:

| Status | Code | Meaning |
|---|---|---|
| 400 | `bad_request` | Malformed JSON or form data |
| 401 | `unauthorized` | Missing or invalid credentials |
| 403 | `forbidden` | The role lacks the permission, or a cross-site request was blocked |
| 404 | `not_found` | No such record **in your organization** |
| 409 | `conflict` | Not allowed in the record's current state; the message says what to do |
| 422 | `validation_failed` / `unprocessable` | Field errors in `details` |
| 429 | `rate_limited` | `details.retryAfterSec` |

## Endpoints

### Master data
`/customers`, `/locations`, `/carriers`, `/vehicles`, `/drivers`, `/service-areas` — each supports `GET` (list), `POST`, `GET /{id}`, `PATCH /{id}`, `DELETE /{id}` (soft delete). `GET /carriers/{id}/scorecard` returns measured performance.

**Service areas** are circles (`latitude`, `longitude`, `radiusKm`, `active`). Once an organization has at least one active area, `POST /orders` returns `422` when the pickup or delivery location is outside all of them; `details.locations` names which. With no active areas, orders are not restricted.

### Maintenance
| | |
|---|---|
| `GET /maintenance` | Filter by `status` (`open` = scheduled or in progress), `vehicleId`, `q` |
| `POST /maintenance` | `{ vehicleId, type, title, scheduledFor, vendor?, notes? }` |
| `GET /maintenance/{id}` · `PATCH /maintenance/{id}` | Includes `history`; editable only while `SCHEDULED` |
| `POST /maintenance/{id}/start` | Vehicle becomes `MAINTENANCE`. `409` if the vehicle is out on a dispatched shipment |
| `POST /maintenance/{id}/complete` | `{ cost?, notes? }`. Vehicle returns to `AVAILABLE` once no other work is in progress |
| `POST /maintenance/{id}/cancel` | `{ reason }` |

While a vehicle is in maintenance or inactive, planning a shipment onto it and dispatching a shipment already planned onto it both return `409`.

### Orders
| | |
|---|---|
| `GET /orders` | Filter by `status`, `customerId`, `q` |
| `POST /orders` | Customer, pickup and delivery locations, optional windows, lines |
| `GET /orders/{id}` · `PATCH /orders/{id}` | Editable only while `OPEN` |
| `POST /orders/{id}/cancel` | `{ reason }` |

### Shipments
| | |
|---|---|
| `GET /shipments` | `status` is comma-separated; `delayed=true` for late shipments |
| `POST /shipments` | `{ orderIds, mode }` → draft shipment |
| `GET /shipments/{id}` | Stops, orders, tenders, exceptions, documents, cost breakdown |
| `POST /shipments/{id}/plan` | `{ vehicleId?, driverId?, departAt, objective }` |
| `POST /shipments/{id}/tender` | `{ carrierId }` |
| `POST /shipments/{id}/tender/respond` | `{ accepted, note? }` |
| `POST /shipments/{id}/dispatch` | |
| `POST /shipments/{id}/cancel` | `{ reason }` |

### Planning
| | |
|---|---|
| `POST /routes/optimize` | `{ orderIds, vehicleIds, departAt, mode }` → up to three alternatives. Saves nothing. |
| `POST /routes/commit` | Same input plus `objective` → one planned shipment per route |

### Tracking
| | |
|---|---|
| `POST /tracking/events` | Report a position or stop event |
| `GET /shipments/{id}/tracking` | History and travelled path |
| `POST /shipments/{id}/simulate` | Demo aid: `{ minutes, speedFactor }` |

```bash
curl -X POST http://localhost:3000/api/v1/tracking/events \
  -H "Authorization: Bearer tms_..." -H "Content-Type: application/json" \
  -d '{
    "shipmentId": "…",
    "type": "LOCATION_UPDATE",
    "latitude": 44.23, "longitude": -76.49,
    "speedKph": 92,
    "occurredAt": "2026-10-02T14:31:00Z",
    "externalId": "unit-17:1759415460"
  }'
```

Reportable `type` values: `LOCATION_UPDATE`, `IN_TRANSIT`, `ARRIVED_PICKUP`, `DEPARTED_PICKUP`, `ARRIVED_DESTINATION`, `OUT_FOR_DELIVERY`, `DELIVERED`, `EXCEPTION`. Stop events apply to `stopId`, or to the next unfinished stop when it is omitted.

**Retries are safe** when you send `externalId`: a repeated id returns `200` with `duplicate: true` and changes nothing.

### Exceptions, documents, analytics
| | |
|---|---|
| `GET /exceptions` · `POST /exceptions` | `status=active` means open or investigating |
| `GET /exceptions/{id}` · `PATCH /exceptions/{id}` | `{ status?, ownerId?, severity?, resolutionNote? }` |
| `GET /documents?entityType=&entityId=` · `POST /documents` | Upload is `multipart/form-data`: `file`, `entityType`, `entityId`, `type` |
| `GET /documents/{id}` · `DELETE /documents/{id}` | Download is always an attachment |
| `GET /analytics/transportation` | `from`, `to`, `carrierId`, `customerId`. Add `format=csv` and `table=daily` or `table=carriers` to download that table as CSV |
| `GET /command-center` | Live summary, map data, exception feed |

### Organization and audit
`GET/PATCH /organization`, `GET/POST /users`, `PATCH/DELETE /users/{id}`, `GET/POST /api-keys`, `DELETE /api-keys/{id}`, `GET /search?q=`, `GET /audit-log`, `GET /events`.

## Following changes

There are no webhooks yet. Poll the domain event log:

```
GET /api/v1/events?since=2026-10-02T14:00:00Z&type=ShipmentDelayed
```

Event types include `OrderCreated`, `ShipmentCreated`, `ShipmentPlanned`, `ShipmentTendered`, `TenderAccepted`, `TenderRejected`, `ShipmentDispatched`, `ShipmentDelayed`, `ShipmentDelivered`, `ShipmentCancelled`, `ProofOfDeliveryUploaded`, `ExceptionRaised`, `ExceptionClosed`, `MaintenanceScheduled`, `MaintenanceStarted`, `MaintenanceCompleted`, `MaintenanceCancelled`. Events are immutable and carry the actor that caused them. Reading the log requires the `audit:read` permission.

## Health

`GET /api/health` (process is up) and `GET /api/ready` (database reachable). A `/metrics` endpoint is not implemented.
