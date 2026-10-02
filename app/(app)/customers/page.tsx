"use client";

import { ResourcePage, type ResourceConfig } from "@/components/ResourcePage";

const config: ResourceConfig = {
  title: "Customers",
  singular: "customer",
  description: "The companies you move goods for. Add their delivery sites under Locations.",
  path: "/customers",
  columns: [
    { header: "Name", render: (r) => <span className="font-medium text-zinc-900">{r.name}</span> },
    { header: "Email", render: (r) => r.email ?? "—" },
    { header: "Phone", render: (r) => r.phone ?? "—" },
  ],
  fields: [
    { name: "name", label: "Name", required: true },
    { name: "email", label: "Email", type: "email", half: true },
    { name: "phone", label: "Phone", half: true },
    { name: "notes", label: "Notes" },
  ],
};

export default function CustomersPage() {
  return <ResourcePage config={config} />;
}
