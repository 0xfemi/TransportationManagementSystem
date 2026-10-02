import type { ExceptionSeverity, Prisma, ShipmentStatus, TrackingEventType } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { conflict, notFound, unprocessable } from "@/lib/errors";
import { audit, emitEvent } from "@/lib/events";
import { raiseException } from "@/modules/exceptions/service";
import { addTrackingEvent, clock, type ServiceCtx } from "@/modules/shipments/service";
import { projectEta } from "./eta";

/** Lateness below this is treated as noise, not a delay. */
export const DELAY_THRESHOLD_MIN = 15;

/** Event types a driver, carrier or telematics feed may report. */
export const REPORTABLE_EVENTS = [
  "LOCATION_UPDATE",
  "IN_TRANSIT",
  "ARRIVED_PICKUP",
  "DEPARTED_PICKUP",
  "ARRIVED_DESTINATION",
  "OUT_FOR_DELIVERY",
  "DELIVERED",
  "EXCEPTION",
] as const satisfies readonly TrackingEventType[];

export type ReportableEvent = (typeof REPORTABLE_EVENTS)[number];

export type TrackingInput = {
  shipmentId: string;
  type: ReportableEvent;
  occurredAt?: Date;
  latitude?: number;
  longitude?: number;
  speedKph?: number;
  heading?: number;
  stopId?: string;
  message?: string;
  externalId?: string;
};

const TX = { timeout: 20_000, maxWait: 10_000 };

function severityFor(lateMinutes: number): ExceptionSeverity {
  if (lateMinutes >= 120) return "CRITICAL";
  if (lateMinutes >= 60) return "HIGH";
  if (lateMinutes >= 30) return "MEDIUM";
  return "LOW";
}

function formatTime(date: Date, timeZone: string): string {
  try {
    return new Intl.DateTimeFormat("en-GB", {
      timeZone,
      day: "2-digit",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(date);
  } catch {
    return date.toISOString();
  }
}

/**
 * Applies one tracking event: stores it, moves the shipment and its stops
 * through their states, refreshes the ETA and raises a delay exception when
 * the projection slips past a deadline. All in one transaction.
 */
export async function ingestTrackingEvent(
  ctx: ServiceCtx & { source?: string },
  input: TrackingInput,
) {
  return prisma.$transaction(async (tx) => {
    if (input.externalId) {
      const duplicate = await tx.trackingEvent.findUnique({
        where: {
          organizationId_externalId: {
            organizationId: ctx.organizationId,
            externalId: input.externalId,
          },
        },
      });
      if (duplicate) return { event: duplicate, duplicate: true, shipmentStatus: null };
    }

    const shipment = await tx.shipment.findFirst({
      where: { id: input.shipmentId, organizationId: ctx.organizationId },
      include: { stops: { orderBy: { sequence: "asc" }, include: { location: true } } },
    });
    if (!shipment) throw notFound("Shipment");
    if (shipment.status !== "DISPATCHED" && shipment.status !== "IN_TRANSIT") {
      throw conflict(
        `Tracking events are only accepted for dispatched shipments; ${shipment.number} is ${shipment.status.toLowerCase().replace("_", " ")}`,
      );
    }

    // A report without its own timestamp is taken to have happened now, but
    // never before the shipment's latest known position: a shipment advanced
    // by the simulator runs ahead of the wall clock, and its history must
    // stay in order.
    const received = clock(ctx);
    const occurredAt =
      input.occurredAt ??
      (shipment.lastPositionAt && shipment.lastPositionAt > received
        ? shipment.lastPositionAt
        : received);
    const eventCtx = { ...ctx, at: occurredAt };
    let latitude = input.latitude ?? null;
    let longitude = input.longitude ?? null;
    let stopId: string | null = null;
    let message = input.message;

    // ── Stop effects ──
    const stopEvent =
      input.type === "ARRIVED_PICKUP" ||
      input.type === "DEPARTED_PICKUP" ||
      input.type === "ARRIVED_DESTINATION" ||
      input.type === "DELIVERED";
    if (stopEvent) {
      const stop = input.stopId
        ? shipment.stops.find((s) => s.id === input.stopId)
        : shipment.stops.find((s) => s.status !== "COMPLETED");
      if (!stop) throw input.stopId ? notFound("Stop") : conflict("Every stop is already completed");
      const expectsPickup = input.type === "ARRIVED_PICKUP" || input.type === "DEPARTED_PICKUP";
      if ((stop.type === "PICKUP") !== expectsPickup) {
        throw unprocessable(
          `${input.type} does not apply to a ${stop.type.toLowerCase()} stop (${stop.location.name})`,
        );
      }
      if (stop.status === "COMPLETED") throw conflict(`${stop.location.name} is already completed`);
      const arriving = input.type === "ARRIVED_PICKUP" || input.type === "ARRIVED_DESTINATION";
      if (arriving && stop.status === "ARRIVED") {
        throw conflict(`Arrival at ${stop.location.name} is already recorded`);
      }

      const data: Prisma.StopUpdateInput = arriving
        ? { status: "ARRIVED", actualArrival: occurredAt }
        : {
            status: "COMPLETED",
            actualArrival: stop.actualArrival ?? occurredAt,
            actualDeparture: occurredAt,
          };
      await tx.stop.update({ where: { id: stop.id }, data });
      Object.assign(stop, data);
      stopId = stop.id;
      latitude ??= stop.location.latitude;
      longitude ??= stop.location.longitude;
      message ??=
        input.type === "ARRIVED_PICKUP"
          ? `Arrived for pickup at ${stop.location.name}`
          : input.type === "DEPARTED_PICKUP"
            ? `Picked up and departed ${stop.location.name}`
            : input.type === "ARRIVED_DESTINATION"
              ? `Arrived at ${stop.location.name}`
              : `Delivered at ${stop.location.name}`;

      if (input.type === "DELIVERED" && stop.orderId) {
        await tx.order.update({ where: { id: stop.orderId }, data: { status: "DELIVERED" } });
      }
    }

    // ── Position ──
    const fresh = !shipment.lastPositionAt || occurredAt >= shipment.lastPositionAt;
    const hasPosition = latitude !== null && longitude !== null;
    const position =
      hasPosition && fresh
        ? { latitude: latitude!, longitude: longitude! }
        : shipment.currentLatitude !== null && shipment.currentLongitude !== null
          ? { latitude: shipment.currentLatitude, longitude: shipment.currentLongitude }
          : null;

    const event = await addTrackingEvent(tx, ctx, {
      shipmentId: shipment.id,
      type: input.type,
      occurredAt,
      message,
      latitude,
      longitude,
      speedKph: input.speedKph,
      heading: input.heading,
      stopId,
      source: ctx.source,
      externalId: input.externalId,
    });

    const update: Prisma.ShipmentUpdateInput = {};
    if (hasPosition && fresh) {
      update.currentLatitude = latitude;
      update.currentLongitude = longitude;
      update.lastPositionAt = occurredAt;
      if (shipment.vehicleId) {
        await tx.vehicle.update({
          where: { id: shipment.vehicleId },
          data: { lastLatitude: latitude, lastLongitude: longitude, lastSeenAt: occurredAt },
        });
      }
    }

    const delivered = shipment.stops.every((s) => s.status === "COMPLETED");
    let status: ShipmentStatus = shipment.status;

    if (delivered) {
      status = "DELIVERED";
      update.status = "DELIVERED";
      update.actualEnd = occurredAt;
      update.currentEta = occurredAt;
      // Until a carrier invoice is reconciled, the planned cost is the
      // best available figure for what the shipment cost.
      update.actualCost = shipment.estimatedCost;
      if (shipment.vehicleId) {
        await tx.vehicle.update({ where: { id: shipment.vehicleId }, data: { status: "AVAILABLE" } });
      }
      if (shipment.driverId) {
        await tx.driver.update({ where: { id: shipment.driverId }, data: { status: "AVAILABLE" } });
      }
      await emitEvent(tx, {
        organizationId: ctx.organizationId,
        type: "ShipmentDelivered",
        entityType: "shipment",
        entityId: shipment.id,
        payload: { deliveredAt: occurredAt.toISOString(), delayMinutes: shipment.delayMinutes },
        actor: ctx.actor,
        occurredAt,
      });
      await audit(tx, {
        organizationId: ctx.organizationId,
        actor: ctx.actor,
        action: "shipment.delivered",
        entityType: "shipment",
        entityId: shipment.id,
        summary: `${shipment.number} delivered`,
        at: occurredAt,
      });
    } else {
      if (shipment.status === "DISPATCHED") {
        status = "IN_TRANSIT";
        update.status = "IN_TRANSIT";
      }
      const projection = projectEta({
        stops: shipment.stops.map((s) => ({
          id: s.id,
          status: s.status,
          serviceMinutes: s.serviceMinutes,
          windowStart: s.windowStart,
          windowEnd: s.windowEnd,
          plannedArrival: s.plannedArrival,
          actualArrival: s.actualArrival,
          legDurationMin: s.legDurationMin,
          latitude: s.location.latitude,
          longitude: s.location.longitude,
        })),
        origin:
          shipment.originLatitude !== null && shipment.originLongitude !== null
            ? { latitude: shipment.originLatitude, longitude: shipment.originLongitude }
            : null,
        position,
        asOf: occurredAt,
        mode: shipment.mode,
      });
      for (const projected of projection.stops) {
        await tx.stop.update({
          where: { id: projected.id },
          data: { estimatedArrival: projected.estimatedArrival },
        });
      }
      update.currentEta = projection.finalEta;
      update.delayMinutes = projection.delayMinutes;

      if (projection.delayMinutes >= DELAY_THRESHOLD_MIN && projection.worstStopId) {
        const worst = projection.stops.find((s) => s.id === projection.worstStopId)!;
        const stop = shipment.stops.find((s) => s.id === projection.worstStopId)!;
        const org = await tx.organization.findUniqueOrThrow({
          where: { id: ctx.organizationId },
          select: { timezone: true },
        });
        const severity = severityFor(projection.delayMinutes);
        const lateStops = projection.stops.filter((s) => s.lateMinutes >= DELAY_THRESHOLD_MIN).length;
        const created = await raiseException(tx, eventCtx, {
          shipmentId: shipment.id,
          type: "LATE_SHIPMENT",
          severity,
          title: `Shipment ${shipment.number} is ${projection.delayMinutes} minutes behind schedule`,
          impact:
            `Arrival at ${stop.location.name} is now expected at ${formatTime(worst.estimatedArrival, org.timezone)}` +
            (worst.deadline ? `, against a deadline of ${formatTime(worst.deadline, org.timezone)}` : "") +
            `. ${lateStops} of ${projection.stops.length} remaining stop(s) will be late.`,
          recommendedAction:
            severity === "LOW" || severity === "MEDIUM"
              ? "Tell the customer the new arrival time and confirm the site can still receive the delivery."
              : "Contact the driver or carrier to find the cause, tell the customer the new arrival time, and check whether the receiving site can extend its window.",
          dedupeKey: `late:${shipment.id}`,
          metricValue: projection.delayMinutes,
        });
        if (shipment.delayMinutes < DELAY_THRESHOLD_MIN) {
          await emitEvent(tx, {
            organizationId: ctx.organizationId,
            type: "ShipmentDelayed",
            entityType: "shipment",
            entityId: shipment.id,
            payload: { delayMinutes: projection.delayMinutes, exceptionId: created.id },
            actor: ctx.actor,
            occurredAt,
          });
        }
      }
    }

    if (input.type === "EXCEPTION") {
      await raiseException(tx, eventCtx, {
        shipmentId: shipment.id,
        type: "OTHER",
        severity: "MEDIUM",
        title: `Problem reported on ${shipment.number}`,
        impact: input.message ?? "No details were given with the report.",
        recommendedAction: "Contact the driver or carrier for details and decide whether the plan needs to change.",
      });
    }

    await tx.shipment.update({ where: { id: shipment.id }, data: update });
    return { event, duplicate: false, shipmentStatus: status };
  }, TX);
}
