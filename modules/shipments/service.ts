import { Prisma, type TransportMode } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { Actor } from "@/lib/auth/context";
import { conflict, notFound, unprocessable } from "@/lib/errors";
import { audit, emitEvent, nextNumber, type Db } from "@/lib/events";
import { optimize, type Objective, type OptProblem, type OptRoute } from "@/modules/routing/optimizer";
import { getRoutingProvider } from "@/modules/routing/provider";
import {
  buildProblem,
  planOrderInclude,
  planVehicleInclude,
  type PlanLocation,
  type PlanOrder,
} from "@/modules/planning/problem";
import { rateOwnVehicle, rateWithCarrier, type RateResult } from "@/modules/rating/rate";
import { raiseException, resolveByDedupeKey } from "@/modules/exceptions/service";

export type ServiceCtx = { organizationId: string; actor: Actor; at?: Date };

export const clock = (ctx: ServiceCtx) => ctx.at ?? new Date();

const TX = { timeout: 20_000, maxWait: 10_000 };

export const shipmentDetailInclude = {
  carrier: { select: { id: true, name: true } },
  vehicle: { select: { id: true, name: true, vehicleType: true, capacityKg: true, capacityM3: true } },
  driver: { select: { id: true, name: true, phone: true } },
  orders: {
    select: {
      id: true,
      number: true,
      status: true,
      priority: true,
      totalWeightKg: true,
      totalVolumeM3: true,
      customer: { select: { id: true, name: true } },
    },
    orderBy: { number: "asc" },
  },
  stops: {
    orderBy: { sequence: "asc" },
    include: {
      location: {
        select: { id: true, name: true, city: true, addressLine: true, latitude: true, longitude: true },
      },
      order: { select: { id: true, number: true } },
    },
  },
  tenders: {
    orderBy: { sentAt: "desc" },
    include: { carrier: { select: { id: true, name: true } } },
  },
} satisfies Prisma.ShipmentInclude;

export async function addTrackingEvent(
  db: Db,
  ctx: ServiceCtx,
  event: {
    shipmentId: string;
    type: Prisma.TrackingEventCreateManyInput["type"];
    occurredAt: Date;
    message?: string;
    latitude?: number | null;
    longitude?: number | null;
    speedKph?: number | null;
    heading?: number | null;
    stopId?: string | null;
    source?: string;
    externalId?: string | null;
  },
) {
  return db.trackingEvent.create({
    data: {
      organizationId: ctx.organizationId,
      shipmentId: event.shipmentId,
      type: event.type,
      occurredAt: event.occurredAt,
      recordedAt: clock(ctx),
      message: event.message,
      latitude: event.latitude ?? null,
      longitude: event.longitude ?? null,
      speedKph: event.speedKph ?? null,
      heading: event.heading ?? null,
      stopId: event.stopId ?? null,
      source: event.source ?? ctx.actor.type,
      actorId: ctx.actor.id,
      externalId: event.externalId ?? null,
    },
  });
}

async function loadShipment(db: Db, organizationId: string, id: string) {
  const shipment = await db.shipment.findFirst({
    where: { id, organizationId },
    include: {
      stops: { orderBy: { sequence: "asc" } },
      orders: { include: planOrderInclude },
      vehicle: { include: planVehicleInclude },
      carrier: true,
    },
  });
  if (!shipment) throw notFound("Shipment");
  return shipment;
}

// ───────────────────────────── Create ─────────────────────────────

export async function createShipmentInTx(
  tx: Prisma.TransactionClient,
  ctx: ServiceCtx,
  orderIds: string[],
  mode: TransportMode,
) {
  const at = clock(ctx);
  const orders = await tx.order.findMany({
    where: { id: { in: orderIds }, organizationId: ctx.organizationId },
    orderBy: { number: "asc" },
  });
  if (orders.length !== new Set(orderIds).size) throw notFound("One or more orders");
  const unavailable = orders.filter((o) => o.status !== "OPEN" || o.shipmentId);
  if (unavailable.length) {
    throw conflict(
      `Only open orders can be added to a shipment: ${unavailable.map((o) => o.number).join(", ")}`,
    );
  }

  const number = await nextNumber(tx, ctx.organizationId, "shipment", "SHP");
  const shipment = await tx.shipment.create({
    data: {
      organizationId: ctx.organizationId,
      number,
      mode,
      status: "DRAFT",
      totalWeightKg: orders.reduce((sum, o) => sum + o.totalWeightKg, 0),
      totalVolumeM3: orders.reduce((sum, o) => sum + o.totalVolumeM3, 0),
      createdAt: at,
      stops: {
        create: [
          ...orders.map((order, i) => ({
            organizationId: ctx.organizationId,
            sequence: i,
            type: "PICKUP" as const,
            locationId: order.pickupLocationId,
            orderId: order.id,
            windowStart: order.pickupWindowStart,
            windowEnd: order.pickupWindowEnd,
          })),
          ...orders.map((order, i) => ({
            organizationId: ctx.organizationId,
            sequence: orders.length + i,
            type: "DELIVERY" as const,
            locationId: order.deliveryLocationId,
            orderId: order.id,
            windowStart: order.deliveryWindowStart,
            windowEnd: order.deliveryWindowEnd,
          })),
        ],
      },
    },
  });
  await tx.order.updateMany({
    where: { id: { in: orderIds }, organizationId: ctx.organizationId },
    data: { shipmentId: shipment.id, status: "PLANNED" },
  });
  await addTrackingEvent(tx, ctx, {
    shipmentId: shipment.id,
    type: "CREATED",
    occurredAt: at,
    message: `Shipment created from ${orders.map((o) => o.number).join(", ")}`,
  });
  await emitEvent(tx, {
    organizationId: ctx.organizationId,
    type: "ShipmentCreated",
    entityType: "shipment",
    entityId: shipment.id,
    payload: { number, orderIds },
    actor: ctx.actor,
    occurredAt: at,
  });
  await audit(tx, {
    organizationId: ctx.organizationId,
    actor: ctx.actor,
    action: "shipment.created",
    entityType: "shipment",
    entityId: shipment.id,
    summary: `Created shipment ${number} from ${orders.length} order(s)`,
    at,
  });
  return shipment;
}

export function createShipment(
  ctx: ServiceCtx,
  input: { orderIds: string[]; mode: TransportMode },
) {
  return prisma.$transaction((tx) => createShipmentInTx(tx, ctx, input.orderIds, input.mode), TX);
}

// ───────────────────────────── Plan ─────────────────────────────

type RouteApplication = {
  route: OptRoute;
  problem: OptProblem;
  nodes: PlanLocation[];
  vehicle: {
    id: string;
    name: string;
    costPerKm: number;
    fixedCost: number;
    carrierId: string | null;
    homeLocation: PlanLocation | null;
  } | null;
  driverId: string | null;
  geometry: [number, number][];
  provider: string;
  objective: Objective;
  departAt: Date;
};

/** Writes an optimized route onto a shipment's stops and marks it PLANNED. */
export async function applyRouteInTx(
  tx: Prisma.TransactionClient,
  ctx: ServiceCtx,
  shipmentId: string,
  plan: RouteApplication,
) {
  const at = clock(ctx);
  const shipment = await tx.shipment.findFirstOrThrow({
    where: { id: shipmentId, organizationId: ctx.organizationId },
    include: { stops: true, vehicle: { select: { name: true } } },
  });

  let previousNode = plan.problem.vehicles.find((v) => v.id === plan.route.vehicleId)?.startNode ?? null;
  for (const [sequence, optStop] of plan.route.stops.entries()) {
    const stop = shipment.stops.find(
      (s) => s.orderId === optStop.jobId && s.type === (optStop.kind === "pickup" ? "PICKUP" : "DELIVERY"),
    );
    if (!stop) throw new Error("Planned stop does not belong to this shipment");
    await tx.stop.update({
      where: { id: stop.id },
      data: {
        sequence,
        plannedArrival: new Date(optStop.arrival),
        plannedDeparture: new Date(optStop.departure),
        estimatedArrival: new Date(optStop.arrival),
        legDistanceKm: previousNode === null ? 0 : plan.problem.distanceKm[previousNode][optStop.node],
        legDurationMin: previousNode === null ? 0 : plan.problem.durationMin[previousNode][optStop.node],
      },
    });
    previousNode = optStop.node;
  }

  const last = plan.route.stops[plan.route.stops.length - 1];
  let driverId = plan.driverId;
  if (!driverId && plan.vehicle) {
    const assigned = await tx.driver.findFirst({
      where: { organizationId: ctx.organizationId, vehicleId: plan.vehicle.id, deletedAt: null },
      orderBy: { name: "asc" },
    });
    driverId = assigned?.id ?? null;
  }

  const ownFleet = plan.vehicle && !plan.vehicle.carrierId;
  const cost: RateResult | null = ownFleet
    ? rateOwnVehicle(plan.vehicle!, { distanceKm: plan.route.distanceKm })
    : null;

  const updated = await tx.shipment.update({
    where: { id: shipmentId },
    data: {
      status: "PLANNED",
      vehicleId: plan.vehicle?.id ?? null,
      driverId,
      plannedStart: plan.departAt,
      plannedEnd: new Date(last.departure),
      currentEta: new Date(last.arrival),
      plannedDistanceKm: plan.route.distanceKm,
      plannedDurationMin: plan.route.durationMin,
      routeGeometry: plan.geometry,
      routingProvider: plan.provider,
      originLatitude: plan.vehicle?.homeLocation?.latitude ?? null,
      originLongitude: plan.vehicle?.homeLocation?.longitude ?? null,
      estimatedCost: cost?.total ?? null,
      costBreakdown: cost ? (cost.lines as unknown as Prisma.InputJsonValue) : Prisma.DbNull,
      delayMinutes: 0,
    },
  });

  await addTrackingEvent(tx, ctx, {
    shipmentId,
    type: "PLANNED",
    occurredAt: at,
    message: `Route planned: ${plan.route.stops.length} stops, ${plan.route.distanceKm.toFixed(0)} km (optimized for ${plan.objective})`,
  });
  await emitEvent(tx, {
    organizationId: ctx.organizationId,
    type: "ShipmentPlanned",
    entityType: "shipment",
    entityId: shipmentId,
    payload: {
      vehicleId: plan.vehicle?.id ?? null,
      distanceKm: plan.route.distanceKm,
      durationMin: plan.route.durationMin,
      objective: plan.objective,
      provider: plan.provider,
    },
    actor: ctx.actor,
    occurredAt: at,
  });
  await audit(tx, {
    organizationId: ctx.organizationId,
    actor: ctx.actor,
    action: "shipment.planned",
    entityType: "shipment",
    entityId: shipmentId,
    summary: `Planned route for ${shipment.number}${plan.vehicle ? ` on ${plan.vehicle.name}` : ""}`,
    before: { vehicle: shipment.vehicle?.name ?? null, distanceKm: shipment.plannedDistanceKm },
    after: { vehicle: plan.vehicle?.name ?? null, distanceKm: plan.route.distanceKm },
    at,
  });
  return updated;
}

export async function routeGeometry(
  route: OptRoute,
  problem: OptProblem,
  nodes: PlanLocation[],
  mode: TransportMode,
): Promise<[number, number][]> {
  const start = problem.vehicles.find((v) => v.id === route.vehicleId)?.startNode ?? null;
  const points = [...(start === null ? [] : [nodes[start]]), ...route.stops.map((s) => nodes[s.node])];
  if (points.length < 2) return points.map((p) => [p.latitude, p.longitude]);
  return (await getRoutingProvider().route(points, mode)).geometry;
}

/** A vehicle in the shop or retired cannot be given work. */
function assertInService(vehicle: { name: string; status: string }) {
  if (vehicle.status === "MAINTENANCE") {
    throw conflict(`${vehicle.name} is in maintenance. Finish its work order or choose another vehicle.`);
  }
  if (vehicle.status === "INACTIVE") {
    throw conflict(`${vehicle.name} is inactive. Reactivate it or choose another vehicle.`);
  }
}

export async function planShipment(
  ctx: ServiceCtx,
  shipmentId: string,
  input: { vehicleId?: string | null; driverId?: string | null; departAt: Date; objective: Objective },
) {
  const shipment = await loadShipment(prisma, ctx.organizationId, shipmentId);
  if (shipment.status !== "DRAFT" && shipment.status !== "PLANNED") {
    throw conflict(`A ${shipment.status.toLowerCase()} shipment can no longer be re-planned`);
  }

  const vehicle = input.vehicleId
    ? await prisma.vehicle.findFirst({
        where: { id: input.vehicleId, organizationId: ctx.organizationId, deletedAt: null },
        include: planVehicleInclude,
      })
    : null;
  if (input.vehicleId && !vehicle) throw notFound("Vehicle");
  if (vehicle) assertInService(vehicle);
  if (input.driverId) {
    const driver = await prisma.driver.findFirst({
      where: { id: input.driverId, organizationId: ctx.organizationId, deletedAt: null },
    });
    if (!driver) throw notFound("Driver");
  }

  const { problem, nodes, provider } = await buildProblem({
    orders: shipment.orders as PlanOrder[],
    vehicles: [
      vehicle ?? {
        id: "unassigned",
        capacityKg: Infinity,
        capacityM3: Infinity,
        costPerKm: 0,
        fixedCost: 0,
        homeLocation: null,
      },
    ],
    departAt: input.departAt,
    objective: input.objective,
    mode: shipment.mode,
    // A shipment's orders are already committed to it, so every stop stays
    // on the route; missed windows come back as warnings instead.
    allowLate: true,
  });
  const result = optimize(problem);
  if (result.unassigned.length || result.routes.length !== 1) {
    throw unprocessable("This shipment does not fit on the selected vehicle", {
      unassigned: result.unassigned.map((u) => ({
        order: shipment.orders.find((o) => o.id === u.jobId)?.number,
        reason: u.reason,
      })),
    });
  }
  const route = result.routes[0];
  const geometry = await routeGeometry(route, problem, nodes, shipment.mode);

  await prisma.$transaction(
    (tx) =>
      applyRouteInTx(tx, ctx, shipmentId, {
        route,
        problem,
        nodes,
        vehicle,
        driverId: input.driverId ?? null,
        geometry,
        provider,
        objective: input.objective,
        departAt: input.departAt,
      }),
    TX,
  );

  return {
    lateStops: route.stops
      .filter((s) => s.lateMin > 0)
      .map((s) => ({
        order: shipment.orders.find((o) => o.id === s.jobId)?.number,
        kind: s.kind,
        lateMinutes: Math.round(s.lateMin),
      })),
  };
}

// ───────────────────────────── Tender ─────────────────────────────

export async function tenderShipment(ctx: ServiceCtx, shipmentId: string, carrierId: string) {
  const at = clock(ctx);
  return prisma.$transaction(async (tx) => {
    const shipment = await loadShipment(tx, ctx.organizationId, shipmentId);
    if (shipment.status !== "PLANNED") {
      throw conflict("Plan the route before tendering; only planned shipments can be tendered");
    }
    const carrier = await tx.carrier.findFirst({
      where: { id: carrierId, organizationId: ctx.organizationId, deletedAt: null },
    });
    if (!carrier) throw notFound("Carrier");
    if (carrier.status !== "ACTIVE") throw conflict(`${carrier.name} is not an active carrier`);

    const cost = rateWithCarrier(carrier, {
      distanceKm: shipment.plannedDistanceKm ?? 0,
      weightKg: shipment.totalWeightKg,
    });
    const tender = await tx.tender.create({
      data: {
        organizationId: ctx.organizationId,
        shipmentId,
        carrierId,
        quotedCost: cost.total,
        sentAt: at,
      },
    });
    await tx.shipment.update({
      where: { id: shipmentId },
      data: {
        status: "TENDERED",
        carrierId,
        estimatedCost: cost.total,
        costBreakdown: cost.lines as unknown as Prisma.InputJsonValue,
      },
    });
    await addTrackingEvent(tx, ctx, {
      shipmentId,
      type: "TENDERED",
      occurredAt: at,
      message: `Tendered to ${carrier.name}`,
    });
    await emitEvent(tx, {
      organizationId: ctx.organizationId,
      type: "ShipmentTendered",
      entityType: "shipment",
      entityId: shipmentId,
      payload: { tenderId: tender.id, carrierId, quotedCost: cost.total },
      actor: ctx.actor,
      occurredAt: at,
    });
    await audit(tx, {
      organizationId: ctx.organizationId,
      actor: ctx.actor,
      action: "shipment.tendered",
      entityType: "shipment",
      entityId: shipmentId,
      summary: `Tendered ${shipment.number} to ${carrier.name}`,
      before: { carrier: shipment.carrier?.name ?? null },
      after: { carrier: carrier.name, quotedCost: cost.total },
      at,
    });
    return tender;
  }, TX);
}

export async function respondToTender(
  ctx: ServiceCtx,
  shipmentId: string,
  input: { accepted: boolean; note?: string },
) {
  const at = clock(ctx);
  return prisma.$transaction(async (tx) => {
    const shipment = await loadShipment(tx, ctx.organizationId, shipmentId);
    if (shipment.status !== "TENDERED") throw conflict("This shipment has no tender awaiting a response");
    const tender = await tx.tender.findFirst({
      where: { shipmentId, organizationId: ctx.organizationId, status: "SENT" },
      orderBy: { sentAt: "desc" },
      include: { carrier: true },
    });
    if (!tender) throw conflict("This shipment has no tender awaiting a response");

    await tx.tender.update({
      where: { id: tender.id },
      data: {
        status: input.accepted ? "ACCEPTED" : "REJECTED",
        respondedAt: at,
        responseNote: input.note,
      },
    });
    await resolveByDedupeKey(tx, ctx, `tender-unack:${tender.id}`, "Carrier responded to the tender");

    if (input.accepted) {
      await tx.shipment.update({ where: { id: shipmentId }, data: { status: "ACCEPTED" } });
    } else {
      const ownCost =
        shipment.vehicle && !shipment.vehicle.carrierId
          ? rateOwnVehicle(shipment.vehicle, { distanceKm: shipment.plannedDistanceKm ?? 0 })
          : null;
      await tx.shipment.update({
        where: { id: shipmentId },
        data: {
          status: "PLANNED",
          carrierId: null,
          estimatedCost: ownCost?.total ?? null,
          costBreakdown: ownCost ? (ownCost.lines as unknown as Prisma.InputJsonValue) : Prisma.DbNull,
        },
      });
      await raiseException(tx, ctx, {
        shipmentId,
        type: "CARRIER_REJECTION",
        severity: "HIGH",
        title: `${tender.carrier.name} rejected the tender for ${shipment.number}`,
        impact: `${shipment.number} has no carrier${input.note ? ` (reason given: ${input.note})` : ""}. It cannot be dispatched until one accepts.`,
        recommendedAction: "Tender the shipment to another carrier, or dispatch it on your own fleet.",
        dedupeKey: `tender-rejected:${tender.id}`,
      });
    }

    await addTrackingEvent(tx, ctx, {
      shipmentId,
      type: input.accepted ? "ACCEPTED" : "REJECTED",
      occurredAt: at,
      message: `${tender.carrier.name} ${input.accepted ? "accepted" : "rejected"} the tender${input.note ? `: ${input.note}` : ""}`,
    });
    await emitEvent(tx, {
      organizationId: ctx.organizationId,
      type: input.accepted ? "TenderAccepted" : "TenderRejected",
      entityType: "shipment",
      entityId: shipmentId,
      payload: { tenderId: tender.id, carrierId: tender.carrierId, note: input.note ?? null },
      actor: ctx.actor,
      occurredAt: at,
    });
    await audit(tx, {
      organizationId: ctx.organizationId,
      actor: ctx.actor,
      action: input.accepted ? "tender.accepted" : "tender.rejected",
      entityType: "shipment",
      entityId: shipmentId,
      summary: `Recorded that ${tender.carrier.name} ${input.accepted ? "accepted" : "rejected"} ${shipment.number}`,
      reason: input.note,
      at,
    });
    return { status: input.accepted ? "ACCEPTED" : "REJECTED" };
  }, TX);
}

// ───────────────────────────── Dispatch ─────────────────────────────

export async function dispatchShipment(ctx: ServiceCtx, shipmentId: string) {
  const at = clock(ctx);
  return prisma.$transaction(async (tx) => {
    const shipment = await tx.shipment.findFirst({
      where: { id: shipmentId, organizationId: ctx.organizationId },
      include: { stops: { orderBy: { sequence: "asc" }, include: { location: true } }, vehicle: true },
    });
    if (!shipment) throw notFound("Shipment");

    const ownFleetReady = shipment.status === "PLANNED" && shipment.vehicleId && !shipment.carrierId;
    if (shipment.status !== "ACCEPTED" && !ownFleetReady) {
      if (shipment.status === "TENDERED") throw conflict("Waiting for the carrier to accept the tender");
      if (shipment.status === "PLANNED") {
        throw conflict("Assign a vehicle or get a carrier to accept the tender before dispatching");
      }
      if (shipment.status === "DRAFT") throw conflict("Plan the route before dispatching");
      throw conflict(`A ${shipment.status.toLowerCase().replace("_", " ")} shipment cannot be dispatched`);
    }
    if (shipment.vehicle) {
      // It may have gone into the shop between planning and dispatch.
      assertInService(shipment.vehicle);
      const busy = await tx.shipment.findFirst({
        where: {
          organizationId: ctx.organizationId,
          vehicleId: shipment.vehicleId,
          status: { in: ["DISPATCHED", "IN_TRANSIT"] },
          id: { not: shipmentId },
        },
      });
      if (busy) throw conflict(`${shipment.vehicle.name} is already out on ${busy.number}`);
    }

    const first = shipment.stops[0];
    const latitude = shipment.originLatitude ?? first?.location.latitude ?? null;
    const longitude = shipment.originLongitude ?? first?.location.longitude ?? null;

    await tx.shipment.update({
      where: { id: shipmentId },
      data: {
        status: "DISPATCHED",
        actualStart: at,
        currentLatitude: latitude,
        currentLongitude: longitude,
        lastPositionAt: at,
      },
    });
    await tx.order.updateMany({
      where: { shipmentId, organizationId: ctx.organizationId },
      data: { status: "IN_TRANSIT" },
    });
    if (shipment.vehicleId) {
      await tx.vehicle.update({
        where: { id: shipment.vehicleId },
        data: { status: "IN_USE", lastLatitude: latitude, lastLongitude: longitude, lastSeenAt: at },
      });
    }
    if (shipment.driverId) {
      await tx.driver.update({ where: { id: shipment.driverId }, data: { status: "ON_DUTY" } });
    }
    await addTrackingEvent(tx, ctx, {
      shipmentId,
      type: "DISPATCHED",
      occurredAt: at,
      latitude,
      longitude,
      message: "Shipment dispatched",
    });
    await emitEvent(tx, {
      organizationId: ctx.organizationId,
      type: "ShipmentDispatched",
      entityType: "shipment",
      entityId: shipmentId,
      payload: { vehicleId: shipment.vehicleId, driverId: shipment.driverId, carrierId: shipment.carrierId },
      actor: ctx.actor,
      occurredAt: at,
    });
    await audit(tx, {
      organizationId: ctx.organizationId,
      actor: ctx.actor,
      action: "shipment.dispatched",
      entityType: "shipment",
      entityId: shipmentId,
      summary: `Dispatched ${shipment.number}`,
      at,
    });
    return { status: "DISPATCHED" };
  }, TX);
}

// ───────────────────────────── Cancel ─────────────────────────────

export async function cancelShipment(ctx: ServiceCtx, shipmentId: string, reason: string) {
  const at = clock(ctx);
  return prisma.$transaction(async (tx) => {
    const shipment = await tx.shipment.findFirst({
      where: { id: shipmentId, organizationId: ctx.organizationId },
    });
    if (!shipment) throw notFound("Shipment");
    if (shipment.status === "DELIVERED" || shipment.status === "CANCELLED") {
      throw conflict(`A ${shipment.status.toLowerCase()} shipment cannot be cancelled`);
    }
    const wasMoving = shipment.status === "DISPATCHED" || shipment.status === "IN_TRANSIT";

    await tx.shipment.update({
      where: { id: shipmentId },
      data: { status: "CANCELLED", cancelReason: reason },
    });
    // Release the orders so they can be planned onto another shipment.
    await tx.order.updateMany({
      where: { shipmentId, organizationId: ctx.organizationId, status: { not: "DELIVERED" } },
      data: { status: "OPEN", shipmentId: null },
    });
    await tx.tender.updateMany({
      where: { shipmentId, status: "SENT" },
      data: { status: "CANCELLED", respondedAt: at },
    });
    if (wasMoving && shipment.vehicleId) {
      await tx.vehicle.update({ where: { id: shipment.vehicleId }, data: { status: "AVAILABLE" } });
    }
    if (wasMoving && shipment.driverId) {
      await tx.driver.update({ where: { id: shipment.driverId }, data: { status: "AVAILABLE" } });
    }
    await tx.shipmentException.updateMany({
      where: { shipmentId, status: { in: ["OPEN", "INVESTIGATING"] } },
      data: { status: "RESOLVED", resolvedAt: at, resolutionNote: "Shipment cancelled" },
    });
    await addTrackingEvent(tx, ctx, {
      shipmentId,
      type: "CANCELLED",
      occurredAt: at,
      message: `Shipment cancelled: ${reason}`,
    });
    await emitEvent(tx, {
      organizationId: ctx.organizationId,
      type: "ShipmentCancelled",
      entityType: "shipment",
      entityId: shipmentId,
      payload: { reason },
      actor: ctx.actor,
      occurredAt: at,
    });
    await audit(tx, {
      organizationId: ctx.organizationId,
      actor: ctx.actor,
      action: "shipment.cancelled",
      entityType: "shipment",
      entityId: shipmentId,
      summary: `Cancelled ${shipment.number}`,
      before: { status: shipment.status },
      after: { status: "CANCELLED" },
      reason,
      at,
    });
    return { status: "CANCELLED" };
  }, TX);
}
