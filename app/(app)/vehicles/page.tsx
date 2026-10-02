"use client";

import { formatNumber, titleCase } from "@/lib/client";
import { MODES } from "@/lib/constants";
import { ResourcePage, type ResourceConfig } from "@/components/ResourcePage";
import { StatusBadge } from "@/components/ui";

const config: ResourceConfig = {
  title: "Vehicles",
  singular: "vehicle",
  description: "Your fleet. Capacity limits what the planner will load; the home location is where routes start.",
  path: "/vehicles",
  columns: [
    { header: "Name", render: (r) => <span className="font-medium text-zinc-900">{r.name}</span> },
    { header: "Type", render: (r) => r.vehicleType },
    { header: "Mode", render: (r) => titleCase(r.mode) },
    { header: "Status", render: (r) => <StatusBadge status={r.status} /> },
    { header: "Capacity", numeric: true, render: (r) => `${formatNumber(r.capacityKg)} kg · ${formatNumber(r.capacityM3, 1)} m³` },
    { header: "Home", render: (r) => r.homeLocation?.name ?? "—" },
    { header: "Driver", render: (r) => r.drivers?.map((d: { name: string }) => d.name).join(", ") || "—" },
  ],
  fields: [
    { name: "name", label: "Name or fleet number", required: true, half: true },
    { name: "registration", label: "Registration", half: true },
    { name: "vehicleType", label: "Type", required: true, half: true, defaultValue: "Truck", hint: "e.g. Van, Box truck, Motorcycle, Drone" },
    {
      name: "mode",
      label: "Mode",
      type: "select",
      required: true,
      half: true,
      defaultValue: "ROAD",
      options: MODES.map((m) => ({ value: m, label: titleCase(m) })),
    },
    { name: "capacityKg", label: "Weight capacity (kg)", type: "number", required: true, half: true },
    { name: "capacityM3", label: "Volume capacity (m³)", type: "number", required: true, half: true },
    { name: "costPerKm", label: "Running cost per km", type: "number", half: true, defaultValue: 0 },
    { name: "fixedCost", label: "Fixed cost per trip", type: "number", half: true, defaultValue: 0 },
    { name: "homeLocationId", label: "Home location", type: "select", optionsFrom: "/locations", half: true },
    {
      name: "status",
      label: "Status",
      type: "select",
      required: true,
      half: true,
      defaultValue: "AVAILABLE",
      options: [
        { value: "AVAILABLE", label: "Available" },
        { value: "MAINTENANCE", label: "In maintenance" },
        { value: "INACTIVE", label: "Inactive" },
      ],
    },
  ],
};

export default function VehiclesPage() {
  return <ResourcePage config={config} />;
}
