"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowRight, RefreshCw } from "lucide-react";
import { apiFetch, formatDateTime, formatMoney, formatNumber, useApi } from "@/lib/client";
import { MapLegend, MapView, type MapLine, type MapMarker } from "@/components/MapView";
import { useSession } from "@/components/Shell";
import { Button, Card, EmptyState, ErrorNote, PageHeader, SeverityBadge, Spinner, Stat } from "@/components/ui";

type CommandCenter = {
  generatedAt: string;
  organization: { currency: string; timezone: string };
  operations: Record<string, number>;
  kpis: {
    periodDays: number;
    onTimePct: number | null;
    deliveriesMeasured: number;
    avgTransitHours: number | null;
    spend: number;
    costPerShipment: number | null;
    delivered: number;
    fleetUtilizationPct: number | null;
  };
  map: {
    shipments: {
      id: string;
      number: string;
      currentLatitude: number | null;
      currentLongitude: number | null;
      currentEta: string | null;
      delayMinutes: number;
      routeGeometry: [number, number][] | null;
      vehicle: { name: string } | null;
      carrier: { name: string } | null;
    }[];
    vehicles: { id: string; name: string; vehicleType: string; status: string; latitude: number; longitude: number }[];
    locations: { id: string; name: string; type: string; latitude: number; longitude: number }[];
  };
  exceptions: {
    id: string;
    severity: string;
    status: string;
    title: string;
    impact: string;
    recommendedAction: string;
    detectedAt: string;
    shipment: { id: string; number: string } | null;
  }[];
};

export default function CommandCenterPage() {
  const { can } = useSession();
  const { data, error, mutate, isValidating } = useApi<CommandCenter>("/command-center", { refreshInterval: 15_000 });
  const [busy, setBusy] = useState<string | null>(null);
  const [actionError, setActionError] = useState<unknown>(null);

  if (error && !data) return <ErrorNote error={error} />;
  if (!data) return <Spinner />;

  const { operations: ops, kpis, map } = data;
  const tz = data.organization.timezone;
  const currency = data.organization.currency;

  const markers: MapMarker[] = [
    ...map.locations.map((l) => ({
      id: l.id,
      latitude: l.latitude,
      longitude: l.longitude,
      kind: l.type === "WAREHOUSE" || l.type === "DEPOT" ? ("warehouse" as const) : ("location" as const),
      label: l.name,
      detail: l.type === "WAREHOUSE" ? "Warehouse" : "Location",
    })),
    // Vehicles out on a shipment are drawn as that shipment instead.
    ...map.vehicles
      .filter((v) => v.status !== "IN_USE")
      .map((v) => ({
        id: v.id,
        latitude: v.latitude,
        longitude: v.longitude,
        kind: "vehicle" as const,
        label: v.name,
        detail: `${v.vehicleType} · ${v.status.toLowerCase().replace("_", " ")}`,
      })),
    ...map.shipments
      .filter((s) => s.currentLatitude !== null && s.currentLongitude !== null)
      .map((s) => ({
        id: s.id,
        latitude: s.currentLatitude!,
        longitude: s.currentLongitude!,
        kind: "shipment" as const,
        tone: s.delayMinutes >= 15 ? ("late" as const) : undefined,
        label: s.number,
        detail: [
          s.vehicle?.name ?? s.carrier?.name,
          s.delayMinutes >= 15 ? `${s.delayMinutes} min late` : "On schedule",
          s.currentEta ? `ETA ${formatDateTime(s.currentEta, tz)}` : null,
        ]
          .filter(Boolean)
          .join(" · "),
        href: `/shipments/${s.id}`,
      })),
  ];
  const lines: MapLine[] = map.shipments
    .filter((s) => s.routeGeometry?.length)
    .map((s) => ({ id: s.id, points: s.routeGeometry!, tone: s.delayMinutes >= 15 ? "late" : "planned" }));

  const act = async (id: string, status: "INVESTIGATING" | "RESOLVED") => {
    setBusy(id);
    setActionError(null);
    try {
      await apiFetch(`/exceptions/${id}`, { method: "PATCH", body: { status } });
      await mutate();
    } catch (err) {
      setActionError(err);
    } finally {
      setBusy(null);
    }
  };

  return (
    <>
      <PageHeader
        title="Command Center"
        description={`Live from your operation. Updated ${formatDateTime(data.generatedAt, tz)}.`}
        actions={
          <Button onClick={() => mutate()} loading={isValidating} variant="ghost">
            {!isValidating && <RefreshCw className="h-3.5 w-3.5" aria-hidden />} Refresh
          </Button>
        }
      />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <Link href="/shipments?status=DISPATCHED,IN_TRANSIT"><Stat label="In transit" value={ops.inTransit} /></Link>
        <Link href="/shipments?delayed=true"><Stat label="Running late" value={ops.delayed} tone={ops.delayed ? "alert" : undefined} sub="15+ min behind" /></Link>
        <Link href="/exceptions"><Stat label="Open exceptions" value={ops.openExceptions} tone={ops.openExceptions ? "alert" : undefined} /></Link>
        <Link href="/shipments?status=PLANNED,TENDERED,ACCEPTED"><Stat label="Awaiting dispatch" value={ops.awaitingDispatch} /></Link>
        <Stat label="Deliveries due today" value={ops.deliveriesDueToday} />
        <Link href="/orders?status=OPEN"><Stat label="Orders to plan" value={ops.unplannedOrders} /></Link>
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-3">
        <Card
          title="Network map"
          padded={false}
          className="xl:col-span-2"
          action={<span className="text-xs text-zinc-500">{map.shipments.length} moving · {ops.vehiclesAvailable} vehicles available</span>}
        >
          <MapView markers={markers} lines={lines} height={440} fitKey={`${map.shipments.length}-${map.locations.length}`} />
          <MapLegend
            items={[
              { glyph: "▲", label: "Shipment on schedule" },
              { glyph: "▲", label: "Shipment running late", late: true },
              { glyph: "●", label: "Idle vehicle" },
              { glyph: "■", label: "Warehouse" },
              { glyph: "◆", label: "Other location" },
            ]}
          />
        </Card>

        <Card
          title="Needs attention"
          padded={false}
          action={<Link href="/exceptions" className="text-xs font-medium text-zinc-600 hover:text-zinc-900">View all</Link>}
        >
          {actionError ? <div className="p-3"><ErrorNote error={actionError} /></div> : null}
          {data.exceptions.length === 0 ? (
            <EmptyState title="Nothing needs attention" hint="Late shipments, rejected tenders and reported problems appear here as they happen." />
          ) : (
            <ul className="max-h-[480px] divide-y divide-zinc-100 overflow-y-auto">
              {data.exceptions.map((e) => (
                <li key={e.id} className="space-y-1.5 px-4 py-3">
                  <div className="flex items-center gap-2">
                    <SeverityBadge severity={e.severity} />
                    <span className="text-xs text-zinc-500">{formatDateTime(e.detectedAt, tz)}</span>
                    {e.status === "INVESTIGATING" && <span className="text-xs text-amber-800">Being investigated</span>}
                  </div>
                  <p className="text-sm font-medium text-zinc-900">{e.title}</p>
                  <p className="text-sm text-zinc-600">{e.impact}</p>
                  <p className="text-sm text-zinc-800"><span className="font-medium">Recommended:</span> {e.recommendedAction}</p>
                  <div className="flex flex-wrap gap-2 pt-1">
                    {e.shipment && (
                      <Link href={`/shipments/${e.shipment.id}`} className="inline-flex h-7 items-center gap-1 rounded-md bg-zinc-900 px-2.5 text-xs font-medium text-white hover:bg-zinc-700">
                        Open {e.shipment.number} <ArrowRight className="h-3 w-3" aria-hidden />
                      </Link>
                    )}
                    {can("exceptions:write") && e.status === "OPEN" && (
                      <Button size="sm" loading={busy === e.id} onClick={() => act(e.id, "INVESTIGATING")}>Investigate</Button>
                    )}
                    {can("exceptions:write") && (
                      <Button size="sm" loading={busy === e.id} onClick={() => act(e.id, "RESOLVED")}>Resolve</Button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <h2 className="mb-2 mt-6 text-sm font-semibold text-zinc-900">Last {kpis.periodDays} days</h2>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <Stat
          label="On-time delivery"
          value={kpis.onTimePct === null ? "—" : `${formatNumber(kpis.onTimePct, 1)}%`}
          sub={`${kpis.deliveriesMeasured} deliveries measured`}
        />
        <Stat label="Shipments delivered" value={formatNumber(kpis.delivered)} />
        <Stat label="Transportation spend" value={formatMoney(kpis.spend, currency, true)} />
        <Stat label="Cost per shipment" value={formatMoney(kpis.costPerShipment, currency)} />
        <Stat label="Average transit time" value={kpis.avgTransitHours === null ? "—" : `${formatNumber(kpis.avgTransitHours, 1)} h`} />
        <Stat
          label="Fleet in use now"
          value={kpis.fleetUtilizationPct === null ? "—" : `${formatNumber(kpis.fleetUtilizationPct)}%`}
          sub={`${ops.vehiclesActive} active · ${formatNumber(ops.availableCapacityKg)} kg free`}
        />
      </div>
    </>
  );
}
