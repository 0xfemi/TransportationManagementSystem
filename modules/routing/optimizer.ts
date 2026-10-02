/**
 * Pickup-and-delivery route optimizer.
 *
 * Solves a capacitated vehicle routing problem with time windows and
 * pickup-before-delivery precedence using cheapest insertion followed by a
 * relocate local search. It is a heuristic: results are good and repeatable,
 * not provably optimal. Everything here is a pure function of its input, so
 * the same problem always yields the same plan.
 */

export type Objective = "distance" | "time" | "cost";

export type TimeWindow = { start?: number; end?: number };

export type OptJob = {
  id: string;
  pickupNode: number;
  deliveryNode: number;
  weightKg: number;
  volumeM3: number;
  pickupWindow?: TimeWindow;
  deliveryWindow?: TimeWindow;
  pickupServiceMin: number;
  deliveryServiceMin: number;
  /** Higher is placed first when capacity is short. */
  priority: number;
};

export type OptVehicle = {
  id: string;
  /** Matrix node the vehicle starts from; null starts at its first stop. */
  startNode: number | null;
  capacityKg: number;
  capacityM3: number;
  costPerKm: number;
  fixedCost: number;
};

export type OptProblem = {
  jobs: OptJob[];
  vehicles: OptVehicle[];
  distanceKm: number[][];
  durationMin: number[][];
  /** Epoch milliseconds at which vehicles leave. */
  departAt: number;
  objective: Objective;
  /** Keep every job on a route even if a window is missed. */
  allowLate?: boolean;
};

export type OptStop = {
  jobId: string;
  kind: "pickup" | "delivery";
  node: number;
  arrival: number;
  departure: number;
  waitMin: number;
  lateMin: number;
  loadKg: number;
  loadM3: number;
};

export type OptRoute = {
  vehicleId: string;
  stops: OptStop[];
  distanceKm: number;
  durationMin: number;
  cost: number;
  lateMin: number;
};

export type OptResult = {
  objective: Objective;
  routes: OptRoute[];
  unassigned: { jobId: string; reason: string }[];
  totals: { distanceKm: number; durationMin: number; cost: number; lateMin: number };
};

type Visit = { job: number; kind: "pickup" | "delivery" };
type Evaluation =
  | { feasible: true; route: Omit<OptRoute, "vehicleId">; score: number }
  | { feasible: false; reason: "capacity" | "window" };

const MIN_MS = 60_000;
const LATE_PENALTY = 1_000;
const EPSILON = 1e-9;

function evaluate(problem: OptProblem, vehicle: OptVehicle, visits: Visit[]): Evaluation {
  let time = problem.departAt;
  let node = vehicle.startNode;
  let distanceKm = 0;
  let loadKg = 0;
  let loadM3 = 0;
  let lateMin = 0;
  const stops: OptStop[] = [];

  for (const visit of visits) {
    const job = problem.jobs[visit.job];
    const isPickup = visit.kind === "pickup";
    const target = isPickup ? job.pickupNode : job.deliveryNode;
    if (node !== null) {
      distanceKm += problem.distanceKm[node][target];
      time += problem.durationMin[node][target] * MIN_MS;
    }
    node = target;

    const window = isPickup ? job.pickupWindow : job.deliveryWindow;
    const arrival = time;
    let waitMin = 0;
    let stopLate = 0;
    if (window?.start !== undefined && arrival < window.start) {
      waitMin = (window.start - arrival) / MIN_MS;
      time = window.start;
    }
    if (window?.end !== undefined && arrival > window.end) {
      if (!problem.allowLate) return { feasible: false, reason: "window" };
      stopLate = (arrival - window.end) / MIN_MS;
      lateMin += stopLate;
    }

    loadKg += isPickup ? job.weightKg : -job.weightKg;
    loadM3 += isPickup ? job.volumeM3 : -job.volumeM3;
    if (loadKg > vehicle.capacityKg + EPSILON || loadM3 > vehicle.capacityM3 + EPSILON) {
      return { feasible: false, reason: "capacity" };
    }

    time += (isPickup ? job.pickupServiceMin : job.deliveryServiceMin) * MIN_MS;
    stops.push({
      jobId: job.id,
      kind: visit.kind,
      node: target,
      arrival,
      departure: time,
      waitMin,
      lateMin: stopLate,
      loadKg,
      loadM3,
    });
  }

  const durationMin = (time - problem.departAt) / MIN_MS;
  const cost = visits.length ? vehicle.fixedCost + distanceKm * vehicle.costPerKm : 0;
  const base =
    problem.objective === "distance" ? distanceKm : problem.objective === "time" ? durationMin : cost;
  return {
    feasible: true,
    route: { stops, distanceKm, durationMin, cost, lateMin },
    score: base + lateMin * LATE_PENALTY,
  };
}

type Insertion = { vehicle: number; visits: Visit[]; delta: number };

function bestInsertion(
  problem: OptProblem,
  routes: Visit[][],
  scores: number[],
  job: number,
): { best: Insertion | null; reason: string } {
  let best: Insertion | null = null;
  let sawCapacity = false;
  let sawWindow = false;

  for (let v = 0; v < problem.vehicles.length; v++) {
    const current = routes[v];
    for (let i = 0; i <= current.length; i++) {
      for (let j = i; j <= current.length; j++) {
        const visits = [
          ...current.slice(0, i),
          { job, kind: "pickup" as const },
          ...current.slice(i, j),
          { job, kind: "delivery" as const },
          ...current.slice(j),
        ];
        const result = evaluate(problem, problem.vehicles[v], visits);
        if (!result.feasible) {
          if (result.reason === "capacity") sawCapacity = true;
          else sawWindow = true;
          continue;
        }
        const delta = result.score - scores[v];
        if (!best || delta < best.delta - EPSILON) best = { vehicle: v, visits, delta };
      }
    }
  }

  let reason = "No vehicles available";
  if (problem.vehicles.length) {
    const j = problem.jobs[job];
    const fitsAny = problem.vehicles.some(
      (v) => j.weightKg <= v.capacityKg && j.volumeM3 <= v.capacityM3,
    );
    if (!fitsAny) reason = "Exceeds the capacity of every selected vehicle";
    else if (sawWindow && !sawCapacity) reason = "Cannot be delivered within its time window";
    else if (sawCapacity && !sawWindow) reason = "Not enough remaining vehicle capacity";
    else reason = "No position satisfies both capacity and time windows";
  }
  return { best, reason };
}

export function optimize(problem: OptProblem): OptResult {
  const routes: Visit[][] = problem.vehicles.map(() => []);
  const scores: number[] = problem.vehicles.map(() => 0);
  const unassigned: { jobId: string; reason: string }[] = [];

  const order = problem.jobs
    .map((_, index) => index)
    .sort((a, b) => {
      const ja = problem.jobs[a];
      const jb = problem.jobs[b];
      if (ja.priority !== jb.priority) return jb.priority - ja.priority;
      const ea = ja.deliveryWindow?.end ?? Infinity;
      const eb = jb.deliveryWindow?.end ?? Infinity;
      if (ea !== eb) return ea - eb;
      return ja.id < jb.id ? -1 : ja.id > jb.id ? 1 : 0;
    });

  const place = (insertion: Insertion) => {
    routes[insertion.vehicle] = insertion.visits;
    scores[insertion.vehicle] += insertion.delta;
  };

  const assigned: number[] = [];
  for (const job of order) {
    const { best, reason } = bestInsertion(problem, routes, scores, job);
    if (best) {
      place(best);
      assigned.push(job);
    } else {
      unassigned.push({ jobId: problem.jobs[job].id, reason });
    }
  }

  // Relocate: lift each job out and put it back wherever it is cheapest.
  for (let pass = 0; pass < 25; pass++) {
    let improved = false;
    for (const job of assigned) {
      const from = routes.findIndex((visits) => visits.some((x) => x.job === job));
      const without = routes[from].filter((x) => x.job !== job);
      const reduced = evaluate(problem, problem.vehicles[from], without);
      if (!reduced.feasible) continue;

      const previousVisits = routes[from];
      const previousScore = scores[from];
      routes[from] = without;
      scores[from] = reduced.score;

      const { best } = bestInsertion(problem, routes, scores, job);
      const before = previousScore;
      const after = best ? scores[from] + best.delta : Infinity;
      if (best && after < before - 1e-6) {
        place(best);
        improved = true;
      } else {
        routes[from] = previousVisits;
        scores[from] = previousScore;
      }
    }
    if (!improved) break;
  }

  const result: OptRoute[] = [];
  const totals = { distanceKm: 0, durationMin: 0, cost: 0, lateMin: 0 };
  problem.vehicles.forEach((vehicle, v) => {
    if (!routes[v].length) return;
    const evaluation = evaluate(problem, vehicle, routes[v]);
    if (!evaluation.feasible) throw new Error("Optimizer produced an infeasible route");
    result.push({ vehicleId: vehicle.id, ...evaluation.route });
    totals.distanceKm += evaluation.route.distanceKm;
    totals.durationMin += evaluation.route.durationMin;
    totals.cost += evaluation.route.cost;
    totals.lateMin += evaluation.route.lateMin;
  });

  return { objective: problem.objective, routes: result, unassigned, totals };
}
