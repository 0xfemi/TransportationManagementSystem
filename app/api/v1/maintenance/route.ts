import type { MaintenanceStatus, Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { api, page, pageQuery, parseBody, parseQuery } from "@/lib/http";
import { MAINTENANCE_STATUSES, maintenanceCreateSchema } from "@/lib/schemas";
import { createMaintenance, maintenanceInclude } from "@/modules/maintenance/service";

const query = pageQuery.extend({
  // "open" = scheduled or in progress.
  status: z.enum([...MAINTENANCE_STATUSES, "open"]).optional(),
  vehicleId: z.string().optional(),
});

export const GET = api("masterdata:read", async ({ req, auth }) => {
  const { limit, offset, q, status, vehicleId } = parseQuery(req, query);
  const where: Prisma.MaintenanceOrderWhereInput = {
    organizationId: auth.organizationId,
    ...(status === "open"
      ? { status: { in: ["SCHEDULED", "IN_PROGRESS"] } }
      : status
        ? { status: status as MaintenanceStatus }
        : {}),
    ...(vehicleId ? { vehicleId } : {}),
    ...(q
      ? {
          OR: [
            { number: { contains: q, mode: "insensitive" } },
            { title: { contains: q, mode: "insensitive" } },
            { vehicle: { name: { contains: q, mode: "insensitive" } } },
          ],
        }
      : {}),
  };
  const [data, total] = await Promise.all([
    prisma.maintenanceOrder.findMany({
      where,
      include: maintenanceInclude,
      orderBy: { scheduledFor: "asc" },
      take: limit,
      skip: offset,
    }),
    prisma.maintenanceOrder.count({ where }),
  ]);
  return page(data, total, limit, offset);
});

export const POST = api("masterdata:write", async ({ req, auth }) =>
  Response.json(await createMaintenance(auth, await parseBody(req, maintenanceCreateSchema)), { status: 201 }),
);
