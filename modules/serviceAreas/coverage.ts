import { haversineKm, type LatLng } from "@/modules/routing/geo";

export type Area = { id: string; name: string; latitude: number; longitude: number; radiusKm: number };

/** The area containing a point, nearest centre first when areas overlap. */
export function coveringArea<T extends Area>(point: LatLng, areas: T[]): T | null {
  let best: { area: T; distance: number } | null = null;
  for (const area of areas) {
    const distance = haversineKm(point, area);
    if (distance <= area.radiusKm && (!best || distance < best.distance)) best = { area, distance };
  }
  return best?.area ?? null;
}

/**
 * Locations outside every area. An organization with no active areas has
 * not limited where it operates, so nothing is outside.
 */
export function uncovered<T extends LatLng & { name: string }>(points: T[], areas: Area[]): T[] {
  if (areas.length === 0) return [];
  return points.filter((p) => !coveringArea(p, areas));
}
