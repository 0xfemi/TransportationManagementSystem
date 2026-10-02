"use client";

import dynamic from "next/dynamic";

export type { MapLine, MapMarker } from "./MapInner";

// Leaflet touches `window` on import, so the map only loads in the browser.
export const MapView = dynamic(() => import("./MapInner"), {
  ssr: false,
  loading: () => <div className="flex h-[420px] items-center justify-center text-sm text-zinc-500">Loading map…</div>,
});

export function MapLegend({ items }: { items: { glyph: string; label: string; late?: boolean }[] }) {
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1 px-4 py-2 text-xs text-zinc-600">
      {items.map((item) => (
        <li key={item.label} className="flex items-center gap-1.5">
          <span
            aria-hidden
            className="flex h-4 w-4 items-center justify-center rounded-full text-[9px] font-semibold text-white"
            style={{ background: item.late ? "#d03b3b" : "#52514e" }}
          >
            {item.glyph}
          </span>
          {item.label}
        </li>
      ))}
    </ul>
  );
}
