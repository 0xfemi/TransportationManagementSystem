import { describe, expect, it } from "vitest";
import { optimize, type OptJob, type OptProblem, type OptVehicle } from "@/modules/routing/optimizer";

const MIN = 60_000;
const T0 = Date.UTC(2026, 0, 5, 8, 0, 0);

/** Nodes on a line: 1 km apart per unit, travelled at 1 km per minute. */
function lineMatrix(positions: number[]) {
  const distanceKm = positions.map((a) => positions.map((b) => Math.abs(a - b)));
  return { distanceKm, durationMin: distanceKm.map((row) => [...row]) };
}

const job = (id: string, pickupNode: number, deliveryNode: number, extra: Partial<OptJob> = {}): OptJob => ({
  id,
  pickupNode,
  deliveryNode,
  weightKg: 100,
  volumeM3: 1,
  pickupServiceMin: 0,
  deliveryServiceMin: 0,
  priority: 1,
  ...extra,
});

const vehicle = (id: string, extra: Partial<OptVehicle> = {}): OptVehicle => ({
  id,
  startNode: 0,
  capacityKg: 1000,
  capacityM3: 10,
  costPerKm: 1,
  fixedCost: 0,
  ...extra,
});

function problem(overrides: Partial<OptProblem> & Pick<OptProblem, "jobs" | "vehicles">, positions: number[]): OptProblem {
  return { ...lineMatrix(positions), departAt: T0, objective: "distance", ...overrides };
}

describe("route optimizer", () => {
  it("visits every pickup before its delivery", () => {
    const result = optimize(
      problem(
        { jobs: [job("a", 0, 3), job("b", 1, 2), job("c", 2, 4)], vehicles: [vehicle("v1")] },
        [0, 10, 20, 30, 40],
      ),
    );
    expect(result.unassigned).toEqual([]);
    const stops = result.routes[0].stops;
    for (const id of ["a", "b", "c"]) {
      const pickup = stops.findIndex((s) => s.jobId === id && s.kind === "pickup");
      const delivery = stops.findIndex((s) => s.jobId === id && s.kind === "delivery");
      expect(pickup).toBeGreaterThanOrEqual(0);
      expect(delivery).toBeGreaterThan(pickup);
    }
  });

  it("finds the shortest sweep along a line instead of zig-zagging", () => {
    // Deliveries at 30, 10 and 20 km from a depot at 0, entered out of order.
    const result = optimize(
      problem(
        { jobs: [job("far", 0, 3), job("near", 0, 1), job("mid", 0, 2)], vehicles: [vehicle("v1")] },
        [0, 10, 20, 30],
      ),
    );
    expect(result.routes[0].distanceKm).toBe(30);
    expect(result.routes[0].stops.filter((s) => s.kind === "delivery").map((s) => s.jobId)).toEqual([
      "near",
      "mid",
      "far",
    ]);
  });

  it("never loads a vehicle beyond its weight or volume capacity", () => {
    const jobs = [
      job("a", 0, 1, { weightKg: 600 }),
      job("b", 0, 2, { weightKg: 600 }),
      job("c", 0, 3, { weightKg: 600 }),
    ];
    const result = optimize(problem({ jobs, vehicles: [vehicle("v1"), vehicle("v2")] }, [0, 10, 20, 30]));
    for (const route of result.routes) {
      for (const stop of route.stops) expect(stop.loadKg).toBeLessThanOrEqual(1000);
    }
    expect(result.unassigned).toEqual([]);
    expect(result.routes.flatMap((r) => r.stops).filter((s) => s.kind === "delivery")).toHaveLength(3);
  });

  it("reuses capacity once a delivery has been dropped off", () => {
    // Two 600 kg jobs fit one 1,000 kg vehicle only if run back to back.
    const jobs = [job("a", 0, 1, { weightKg: 600 }), job("b", 1, 2, { weightKg: 600 })];
    const result = optimize(problem({ jobs, vehicles: [vehicle("v1")] }, [0, 10, 20]));
    expect(result.unassigned).toEqual([]);
    expect(result.routes).toHaveLength(1);
    expect(Math.max(...result.routes[0].stops.map((s) => s.loadKg))).toBe(600);
  });

  it("reports an order no vehicle can carry, with the reason", () => {
    const result = optimize(
      problem({ jobs: [job("heavy", 0, 1, { weightKg: 5000 })], vehicles: [vehicle("v1")] }, [0, 10]),
    );
    expect(result.routes).toEqual([]);
    expect(result.unassigned).toEqual([
      { jobId: "heavy", reason: "Exceeds the capacity of every selected vehicle" },
    ]);
  });

  it("respects delivery windows and serves the tight one first", () => {
    const jobs = [
      job("relaxed", 0, 1),
      // 30 km away and due within 35 minutes: must go first.
      job("urgent", 0, 3, { deliveryWindow: { end: T0 + 35 * MIN } }),
    ];
    const result = optimize(problem({ jobs, vehicles: [vehicle("v1")] }, [0, 10, 20, 30]));
    expect(result.unassigned).toEqual([]);
    const urgent = result.routes[0].stops.find((s) => s.jobId === "urgent" && s.kind === "delivery")!;
    expect(urgent.arrival).toBeLessThanOrEqual(T0 + 35 * MIN);
  });

  it("leaves an order unassigned rather than plan it late", () => {
    const jobs = [job("impossible", 0, 3, { deliveryWindow: { end: T0 + 10 * MIN } })];
    const result = optimize(problem({ jobs, vehicles: [vehicle("v1")] }, [0, 10, 20, 30]));
    expect(result.unassigned).toEqual([
      { jobId: "impossible", reason: "Cannot be delivered within its time window" },
    ]);
  });

  it("keeps the order on the route and reports lateness when allowLate is set", () => {
    const jobs = [job("late", 0, 3, { deliveryWindow: { end: T0 + 10 * MIN } })];
    const result = optimize(
      problem({ jobs, vehicles: [vehicle("v1")], allowLate: true }, [0, 10, 20, 30]),
    );
    expect(result.unassigned).toEqual([]);
    expect(result.routes[0].lateMin).toBe(20);
  });

  it("waits for a window to open instead of arriving early", () => {
    const jobs = [job("timed", 0, 1, { deliveryWindow: { start: T0 + 60 * MIN, end: T0 + 120 * MIN } })];
    const result = optimize(problem({ jobs, vehicles: [vehicle("v1")] }, [0, 10]));
    const delivery = result.routes[0].stops.find((s) => s.kind === "delivery")!;
    expect(delivery.arrival).toBe(T0 + 10 * MIN);
    expect(delivery.waitMin).toBe(50);
    expect(delivery.departure).toBe(T0 + 60 * MIN);
  });

  it("picks the cheaper vehicle when optimizing for cost", () => {
    const jobs = [job("a", 0, 1)];
    const vehicles = [vehicle("expensive", { costPerKm: 5 }), vehicle("cheap", { costPerKm: 1 })];
    const result = optimize(problem({ jobs, vehicles, objective: "cost" }, [0, 10]));
    expect(result.routes).toHaveLength(1);
    expect(result.routes[0].vehicleId).toBe("cheap");
    expect(result.routes[0].cost).toBe(10);
  });

  it("places higher-priority orders first when capacity is short", () => {
    // Both are due in 10 minutes and too heavy to ride together, so the
    // one vehicle can only make one of them on time.
    const due = { deliveryWindow: { end: T0 + 10 * MIN } };
    const jobs = [
      job("normal", 0, 1, { weightKg: 800, priority: 1, ...due }),
      job("urgent", 0, 1, { weightKg: 800, priority: 3, ...due }),
    ];
    const result = optimize(problem({ jobs, vehicles: [vehicle("v1")] }, [0, 10]));
    expect(result.routes[0].stops.map((s) => s.jobId)).toEqual(["urgent", "urgent"]);
    expect(result.unassigned.map((u) => u.jobId)).toEqual(["normal"]);
  });

  it("is deterministic", () => {
    const build = () =>
      problem(
        {
          jobs: [job("a", 0, 4), job("b", 1, 3), job("c", 2, 5), job("d", 0, 2), job("e", 3, 1)],
          vehicles: [vehicle("v1"), vehicle("v2", { startNode: 5 })],
        },
        [0, 7, 19, 23, 31, 44],
      );
    expect(optimize(build())).toEqual(optimize(build()));
  });

  it("beats visiting orders in the sequence they were entered", () => {
    const positions = [0, 40, 5, 35, 10, 30, 15];
    const jobs = [1, 2, 3, 4, 5, 6].map((node) => job(`j${node}`, 0, node));
    const result = optimize(problem({ jobs, vehicles: [vehicle("v1")] }, positions));
    const naive = [0, 1, 2, 3, 4, 5, 6].reduce(
      (sum, node, i, all) => (i === 0 ? 0 : sum + Math.abs(positions[node] - positions[all[i - 1]])),
      0,
    );
    expect(result.routes[0].distanceKm).toBe(40);
    expect(result.routes[0].distanceKm).toBeLessThan(naive);
  });
});
