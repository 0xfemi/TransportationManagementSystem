"use client";

import { useState } from "react";
import Link from "next/link";
import clsx from "clsx";
import { apiFetch, formatDateTime, formatDuration, formatMoney, formatNumber, toLocalInput, useApi } from "@/lib/client";
import { MapView, type MapLine, type MapMarker } from "@/components/MapView";
import { useSession } from "@/components/Shell";
import { Button, Card, EmptyState, ErrorNote, Field, PageHeader, Spinner, StatusBadge, inputClass } from "@/components/ui";

const OBJECTIVE_LABELS: Record<string, string> = {
  cost: "Lowest cost",
  distance: "Shortest distance",
  time: "Fastest completion",
};

type Alternative = {
  objective: string;
  objectives: string[];
  routingProvider: string;
  totals: { distanceKm: number; durationMin: number; cost: number };
  unassigned: { orderId: string; orderNumber: string; reason: string }[];
  routes: {
    vehicle: { id: string; name: string; capacityKg: number };
    distanceKm: number;
    durationMin: number;
    cost: number;
    peakLoadKg: number;
    geometry: [number, number][];
    stops: {
      orderNumber: string;
      kind: "pickup" | "delivery";
      location: { id: string; name: string; latitude: number; longitude: number };
      arrival: string;
      waitMinutes: number;
    }[];
  }[];
};

export default function PlanningPage() {
  const { organization } = useSession();
  const tz = organization.timezone;
  const { data: orders, mutate: mutateOrders } = useApi<{ data: any[] }>("/orders?status=OPEN&limit=200");
  const { data: vehicles, mutate: mutateVehicles } = useApi<{ data: any[] }>("/vehicles?status=AVAILABLE&limit=200");
  const [orderIds, setOrderIds] = useState<string[]>([]);
  const [vehicleIds, setVehicleIds] = useState<string[]>([]);
  const [departAt, setDepartAt] = useState(toLocalInput(new Date()));
  const [proposal, setProposal] = useState<{ alternatives: Alternative[] } | null>(null);
  const [chosen, setChosen] = useState(0);
  const [busy, setBusy] = useState<"propose" | "commit" | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [created, setCreated] = useState<{ shipments: { id: string; number: string; vehicle: string }[]; unassigned: { orderNumber: string; reason: string }[] } | null>(null);

  const toggle = (list: string[], set: (v: string[]) => void, id: string) => {
    set(list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);
    setProposal(null);
  };
  const input = () => ({ orderIds, vehicleIds, departAt: new Date(departAt).toISOString() });

  const propose = async () => {
    setBusy("propose");
    setError(null);
    setCreated(null);
    try {
      setProposal(await apiFetch("/routes/optimize", { body: input() }));
      setChosen(0);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(null);
    }
  };

  const commit = async (objective: string) => {
    setBusy("commit");
    setError(null);
    try {
      setCreated(await apiFetch("/routes/commit", { body: { ...input(), objective } }));
      setProposal(null);
      setOrderIds([]);
      setVehicleIds([]);
      await Promise.all([mutateOrders(), mutateVehicles()]);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(null);
    }
  };

  if (!orders || !vehicles) return <Spinner />;
  const alternative = proposal?.alternatives[chosen];

  const markers: MapMarker[] = [];
  const lines: MapLine[] = [];
  alternative?.routes.forEach((route) => {
    lines.push({ id: route.vehicle.id, points: route.geometry });
    route.stops.forEach((stop, i) => {
      if (markers.some((m) => m.id === `${stop.location.id}-${stop.kind}`)) return;
      markers.push({
        id: `${stop.location.id}-${stop.kind}`,
        latitude: stop.location.latitude,
        longitude: stop.location.longitude,
        kind: stop.kind,
        label: stop.location.name,
        detail: `${route.vehicle.name} · stop ${i + 1}`,
      });
    });
  });

  return (
    <>
      <PageHeader
        title="Planning"
        description="Choose open orders and available vehicles. The optimizer groups orders into shipments, sequences the stops and proposes alternatives. Nothing is saved until you approve a plan."
      />

      {created && (
        <div role="status" className="mb-4 rounded-md border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-900">
          <p className="font-medium">Plan approved: {created.shipments.length} shipment{created.shipments.length === 1 ? "" : "s"} created.</p>
          <ul className="mt-1 space-y-0.5">
            {created.shipments.map((s) => (
              <li key={s.id}>
                <Link href={`/shipments/${s.id}`} className="font-medium underline underline-offset-2">{s.number}</Link> on {s.vehicle}
              </li>
            ))}
          </ul>
          {created.unassigned.length > 0 && (
            <p className="mt-1">Left open: {created.unassigned.map((u) => `${u.orderNumber} (${u.reason.toLowerCase()})`).join("; ")}.</p>
          )}
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        <Card title={`Open orders (${orderIds.length} of ${orders.data.length} selected)`} padded={false} className="lg:col-span-2"
          action={orders.data.length > 0 && (
            <Button size="sm" variant="ghost" onClick={() => { setOrderIds(orderIds.length === orders.data.length ? [] : orders.data.map((o) => o.id)); setProposal(null); }}>
              {orderIds.length === orders.data.length ? "Clear" : "Select all"}
            </Button>
          )}>
          {orders.data.length === 0 ? (
            <EmptyState title="No open orders" hint="Every order is already on a shipment." action={<Link href="/orders" className="text-sm font-medium underline">Go to orders</Link>} />
          ) : (
            <ul className="max-h-80 divide-y divide-zinc-100 overflow-y-auto">
              {orders.data.map((o) => (
                <li key={o.id}>
                  <label className="flex cursor-pointer items-center gap-3 px-4 py-2 text-sm hover:bg-zinc-50">
                    <input type="checkbox" checked={orderIds.includes(o.id)} onChange={() => toggle(orderIds, setOrderIds, o.id)} className="h-4 w-4 rounded border-zinc-300" />
                    <span className="w-24 font-medium text-zinc-900">{o.number}</span>
                    <span className="min-w-0 flex-1 truncate text-zinc-600">{o.pickupLocation.name} → {o.deliveryLocation.name}</span>
                    {o.priority !== "NORMAL" && <StatusBadge status={o.priority} />}
                    <span className="w-20 text-right tabular-nums text-zinc-600">{formatNumber(o.totalWeightKg)} kg</span>
                    <span className="hidden w-32 text-right text-xs text-zinc-500 sm:block">{o.deliveryWindowEnd ? `by ${formatDateTime(o.deliveryWindowEnd, tz)}` : "no deadline"}</span>
                  </label>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title={`Vehicles (${vehicleIds.length} selected)`} padded={false}>
          {vehicles.data.length === 0 ? (
            <EmptyState title="No vehicles available" hint="Vehicles out on a shipment or in maintenance cannot be planned." />
          ) : (
            <ul className="max-h-56 divide-y divide-zinc-100 overflow-y-auto">
              {vehicles.data.map((v) => (
                <li key={v.id}>
                  <label className="flex cursor-pointer items-center gap-3 px-4 py-2 text-sm hover:bg-zinc-50">
                    <input type="checkbox" checked={vehicleIds.includes(v.id)} onChange={() => toggle(vehicleIds, setVehicleIds, v.id)} className="h-4 w-4 rounded border-zinc-300" />
                    <span className="flex-1">
                      <span className="font-medium text-zinc-900">{v.name}</span>
                      <span className="block text-xs text-zinc-500">{v.vehicleType} · {formatNumber(v.capacityKg)} kg · {v.homeLocation?.name ?? "no home location"}</span>
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          )}
          <div className="space-y-3 border-t border-zinc-100 p-4">
            <Field label="Departure">
              <input type="datetime-local" value={departAt} onChange={(e) => { setDepartAt(e.target.value); setProposal(null); }} className={inputClass} />
            </Field>
            <Button variant="primary" className="w-full" loading={busy === "propose"} disabled={!orderIds.length || !vehicleIds.length || !departAt} onClick={propose}>
              Propose plans
            </Button>
          </div>
        </Card>
      </div>

      <div className="mt-4"><ErrorNote error={error} /></div>

      {proposal && alternative && (
        <div className="mt-4 space-y-4">
          <div className="grid gap-3 md:grid-cols-3">
            {proposal.alternatives.map((alt, i) => (
              <button
                key={alt.objective}
                type="button"
                onClick={() => setChosen(i)}
                aria-pressed={i === chosen}
                className={clsx("rounded-lg border bg-white p-4 text-left", i === chosen ? "border-zinc-900 ring-1 ring-zinc-900" : "border-zinc-200 hover:border-zinc-400")}
              >
                <p className="text-sm font-semibold text-zinc-900">{alt.objectives.map((o) => OBJECTIVE_LABELS[o]).join(" · ")}</p>
                <dl className="mt-2 grid grid-cols-3 gap-2 text-sm">
                  <div><dt className="text-xs text-zinc-500">Cost</dt><dd className="font-medium tabular-nums">{formatMoney(alt.totals.cost, organization.currency)}</dd></div>
                  <div><dt className="text-xs text-zinc-500">Distance</dt><dd className="font-medium tabular-nums">{formatNumber(alt.totals.distanceKm)} km</dd></div>
                  <div><dt className="text-xs text-zinc-500">Vehicle time</dt><dd className="font-medium tabular-nums">{formatDuration(alt.totals.durationMin)}</dd></div>
                </dl>
                <p className="mt-2 text-xs text-zinc-500">
                  {alt.routes.length} shipment{alt.routes.length === 1 ? "" : "s"}
                  {alt.unassigned.length ? ` · ${alt.unassigned.length} order${alt.unassigned.length === 1 ? "" : "s"} not planned` : ""}
                </p>
              </button>
            ))}
          </div>
          {proposal.alternatives.length === 1 && (
            <p className="text-sm text-zinc-500">All three objectives lead to the same plan for this selection.</p>
          )}

          <div className="grid gap-4 xl:grid-cols-2">
            <Card title="Proposed routes" padded={false} action={
              <Button variant="primary" size="sm" loading={busy === "commit"} disabled={!alternative.routes.length} onClick={() => commit(alternative.objective)}>
                Approve this plan
              </Button>
            }>
              {alternative.routes.length === 0 && <EmptyState title="No order could be planned" hint="See the reasons below, then adjust the vehicles or the departure time." />}
              {alternative.routes.map((route) => (
                <div key={route.vehicle.id} className="border-b border-zinc-100 px-4 py-3 last:border-0">
                  <p className="text-sm font-semibold text-zinc-900">{route.vehicle.name}</p>
                  <p className="text-xs text-zinc-500">
                    {formatNumber(route.distanceKm)} km · {formatDuration(route.durationMin)} · {formatMoney(route.cost, organization.currency)} · peak load {formatNumber(route.peakLoadKg)} of {formatNumber(route.vehicle.capacityKg)} kg
                  </p>
                  <ol className="mt-2 space-y-1">
                    {route.stops.map((stop, i) => (
                      <li key={i} className="flex gap-2 text-sm">
                        <span className="w-5 shrink-0 text-right tabular-nums text-zinc-400">{i + 1}</span>
                        <span className="w-28 shrink-0 text-zinc-500">{formatDateTime(stop.arrival, tz)}</span>
                        <span className="text-zinc-800">
                          {stop.kind === "pickup" ? "Pick up" : "Deliver"} {stop.orderNumber} at {stop.location.name}
                          {stop.waitMinutes > 0 && <span className="text-zinc-500"> (waits {formatDuration(stop.waitMinutes)} for the window)</span>}
                        </span>
                      </li>
                    ))}
                  </ol>
                </div>
              ))}
              {alternative.unassigned.length > 0 && (
                <div className="border-t border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
                  <p className="font-medium">Not planned — these orders stay open:</p>
                  <ul className="mt-1 space-y-0.5">
                    {alternative.unassigned.map((u) => <li key={u.orderId}>{u.orderNumber}: {u.reason}</li>)}
                  </ul>
                </div>
              )}
            </Card>
            <Card title="Map" padded={false} action={alternative.routingProvider === "haversine" ? <span className="text-xs text-zinc-500">Distances estimated from straight lines</span> : null}>
              <MapView markers={markers} lines={lines} height={420} fitKey={`${chosen}-${markers.length}`} />
            </Card>
          </div>
        </div>
      )}
    </>
  );
}
