import type { OrderPriority, TransportMode } from "@prisma/client";
import { getRoutingProvider } from "@/modules/routing/provider";
import type { Objective, OptProblem } from "@/modules/routing/optimizer";

export const DEFAULT_SERVICE_MIN = 15;

const PRIORITY_RANK: Record<OrderPriority, number> = { LOW: 0, NORMAL: 1, HIGH: 2, URGENT: 3 };

export type PlanLocation = { id: string; name: string; latitude: number; longitude: number };

export type PlanOrder = {
  id: string;
  number: string;
  priority: OrderPriority;
  totalWeightKg: number;
  totalVolumeM3: number;
  pickupWindowStart: Date | null;
  pickupWindowEnd: Date | null;
  deliveryWindowStart: Date | null;
  deliveryWindowEnd: Date | null;
  pickupLocation: PlanLocation;
  deliveryLocation: PlanLocation;
};

export type PlanVehicle = {
  id: string;
  capacityKg: number;
  capacityM3: number;
  costPerKm: number;
  fixedCost: number;
  homeLocation: PlanLocation | null;
};

const window = (start: Date | null, end: Date | null) =>
  start || end ? { start: start?.getTime(), end: end?.getTime() } : undefined;

/** Turns orders and vehicles into a matrix-indexed optimization problem. */
export async function buildProblem(input: {
  orders: PlanOrder[];
  vehicles: PlanVehicle[];
  departAt: Date;
  objective: Objective;
  mode: TransportMode;
  allowLate: boolean;
}): Promise<{ problem: OptProblem; nodes: PlanLocation[]; provider: string }> {
  const nodes: PlanLocation[] = [];
  const index = new Map<string, number>();
  const nodeOf = (location: PlanLocation) => {
    let i = index.get(location.id);
    if (i === undefined) {
      i = nodes.length;
      nodes.push(location);
      index.set(location.id, i);
    }
    return i;
  };

  const jobs = input.orders.map((order) => ({
    id: order.id,
    pickupNode: nodeOf(order.pickupLocation),
    deliveryNode: nodeOf(order.deliveryLocation),
    weightKg: order.totalWeightKg,
    volumeM3: order.totalVolumeM3,
    pickupWindow: window(order.pickupWindowStart, order.pickupWindowEnd),
    deliveryWindow: window(order.deliveryWindowStart, order.deliveryWindowEnd),
    pickupServiceMin: DEFAULT_SERVICE_MIN,
    deliveryServiceMin: DEFAULT_SERVICE_MIN,
    priority: PRIORITY_RANK[order.priority],
  }));

  const vehicles = input.vehicles.map((vehicle) => ({
    id: vehicle.id,
    startNode: vehicle.homeLocation ? nodeOf(vehicle.homeLocation) : null,
    capacityKg: vehicle.capacityKg,
    capacityM3: vehicle.capacityM3,
    costPerKm: vehicle.costPerKm,
    fixedCost: vehicle.fixedCost,
  }));

  const provider = getRoutingProvider();
  const matrix = await provider.matrix(nodes, input.mode);

  return {
    problem: {
      jobs,
      vehicles,
      distanceKm: matrix.distanceKm,
      durationMin: matrix.durationMin,
      departAt: input.departAt.getTime(),
      objective: input.objective,
      allowLate: input.allowLate,
    },
    nodes,
    provider: provider.name,
  };
}

export const planOrderInclude = {
  pickupLocation: { select: { id: true, name: true, latitude: true, longitude: true } },
  deliveryLocation: { select: { id: true, name: true, latitude: true, longitude: true } },
} as const;

export const planVehicleInclude = {
  homeLocation: { select: { id: true, name: true, latitude: true, longitude: true } },
} as const;
