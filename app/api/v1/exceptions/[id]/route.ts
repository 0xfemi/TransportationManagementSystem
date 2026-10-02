import { prisma } from "@/lib/prisma";
import { notFound } from "@/lib/errors";
import { api, parseBody } from "@/lib/http";
import { exceptionUpdateSchema } from "@/lib/schemas";
import { updateException } from "@/modules/exceptions/service";

/** An exception with the timeline of everything recorded against it. */
export const GET = api("exceptions:read", async ({ auth, params }) => {
  const exception = await prisma.shipmentException.findFirst({
    where: { id: params.id, organizationId: auth.organizationId },
    include: { shipment: { select: { id: true, number: true, status: true } } },
  });
  if (!exception) throw notFound("Exception");
  const [history, shipmentEvents, owner] = await Promise.all([
    prisma.auditLog.findMany({
      where: { organizationId: auth.organizationId, entityType: "exception", entityId: exception.id },
      orderBy: { createdAt: "asc" },
    }),
    exception.shipmentId
      ? prisma.trackingEvent.findMany({
          where: {
            organizationId: auth.organizationId,
            shipmentId: exception.shipmentId,
            type: { not: "LOCATION_UPDATE" },
          },
          orderBy: { occurredAt: "asc" },
          take: 200,
        })
      : [],
    exception.ownerId
      ? prisma.user.findUnique({ where: { id: exception.ownerId }, select: { id: true, name: true } })
      : null,
  ]);
  return { ...exception, owner, history, shipmentEvents };
});

export const PATCH = api("exceptions:write", async ({ req, auth, params }) =>
  updateException(auth, params.id, await parseBody(req, exceptionUpdateSchema)),
);
