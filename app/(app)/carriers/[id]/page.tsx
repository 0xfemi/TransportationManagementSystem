"use client";

import Link from "next/link";
import { formatDateTime, formatMoney, formatNumber, useApi } from "@/lib/client";
import { useSession } from "@/components/Shell";
import { Card, EmptyState, ErrorNote, PageHeader, Spinner, Stat, StatusBadge, Table, td, tdNum } from "@/components/ui";

const pct = (v: number | null) => (v === null ? "—" : `${formatNumber(v, 1)}%`);

export default function CarrierPage({ params }: { params: { id: string } }) {
  const { can, organization } = useSession();
  const currency = organization.currency;
  const { data: carrier, error } = useApi<any>(`/carriers/${params.id}`);
  const { data: score } = useApi<any>(can("analytics:read") ? `/carriers/${params.id}/scorecard` : null);
  const { data: shipments } = useApi<{ data: any[] }>(`/shipments?carrierId=${params.id}&limit=20`);

  if (error) return <ErrorNote error={error} />;
  if (!carrier) return <Spinner />;

  const rate = (label: string, value: string) => (
    <div className="flex justify-between py-1.5 text-sm">
      <dt className="text-zinc-500">{label}</dt>
      <dd className="tabular-nums text-zinc-900">{value}</dd>
    </div>
  );

  return (
    <>
      <PageHeader
        title={carrier.name}
        description={[carrier.code, carrier.email, carrier.phone].filter(Boolean).join(" · ") || "No contact details recorded"}
        actions={
          <>
            <StatusBadge status={carrier.status} />
            <Link href={`/carriers?q=${encodeURIComponent(carrier.name)}`} className="text-sm font-medium text-zinc-700 underline underline-offset-2">
              Edit in carrier list
            </Link>
          </>
        }
      />

      {score && (
        <>
          <h2 className="mb-2 text-sm font-semibold text-zinc-900">Scorecard · last {score.periodDays} days</h2>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
            <Stat label="Shipments delivered" value={formatNumber(score.shipments)} />
            <Stat label="On-time delivery" value={pct(score.onTimePct)} sub={`${score.deliveriesMeasured} deliveries measured`} />
            <Stat label="Tender acceptance" value={pct(score.tenderAcceptancePct)} sub={`${score.tendersAnswered} tenders answered`} />
            <Stat label="Average transit time" value={score.avgTransitHours === null ? "—" : `${formatNumber(score.avgTransitHours, 1)} h`} />
            <Stat label="Spend" value={formatMoney(score.spend, currency, true)} sub={`${formatMoney(score.costPerKm, currency)} per km`} />
          </div>
          <p className="mt-2 text-xs text-zinc-500">{score.methodology.onTime} {score.methodology.tenderAcceptance}</p>
        </>
      )}

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <Card title="Contract rate">
          <dl className="divide-y divide-zinc-100">
            {rate("Base rate per shipment", formatMoney(carrier.baseRate, currency))}
            {rate("Per km", formatMoney(carrier.ratePerKm, currency))}
            {rate("Per kg", formatMoney(carrier.ratePerKg, currency))}
            {rate("Minimum charge", formatMoney(carrier.minimumCharge, currency))}
            {rate("Fuel surcharge", `${formatNumber(carrier.fuelSurchargePct, 1)}%`)}
          </dl>
        </Card>
        <Card title="Recent shipments" padded={false} className="lg:col-span-2">
          {!shipments ? (
            <Spinner />
          ) : shipments.data.length === 0 ? (
            <EmptyState title="No shipments with this carrier yet" />
          ) : (
            <Table head={["Shipment", "Status", "Created", "Distance", "Cost"]}>
              {shipments.data.map((s) => (
                <tr key={s.id}>
                  <td className={td}><Link href={`/shipments/${s.id}`} className="font-medium underline-offset-2 hover:underline">{s.number}</Link></td>
                  <td className={td}><StatusBadge status={s.status} /></td>
                  <td className={td}>{formatDateTime(s.createdAt, organization.timezone)}</td>
                  <td className={tdNum}>{s.plannedDistanceKm ? `${formatNumber(s.plannedDistanceKm)} km` : "—"}</td>
                  <td className={tdNum}>{formatMoney(s.estimatedCost, currency)}</td>
                </tr>
              ))}
            </Table>
          )}
        </Card>
      </div>
    </>
  );
}
