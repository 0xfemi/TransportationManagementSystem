import { describe, expect, it } from "vitest";
import { call, unique } from "../helpers";
import * as register from "@/app/api/v1/auth/register/route";
import * as apiKeys from "@/app/api/v1/api-keys/route";
import * as locations from "@/app/api/v1/locations/route";
import * as customers from "@/app/api/v1/customers/route";
import * as vehicles from "@/app/api/v1/vehicles/route";
import * as vehicle from "@/app/api/v1/vehicles/[id]/route";
import * as orders from "@/app/api/v1/orders/route";
import * as shipments from "@/app/api/v1/shipments/route";
import * as plan from "@/app/api/v1/shipments/[id]/plan/route";
import * as dispatch from "@/app/api/v1/shipments/[id]/dispatch/route";
import * as cancelShipment from "@/app/api/v1/shipments/[id]/cancel/route";
import * as maintenance from "@/app/api/v1/maintenance/route";
import * as workOrder from "@/app/api/v1/maintenance/[id]/route";
import * as start from "@/app/api/v1/maintenance/[id]/start/route";
import * as complete from "@/app/api/v1/maintenance/[id]/complete/route";
import * as cancelWork from "@/app/api/v1/maintenance/[id]/cancel/route";
import * as serviceAreas from "@/app/api/v1/service-areas/route";
import * as serviceArea from "@/app/api/v1/service-areas/[id]/route";
import * as analytics from "@/app/api/v1/analytics/transportation/route";
import * as auditLog from "@/app/api/v1/audit-log/route";
import * as openapi from "@/app/api/v1/openapi.json/route";

const TORONTO = { latitude: 43.6532, longitude: -79.3832 };
const OTTAWA = { latitude: 45.4215, longitude: -75.6972 };

async function organization(name: string) {
  const res = await call(register.POST, {
    body: {
      organizationName: name,
      name: "Morgan Manager",
      email: `${unique("fleet")}@example.com`,
      password: "correct-horse-battery",
    },
  });
  expect(res.status).toBe(201);
  const cookie = res.cookie!;

  const warehouse = await call(locations.POST, {
    cookie,
    body: { type: "WAREHOUSE", name: "Toronto DC", ...TORONTO },
  });
  const customer = await call(customers.POST, { cookie, body: { name: "Retailer B" } });
  const store = await call(locations.POST, {
    cookie,
    body: { type: "CUSTOMER", name: "Ottawa store", customerId: customer.body.id, ...OTTAWA },
  });
  return { cookie, warehouse: warehouse.body, customer: customer.body, store: store.body };
}

async function addVehicle(cookie: string, name: string, homeLocationId: string) {
  const res = await call(vehicles.POST, {
    cookie,
    body: { name, capacityKg: 5000, capacityM3: 30, costPerKm: 1, homeLocationId },
  });
  expect(res.status).toBe(201);
  return res.body;
}

function orderBody(org: Awaited<ReturnType<typeof organization>>) {
  return {
    customerId: org.customer.id,
    pickupLocationId: org.warehouse.id,
    deliveryLocationId: org.store.id,
    lines: [{ description: "Cartons", quantity: 10, weightKg: 200, volumeM3: 2 }],
  };
}

async function draftShipment(org: Awaited<ReturnType<typeof organization>>) {
  const order = await call(orders.POST, { cookie: org.cookie, body: orderBody(org) });
  expect(order.status).toBe(201);
  const shipment = await call(shipments.POST, { cookie: org.cookie, body: { orderIds: [order.body.id] } });
  expect(shipment.status).toBe(201);
  return shipment.body;
}

const planOnto = (cookie: string, shipmentId: string, vehicleId: string) =>
  call(plan.POST, {
    cookie,
    params: { id: shipmentId },
    body: { vehicleId, departAt: new Date().toISOString(), objective: "distance" },
  });

const vehicleStatus = async (cookie: string, id: string) =>
  (await call(vehicle.GET, { cookie, params: { id } })).body.status;

describe("vehicle maintenance", () => {
  const s: Record<string, any> = {};

  it("schedules a work order without taking the vehicle out of service", async () => {
    s.org = await organization("Fleet Test Haulage");
    s.truck = await addVehicle(s.org.cookie, "TRK-201", s.org.warehouse.id);

    const res = await call(maintenance.POST, {
      cookie: s.org.cookie,
      body: {
        vehicleId: s.truck.id,
        type: "SERVICE",
        title: "50,000 km service",
        scheduledFor: new Date(Date.now() + 86_400_000).toISOString(),
        vendor: "Northside Garage",
      },
    });
    expect(res.status).toBe(201);
    expect(res.body.number).toBe("MNT-00001");
    expect(res.body.status).toBe("SCHEDULED");
    expect(res.body.vehicle.name).toBe("TRK-201");
    s.work = res.body;
    expect(await vehicleStatus(s.org.cookie, s.truck.id)).toBe("AVAILABLE");

    const edited = await call(workOrder.PATCH, {
      cookie: s.org.cookie,
      method: "PATCH",
      params: { id: s.work.id },
      body: { title: "50,000 km service and brakes" },
    });
    expect(edited.status).toBe(200);
    expect(edited.body.title).toBe("50,000 km service and brakes");
  });

  it("starting the work grounds the vehicle, and planning refuses it", async () => {
    const res = await call(start.POST, { cookie: s.org.cookie, method: "POST", params: { id: s.work.id } });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("IN_PROGRESS");
    expect(res.body.startedAt).toBeTruthy();
    expect(await vehicleStatus(s.org.cookie, s.truck.id)).toBe("MAINTENANCE");

    s.shipment = await draftShipment(s.org);
    const planned = await planOnto(s.org.cookie, s.shipment.id, s.truck.id);
    expect(planned.status).toBe(409);
    expect(planned.body.error.message).toMatch(/in maintenance/i);

    const edit = await call(workOrder.PATCH, {
      cookie: s.org.cookie,
      method: "PATCH",
      params: { id: s.work.id },
      body: { title: "Too late to edit" },
    });
    expect(edit.status).toBe(409);
    const again = await call(start.POST, { cookie: s.org.cookie, method: "POST", params: { id: s.work.id } });
    expect(again.status).toBe(409);
  });

  it("keeps the vehicle grounded while another work order is still in progress", async () => {
    const second = await call(maintenance.POST, {
      cookie: s.org.cookie,
      body: { vehicleId: s.truck.id, type: "TIRES", title: "Replace front tyres", scheduledFor: new Date().toISOString() },
    });
    await call(start.POST, { cookie: s.org.cookie, method: "POST", params: { id: second.body.id } });

    const done = await call(complete.POST, {
      cookie: s.org.cookie,
      params: { id: second.body.id },
      body: { cost: 820 },
    });
    expect(done.status).toBe(200);
    expect(done.body.status).toBe("COMPLETED");
    expect(done.body.cost).toBe(820);
    expect(await vehicleStatus(s.org.cookie, s.truck.id)).toBe("MAINTENANCE");
  });

  it("completing the last open work returns the vehicle to service", async () => {
    const res = await call(complete.POST, {
      cookie: s.org.cookie,
      params: { id: s.work.id },
      body: { cost: 1450.5, notes: "Brake pads replaced" },
    });
    expect(res.status).toBe(200);
    expect(res.body.completedAt).toBeTruthy();
    expect(res.body.notes).toBe("Brake pads replaced");
    expect(await vehicleStatus(s.org.cookie, s.truck.id)).toBe("AVAILABLE");

    const closed = await call(cancelWork.POST, {
      cookie: s.org.cookie,
      params: { id: s.work.id },
      body: { reason: "Changed my mind" },
    });
    expect(closed.status).toBe(409);

    const planned = await planOnto(s.org.cookie, s.shipment.id, s.truck.id);
    expect(planned.status).toBe(200);
  });

  it("will not start work on a vehicle that is out on a shipment", async () => {
    const out = await call(dispatch.POST, { cookie: s.org.cookie, method: "POST", params: { id: s.shipment.id } });
    expect(out.status).toBe(200);
    expect(await vehicleStatus(s.org.cookie, s.truck.id)).toBe("IN_USE");

    const work = await call(maintenance.POST, {
      cookie: s.org.cookie,
      body: { vehicleId: s.truck.id, type: "INSPECTION", title: "Annual inspection", scheduledFor: new Date().toISOString() },
    });
    const refused = await call(start.POST, { cookie: s.org.cookie, method: "POST", params: { id: work.body.id } });
    expect(refused.status).toBe(409);
    expect(refused.body.error.message).toContain(s.shipment.number);

    // Cancelling a work order that never started leaves the vehicle alone.
    const cancelled = await call(cancelWork.POST, {
      cookie: s.org.cookie,
      params: { id: work.body.id },
      body: { reason: "Inspection moved to next quarter" },
    });
    expect(cancelled.status).toBe(200);
    expect(cancelled.body.status).toBe("CANCELLED");
    expect(cancelled.body.cancelReason).toBe("Inspection moved to next quarter");
    expect(await vehicleStatus(s.org.cookie, s.truck.id)).toBe("IN_USE");
  });

  it("refuses to dispatch a planned shipment whose vehicle went into the shop", async () => {
    const van = await addVehicle(s.org.cookie, "VAN-7", s.org.warehouse.id);
    const shipment = await draftShipment(s.org);
    expect((await planOnto(s.org.cookie, shipment.id, van.id)).status).toBe(200);

    const work = await call(maintenance.POST, {
      cookie: s.org.cookie,
      body: { vehicleId: van.id, type: "REPAIR", title: "Warning light", scheduledFor: new Date().toISOString() },
    });
    await call(start.POST, { cookie: s.org.cookie, method: "POST", params: { id: work.body.id } });

    const res = await call(dispatch.POST, { cookie: s.org.cookie, method: "POST", params: { id: shipment.id } });
    expect(res.status).toBe(409);
    expect(res.body.error.message).toMatch(/VAN-7 is in maintenance/);

    // Cancelling in-progress work brings the vehicle back, and dispatch works.
    await call(cancelWork.POST, { cookie: s.org.cookie, params: { id: work.body.id }, body: { reason: "False alarm" } });
    expect(await vehicleStatus(s.org.cookie, van.id)).toBe("AVAILABLE");
    expect((await call(dispatch.POST, { cookie: s.org.cookie, method: "POST", params: { id: shipment.id } })).status).toBe(200);
    await call(cancelShipment.POST, { cookie: s.org.cookie, params: { id: shipment.id }, body: { reason: "Test cleanup" } });
  });

  it("filters the list and records every step in the audit log", async () => {
    const open = await call(maintenance.GET, { cookie: s.org.cookie, path: "/api/v1/maintenance?status=open" });
    expect(open.body.data).toEqual([]);
    const all = await call(maintenance.GET, { cookie: s.org.cookie, path: "/api/v1/maintenance" });
    expect(all.body.total).toBe(4);
    const byVehicle = await call(maintenance.GET, {
      cookie: s.org.cookie,
      path: `/api/v1/maintenance?vehicleId=${s.truck.id}&q=brakes`,
    });
    expect(byVehicle.body.data.map((w: any) => w.number)).toEqual(["MNT-00001"]);

    const detail = await call(workOrder.GET, { cookie: s.org.cookie, params: { id: s.work.id } });
    expect(detail.body.history.map((h: any) => h.action)).toEqual([
      "maintenance.scheduled",
      "maintenance.updated",
      "maintenance.started",
      "maintenance.completed",
    ]);
    const audit = await call(auditLog.GET, { cookie: s.org.cookie, path: "/api/v1/audit-log?entityType=maintenance" });
    expect(audit.body.total).toBeGreaterThanOrEqual(10);
  });

  it("keeps work orders inside their organization and behind permissions", async () => {
    const other = await organization("Someone Else Freight");
    expect((await call(workOrder.GET, { cookie: other.cookie, params: { id: s.work.id } })).status).toBe(404);
    expect((await call(start.POST, { cookie: other.cookie, method: "POST", params: { id: s.work.id } })).status).toBe(404);
    const foreign = await call(maintenance.POST, {
      cookie: other.cookie,
      body: { vehicleId: s.truck.id, type: "OTHER", title: "Not mine", scheduledFor: new Date().toISOString() },
    });
    expect(foreign.status).toBe(404);

    const key = await call(apiKeys.POST, { cookie: s.org.cookie, body: { name: "Dispatch desk", role: "DISPATCHER" } });
    const dispatcher = key.body.key as string;
    expect((await call(maintenance.GET, { apiKey: dispatcher })).status).toBe(200);
    const denied = await call(maintenance.POST, {
      apiKey: dispatcher,
      body: { vehicleId: s.truck.id, type: "OTHER", title: "Nope", scheduledFor: new Date().toISOString() },
    });
    expect(denied.status).toBe(403);
  });
});

describe("service areas", () => {
  const s: Record<string, any> = {};

  it("leaves orders unrestricted until an area exists", async () => {
    s.org = await organization("Area Test Couriers");
    expect((await call(orders.POST, { cookie: s.org.cookie, body: orderBody(s.org) })).status).toBe(201);
  });

  it("rejects an order that leaves every active area, naming the location", async () => {
    const area = await call(serviceAreas.POST, {
      cookie: s.org.cookie,
      body: { name: "Greater Toronto", ...TORONTO, radiusKm: 60 },
    });
    expect(area.status).toBe(201);
    expect(area.body.active).toBe(true);
    s.area = area.body;

    const res = await call(orders.POST, { cookie: s.org.cookie, body: orderBody(s.org) });
    expect(res.status).toBe(422);
    expect(res.body.error.message).toMatch(/^Ottawa store is outside every active service area/);
    expect(res.body.error.details.locations.map((l: any) => l.name)).toEqual(["Ottawa store"]);
  });

  it("accepts the order once an area covers both ends", async () => {
    const widened = await call(serviceArea.PATCH, {
      cookie: s.org.cookie,
      method: "PATCH",
      params: { id: s.area.id },
      body: { radiusKm: 400 },
    });
    expect(widened.body.radiusKm).toBe(400);
    expect((await call(orders.POST, { cookie: s.org.cookie, body: orderBody(s.org) })).status).toBe(201);
  });

  it("ignores inactive and removed areas", async () => {
    await call(serviceArea.PATCH, { cookie: s.org.cookie, method: "PATCH", params: { id: s.area.id }, body: { radiusKm: 10 } });
    expect((await call(orders.POST, { cookie: s.org.cookie, body: orderBody(s.org) })).status).toBe(422);

    await call(serviceArea.PATCH, { cookie: s.org.cookie, method: "PATCH", params: { id: s.area.id }, body: { active: false } });
    expect((await call(orders.POST, { cookie: s.org.cookie, body: orderBody(s.org) })).status).toBe(201);

    const second = await call(serviceAreas.POST, {
      cookie: s.org.cookie,
      body: { name: "Downtown only", ...TORONTO, radiusKm: 5 },
    });
    expect((await call(orders.POST, { cookie: s.org.cookie, body: orderBody(s.org) })).status).toBe(422);
    await call(serviceArea.DELETE, { cookie: s.org.cookie, method: "DELETE", params: { id: second.body.id } });
    expect((await call(orders.POST, { cookie: s.org.cookie, body: orderBody(s.org) })).status).toBe(201);

    const listed = await call(serviceAreas.GET, { cookie: s.org.cookie });
    expect(listed.body.data.map((a: any) => a.name)).toEqual(["Greater Toronto"]);
  });

  it("validates the radius", async () => {
    const res = await call(serviceAreas.POST, {
      cookie: s.org.cookie,
      body: { name: "Bad", ...TORONTO, radiusKm: 0 },
    });
    expect(res.status).toBe(422);
  });
});

describe("analytics export", () => {
  it("downloads the daily and carrier tables as CSV", async () => {
    const org = await organization("Export Test Lines");
    const daily = await call(analytics.GET, {
      cookie: org.cookie,
      path: "/api/v1/analytics/transportation?format=csv",
    });
    expect(daily.status).toBe(200);
    expect(daily.headers.get("content-type")).toMatch(/^text\/csv/);
    expect(daily.headers.get("content-disposition")).toMatch(/attachment; filename="transportation-daily-from-\d{4}-\d{2}-\d{2}\.csv"/);
    expect(String(daily.body).replace(/^﻿/, "").split("\r\n")[0]).toBe(
      "date,shipments,spend,distance_km,cost_per_shipment,cost_per_km,on_time_pct,deliveries_measured,avg_transit_hours",
    );

    const carriers = await call(analytics.GET, {
      cookie: org.cookie,
      path: "/api/v1/analytics/transportation?format=csv&table=carriers",
    });
    expect(String(carriers.body).replace(/^﻿/, "").split("\r\n")[0]).toMatch(/^carrier,shipments,.*,tender_acceptance_pct$/);

    const bad = await call(analytics.GET, { cookie: org.cookie, path: "/api/v1/analytics/transportation?format=xml" });
    expect(bad.status).toBe(422);
  });

  it("documents the new endpoints", async () => {
    const doc = await openapi.GET().json();
    expect(Object.keys(doc.paths)).toEqual(
      expect.arrayContaining(["/maintenance", "/maintenance/{id}/start", "/service-areas", "/service-areas/{id}"]),
    );
  });
});
