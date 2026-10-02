import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { api, page, pageQuery, parseQuery } from "@/lib/http";

const query = pageQuery.extend({
  entityType: z.string().max(40).optional(),
  entityId: z.string().max(40).optional(),
});

export const GET = api("audit:read", async ({ req, auth }) => {
  const { limit, offset, q, entityType, entityId } = parseQuery(req, query);
  const where: Prisma.AuditLogWhereInput = {
    organizationId: auth.organizationId,
    ...(entityType ? { entityType } : {}),
    ...(entityId ? { entityId } : {}),
    ...(q
      ? {
          OR: [
            { summary: { contains: q, mode: "insensitive" } },
            { actorLabel: { contains: q, mode: "insensitive" } },
          ],
        }
      : {}),
  };
  const [data, total] = await Promise.all([
    prisma.auditLog.findMany({ where, orderBy: { createdAt: "desc" }, take: limit, skip: offset }),
    prisma.auditLog.count({ where }),
  ]);
  return page(data, total, limit, offset);
});
