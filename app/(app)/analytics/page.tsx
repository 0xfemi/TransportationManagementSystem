"use client";

import { useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { formatMoney, formatNumber, titleCase, useApi } from "@/lib/client";
import { useSession } from "@/components/Shell";
import { Card, EmptyState, ErrorNote, PageHeader, Spinner, Stat, Table, inputClass, td, tdNum } from "@/components/ui";

// One series per chart, so one hue. Text stays in ink colours.
const SERIES = "#2a78d6";
const GRID = "#e1e0d9";
const AXIS = "#898781";

const PERIODS = [
  { days: 7, label: "Last 7 days" },
  { days: 30, label: "Last 30 days" },
  { days: 90, label: "Last 90 days" },
];

type Summary = {
  shipments: number;
  spend: number;
  distanceKm: number;
  costPerShipment: number | null;
  costPerKm: number | null;
  onTimePct: number | null;
  deliveriesMeasured: number;
  avgTransitHours: number | null;
};

type Analytics = {
  totals: Summary & { shipmentsCreated: number; shipmentsCancelled: number; tenderAcceptancePct: number | null; tendersAnswered: number };
  daily: ({ date: string } & Summary)[];
  carriers: ({ carrierId: string | null; name: string; tendersAnswered: number; tenderAcceptancePct: number | null } & Summary)[];
  exceptionsByType: { type: string; count: number }[];
  methodology: Record<string, string>;
};

const pct = (v: number | null) => (v === null ? "—" : `${formatNumber(v, 1)}%`);
const shortDate = (iso: string) =>
  new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(`${iso}T00:00:00Z`));

function ColumnChart({ data, dataKey, format, label }: { data: Record<string, any>[]; dataKey: string; format: (v: number) => string; label: string }) {
  return (
    <div className="h-56" role="img" aria-label={`${label} per day. The same figures are in the daily table below.`}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
          <CartesianGrid vertical={false} stroke={GRID} />
          <XAxis dataKey="date" tickFormatter={shortDate} tick={{ fill: AXIS, fontSize: 11 }} tickLine={false} axisLine={{ stroke: "#c3c2b7" }} minTickGap={24} />
          <YAxis tickFormatter={format} tick={{ fill: AXIS, fontSize: 11 }} tickLine={false} axisLine={false} width={56} allowDecimals={false} />
          <Tooltip
            cursor={{ fill: "rgba(11,11,11,0.04)" }}
            content={({ active, payload }) =>
              active && payload?.length ? (
                <div className="rounded-md border border-zinc-200 bg-white px-2.5 py-1.5 text-xs shadow-sm">
                  <p className="text-zinc-500">{shortDate(payload[0].payload.date)}</p>
                  <p className="font-semibold text-zinc-900">{format(Number(payload[0].value))} <span className="font-normal text-zinc-500">{label.toLowerCase()}</span></p>
                </div>
              ) : null
            }
          />
          <Bar dataKey={dataKey} fill={SERIES} radius={[4, 4, 0, 0]} maxBarSize={24} isAnimationActive={false} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export default function AnalyticsPage() {
  const { organization } = useSession();
  const currency = organization.currency;
  const [days, setDays] = useState(30);
  const [carrierId, setCarrierId] = useState("");
  const { data: carriers } = useApi<{ data: { id: string; name: string }[] }>("/carriers?limit=200");

  // Rounded to the hour so the request URL is stable between renders.
  const from = useMemo(() => {
    const d = new Date(Date.now() - days * 86_400_000);
    d.setMinutes(0, 0, 0);
    return d.toISOString();
  }, [days]);
  const query = new URLSearchParams({ from });
  if (carrierId) query.set("carrierId", carrierId);
  const { data, error } = useApi<Analytics>(`/analytics/transportation?${query}`, { keepPreviousData: true });

  // Fill days with no deliveries so gaps in activity are visible.
  const daily = useMemo(() => {
    if (!data) return [];
    const byDate = new Map(data.daily.map((d) => [d.date, d]));
    const last = data.daily.at(-1)?.date ?? new Date().toISOString().slice(0, 10);
    const end = new Date(`${last > new Date().toISOString().slice(0, 10) ? last : new Date().toISOString().slice(0, 10)}T00:00:00Z`);
    const out = [];
    for (let t = new Date(`${from.slice(0, 10)}T00:00:00Z`).getTime(); t <= end.getTime(); t += 86_400_000) {
      const date = new Date(t).toISOString().slice(0, 10);
      out.push({ date, shipments: byDate.get(date)?.shipments ?? 0, spend: byDate.get(date)?.spend ?? 0 });
    }
    return out;
  }, [data, from]);

  return (
    <>
      <PageHeader title="Analytics" description="Transportation performance, calculated from your delivered shipments each time this page loads." />
      <div className="mb-4 flex flex-wrap gap-2">
        <select value={days} onChange={(e) => setDays(Number(e.target.value))} aria-label="Period" className={`${inputClass} max-w-[11rem]`}>
          {PERIODS.map((p) => <option key={p.days} value={p.days}>{p.label}</option>)}
        </select>
        <select value={carrierId} onChange={(e) => setCarrierId(e.target.value)} aria-label="Carrier" className={`${inputClass} max-w-[14rem]`}>
          <option value="">All carriers and own fleet</option>
          {carriers?.data.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </div>

      {error ? (
        <ErrorNote error={error} />
      ) : !data ? (
        <Spinner />
      ) : (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Stat label="Shipments delivered" value={formatNumber(data.totals.shipments)} sub={`${data.totals.shipmentsCreated} created · ${data.totals.shipmentsCancelled} cancelled`} />
            <Stat label="On-time delivery" value={pct(data.totals.onTimePct)} sub={`${data.totals.deliveriesMeasured} deliveries measured`} />
            <Stat label="Transportation spend" value={formatMoney(data.totals.spend, currency, true)} sub={`${formatNumber(data.totals.distanceKm)} km planned distance`} />
            <Stat label="Cost per shipment" value={formatMoney(data.totals.costPerShipment, currency)} />
            <Stat label="Cost per km" value={formatMoney(data.totals.costPerKm, currency)} />
            <Stat label="Average transit time" value={data.totals.avgTransitHours === null ? "—" : `${formatNumber(data.totals.avgTransitHours, 1)} h`} />
            <Stat label="Tender acceptance" value={pct(data.totals.tenderAcceptancePct)} sub={`${data.totals.tendersAnswered} tenders answered`} />
            <Stat label="Exceptions raised" value={formatNumber(data.exceptionsByType.reduce((sum, e) => sum + e.count, 0))} />
          </div>

          {data.totals.shipments === 0 ? (
            <Card><EmptyState title="No deliveries in this period" hint="Charts appear once shipments have been delivered. Try a longer period." /></Card>
          ) : (
            <div className="grid gap-4 lg:grid-cols-2">
              <Card title="Shipments delivered per day">
                <ColumnChart data={daily} dataKey="shipments" format={(v) => formatNumber(v)} label="Delivered" />
              </Card>
              <Card title={`Transportation spend per day (${currency})`}>
                <ColumnChart data={daily} dataKey="spend" format={(v) => formatMoney(v, currency, true)} label="Spend" />
              </Card>
            </div>
          )}

          <Card title="Carrier performance" padded={false}>
            {data.carriers.length === 0 ? (
              <EmptyState title="No carrier activity in this period" />
            ) : (
              <Table right={[1, 2, 3, 4, 5, 6, 7]} head={["Carrier", "Shipments", "On-time delivery", "Tender acceptance", "Avg transit", "Spend", "Cost / shipment", "Cost / km"]}>
                {data.carriers.map((c) => (
                  <tr key={c.carrierId ?? "own"}>
                    <td className={`${td} font-medium text-zinc-900`}>{c.name}</td>
                    <td className={tdNum}>{formatNumber(c.shipments)}</td>
                    <td className={tdNum}>{pct(c.onTimePct)}<span className="text-xs text-zinc-500"> of {c.deliveriesMeasured}</span></td>
                    <td className={tdNum}>{c.carrierId ? <>{pct(c.tenderAcceptancePct)}<span className="text-xs text-zinc-500"> of {c.tendersAnswered}</span></> : "n/a"}</td>
                    <td className={tdNum}>{c.avgTransitHours === null ? "—" : `${formatNumber(c.avgTransitHours, 1)} h`}</td>
                    <td className={tdNum}>{formatMoney(c.spend, currency)}</td>
                    <td className={tdNum}>{formatMoney(c.costPerShipment, currency)}</td>
                    <td className={tdNum}>{formatMoney(c.costPerKm, currency)}</td>
                  </tr>
                ))}
              </Table>
            )}
            <p className="border-t border-zinc-100 px-4 py-2 text-xs text-zinc-500">Sorted by shipment count. These are measured figures, not a ranking.</p>
          </Card>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card title="Exceptions by type" padded={false}>
              {data.exceptionsByType.length === 0 ? (
                <EmptyState title="No exceptions in this period" />
              ) : (
                <Table compact right={[1]} head={["Type", "Count"]}>
                  {data.exceptionsByType.map((e) => (
                    <tr key={e.type}>
                      <td className={td}>{titleCase(e.type)}</td>
                      <td className={tdNum}>{e.count}</td>
                    </tr>
                  ))}
                </Table>
              )}
            </Card>
            <Card title="How these figures are calculated">
              <dl className="space-y-2 text-sm">
                {Object.entries(data.methodology).map(([key, text]) => (
                  <div key={key}>
                    <dt className="font-medium text-zinc-900">{titleCase(key.replace(/([A-Z])/g, " $1"))}</dt>
                    <dd className="text-zinc-600">{text}</dd>
                  </div>
                ))}
              </dl>
            </Card>
          </div>

          {data.daily.length > 0 && (
            <Card title="Daily figures" padded={false}>
              <Table right={[1, 2, 3, 4]} head={["Date (UTC)", "Delivered", "On-time", "Spend", "Distance"]}>
                {[...data.daily].reverse().map((d) => (
                  <tr key={d.date}>
                    <td className={td}>{shortDate(d.date)}</td>
                    <td className={tdNum}>{d.shipments}</td>
                    <td className={tdNum}>{pct(d.onTimePct)}</td>
                    <td className={tdNum}>{formatMoney(d.spend, currency)}</td>
                    <td className={tdNum}>{formatNumber(d.distanceKm)} km</td>
                  </tr>
                ))}
              </Table>
            </Card>
          )}
        </div>
      )}
    </>
  );
}
