import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { toCsv } from "@/lib/csv";

/** A delivery this many minutes past its deadline still counts as on time. */
export const ON_TIME_GRACE_MIN = 15;

const MIN_MS = 60_000;
const pct = (part: number, whole: number) => (whole ? (part / whole) * 100 : null);
const avg = (values: number[]) =>
  values.length ? values.reduce((sum, v) => sum + v, 0) / values.length : null;

export type AnalyticsFilter = {
  from: Date;
  /** Exclusive upper bound. Left out, the period is open-ended. */
  to?: Date;
  carrierId?: string;
  customerId?: string;
};

export const METHODOLOGY = {
  period: "Shipments are counted in the period in which they were delivered.",
  onTime: `A delivery stop is on time when the vehicle arrived no more than ${ON_TIME_GRACE_MIN} minutes after the end of its delivery window, or after its planned arrival when the order has no window. Stops with neither are left out.`,
  spend: "Spend is the carrier's quoted cost or the own-fleet running cost for delivered shipments. Carrier invoices are not yet reconciled against it.",
  distance: "Distance is the planned route distance from the routing provider, not odometer distance.",
  tenderAcceptance: "Accepted tenders divided by tenders the carrier answered in the period.",
};

/** Transportation KPIs, computed from stored shipments on every request. */
export async function transportationAnalytics(organizationId: string, filter: AnalyticsFilter) {
  const scope: Prisma.ShipmentWhereInput = {
    organizationId,
    ...(filter.carrierId ? { carrierId: filter.carrierId } : {}),
    ...(filter.customerId ? { orders: { some: { customerId: filter.customerId } } } : {}),
  };
  const inPeriod = { gte: filter.from, ...(filter.to ? { lt: filter.to } : {}) };

  const [delivered, created, cancelled, tenders, exceptions] = await Promise.all([
    prisma.shipment.findMany({
      where: { ...scope, status: "DELIVERED", actualEnd: inPeriod },
      select: {
        id: true,
        carrierId: true,
        carrier: { select: { name: true } },
        actualStart: true,
        actualEnd: true,
        plannedDistanceKm: true,
        actualCost: true,
        estimatedCost: true,
        stops: {
          where: { type: "DELIVERY" },
          select: { actualArrival: true, windowEnd: true, plannedArrival: true },
        },
      },
    }),
    prisma.shipment.count({ where: { ...scope, createdAt: inPeriod } }),
    prisma.shipment.count({ where: { ...scope, status: "CANCELLED", updatedAt: inPeriod } }),
    prisma.tender.findMany({
      where: {
        organizationId,
        sentAt: inPeriod,
        ...(filter.carrierId ? { carrierId: filter.carrierId } : {}),
      },
      select: { carrierId: true, status: true, carrier: { select: { name: true } } },
    }),
    prisma.shipmentException.groupBy({
      by: ["type"],
      where: { organizationId, detectedAt: inPeriod },
      _count: true,
    }),
  ]);

  type Bucket = {
    shipments: number;
    spend: number;
    costedShipments: number;
    costedKm: number;
    distanceKm: number;
    onTime: number;
    measured: number;
    transitHours: number[];
  };
  const bucket = (): Bucket => ({
    shipments: 0,
    spend: 0,
    costedShipments: 0,
    costedKm: 0,
    distanceKm: 0,
    onTime: 0,
    measured: 0,
    transitHours: [],
  });

  const total = bucket();
  const byDay = new Map<string, Bucket>();
  const byCarrier = new Map<string, Bucket & { name: string; carrierId: string | null }>();

  for (const shipment of delivered) {
    const day = shipment.actualEnd!.toISOString().slice(0, 10);
    const carrierKey = shipment.carrierId ?? "own-fleet";
    if (!byDay.has(day)) byDay.set(day, bucket());
    if (!byCarrier.has(carrierKey)) {
      byCarrier.set(carrierKey, {
        ...bucket(),
        name: shipment.carrier?.name ?? "Own fleet",
        carrierId: shipment.carrierId,
      });
    }
    const cost = shipment.actualCost ?? shipment.estimatedCost;
    const km = shipment.plannedDistanceKm ?? 0;

    for (const b of [total, byDay.get(day)!, byCarrier.get(carrierKey)!]) {
      b.shipments += 1;
      b.distanceKm += km;
      if (cost !== null) {
        b.spend += cost;
        b.costedShipments += 1;
        b.costedKm += km;
      }
      if (shipment.actualStart && shipment.actualEnd) {
        b.transitHours.push((shipment.actualEnd.getTime() - shipment.actualStart.getTime()) / 3_600_000);
      }
      for (const stop of shipment.stops) {
        const deadline = stop.windowEnd ?? stop.plannedArrival;
        if (!deadline || !stop.actualArrival) continue;
        b.measured += 1;
        if (stop.actualArrival.getTime() <= deadline.getTime() + ON_TIME_GRACE_MIN * MIN_MS) b.onTime += 1;
      }
    }
  }

  const tendersByCarrier = new Map<string, { accepted: number; rejected: number; pending: number }>();
  for (const tender of tenders) {
    const entry = tendersByCarrier.get(tender.carrierId) ?? { accepted: 0, rejected: 0, pending: 0 };
    if (tender.status === "ACCEPTED") entry.accepted += 1;
    else if (tender.status === "REJECTED") entry.rejected += 1;
    else if (tender.status === "SENT") entry.pending += 1;
    tendersByCarrier.set(tender.carrierId, entry);
    if (!byCarrier.has(tender.carrierId)) {
      byCarrier.set(tender.carrierId, { ...bucket(), name: tender.carrier.name, carrierId: tender.carrierId });
    }
  }

  const summarize = (b: Bucket) => ({
    shipments: b.shipments,
    spend: b.spend,
    distanceKm: b.distanceKm,
    costPerShipment: b.costedShipments ? b.spend / b.costedShipments : null,
    costPerKm: b.costedKm ? b.spend / b.costedKm : null,
    onTimePct: pct(b.onTime, b.measured),
    deliveriesMeasured: b.measured,
    avgTransitHours: avg(b.transitHours),
  });

  const answered = tenders.filter((t) => t.status === "ACCEPTED" || t.status === "REJECTED");

  return {
    period: { from: filter.from, to: filter.to ?? null },
    totals: {
      ...summarize(total),
      shipmentsCreated: created,
      shipmentsCancelled: cancelled,
      tenderAcceptancePct: pct(answered.filter((t) => t.status === "ACCEPTED").length, answered.length),
      tendersAnswered: answered.length,
    },
    daily: [...byDay.entries()]
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .map(([date, b]) => ({ date, ...summarize(b) })),
    carriers: [...byCarrier.values()]
      .map((b) => {
        const t = b.carrierId ? tendersByCarrier.get(b.carrierId) : undefined;
        return {
          carrierId: b.carrierId,
          name: b.name,
          ...summarize(b),
          tendersAnswered: t ? t.accepted + t.rejected : 0,
          tenderAcceptancePct: t ? pct(t.accepted, t.accepted + t.rejected) : null,
        };
      })
      .sort((a, b) => b.shipments - a.shipments || a.name.localeCompare(b.name)),
    exceptionsByType: exceptions
      .map((e) => ({ type: e.type, count: e._count }))
      .sort((a, b) => b.count - a.count),
    methodology: METHODOLOGY,
  };
}

const round = (value: number | null, digits = 2) =>
  value === null ? null : Math.round(value * 10 ** digits) / 10 ** digits;

const SUMMARY_COLUMNS = [
  "shipments",
  "spend",
  "distance_km",
  "cost_per_shipment",
  "cost_per_km",
  "on_time_pct",
  "deliveries_measured",
  "avg_transit_hours",
];

type Analytics = Awaited<ReturnType<typeof transportationAnalytics>>;

const summaryCells = (s: Omit<Analytics["daily"][number], "date">) => [
  s.shipments,
  round(s.spend),
  round(s.distanceKm, 1),
  round(s.costPerShipment),
  round(s.costPerKm),
  round(s.onTimePct, 1),
  s.deliveriesMeasured,
  round(s.avgTransitHours, 1),
];

/** One analytics table as CSV, with the same figures and method as the JSON. */
export function analyticsCsv(result: Analytics, table: "daily" | "carriers"): string {
  if (table === "carriers") {
    return toCsv(
      ["carrier", ...SUMMARY_COLUMNS, "tenders_answered", "tender_acceptance_pct"],
      result.carriers.map((c) => [c.name, ...summaryCells(c), c.tendersAnswered, round(c.tenderAcceptancePct, 1)]),
    );
  }
  return toCsv(
    ["date", ...SUMMARY_COLUMNS],
    result.daily.map((d) => [d.date, ...summaryCells(d)]),
  );
}
