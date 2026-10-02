import { prisma } from "@/lib/prisma";
import { dayBounds } from "@/lib/time";
import { transportationAnalytics } from "@/modules/analytics/service";
import { sweepStaleTenders } from "@/modules/exceptions/service";
import { DELAY_THRESHOLD_MIN } from "@/modules/tracking/service";

const SEVERITY_RANK = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 } as const;
const KPI_DAYS = 30;

/** Everything the Command Center shows, read live from the database. */
export async function commandCenter(organizationId: string, now = new Date()) {
  await sweepStaleTenders(organizationId, now);
  const organization = await prisma.organization.findUniqueOrThrow({ where: { id: organizationId } });
  const today = dayBounds(now, organization.timezone);
  const active = { in: ["DISPATCHED", "IN_TRANSIT"] as ("DISPATCHED" | "IN_TRANSIT")[] };

  const [
    statusCounts,
    delayed,
    dueToday,
    openOrders,
    vehicles,
    activeShipments,
    locations,
    exceptions,
    openExceptionCount,
    kpis,
  ] = await Promise.all([
    prisma.shipment.groupBy({ by: ["status"], where: { organizationId }, _count: true }),
    prisma.shipment.count({
      where: { organizationId, status: active, delayMinutes: { gte: DELAY_THRESHOLD_MIN } },
    }),
    prisma.stop.count({
      where: {
        organizationId,
        type: "DELIVERY",
        status: { not: "COMPLETED" },
        shipment: { status: { notIn: ["CANCELLED", "DELIVERED"] } },
        OR: [
          { windowEnd: { gte: today.start, lt: today.end } },
          { windowEnd: null, plannedArrival: { gte: today.start, lt: today.end } },
        ],
      },
    }),
    prisma.order.count({ where: { organizationId, status: "OPEN" } }),
    prisma.vehicle.findMany({
      where: { organizationId, deletedAt: null },
      select: {
        id: true,
        name: true,
        vehicleType: true,
        status: true,
        capacityKg: true,
        lastLatitude: true,
        lastLongitude: true,
        lastSeenAt: true,
        homeLocation: { select: { latitude: true, longitude: true } },
      },
    }),
    prisma.shipment.findMany({
      where: { organizationId, status: active },
      select: {
        id: true,
        number: true,
        status: true,
        currentLatitude: true,
        currentLongitude: true,
        lastPositionAt: true,
        currentEta: true,
        delayMinutes: true,
        routeGeometry: true,
        vehicle: { select: { name: true } },
        carrier: { select: { name: true } },
        stops: {
          orderBy: { sequence: "asc" },
          select: {
            id: true,
            type: true,
            status: true,
            location: { select: { name: true, latitude: true, longitude: true } },
          },
        },
      },
      orderBy: { delayMinutes: "desc" },
      take: 200,
    }),
    prisma.location.findMany({
      where: { organizationId, deletedAt: null },
      select: { id: true, name: true, type: true, latitude: true, longitude: true },
      take: 500,
    }),
    prisma.shipmentException.findMany({
      where: { organizationId, status: { in: ["OPEN", "INVESTIGATING"] } },
      include: { shipment: { select: { id: true, number: true } } },
      orderBy: { detectedAt: "desc" },
      take: 100,
    }),
    prisma.shipmentException.count({
      where: { organizationId, status: { in: ["OPEN", "INVESTIGATING"] } },
    }),
    transportationAnalytics(organizationId, {
      from: new Date(now.getTime() - KPI_DAYS * 86_400_000),
    }),
  ]);

  const count = (...statuses: string[]) =>
    statusCounts.filter((s) => statuses.includes(s.status)).reduce((sum, s) => sum + s._count, 0);
  const usable = vehicles.filter((v) => v.status === "AVAILABLE" || v.status === "IN_USE");
  const inUse = vehicles.filter((v) => v.status === "IN_USE");
  const available = vehicles.filter((v) => v.status === "AVAILABLE");

  return {
    generatedAt: now,
    organization: { name: organization.name, currency: organization.currency, timezone: organization.timezone },
    operations: {
      inTransit: count("DISPATCHED", "IN_TRANSIT"),
      awaitingDispatch: count("PLANNED", "TENDERED", "ACCEPTED"),
      drafts: count("DRAFT"),
      deliveriesDueToday: dueToday,
      delayed,
      openExceptions: openExceptionCount,
      unplannedOrders: openOrders,
      vehiclesActive: inUse.length,
      vehiclesAvailable: available.length,
      availableCapacityKg: available.reduce((sum, v) => sum + v.capacityKg, 0),
    },
    kpis: {
      periodDays: KPI_DAYS,
      onTimePct: kpis.totals.onTimePct,
      deliveriesMeasured: kpis.totals.deliveriesMeasured,
      avgTransitHours: kpis.totals.avgTransitHours,
      spend: kpis.totals.spend,
      costPerShipment: kpis.totals.costPerShipment,
      delivered: kpis.totals.shipments,
      fleetUtilizationPct: usable.length ? (inUse.length / usable.length) * 100 : null,
    },
    map: {
      shipments: activeShipments,
      vehicles: vehicles
        .filter((v) => v.status !== "INACTIVE")
        .map((v) => ({
          id: v.id,
          name: v.name,
          vehicleType: v.vehicleType,
          status: v.status,
          lastSeenAt: v.lastSeenAt,
          latitude: v.lastLatitude ?? v.homeLocation?.latitude ?? null,
          longitude: v.lastLongitude ?? v.homeLocation?.longitude ?? null,
        }))
        .filter((v) => v.latitude !== null && v.longitude !== null),
      locations,
    },
    exceptions: exceptions
      .sort(
        (a, b) =>
          SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] ||
          b.detectedAt.getTime() - a.detectedAt.getTime(),
      )
      .slice(0, 20),
  };
}
