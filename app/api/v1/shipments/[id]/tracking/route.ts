import { prisma } from "@/lib/prisma";
import { notFound } from "@/lib/errors";
import { api } from "@/lib/http";

/** Full tracking history of a shipment, oldest first. */
export const GET = api("shipments:read", async ({ auth, params }) => {
  const shipment = await prisma.shipment.findFirst({
    where: { id: params.id, organizationId: auth.organizationId },
    select: {
      id: true,
      number: true,
      status: true,
      currentLatitude: true,
      currentLongitude: true,
      lastPositionAt: true,
      currentEta: true,
      delayMinutes: true,
    },
  });
  if (!shipment) throw notFound("Shipment");
  const events = await prisma.trackingEvent.findMany({
    where: { shipmentId: shipment.id, organizationId: auth.organizationId },
    orderBy: [{ occurredAt: "asc" }, { recordedAt: "asc" }],
    take: 5000,
  });
  return {
    shipment,
    events,
    // Breadcrumb trail for the map.
    path: events
      .filter((e) => e.latitude !== null && e.longitude !== null)
      .map((e) => [e.latitude, e.longitude]),
  };
});
