import type { TransportMode } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { conflict, notFound, unprocessable } from "@/lib/errors";
import { optimize, type Objective, type OptResult } from "@/modules/routing/optimizer";
import {
  applyRouteInTx,
  createShipmentInTx,
  routeGeometry,
  type ServiceCtx,
} from "@/modules/shipments/service";
import {
  buildProblem,
  planOrderInclude,
  planVehicleInclude,
  type PlanOrder,
} from "./problem";

export const OBJECTIVES: Objective[] = ["cost", "distance", "time"];

export const OBJECTIVE_LABELS: Record<Objective, string> = {
  cost: "Lowest cost",
  distance: "Shortest distance",
  time: "Fastest completion",
};

type PlanInput = {
  orderIds: string[];
  vehicleIds: string[];
  departAt: Date;
  mode: TransportMode;
};

async function loadInputs(organizationId: string, input: PlanInput) {
  const [orders, vehicles] = await Promise.all([
    prisma.order.findMany({
      where: { id: { in: input.orderIds }, organizationId },
      include: planOrderInclude,
      orderBy: { number: "asc" },
    }),
    prisma.vehicle.findMany({
      where: { id: { in: input.vehicleIds }, organizationId, deletedAt: null },
      include: planVehicleInclude,
      orderBy: { name: "asc" },
    }),
  ]);
  if (orders.length !== new Set(input.orderIds).size) throw notFound("One or more orders");
  if (vehicles.length !== new Set(input.vehicleIds).size) throw notFound("One or more vehicles");
  const notOpen = orders.filter((o) => o.status !== "OPEN" || o.shipmentId);
  if (notOpen.length) {
    throw conflict(`Only open orders can be planned: ${notOpen.map((o) => o.number).join(", ")}`);
  }
  const busy = vehicles.filter((v) => v.status !== "AVAILABLE");
  if (busy.length) {
    throw conflict(`Not available for planning: ${busy.map((v) => v.name).join(", ")}`);
  }
  return { orders, vehicles };
}

async function solve(
  orders: Awaited<ReturnType<typeof loadInputs>>["orders"],
  vehicles: Awaited<ReturnType<typeof loadInputs>>["vehicles"],
  input: PlanInput,
  objective: Objective,
) {
  const built = await buildProblem({
    orders: orders as PlanOrder[],
    vehicles,
    departAt: input.departAt,
    objective,
    mode: input.mode,
    // Planning new work: an order that cannot make its window is left
    // unassigned and reported, rather than planned to arrive late.
    allowLate: false,
  });
  return { ...built, result: optimize(built.problem) };
}

const signature = (result: OptResult) =>
  JSON.stringify(result.routes.map((r) => [r.vehicleId, r.stops.map((s) => `${s.jobId}:${s.kind}`)]));

/**
 * Computes up to three alternative plans (one per objective) without saving
 * anything. Objectives that lead to the same routes are merged.
 */
export async function proposePlans(ctx: ServiceCtx, input: PlanInput) {
  const { orders, vehicles } = await loadInputs(ctx.organizationId, input);
  const orderById = new Map(orders.map((o) => [o.id, o]));
  const vehicleById = new Map(vehicles.map((v) => [v.id, v]));
  const seen = new Map<string, { objectives: Objective[] }>();
  const alternatives = [];

  for (const objective of OBJECTIVES) {
    const { problem, nodes, provider, result } = await solve(orders, vehicles, input, objective);
    const key = signature(result);
    const existing = seen.get(key);
    if (existing) {
      existing.objectives.push(objective);
      continue;
    }
    const alternative = {
      objective,
      objectives: [objective],
      routingProvider: provider,
      totals: result.totals,
      unassigned: result.unassigned.map((u) => ({
        orderId: u.jobId,
        orderNumber: orderById.get(u.jobId)!.number,
        reason: u.reason,
      })),
      routes: await Promise.all(
        result.routes.map(async (route) => {
          const vehicle = vehicleById.get(route.vehicleId)!;
          return {
            vehicle: {
              id: vehicle.id,
              name: vehicle.name,
              capacityKg: vehicle.capacityKg,
              capacityM3: vehicle.capacityM3,
            },
            distanceKm: route.distanceKm,
            durationMin: route.durationMin,
            cost: route.cost,
            peakLoadKg: Math.max(...route.stops.map((s) => s.loadKg)),
            geometry: await routeGeometry(route, problem, nodes, input.mode),
            stops: route.stops.map((stop) => {
              const order = orderById.get(stop.jobId)!;
              const location = nodes[stop.node];
              return {
                orderId: order.id,
                orderNumber: order.number,
                kind: stop.kind,
                location: {
                  id: location.id,
                  name: location.name,
                  latitude: location.latitude,
                  longitude: location.longitude,
                },
                arrival: new Date(stop.arrival),
                departure: new Date(stop.departure),
                waitMinutes: Math.round(stop.waitMin),
              };
            }),
          };
        }),
      ),
    };
    seen.set(key, alternative);
    alternatives.push(alternative);
  }
  return { departAt: input.departAt, alternatives };
}

/**
 * Re-runs the optimizer for the chosen objective and saves one planned
 * shipment per route. The optimizer is deterministic, so the saved plan is
 * the one that was proposed as long as the orders and vehicles are unchanged.
 */
export async function commitPlan(ctx: ServiceCtx, input: PlanInput & { objective: Objective }) {
  const { orders, vehicles } = await loadInputs(ctx.organizationId, input);
  const { problem, nodes, provider, result } = await solve(orders, vehicles, input, input.objective);
  if (!result.routes.length) {
    throw unprocessable("None of the selected orders can be planned on the selected vehicles", {
      unassigned: result.unassigned,
    });
  }
  const geometries = await Promise.all(
    result.routes.map((route) => routeGeometry(route, problem, nodes, input.mode)),
  );

  const shipments = await prisma.$transaction(
    async (tx) => {
      const created = [];
      for (const [i, route] of result.routes.entries()) {
        const orderIds = [...new Set(route.stops.map((s) => s.jobId))];
        const shipment = await createShipmentInTx(tx, ctx, orderIds, input.mode);
        const vehicle = vehicles.find((v) => v.id === route.vehicleId)!;
        await applyRouteInTx(tx, ctx, shipment.id, {
          route,
          problem,
          nodes,
          vehicle,
          driverId: null,
          geometry: geometries[i],
          provider,
          objective: input.objective,
          departAt: input.departAt,
        });
        created.push({ id: shipment.id, number: shipment.number, vehicle: vehicle.name });
      }
      return created;
    },
    { timeout: 30_000, maxWait: 10_000 },
  );

  return {
    shipments,
    unassigned: result.unassigned.map((u) => ({
      orderId: u.jobId,
      orderNumber: orders.find((o) => o.id === u.jobId)!.number,
      reason: u.reason,
    })),
  };
}
