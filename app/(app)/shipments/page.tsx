"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { formatDateTime, formatMoney, formatNumber, titleCase, useApi } from "@/lib/client";
import { useSession } from "@/components/Shell";
import { Badge, Card, EmptyState, ErrorNote, PageHeader, Spinner, StatusBadge, Table, inputClass, td, tdNum } from "@/components/ui";

const FILTERS = [
  { value: "", label: "All shipments" },
  { value: "DRAFT", label: "Draft" },
  { value: "PLANNED,TENDERED,ACCEPTED", label: "Awaiting dispatch" },
  { value: "DISPATCHED,IN_TRANSIT", label: "In transit" },
  { value: "DELIVERED", label: "Delivered" },
  { value: "CANCELLED", label: "Cancelled" },
];

export default function ShipmentsPage() {
  const { organization } = useSession();
  const [status, setStatus] = useState("");
  const [delayed, setDelayed] = useState(false);
  const [q, setQ] = useState("");

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    setStatus(params.get("status") ?? "");
    setDelayed(params.get("delayed") === "true");
  }, []);

  const query = new URLSearchParams({ limit: "100" });
  if (status) query.set("status", status);
  if (delayed) query.set("delayed", "true");
  if (q) query.set("q", q);
  const { data, error } = useApi<{ data: any[]; total: number }>(`/shipments?${query}`, {
    keepPreviousData: true,
    refreshInterval: 20_000,
  });

  return (
    <>
      <PageHeader title="Shipments" description="Every movement, from draft to delivered. Open one to plan, tender, dispatch and track it." />
      <Card padded={false}>
        <div className="flex flex-wrap items-center gap-2 border-b border-zinc-100 p-3">
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search number, order, customer or carrier" aria-label="Search shipments" className={`${inputClass} max-w-xs`} />
          <select value={FILTERS.some((f) => f.value === status) ? status : ""} onChange={(e) => setStatus(e.target.value)} aria-label="Filter by status" className={`${inputClass} max-w-[12rem]`}>
            {FILTERS.map((f) => <option key={f.label} value={f.value}>{f.label}</option>)}
          </select>
          <label className="flex items-center gap-2 text-sm text-zinc-700">
            <input type="checkbox" checked={delayed} onChange={(e) => setDelayed(e.target.checked)} className="h-4 w-4 rounded border-zinc-300" />
            Running late only
          </label>
        </div>
        {error ? (
          <div className="p-4"><ErrorNote error={error} /></div>
        ) : !data ? (
          <Spinner />
        ) : data.data.length === 0 ? (
          <EmptyState
            title="No shipments match"
            hint={status || q || delayed ? "Try clearing the filters." : "Create one from an order, or plan several orders at once in Planning."}
          />
        ) : (
          <Table right={[6, 7]} head={["Shipment", "Status", "Route", "Carrier / vehicle", "Orders", "ETA / delivered", "Distance", "Cost"]}>
            {data.data.map((s) => {
              const first = s.stops[0]?.location;
              const last = s.stops[s.stops.length - 1]?.location;
              const moving = s.status === "DISPATCHED" || s.status === "IN_TRANSIT";
              return (
                <tr key={s.id} className="hover:bg-zinc-50">
                  <td className={td}>
                    <Link href={`/shipments/${s.id}`} className="font-medium text-zinc-900 underline-offset-2 hover:underline">{s.number}</Link>
                  </td>
                  <td className={td}>
                    <span className="flex items-center gap-1.5">
                      <StatusBadge status={s.status} />
                      {moving && s.delayMinutes >= 15 && <Badge tone="red">{s.delayMinutes} min late</Badge>}
                    </span>
                  </td>
                  <td className={td}>
                    {first ? `${first.city ?? first.name} → ${last.city ?? last.name}` : "—"}
                    <span className="text-zinc-500"> · {s.stops.length} stops</span>
                  </td>
                  <td className={td}>{s.carrier?.name ?? s.vehicle?.name ?? <span className="text-zinc-400">Unassigned</span>}</td>
                  <td className={td}>
                    {s.orders.slice(0, 2).map((o: any) => o.number).join(", ")}
                    {s.orders.length > 2 ? ` +${s.orders.length - 2}` : ""}
                  </td>
                  <td className={td}>
                    {s.status === "DELIVERED"
                      ? formatDateTime(s.actualEnd, organization.timezone)
                      : s.status === "CANCELLED"
                        ? "—"
                        : formatDateTime(s.currentEta, organization.timezone)}
                  </td>
                  <td className={tdNum}>{s.plannedDistanceKm ? `${formatNumber(s.plannedDistanceKm)} km` : "—"}</td>
                  <td className={tdNum}>{formatMoney(s.estimatedCost, organization.currency)}</td>
                </tr>
              );
            })}
          </Table>
        )}
      </Card>
      {data && data.total > data.data.length && (
        <p className="mt-2 text-xs text-zinc-500">Showing the newest {data.data.length} of {data.total}. Narrow the search to see others.</p>
      )}
    </>
  );
}
