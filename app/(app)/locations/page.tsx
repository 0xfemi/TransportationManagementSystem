"use client";

import { titleCase } from "@/lib/client";
import { LOCATION_TYPES } from "@/lib/constants";
import { ResourcePage, type ResourceConfig } from "@/components/ResourcePage";

const config: ResourceConfig = {
  title: "Locations",
  singular: "location",
  description:
    "Warehouses, depots and customer sites. Routing uses the coordinates, so a location works even where street addresses are unreliable.",
  path: "/locations",
  columns: [
    { header: "Name", render: (r) => <span className="font-medium text-zinc-900">{r.name}</span> },
    { header: "Type", render: (r) => titleCase(r.type) },
    { header: "City", render: (r) => r.city ?? "—" },
    { header: "Customer", render: (r) => r.customer?.name ?? "—" },
    { header: "Coordinates", render: (r) => `${r.latitude.toFixed(4)}, ${r.longitude.toFixed(4)}` },
  ],
  fields: [
    { name: "name", label: "Name", required: true },
    {
      name: "type",
      label: "Type",
      type: "select",
      required: true,
      half: true,
      defaultValue: "WAREHOUSE",
      options: LOCATION_TYPES.map((t) => ({ value: t, label: titleCase(t) })),
    },
    { name: "customerId", label: "Customer", type: "select", optionsFrom: "/customers", half: true },
    { name: "addressLine", label: "Address or directions", hint: "Free text. A landmark or directions is fine." },
    { name: "city", label: "City", half: true },
    { name: "country", label: "Country", half: true },
    { name: "latitude", label: "Latitude", type: "number", required: true, half: true, hint: "Decimal degrees, e.g. 43.6532" },
    { name: "longitude", label: "Longitude", type: "number", required: true, half: true, hint: "Decimal degrees, e.g. -79.3832" },
  ],
};

export default function LocationsPage() {
  return <ResourcePage config={config} />;
}
