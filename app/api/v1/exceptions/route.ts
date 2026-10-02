import type { ExceptionStatus, Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { notFound } from "@/lib/errors";
import { api, page, pageQuery, parseBody, parseQuery } from "@/lib/http";
import { EXCEPTION_STATUSES, SEVERITIES, exceptionCreateSchema } from "@/lib/schemas";
import { raiseException, sweepStaleTenders } from "@/modules/exceptions/service";

const query = pageQuery.extend({
  // "active" = open or investigating.
  status: z.enum([...EXCEPTION_STATUSES, "active"]).optional(),
  severity: z.enum(SEVERITIES).optional(),
  shipmentId: z.string().optional(),
});

export const GET = api("exceptions:read", async ({ req, auth }) => {
  await sweepStaleTenders(auth.organizationId);
  const { limit, offset, q, status, severity, shipmentId } = parseQuery(req, query);
  const where: Prisma.ShipmentExceptionWhereInput = {
    organizationId: auth.organizationId,
    ...(status === "active"
      ? { status: { in: ["OPEN", "INVESTIGATING"] } }
      : status
        ? { status: status as ExceptionStatus }
        : {}),
    ...(severity ? { severity } : {}),
    ...(shipmentId ? { shipmentId } : {}),
    ...(q ? { title: { contains: q, mode: "insensitive" } } : {}),
  };
  const [data, total] = await Promise.all([
    prisma.shipmentException.findMany({
      where,
      include: { shipment: { select: { id: true, number: true, status: true } } },
      orderBy: { detectedAt: "desc" },
      take: limit,
      skip: offset,
    }),
    prisma.shipmentException.count({ where }),
  ]);
  return page(data, total, limit, offset);
});

/** Reports an exception by hand (breakdown, damage, …). */
export const POST = api("exceptions:write", async ({ req, auth }) => {
  const input = await parseBody(req, exceptionCreateSchema);
  if (input.shipmentId) {
    const shipment = await prisma.shipment.findFirst({
      where: { id: input.shipmentId, organizationId: auth.organizationId },
      select: { id: true },
    });
    if (!shipment) throw notFound("Shipment");
  }
  return Response.json(await raiseException(prisma, auth, input), { status: 201 });
});
