import { prisma } from "@/lib/prisma";
import { notFound } from "@/lib/errors";
import { api } from "@/lib/http";
import { shipmentDetailInclude } from "@/modules/shipments/service";
import { etaWindowMinutes } from "@/modules/tracking/eta";

export const GET = api("shipments:read", async ({ auth, params }) => {
  const shipment = await prisma.shipment.findFirst({
    where: { id: params.id, organizationId: auth.organizationId },
    include: shipmentDetailInclude,
  });
  if (!shipment) throw notFound("Shipment");

  const [exceptions, documents] = await Promise.all([
    prisma.shipmentException.findMany({
      where: { shipmentId: shipment.id, organizationId: auth.organizationId },
      orderBy: { detectedAt: "desc" },
    }),
    prisma.document.findMany({
      where: { organizationId: auth.organizationId, entityType: "shipment", entityId: shipment.id },
      select: { id: true, type: true, filename: true, contentType: true, sizeBytes: true, createdAt: true },
      orderBy: { createdAt: "desc" },
    }),
  ]);

  const moving = shipment.status === "DISPATCHED" || shipment.status === "IN_TRANSIT";
  const asOf = shipment.lastPositionAt ?? shipment.actualStart ?? new Date();
  return {
    ...shipment,
    exceptions,
    documents,
    // "Expected arrival 14:32–14:48": the range widens with time still to run.
    etaWindowMinutes:
      moving && shipment.currentEta ? etaWindowMinutes(shipment.currentEta, asOf) : null,
  };
});
