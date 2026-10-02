"use client";

import { useEffect, useMemo } from "react";
import Link from "next/link";
import L from "leaflet";
import { MapContainer, Marker, Polyline, Popup, TileLayer, useMap } from "react-leaflet";
import "leaflet/dist/leaflet.css";

export type MapMarker = {
  id: string;
  latitude: number;
  longitude: number;
  kind: "shipment" | "vehicle" | "warehouse" | "location" | "pickup" | "delivery";
  label: string;
  detail?: string;
  /** late = behind schedule, done = completed stop. */
  tone?: "late" | "done";
  href?: string;
};

export type MapLine = {
  id: string;
  points: [number, number][];
  tone?: "planned" | "late" | "travelled";
};

// The tile source is configuration, not code: any XYZ raster provider works.
const TILE_URL = process.env.NEXT_PUBLIC_MAP_TILE_URL || "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
const ATTRIBUTION =
  process.env.NEXT_PUBLIC_MAP_ATTRIBUTION ||
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';

const GLYPH: Record<MapMarker["kind"], string> = {
  shipment: "▲",
  vehicle: "●",
  warehouse: "■",
  location: "◆",
  pickup: "P",
  delivery: "D",
};

const FILL: Record<MapMarker["kind"], string> = {
  shipment: "#2a78d6",
  vehicle: "#52514e",
  warehouse: "#18181b",
  location: "#898781",
  pickup: "#2a78d6",
  delivery: "#2a78d6",
};

/**
 * Markers differ by shape and letter as well as colour, so they stay
 * distinguishable without colour vision. The white ring keeps overlapping
 * markers legible.
 */
function icon(marker: MapMarker) {
  const fill = marker.tone === "late" ? "#d03b3b" : marker.tone === "done" ? "#898781" : FILL[marker.kind];
  const big = marker.kind === "shipment";
  const size = big ? 26 : 20;
  return L.divIcon({
    className: "",
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
    html: `<div style="width:${size}px;height:${size}px;border-radius:${marker.kind === "warehouse" ? 4 : 999}px;background:${fill};color:#fff;font:600 ${big ? 12 : 10}px/1 system-ui;display:flex;align-items:center;justify-content:center;box-shadow:0 0 0 2px #fff,0 1px 3px rgba(0,0,0,.35)">${GLYPH[marker.kind]}</div>`,
  });
}

function FitBounds({ points, fitKey }: { points: [number, number][]; fitKey: string }) {
  const map = useMap();
  // Re-fit only when the set of things shown changes, not on every position
  // update, so the map does not jump while someone is looking at it.
  useEffect(() => {
    if (!points.length) return;
    if (points.length === 1) map.setView(points[0], 10);
    else map.fitBounds(points, { padding: [32, 32], maxZoom: 12 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fitKey, map]);
  return null;
}

const LINE_STYLE = {
  planned: { color: "#2a78d6", weight: 3, opacity: 0.55, dashArray: undefined },
  late: { color: "#d03b3b", weight: 3, opacity: 0.6, dashArray: undefined },
  travelled: { color: "#18181b", weight: 3, opacity: 0.85, dashArray: undefined },
} as const;

export default function MapInner({
  markers,
  lines = [],
  height = 420,
  fitKey,
}: {
  markers: MapMarker[];
  lines?: MapLine[];
  height?: number;
  /** Change this to make the map re-fit its bounds. */
  fitKey?: string;
}) {
  const points = useMemo<[number, number][]>(
    () => [...markers.map((m) => [m.latitude, m.longitude] as [number, number]), ...lines.flatMap((l) => l.points)],
    [markers, lines],
  );
  const key = fitKey ?? markers.map((m) => m.id).join(",");

  return (
    <MapContainer
      center={points[0] ?? [20, 0]}
      zoom={points.length ? 6 : 2}
      style={{ height, width: "100%" }}
      scrollWheelZoom
      className="z-0 rounded-b-lg"
    >
      <TileLayer url={TILE_URL} attribution={ATTRIBUTION} />
      <FitBounds points={points} fitKey={key} />
      {lines.map((line) => (
        <Polyline key={line.id} positions={line.points} pathOptions={LINE_STYLE[line.tone ?? "planned"]} />
      ))}
      {markers.map((marker) => (
        <Marker
          key={`${marker.kind}-${marker.id}`}
          position={[marker.latitude, marker.longitude]}
          icon={icon(marker)}
          zIndexOffset={marker.kind === "shipment" ? 1000 : 0}
          title={marker.label}
        >
          <Popup>
            <div className="text-sm">
              <p className="font-semibold">{marker.label}</p>
              {marker.detail && <p className="mt-0.5 text-zinc-600">{marker.detail}</p>}
              {marker.href && (
                <Link href={marker.href} className="mt-1 inline-block font-medium text-blue-700 underline">
                  Open
                </Link>
              )}
            </div>
          </Popup>
        </Marker>
      ))}
    </MapContainer>
  );
}
