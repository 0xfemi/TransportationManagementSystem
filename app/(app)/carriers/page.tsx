"use client";

import Link from "next/link";
import { formatNumber } from "@/lib/client";
import { ResourcePage, type ResourceConfig } from "@/components/ResourcePage";
import { StatusBadge } from "@/components/ui";

const config: ResourceConfig = {
  title: "Carriers",
  singular: "carrier",
  description: "Transport providers you tender shipments to, with the contract rate used to quote each tender.",
  path: "/carriers",
  columns: [
    {
      header: "Name",
      render: (r) => (
        <Link href={`/carriers/${r.id}`} className="font-medium text-zinc-900 underline-offset-2 hover:underline">
          {r.name}
        </Link>
      ),
    },
    { header: "Code", render: (r) => r.code ?? "—" },
    { header: "Status", render: (r) => <StatusBadge status={r.status} /> },
    { header: "Base rate", numeric: true, render: (r) => formatNumber(r.baseRate, 2) },
    { header: "Per km", numeric: true, render: (r) => formatNumber(r.ratePerKm, 2) },
    { header: "Fuel surcharge", numeric: true, render: (r) => `${formatNumber(r.fuelSurchargePct, 1)}%` },
  ],
  fields: [
    { name: "name", label: "Name", required: true },
    { name: "code", label: "Code", half: true, hint: "Short identifier such as a SCAC." },
    {
      name: "status",
      label: "Status",
      type: "select",
      required: true,
      half: true,
      defaultValue: "ACTIVE",
      options: [
        { value: "ACTIVE", label: "Active" },
        { value: "INACTIVE", label: "Inactive" },
      ],
    },
    { name: "email", label: "Email", type: "email", half: true },
    { name: "phone", label: "Phone", half: true },
    { name: "baseRate", label: "Base rate per shipment", type: "number", half: true, defaultValue: 0 },
    { name: "ratePerKm", label: "Rate per km", type: "number", half: true, defaultValue: 0 },
    { name: "ratePerKg", label: "Rate per kg", type: "number", half: true, defaultValue: 0 },
    { name: "minimumCharge", label: "Minimum charge", type: "number", half: true, defaultValue: 0 },
    { name: "fuelSurchargePct", label: "Fuel surcharge %", type: "number", half: true, defaultValue: 0, hint: "Applied to the linehaul total." },
  ],
};

export default function CarriersPage() {
  return <ResourcePage config={config} />;
}
