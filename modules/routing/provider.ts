import type { TransportMode } from "@prisma/client";
import { estimateLeg, type LatLng } from "./geo";

export type Matrix = { distanceKm: number[][]; durationMin: number[][] };
export type RouteResult = {
  geometry: [number, number][];
  distanceKm: number;
  durationMin: number;
};

/**
 * Anything that can answer "how far and how long between these points".
 * Swap implementations with ROUTING_PROVIDER; the rest of the system only
 * sees this interface.
 */
export interface RoutingProvider {
  readonly name: string;
  matrix(points: LatLng[], mode: TransportMode): Promise<Matrix>;
  route(points: LatLng[], mode: TransportMode): Promise<RouteResult>;
}

export const haversineProvider: RoutingProvider = {
  name: "haversine",
  async matrix(points, mode) {
    const distanceKm: number[][] = [];
    const durationMin: number[][] = [];
    for (let i = 0; i < points.length; i++) {
      distanceKm.push([]);
      durationMin.push([]);
      for (let j = 0; j < points.length; j++) {
        const leg = i === j ? { distanceKm: 0, durationMin: 0 } : estimateLeg(points[i], points[j], mode);
        distanceKm[i].push(leg.distanceKm);
        durationMin[i].push(leg.durationMin);
      }
    }
    return { distanceKm, durationMin };
  },
  async route(points, mode) {
    let distanceKm = 0;
    let durationMin = 0;
    for (let i = 1; i < points.length; i++) {
      const leg = estimateLeg(points[i - 1], points[i], mode);
      distanceKm += leg.distanceKm;
      durationMin += leg.durationMin;
    }
    return {
      geometry: points.map((p) => [p.latitude, p.longitude]),
      distanceKm,
      durationMin,
    };
  },
};

/** Road routing from an OSRM server (https://project-osrm.org). */
export function osrmProvider(baseUrl: string): RoutingProvider {
  const coords = (points: LatLng[]) =>
    points.map((p) => `${p.longitude},${p.latitude}`).join(";");
  const get = async (path: string) => {
    const res = await fetch(`${baseUrl.replace(/\/$/, "")}${path}`, {
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) throw new Error(`OSRM responded ${res.status}`);
    const body = await res.json();
    if (body.code !== "Ok") throw new Error(`OSRM error: ${body.code}`);
    return body;
  };
  return {
    name: "osrm",
    async matrix(points) {
      const body = await get(
        `/table/v1/driving/${coords(points)}?annotations=distance,duration`,
      );
      return {
        distanceKm: body.distances.map((row: number[]) => row.map((m) => m / 1000)),
        durationMin: body.durations.map((row: number[]) => row.map((s) => s / 60)),
      };
    },
    async route(points) {
      const body = await get(
        `/route/v1/driving/${coords(points)}?overview=full&geometries=geojson`,
      );
      const route = body.routes[0];
      return {
        geometry: route.geometry.coordinates.map(([lng, lat]: [number, number]) => [lat, lng]),
        distanceKm: route.distance / 1000,
        durationMin: route.duration / 60,
      };
    },
  };
}

/**
 * OSRM only knows roads, so other modes always use the estimate. If the
 * routing server is unreachable we fall back to the estimate rather than
 * block planning, and report which provider actually answered.
 */
export function getRoutingProvider(): RoutingProvider {
  const osrmUrl = process.env.OSRM_URL;
  if (process.env.ROUTING_PROVIDER !== "osrm" || !osrmUrl) return haversineProvider;
  const osrm = osrmProvider(osrmUrl);
  const roadModes: TransportMode[] = ["ROAD", "COURIER", "MOTORCYCLE"];
  return {
    name: "osrm",
    async matrix(points, mode) {
      if (!roadModes.includes(mode)) return haversineProvider.matrix(points, mode);
      try {
        return await osrm.matrix(points, mode);
      } catch (error) {
        console.warn(JSON.stringify({ level: "warn", msg: "osrm_matrix_failed", error: String(error) }));
        return haversineProvider.matrix(points, mode);
      }
    },
    async route(points, mode) {
      if (!roadModes.includes(mode)) return haversineProvider.route(points, mode);
      try {
        return await osrm.route(points, mode);
      } catch (error) {
        console.warn(JSON.stringify({ level: "warn", msg: "osrm_route_failed", error: String(error) }));
        return haversineProvider.route(points, mode);
      }
    },
  };
}
