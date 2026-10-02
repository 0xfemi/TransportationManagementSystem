import { prisma } from "@/lib/prisma";
import { conflict, notFound } from "@/lib/errors";
import { estimateLeg, haversineKm, interpolate, type LatLng } from "@/modules/routing/geo";
import type { ServiceCtx } from "@/modules/shipments/service";
import { ingestTrackingEvent } from "./service";

const MIN_MS = 60_000;

/**
 * Stands in for a vehicle's GPS unit and driver app during demos and tests.
 *
 * It advances a simulated clock by `minutes` and reports whatever a real
 * feed would have reported in that time (positions, arrivals, departures,
 * deliveries) through the same ingestion path as real events. A speed factor
 * below 1 models traffic. Events are stored with source "simulator".
 */
export async function simulateTracking(
  ctx: ServiceCtx,
  shipmentId: string,
  input: { minutes: number; speedFactor: number },
) {
  const simCtx: ServiceCtx & { source: string } = {
    organizationId: ctx.organizationId,
    actor: { type: "simulator", id: ctx.actor.id, label: `Simulator (${ctx.actor.label})` },
    source: "simulator",
    at: ctx.at,
  };
  let budget = input.minutes;
  const emitted: { type: string; occurredAt: Date; message: string | null }[] = [];

  const first = await prisma.shipment.findFirst({
    where: { id: shipmentId, organizationId: ctx.organizationId },
    select: { status: true, number: true },
  });
  if (!first) throw notFound("Shipment");
  if (first.status !== "DISPATCHED" && first.status !== "IN_TRANSIT") {
    throw conflict(`Dispatch ${first.number} before simulating its movement`);
  }

  for (let guard = 0; guard < 200 && budget > 1e-6; guard++) {
    const shipment = await prisma.shipment.findFirstOrThrow({
      where: { id: shipmentId, organizationId: ctx.organizationId },
      include: {
        stops: { orderBy: { sequence: "asc" }, include: { location: true } },
        trackingEvents: { orderBy: { occurredAt: "desc" }, take: 1 },
      },
    });
    if (shipment.status !== "DISPATCHED" && shipment.status !== "IN_TRANSIT") break;

    const index = shipment.stops.findIndex((s) => s.status !== "COMPLETED");
    if (index === -1) break;
    const stop = shipment.stops[index];
    const target: LatLng = stop.location;
    let now = Math.max(
      shipment.trackingEvents[0]?.occurredAt.getTime() ?? 0,
      shipment.actualStart?.getTime() ?? 0,
    );

    const report = async (
      type: "LOCATION_UPDATE" | "ARRIVED_PICKUP" | "DEPARTED_PICKUP" | "ARRIVED_DESTINATION" | "DELIVERED",
      position: LatLng,
      speedKph: number,
    ) => {
      const { event } = await ingestTrackingEvent(simCtx, {
        shipmentId,
        type,
        occurredAt: new Date(now),
        latitude: position.latitude,
        longitude: position.longitude,
        speedKph,
        stopId: type === "LOCATION_UPDATE" ? undefined : stop.id,
      });
      emitted.push({ type: event.type, occurredAt: event.occurredAt, message: event.message });
    };

    if (stop.status === "ARRIVED") {
      const readyAt = (stop.actualArrival?.getTime() ?? now) + stop.serviceMinutes * MIN_MS;
      const needed = Math.max(0, (readyAt - now) / MIN_MS);
      if (needed > budget) {
        now += budget * MIN_MS;
        budget = 0;
        await report("LOCATION_UPDATE", target, 0);
        break;
      }
      now += needed * MIN_MS;
      budget -= needed;
      await report(stop.type === "PICKUP" ? "DEPARTED_PICKUP" : "DELIVERED", target, 0);
      continue;
    }

    const previous: LatLng | null =
      index > 0
        ? shipment.stops[index - 1].location
        : shipment.originLatitude !== null && shipment.originLongitude !== null
          ? { latitude: shipment.originLatitude, longitude: shipment.originLongitude }
          : null;
    const position: LatLng =
      shipment.currentLatitude !== null && shipment.currentLongitude !== null
        ? { latitude: shipment.currentLatitude, longitude: shipment.currentLongitude }
        : (previous ?? target);

    const legKm = previous ? haversineKm(previous, target) : 0;
    const usePlan = previous !== null && stop.legDurationMin !== null && legKm > 0.05;
    const nominalMin = usePlan
      ? stop.legDurationMin! * Math.min(1.5, haversineKm(position, target) / legKm)
      : estimateLeg(position, target, shipment.mode).durationMin;
    const nominalKph =
      usePlan && stop.legDurationMin! > 0
        ? ((stop.legDistanceKm ?? legKm) / stop.legDurationMin!) * 60
        : 60;
    const needed = nominalMin / input.speedFactor;

    if (needed > budget) {
      const fraction = (budget * input.speedFactor) / nominalMin;
      now += budget * MIN_MS;
      budget = 0;
      await report("LOCATION_UPDATE", interpolate(position, target, fraction), nominalKph * input.speedFactor);
      break;
    }
    now += needed * MIN_MS;
    budget -= needed;
    await report(stop.type === "PICKUP" ? "ARRIVED_PICKUP" : "ARRIVED_DESTINATION", target, 0);
  }

  return { events: emitted };
}
