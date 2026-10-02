import type { StopStatus, TransportMode } from "@prisma/client";
import { estimateLeg, haversineKm, type LatLng } from "@/modules/routing/geo";

export type EtaStop = LatLng & {
  id: string;
  status: StopStatus;
  serviceMinutes: number;
  windowStart: Date | null;
  windowEnd: Date | null;
  plannedArrival: Date | null;
  actualArrival: Date | null;
  legDurationMin: number | null;
};

export type EtaProjection = {
  stops: { id: string; estimatedArrival: Date; lateMinutes: number; deadline: Date | null }[];
  finalEta: Date | null;
  /** Worst lateness across remaining stops, never negative. */
  delayMinutes: number;
  worstStopId: string | null;
};

const MIN_MS = 60_000;
const SAME_PLACE_KM = 0.05;

/**
 * Projects arrival times for the stops a shipment has not finished yet.
 *
 * Travel time on the current leg is the planned leg duration scaled by how
 * much of the leg is left, so the estimate stays consistent with whichever
 * routing provider planned the route. Later legs use their planned duration.
 * Stops are expected in sequence order.
 */
export function projectEta(input: {
  stops: EtaStop[];
  origin: LatLng | null;
  position: LatLng | null;
  asOf: Date;
  mode: TransportMode;
}): EtaProjection {
  let time = input.asOf.getTime();
  let cursor: LatLng | null = input.position;
  const projected: EtaProjection["stops"] = [];
  let worst = { id: null as string | null, late: 0 };
  let finalEta: Date | null = null;

  input.stops.forEach((stop, i) => {
    if (stop.status === "COMPLETED") return;
    const previous: LatLng | null = i > 0 ? input.stops[i - 1] : input.origin;
    let eta: number;

    if (stop.status === "ARRIVED" && stop.actualArrival) {
      eta = stop.actualArrival.getTime();
      time = Math.max(time, eta + stop.serviceMinutes * MIN_MS);
    } else {
      const from = cursor ?? previous ?? stop;
      const legKm = previous ? haversineKm(previous, stop) : 0;
      let travelMin: number;
      if (previous && stop.legDurationMin !== null && legKm > SAME_PLACE_KM) {
        const remaining = Math.min(1.5, haversineKm(from, stop) / legKm);
        travelMin = stop.legDurationMin * remaining;
      } else {
        travelMin = estimateLeg(from, stop, input.mode).durationMin;
      }
      time += travelMin * MIN_MS;
      eta = time;
      if (stop.windowStart && time < stop.windowStart.getTime()) time = stop.windowStart.getTime();
      time += stop.serviceMinutes * MIN_MS;
    }
    cursor = stop;

    const deadline = stop.windowEnd ?? stop.plannedArrival;
    const lateMinutes = deadline ? (eta - deadline.getTime()) / MIN_MS : 0;
    if (lateMinutes > worst.late) worst = { id: stop.id, late: lateMinutes };
    finalEta = new Date(eta);
    projected.push({ id: stop.id, estimatedArrival: new Date(eta), lateMinutes, deadline });
  });

  return {
    stops: projected,
    finalEta,
    delayMinutes: Math.max(0, Math.round(worst.late)),
    worstStopId: worst.id,
  };
}

/** Range shown next to an ETA: uncertainty grows with the time still to run. */
export function etaWindowMinutes(eta: Date, asOf: Date): number {
  const remaining = Math.max(0, (eta.getTime() - asOf.getTime()) / MIN_MS);
  return Math.max(5, Math.round(remaining * 0.15));
}
