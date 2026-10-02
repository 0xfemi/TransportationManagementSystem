"use client";

import { formatNumber } from "@/lib/client";
import { ResourcePage, type ResourceConfig } from "@/components/ResourcePage";
import { Badge } from "@/components/ui";

const config: ResourceConfig = {
  title: "Service areas",
  singular: "service area",
  description:
    "Where you operate. With at least one active area, new orders must pick up and deliver inside one. With none, orders are not restricted.",
  path: "/service-areas",
  columns: [
    { header: "Name", render: (r) => <span className="font-medium text-zinc-900">{r.name}</span> },
    { header: "Centre", render: (r) => `${formatNumber(r.latitude, 4)}, ${formatNumber(r.longitude, 4)}` },
    { header: "Radius", numeric: true, render: (r) => `${formatNumber(r.radiusKm, 1)} km` },
    { header: "Status", render: (r) => (r.active ? <Badge tone="green">Active</Badge> : <Badge>Inactive</Badge>) },
  ],
  fields: [
    { name: "name", label: "Name", required: true, hint: "e.g. Greater Toronto, Lagos Island" },
    { name: "latitude", label: "Centre latitude", type: "number", required: true, half: true },
    { name: "longitude", label: "Centre longitude", type: "number", required: true, half: true },
    { name: "radiusKm", label: "Radius (km)", type: "number", required: true, half: true, step: "0.1" },
    { name: "active", label: "Active", type: "boolean", half: true, defaultValue: "true" },
  ],
};

export default function ServiceAreasPage() {
  return <ResourcePage config={config} />;
}
