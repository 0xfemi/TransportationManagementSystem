import { describe, expect, it } from "vitest";
import { can, permissionsFor } from "@/lib/rbac";
import { dayBounds } from "@/lib/time";
import { rateOwnVehicle, rateWithCarrier } from "@/modules/rating/rate";
import { estimateLeg, haversineKm, interpolate } from "@/modules/routing/geo";
import { projectEta, type EtaStop } from "@/modules/tracking/eta";

const TORONTO = { latitude: 43.6532, longitude: -79.3832 };
const OTTAWA = { latitude: 45.4215, longitude: -75.6972 };
const MIN = 60_000;

describe("geo", () => {
  it("measures great-circle distance", () => {
    // Toronto to Ottawa is about 352 km in a straight line.
    expect(haversineKm(TORONTO, OTTAWA)).toBeGreaterThan(345);
    expect(haversineKm(TORONTO, OTTAWA)).toBeLessThan(360);
    expect(haversineKm(TORONTO, TORONTO)).toBe(0);
  });

  it("interpolates and clamps between two points", () => {
    const mid = interpolate(TORONTO, OTTAWA, 0.5);
    expect(mid.latitude).toBeCloseTo((TORONTO.latitude + OTTAWA.latitude) / 2);
    expect(interpolate(TORONTO, OTTAWA, 2)).toEqual(OTTAWA);
  });

  it("estimates road legs as longer than the straight line", () => {
    const leg = estimateLeg(TORONTO, OTTAWA, "ROAD");
    expect(leg.distanceKm).toBeCloseTo(haversineKm(TORONTO, OTTAWA) * 1.3);
    expect(leg.durationMin).toBeCloseTo((leg.distanceKm / 65) * 60);
  });
});

describe("freight rating", () => {
  const rate = { baseRate: 100, ratePerKm: 2, ratePerKg: 0.1, minimumCharge: 0, fuelSurchargePct: 10 };

  it("itemises every charge and totals them", () => {
    const result = rateWithCarrier(rate, { distanceKm: 250, weightKg: 1000 });
    expect(result.lines.map((l) => [l.code, l.amount])).toEqual([
      ["BASE", 100],
      ["DISTANCE", 500],
      ["WEIGHT", 100],
      ["FUEL", 70],
    ]);
    expect(result.total).toBe(770);
    expect(result.lines.every((l) => l.calculation.length > 0)).toBe(true);
  });

  it("tops a small shipment up to the minimum charge before fuel", () => {
    const result = rateWithCarrier({ ...rate, minimumCharge: 400 }, { distanceKm: 10, weightKg: 50 });
    // Linehaul 100 + 20 + 5 = 125, topped up by 275 to 400, plus 10% fuel.
    expect(result.lines.find((l) => l.code === "MINIMUM")?.amount).toBe(275);
    expect(result.total).toBe(440);
  });

  it("rates the same input identically every time", () => {
    const input = { distanceKm: 123.456, weightKg: 789.1 };
    expect(rateWithCarrier(rate, input)).toEqual(rateWithCarrier(rate, input));
  });

  it("costs an own-fleet trip from fixed and running costs", () => {
    expect(rateOwnVehicle({ costPerKm: 1.5, fixedCost: 80 }, { distanceKm: 200 }).total).toBe(380);
  });
});

describe("permissions", () => {
  it("gives admins everything", () => {
    expect(can("ADMIN", "users:manage")).toBe(true);
    expect(can("ADMIN", "settings:manage")).toBe(true);
  });

  it("keeps user and settings management away from other roles", () => {
    for (const role of ["LOGISTICS_MANAGER", "PLANNER", "DISPATCHER", "FINANCE", "ANALYST", "DRIVER"] as const) {
      expect(can(role, "users:manage")).toBe(false);
      expect(can(role, "settings:manage")).toBe(false);
    }
  });

  it("separates planning from dispatching", () => {
    expect(can("PLANNER", "shipments:plan")).toBe(true);
    expect(can("PLANNER", "shipments:dispatch")).toBe(false);
    expect(can("DISPATCHER", "shipments:dispatch")).toBe(true);
    expect(can("DISPATCHER", "shipments:plan")).toBe(false);
  });

  it("limits analysts to reading", () => {
    expect(permissionsFor("ANALYST").every((p) => p.endsWith(":read"))).toBe(true);
  });

  it("lets drivers report tracking but not see orders or master data", () => {
    expect(can("DRIVER", "tracking:write")).toBe(true);
    expect(can("DRIVER", "orders:read")).toBe(false);
    expect(can("DRIVER", "masterdata:read")).toBe(false);
  });
});

describe("ETA projection", () => {
  const T0 = new Date("2026-01-05T08:00:00Z");
  const stop = (id: string, at: typeof TORONTO, extra: Partial<EtaStop> = {}): EtaStop => ({
    id,
    ...at,
    status: "PENDING",
    serviceMinutes: 15,
    windowStart: null,
    windowEnd: null,
    plannedArrival: null,
    actualArrival: null,
    legDurationMin: null,
    ...extra,
  });

  it("uses the planned leg duration scaled by the distance still to cover", () => {
    const halfway = interpolate(TORONTO, OTTAWA, 0.5);
    const result = projectEta({
      stops: [stop("s1", OTTAWA, { legDurationMin: 300, plannedArrival: new Date(T0.getTime() + 300 * MIN) })],
      origin: TORONTO,
      position: halfway,
      asOf: new Date(T0.getTime() + 150 * MIN),
      mode: "ROAD",
    });
    const etaMin = (result.finalEta!.getTime() - T0.getTime()) / MIN;
    expect(etaMin).toBeGreaterThan(298);
    expect(etaMin).toBeLessThan(302);
    expect(result.delayMinutes).toBeLessThanOrEqual(2);
  });

  it("reports a delay when the vehicle is behind its plan", () => {
    const quarter = interpolate(TORONTO, OTTAWA, 0.25);
    const result = projectEta({
      stops: [stop("s1", OTTAWA, { legDurationMin: 300, windowEnd: new Date(T0.getTime() + 300 * MIN) })],
      origin: TORONTO,
      position: quarter,
      // Half the time gone, a quarter of the distance covered.
      asOf: new Date(T0.getTime() + 150 * MIN),
      mode: "ROAD",
    });
    expect(result.delayMinutes).toBeGreaterThan(70);
    expect(result.delayMinutes).toBeLessThan(80);
    expect(result.worstStopId).toBe("s1");
  });

  it("carries a delay forward to later stops, including service time", () => {
    const result = projectEta({
      stops: [
        stop("s1", TORONTO, { status: "ARRIVED", actualArrival: T0, serviceMinutes: 30 }),
        stop("s2", OTTAWA, { legDurationMin: 240, plannedArrival: new Date(T0.getTime() + 250 * MIN) }),
      ],
      origin: null,
      position: TORONTO,
      asOf: T0,
      mode: "ROAD",
    });
    // 30 min service + 240 min drive = 270 min, 20 min past the plan.
    expect(result.stops[1].estimatedArrival).toEqual(new Date(T0.getTime() + 270 * MIN));
    expect(result.delayMinutes).toBe(20);
  });

  it("ignores completed stops", () => {
    const result = projectEta({
      stops: [stop("done", TORONTO, { status: "COMPLETED" })],
      origin: null,
      position: TORONTO,
      asOf: T0,
      mode: "ROAD",
    });
    expect(result.stops).toEqual([]);
    expect(result.finalEta).toBeNull();
  });
});

describe("day bounds", () => {
  it("returns the local calendar day in the organization's time zone", () => {
    // 02:30 UTC on 6 Jan is still the evening of 5 Jan in Toronto (UTC-5).
    const { start, end } = dayBounds(new Date("2026-01-06T02:30:00Z"), "America/Toronto");
    expect(start.toISOString()).toBe("2026-01-05T05:00:00.000Z");
    expect(end.toISOString()).toBe("2026-01-06T05:00:00.000Z");
  });

  it("falls back to UTC for an unknown zone", () => {
    const { start } = dayBounds(new Date("2026-01-06T02:30:00Z"), "Not/AZone");
    expect(start.toISOString()).toBe("2026-01-06T00:00:00.000Z");
  });
});
