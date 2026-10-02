"use client";

import { ResourcePage, type ResourceConfig } from "@/components/ResourcePage";
import { StatusBadge } from "@/components/ui";

const config: ResourceConfig = {
  title: "Drivers",
  singular: "driver",
  description: "People who operate your vehicles. A driver assigned to a vehicle is put on its shipments automatically.",
  path: "/drivers",
  columns: [
    { header: "Name", render: (r) => <span className="font-medium text-zinc-900">{r.name}</span> },
    { header: "Phone", render: (r) => r.phone ?? "—" },
    { header: "Licence", render: (r) => r.licenseNumber ?? "—" },
    { header: "Vehicle", render: (r) => r.vehicle?.name ?? "—" },
    { header: "Status", render: (r) => <StatusBadge status={r.status} /> },
  ],
  fields: [
    { name: "name", label: "Name", required: true },
    { name: "phone", label: "Phone", half: true },
    { name: "licenseNumber", label: "Licence number", half: true },
    { name: "vehicleId", label: "Assigned vehicle", type: "select", optionsFrom: "/vehicles", half: true },
    {
      name: "status",
      label: "Status",
      type: "select",
      required: true,
      half: true,
      defaultValue: "AVAILABLE",
      options: [
        { value: "AVAILABLE", label: "Available" },
        { value: "OFF_DUTY", label: "Off duty" },
        { value: "INACTIVE", label: "Inactive" },
      ],
    },
  ],
};

export default function DriversPage() {
  return <ResourcePage config={config} />;
}
