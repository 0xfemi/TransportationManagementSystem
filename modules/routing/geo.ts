import type { TransportMode } from "@prisma/client";

export type LatLng = { latitude: number; longitude: number };

const EARTH_RADIUS_KM = 6371.0088;
const toRad = (deg: number) => (deg * Math.PI) / 180;

/** Great-circle distance in kilometres. */
export function haversineKm(a: LatLng, b: LatLng): number {
  const dLat = toRad(b.latitude - a.latitude);
  const dLng = toRad(b.longitude - a.longitude);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.latitude)) * Math.cos(toRad(b.latitude)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Point a given fraction (0..1) of the way from a to b. */
export function interpolate(a: LatLng, b: LatLng, fraction: number): LatLng {
  const f = Math.max(0, Math.min(1, fraction));
  return {
    latitude: a.latitude + (b.latitude - a.latitude) * f,
    longitude: a.longitude + (b.longitude - a.longitude) * f,
  };
}

/**
 * Assumptions used when no routing engine is configured. Travelled distance
 * is the great-circle distance times a circuity factor; duration follows from
 * an average speed. They are estimates and are labelled as such in the UI.
 */
export const MODE_PROFILE: Record<TransportMode, { circuity: number; speedKph: number }> = {
  ROAD: { circuity: 1.3, speedKph: 65 },
  COURIER: { circuity: 1.35, speedKph: 40 },
  MOTORCYCLE: { circuity: 1.35, speedKph: 35 },
  RAIL: { circuity: 1.2, speedKph: 60 },
  OCEAN: { circuity: 1.25, speedKph: 30 },
  AIR: { circuity: 1.05, speedKph: 750 },
  DRONE: { circuity: 1.05, speedKph: 80 },
};

export function estimateLeg(a: LatLng, b: LatLng, mode: TransportMode) {
  const profile = MODE_PROFILE[mode];
  const distanceKm = haversineKm(a, b) * profile.circuity;
  return { distanceKm, durationMin: (distanceKm / profile.speedKph) * 60 };
}
