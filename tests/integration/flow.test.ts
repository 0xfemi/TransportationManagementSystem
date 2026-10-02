import { describe, expect, it } from "vitest";
import { call, unique } from "../helpers";
import * as register from "@/app/api/v1/auth/register/route";
import * as me from "@/app/api/v1/auth/me/route";
import * as locations from "@/app/api/v1/locations/route";
import * as customers from "@/app/api/v1/customers/route";
import * as carriers from "@/app/api/v1/carriers/route";
import * as carrierScorecard from "@/app/api/v1/carriers/[id]/scorecard/route";
import * as vehicles from "@/app/api/v1/vehicles/route";
import * as vehicle from "@/app/api/v1/vehicles/[id]/route";
import * as drivers from "@/app/api/v1/drivers/route";
import * as orders from "@/app/api/v1/orders/route";
import * as order from "@/app/api/v1/orders/[id]/route";
import * as shipments from "@/app/api/v1/shipments/route";
import * as shipment from "@/app/api/v1/shipments/[id]/route";
import * as plan from "@/app/api/v1/shipments/[id]/plan/route";
import * as tender from "@/app/api/v1/shipments/[id]/tender/route";
import * as tenderRespond from "@/app/api/v1/shipments/[id]/tender/respond/route";
import * as dispatch from "@/app/api/v1/shipments/[id]/dispatch/route";
import * as cancel from "@/app/api/v1/shipments/[id]/cancel/route";
import * as simulate from "@/app/api/v1/shipments/[id]/simulate/route";
import * as tracking from "@/app/api/v1/shipments/[id]/tracking/route";
import * as trackingEvents from "@/app/api/v1/tracking/events/route";
import * as optimizeRoute from "@/app/api/v1/routes/optimize/route";
import * as commitRoute from "@/app/api/v1/routes/commit/route";
import * as exceptions from "@/app/api/v1/exceptions/route";
import * as exception from "@/app/api/v1/exceptions/[id]/route";
import * as documents from "@/app/api/v1/documents/route";
import * as document from "@/app/api/v1/documents/[id]/route";
import * as analytics from "@/app/api/v1/analytics/transportation/route";
import * as commandCenter from "@/app/api/v1/command-center/route";
import * as auditLog from "@/app/api/v1/audit-log/route";
import * as search from "@/app/api/v1/search/route";

const HOUR = 3_600_000;
const TORONTO = { latitude: 43.6532, longitude: -79.3832 };
const OTTAWA = { latitude: 45.4215, longitude: -75.6972 };
const KINGSTON = { latitude: 44.2312, longitude: -76.486 };

/**
 * Walks the release's success criteria end to end through the public API:
 * organization → master data → order → shipment → plan → tender → dispatch →
 * track → delay → resolve → deliver → proof of delivery → history → analytics.
 */
describe("order to delivery", () => {
  const s: Record<string, any> = {};

  it("1. creates an organization", async () => {
    const res = await call(register.POST, {
      body: {
        organizationName: "Flow Test Logistics",
        name: "Pat Planner",
        email: `${unique("flow")}@example.com`,
        password: "correct-horse-battery",
      },
    });
    expect(res.status).toBe(201);
    expect(res.cookie).toMatch(/^tms_session=/);
    s.cookie = res.cookie;

    const who = await call(me.GET, { cookie: s.cookie });
    expect(who.body.role).toBe("ADMIN");
    expect(who.body.organization.name).toBe("Flow Test Logistics");
  });

  it("2–5. adds a warehouse, a customer, a carrier and a vehicle", async () => {
    const warehouse = await call(locations.POST, {
      cookie: s.cookie,
      body: { type: "WAREHOUSE", name: "Toronto DC", city: "Toronto", ...TORONTO },
    });
    expect(warehouse.status).toBe(201);
    s.warehouse = warehouse.body;

    const customer = await call(customers.POST, { cookie: s.cookie, body: { name: "Retailer A" } });
    expect(customer.status).toBe(201);
    s.customer = customer.body;

    const store = await call(locations.POST, {
      cookie: s.cookie,
      body: { type: "CUSTOMER", name: "Retailer A Ottawa", city: "Ottawa", customerId: s.customer.id, ...OTTAWA },
    });
    s.store = store.body;
    const store2 = await call(locations.POST, {
      cookie: s.cookie,
      body: { type: "CUSTOMER", name: "Retailer A Kingston", city: "Kingston", customerId: s.customer.id, ...KINGSTON },
    });
    s.store2 = store2.body;

    const carrier = await call(carriers.POST, {
      cookie: s.cookie,
      body: { name: "Carrier Alpha", baseRate: 150, ratePerKm: 1.8, fuelSurchargePct: 12 },
    });
    expect(carrier.status).toBe(201);
    s.carrier = carrier.body;

    const truck = await call(vehicles.POST, {
      cookie: s.cookie,
      body: {
        name: "TRK-101",
        vehicleType: "Box truck",
        capacityKg: 5000,
        capacityM3: 30,
        costPerKm: 1.2,
        homeLocationId: s.warehouse.id,
      },
    });
    expect(truck.status).toBe(201);
    s.vehicle = truck.body;

    const driver = await call(drivers.POST, {
      cookie: s.cookie,
      body: { name: "Dana Driver", vehicleId: s.vehicle.id },
    });
    expect(driver.status).toBe(201);
  });

  it("6. creates an order", async () => {
    const res = await call(orders.POST, {
      cookie: s.cookie,
      body: {
        customerId: s.customer.id,
        pickupLocationId: s.warehouse.id,
        deliveryLocationId: s.store.id,
        priority: "HIGH",
        deliveryWindowEnd: new Date(Date.now() + 8 * HOUR).toISOString(),
        lines: [
          { description: "Pallet of beverages", quantity: 4, weightKg: 1200, volumeM3: 6 },
          { description: "Display stands", quantity: 2, weightKg: 80, volumeM3: 1.5 },
        ],
      },
    });
    expect(res.status).toBe(201);
    expect(res.body.number).toBe("ORD-00001");
    expect(res.body.totalWeightKg).toBe(1280);
    expect(res.body.status).toBe("OPEN");
    s.order = res.body;
  });

  it("7. converts the order into a shipment", async () => {
    const res = await call(shipments.POST, { cookie: s.cookie, body: { orderIds: [s.order.id] } });
    expect(res.status).toBe(201);
    expect(res.body.status).toBe("DRAFT");
    expect(res.body.number).toBe("SHP-00001");
    s.shipment = res.body;

    const updated = await call(order.GET, { cookie: s.cookie, params: { id: s.order.id } });
    expect(updated.body.status).toBe("PLANNED");
    expect(updated.body.shipment.number).toBe("SHP-00001");

    const again = await call(shipments.POST, { cookie: s.cookie, body: { orderIds: [s.order.id] } });
    expect(again.status).toBe(409);
  });

  it("refuses to dispatch a shipment that has no route", async () => {
    const res = await call(dispatch.POST, { cookie: s.cookie, method: "POST", params: { id: s.shipment.id } });
    expect(res.status).toBe(409);
  });

  it("8–9. plans and optimizes the route", async () => {
    const res = await call(plan.POST, {
      cookie: s.cookie,
      params: { id: s.shipment.id },
      body: { vehicleId: s.vehicle.id, departAt: new Date().toISOString(), objective: "distance" },
    });
    expect(res.status).toBe(200);
    expect(res.body.lateStops).toEqual([]);

    const detail = await call(shipment.GET, { cookie: s.cookie, params: { id: s.shipment.id } });
    expect(detail.body.status).toBe("PLANNED");
    expect(detail.body.stops.map((x: any) => x.type)).toEqual(["PICKUP", "DELIVERY"]);
    // Toronto to Ottawa: ~352 km straight line × 1.3 road factor.
    expect(detail.body.plannedDistanceKm).toBeGreaterThan(440);
    expect(detail.body.plannedDistanceKm).toBeLessThan(470);
    expect(detail.body.routeGeometry.length).toBeGreaterThanOrEqual(2);
    expect(detail.body.vehicle.name).toBe("TRK-101");
    expect(detail.body.driver.name).toBe("Dana Driver");
    expect(detail.body.stops[1].plannedArrival).toBeTruthy();
    // Own-fleet cost until a carrier is chosen: distance × 1.2 per km.
    expect(detail.body.estimatedCost).toBeCloseTo(detail.body.plannedDistanceKm * 1.2, 1);
  });

  it("10. assigns a carrier by tender, and the carrier accepts", async () => {
    const sent = await call(tender.POST, {
      cookie: s.cookie,
      params: { id: s.shipment.id },
      body: { carrierId: s.carrier.id },
    });
    expect(sent.status).toBe(201);

    const waiting = await call(dispatch.POST, { cookie: s.cookie, method: "POST", params: { id: s.shipment.id } });
    expect(waiting.status).toBe(409);
    expect(waiting.body.error.message).toMatch(/waiting for the carrier/i);

    const accepted = await call(tenderRespond.POST, {
      cookie: s.cookie,
      params: { id: s.shipment.id },
      body: { accepted: true },
    });
    expect(accepted.body.status).toBe("ACCEPTED");

    const detail = await call(shipment.GET, { cookie: s.cookie, params: { id: s.shipment.id } });
    expect(detail.body.carrier.name).toBe("Carrier Alpha");
    const km = detail.body.plannedDistanceKm;
    const linehaul = 150 + Math.round(km * 1.8 * 100) / 100;
    expect(detail.body.estimatedCost).toBeCloseTo(linehaul * 1.12, 1);
    expect(detail.body.costBreakdown.map((l: any) => l.code)).toEqual(["BASE", "DISTANCE", "FUEL"]);
    s.quotedCost = detail.body.estimatedCost;
  });

  it("11. dispatches the shipment", async () => {
    const res = await call(dispatch.POST, { cookie: s.cookie, method: "POST", params: { id: s.shipment.id } });
    expect(res.status).toBe(200);

    const detail = await call(shipment.GET, { cookie: s.cookie, params: { id: s.shipment.id } });
    expect(detail.body.status).toBe("DISPATCHED");
    expect(detail.body.currentLatitude).toBeCloseTo(TORONTO.latitude);
    const truck = await call(vehicle.GET, { cookie: s.cookie, params: { id: s.vehicle.id } });
    expect(truck.body.status).toBe("IN_USE");
    const o = await call(order.GET, { cookie: s.cookie, params: { id: s.order.id } });
    expect(o.body.status).toBe("IN_TRANSIT");
  });

  it("accepts tracking events from outside and ignores repeated deliveries", async () => {
    const body = {
      shipmentId: s.shipment.id,
      type: "LOCATION_UPDATE",
      latitude: TORONTO.latitude,
      longitude: TORONTO.longitude,
      speedKph: 0,
      externalId: "gps-0001",
    };
    const first = await call(trackingEvents.POST, { cookie: s.cookie, body });
    expect(first.status).toBe(201);
    expect(first.body.shipmentStatus).toBe("IN_TRANSIT");
    const repeat = await call(trackingEvents.POST, { cookie: s.cookie, body });
    expect(repeat.status).toBe(200);
    expect(repeat.body.duplicate).toBe(true);

    const history = await call(tracking.GET, { cookie: s.cookie, params: { id: s.shipment.id } });
    expect(history.body.events.filter((e: any) => e.externalId === "gps-0001")).toHaveLength(1);
  });

  it("rejects a delivery report against a pickup stop", async () => {
    const res = await call(trackingEvents.POST, {
      cookie: s.cookie,
      body: { shipmentId: s.shipment.id, type: "DELIVERED" },
    });
    expect(res.status).toBe(422);
  });

  it("12–13. simulates tracking and the shipment moves on the map", async () => {
    const res = await call(simulate.POST, {
      cookie: s.cookie,
      params: { id: s.shipment.id },
      body: { minutes: 90, speedFactor: 1 },
    });
    expect(res.status).toBe(200);
    expect(res.body.events.map((e: any) => e.type)).toEqual([
      "ARRIVED_PICKUP",
      "DEPARTED_PICKUP",
      "LOCATION_UPDATE",
    ]);

    const detail = await call(shipment.GET, { cookie: s.cookie, params: { id: s.shipment.id } });
    expect(detail.body.status).toBe("IN_TRANSIT");
    expect(detail.body.currentLongitude).toBeGreaterThan(TORONTO.longitude);
    expect(detail.body.currentLongitude).toBeLessThan(OTTAWA.longitude);
    expect(detail.body.delayMinutes).toBeLessThan(15);
    expect(detail.body.etaWindowMinutes).toBeGreaterThan(0);

    const history = await call(tracking.GET, { cookie: s.cookie, params: { id: s.shipment.id } });
    expect(history.body.path.length).toBeGreaterThanOrEqual(3);

    const cc = await call(commandCenter.GET, { cookie: s.cookie });
    expect(cc.body.operations.inTransit).toBe(1);
    expect(cc.body.operations.delayed).toBe(0);
    expect(cc.body.operations.vehiclesActive).toBe(1);
    expect(cc.body.map.shipments[0].number).toBe("SHP-00001");
  });

  it("14. detects a delay and raises an exception", async () => {
    // Three hours of heavy traffic at 30% of normal speed.
    await call(simulate.POST, {
      cookie: s.cookie,
      params: { id: s.shipment.id },
      body: { minutes: 180, speedFactor: 0.3 },
    });
    const detail = await call(shipment.GET, { cookie: s.cookie, params: { id: s.shipment.id } });
    expect(detail.body.delayMinutes).toBeGreaterThan(60);

    const list = await call(exceptions.GET, { cookie: s.cookie, path: "/?status=active" });
    expect(list.body.total).toBe(1);
    const late = list.body.data[0];
    expect(late.type).toBe("LATE_SHIPMENT");
    expect(late.title).toMatch(/SHP-00001 is \d+ minutes behind schedule/);
    expect(late.impact).toMatch(/Retailer A Ottawa/);
    expect(late.recommendedAction.length).toBeGreaterThan(10);
    expect(["HIGH", "CRITICAL"]).toContain(late.severity);
    s.exception = late;

    // Another ping while still late updates the same exception.
    await call(simulate.POST, {
      cookie: s.cookie,
      params: { id: s.shipment.id },
      body: { minutes: 10, speedFactor: 0.3 },
    });
    const after = await call(exceptions.GET, { cookie: s.cookie, path: "/?status=active" });
    expect(after.body.total).toBe(1);

    const cc = await call(commandCenter.GET, { cookie: s.cookie });
    expect(cc.body.operations.delayed).toBe(1);
    expect(cc.body.operations.openExceptions).toBe(1);
    expect(cc.body.exceptions[0].id).toBe(late.id);
  });

  it("15. resolves the exception", async () => {
    const res = await call(exception.PATCH, {
      cookie: s.cookie,
      method: "PATCH",
      params: { id: s.exception.id },
      body: { status: "RESOLVED", resolutionNote: "Customer informed of new ETA" },
    });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("RESOLVED");
    expect(res.body.resolvedAt).toBeTruthy();

    // A slightly later ping does not reopen what the planner just closed.
    await call(simulate.POST, {
      cookie: s.cookie,
      params: { id: s.shipment.id },
      body: { minutes: 5, speedFactor: 1 },
    });
    const active = await call(exceptions.GET, { cookie: s.cookie, path: "/?status=active" });
    expect(active.body.total).toBe(0);

    const detail = await call(exception.GET, { cookie: s.cookie, params: { id: s.exception.id } });
    expect(detail.body.history.at(-1).reason).toBe("Customer informed of new ETA");
  });

  it("16. completes the delivery", async () => {
    const res = await call(simulate.POST, {
      cookie: s.cookie,
      params: { id: s.shipment.id },
      body: { minutes: 2880, speedFactor: 1 },
    });
    expect(res.body.events.map((e: any) => e.type)).toEqual(["ARRIVED_DESTINATION", "DELIVERED"]);

    const detail = await call(shipment.GET, { cookie: s.cookie, params: { id: s.shipment.id } });
    expect(detail.body.status).toBe("DELIVERED");
    expect(detail.body.actualEnd).toBeTruthy();
    expect(detail.body.actualCost).toBe(s.quotedCost);
    expect(detail.body.stops.every((x: any) => x.status === "COMPLETED")).toBe(true);

    const o = await call(order.GET, { cookie: s.cookie, params: { id: s.order.id } });
    expect(o.body.status).toBe("DELIVERED");
    const truck = await call(vehicle.GET, { cookie: s.cookie, params: { id: s.vehicle.id } });
    expect(truck.body.status).toBe("AVAILABLE");

    const more = await call(simulate.POST, {
      cookie: s.cookie,
      params: { id: s.shipment.id },
      body: { minutes: 10 },
    });
    expect(more.status).toBe(409);
  });

  it("17. uploads proof of delivery", async () => {
    const form = new FormData();
    const pdf = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34, 0x0a]);
    form.set("file", new File([pdf], "signed-pod.pdf", { type: "application/pdf" }));
    form.set("entityType", "shipment");
    form.set("entityId", s.shipment.id);
    form.set("type", "PROOF_OF_DELIVERY");
    const res = await call(documents.POST, { cookie: s.cookie, form });
    expect(res.status).toBe(201);
    expect(res.body.filename).toBe("signed-pod.pdf");

    const detail = await call(shipment.GET, { cookie: s.cookie, params: { id: s.shipment.id } });
    expect(detail.body.documents).toHaveLength(1);

    const download = await call(document.GET, { cookie: s.cookie, params: { id: res.body.id } });
    expect(download.status).toBe(200);
    expect(download.headers.get("content-disposition")).toContain("attachment");
    expect(download.body.startsWith("%PDF")).toBe(true);
  });

  it("rejects a file whose contents do not match its declared type", async () => {
    const form = new FormData();
    form.set("file", new File(["<script>alert(1)</script>"], "pod.pdf", { type: "application/pdf" }));
    form.set("entityType", "shipment");
    form.set("entityId", s.shipment.id);
    form.set("type", "PROOF_OF_DELIVERY");
    expect((await call(documents.POST, { cookie: s.cookie, form })).status).toBe(422);

    const html = new FormData();
    html.set("file", new File(["<html></html>"], "page.html", { type: "text/html" }));
    html.set("entityType", "shipment");
    html.set("entityId", s.shipment.id);
    html.set("type", "OTHER");
    expect((await call(documents.POST, { cookie: s.cookie, form: html })).status).toBe(422);
  });

  it("18. shows the full shipment history in order", async () => {
    const history = await call(tracking.GET, { cookie: s.cookie, params: { id: s.shipment.id } });
    const milestones = history.body.events
      .map((e: any) => e.type)
      .filter((t: string) => t !== "LOCATION_UPDATE");
    expect(milestones).toEqual([
      "CREATED",
      "PLANNED",
      "TENDERED",
      "ACCEPTED",
      "DISPATCHED",
      "ARRIVED_PICKUP",
      "DEPARTED_PICKUP",
      "ARRIVED_DESTINATION",
      "DELIVERED",
      "POD_RECEIVED",
    ]);
    const times = history.body.events.map((e: any) => new Date(e.occurredAt).getTime());
    expect([...times].sort((a, b) => a - b)).toEqual(times);

    const audit = await call(auditLog.GET, {
      cookie: s.cookie,
      path: `/?entityType=shipment&entityId=${s.shipment.id}`,
    });
    const actions = audit.body.data.map((a: any) => a.action);
    for (const action of [
      "shipment.created",
      "shipment.planned",
      "shipment.tendered",
      "tender.accepted",
      "shipment.dispatched",
      "shipment.delivered",
      "document.uploaded",
    ]) {
      expect(actions).toContain(action);
    }
    expect(audit.body.data.find((a: any) => a.action === "shipment.tendered").after.carrier).toBe("Carrier Alpha");
  });

  it("19. reflects the delivery in transportation analytics", async () => {
    const res = await call(analytics.GET, { cookie: s.cookie });
    expect(res.status).toBe(200);
    const t = res.body.totals;
    expect(t.shipments).toBe(1);
    expect(t.spend).toBe(s.quotedCost);
    expect(t.costPerShipment).toBe(s.quotedCost);
    expect(t.costPerKm).toBeGreaterThan(1.8);
    expect(t.deliveriesMeasured).toBe(1);
    // It ran through three hours of traffic and missed its window.
    expect(t.onTimePct).toBe(0);
    expect(t.tenderAcceptancePct).toBe(100);
    expect(res.body.carriers[0]).toMatchObject({ name: "Carrier Alpha", shipments: 1, tenderAcceptancePct: 100 });
    expect(res.body.exceptionsByType).toEqual([{ type: "LATE_SHIPMENT", count: 1 }]);

    const scorecard = await call(carrierScorecard.GET, { cookie: s.cookie, params: { id: s.carrier.id } });
    expect(scorecard.body.shipments).toBe(1);

    const cc = await call(commandCenter.GET, { cookie: s.cookie });
    expect(cc.body.kpis.delivered).toBe(1);
    expect(cc.body.operations.inTransit).toBe(0);
  });

  it("finds records through global search", async () => {
    const res = await call(search.GET, { cookie: s.cookie, path: "/?q=shp-0000" });
    expect(res.body.data.map((h: any) => h.title)).toContain("SHP-00001");
    const byName = await call(search.GET, { cookie: s.cookie, path: "/?q=alpha" });
    expect(byName.body.data[0]).toMatchObject({ type: "Carrier", title: "Carrier Alpha" });
  });

  describe("multi-order planning", () => {
    it("proposes alternatives without saving, then commits the chosen one", async () => {
      const windowEnd = new Date(Date.now() + 30 * HOUR).toISOString();
      const make = async (deliveryLocationId: string, weightKg: number) =>
        (
          await call(orders.POST, {
            cookie: s.cookie,
            body: {
              customerId: s.customer.id,
              pickupLocationId: s.warehouse.id,
              deliveryLocationId,
              deliveryWindowEnd: windowEnd,
              lines: [{ description: "Mixed goods", quantity: 1, weightKg, volumeM3: 2 }],
            },
          })
        ).body;
      const ottawa = await make(s.store.id, 900);
      const kingston = await make(s.store2.id, 700);
      const tooHeavy = await make(s.store2.id, 9000);

      const input = {
        orderIds: [ottawa.id, kingston.id, tooHeavy.id],
        vehicleIds: [s.vehicle.id],
        departAt: new Date().toISOString(),
      };
      const proposal = await call(optimizeRoute.POST, { cookie: s.cookie, body: input });
      expect(proposal.status).toBe(200);
      const best = proposal.body.alternatives[0];
      // Kingston lies between Toronto and Ottawa, so it is dropped first.
      expect(best.routes[0].stops.map((x: any) => `${x.kind}:${x.location.name}`)).toEqual([
        "pickup:Toronto DC",
        "pickup:Toronto DC",
        "delivery:Retailer A Kingston",
        "delivery:Retailer A Ottawa",
      ]);
      expect(best.routes[0].peakLoadKg).toBe(1600);
      expect(best.unassigned).toEqual([
        {
          orderId: tooHeavy.id,
          orderNumber: tooHeavy.number,
          reason: "Exceeds the capacity of every selected vehicle",
        },
      ]);

      // Nothing was saved by proposing.
      const stillOpen = await call(order.GET, { cookie: s.cookie, params: { id: ottawa.id } });
      expect(stillOpen.body.status).toBe("OPEN");

      const committed = await call(commitRoute.POST, {
        cookie: s.cookie,
        body: { ...input, objective: best.objective },
      });
      expect(committed.status).toBe(201);
      expect(committed.body.shipments).toHaveLength(1);
      expect(committed.body.unassigned[0].orderNumber).toBe(tooHeavy.number);

      const saved = await call(shipment.GET, {
        cookie: s.cookie,
        params: { id: committed.body.shipments[0].id },
      });
      expect(saved.body.status).toBe("PLANNED");
      expect(saved.body.plannedDistanceKm).toBeCloseTo(best.routes[0].distanceKm, 5);
      expect(saved.body.stops.map((x: any) => x.location.name)).toEqual([
        "Toronto DC",
        "Toronto DC",
        "Retailer A Kingston",
        "Retailer A Ottawa",
      ]);
      const left = await call(order.GET, { cookie: s.cookie, params: { id: tooHeavy.id } });
      expect(left.body.status).toBe("OPEN");
      s.second = saved.body;
      s.ottawaOrder = ottawa;
    });

    it("turns a rejected tender into an exception and lets the shipment be re-tendered", async () => {
      await call(tender.POST, { cookie: s.cookie, params: { id: s.second.id }, body: { carrierId: s.carrier.id } });
      const rejected = await call(tenderRespond.POST, {
        cookie: s.cookie,
        params: { id: s.second.id },
        body: { accepted: false, note: "No capacity this week" },
      });
      expect(rejected.body.status).toBe("REJECTED");

      const detail = await call(shipment.GET, { cookie: s.cookie, params: { id: s.second.id } });
      expect(detail.body.status).toBe("PLANNED");
      expect(detail.body.carrier).toBeNull();
      expect(detail.body.exceptions[0]).toMatchObject({ type: "CARRIER_REJECTION", status: "OPEN" });
      expect(detail.body.exceptions[0].impact).toContain("No capacity this week");

      const stats = await call(analytics.GET, { cookie: s.cookie });
      expect(stats.body.totals.tenderAcceptancePct).toBe(50);
    });

    it("releases orders when a shipment is cancelled", async () => {
      const res = await call(cancel.POST, {
        cookie: s.cookie,
        params: { id: s.second.id },
        body: { reason: "Customer postponed" },
      });
      expect(res.status).toBe(200);
      const released = await call(order.GET, { cookie: s.cookie, params: { id: s.ottawaOrder.id } });
      expect(released.body.status).toBe("OPEN");
      expect(released.body.shipment).toBeNull();
      const detail = await call(shipment.GET, { cookie: s.cookie, params: { id: s.second.id } });
      expect(detail.body.status).toBe("CANCELLED");
      expect(detail.body.exceptions.every((e: any) => e.status === "RESOLVED")).toBe(true);
    });
  });
});
