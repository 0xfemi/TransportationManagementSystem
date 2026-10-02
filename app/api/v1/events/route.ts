import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { api, page, pageQuery, parseQuery } from "@/lib/http";

const query = pageQuery.extend({
  type: z.string().max(60).optional(),
  entityType: z.string().max(40).optional(),
  entityId: z.string().max(40).optional(),
  since: z.coerce.date().optional(),
});

/** The append-only domain event log, for integrations that poll. */
export const GET = api("audit:read", async ({ req, auth }) => {
  const { limit, offset, type, entityType, entityId, since } = parseQuery(req, query);
  const where: Prisma.DomainEventWhereInput = {
    organizationId: auth.organizationId,
    ...(type ? { type } : {}),
    ...(entityType ? { entityType } : {}),
    ...(entityId ? { entityId } : {}),
    ...(since ? { occurredAt: { gt: since } } : {}),
  };
  const [data, total] = await Promise.all([
    prisma.domainEvent.findMany({ where, orderBy: { occurredAt: "desc" }, take: limit, skip: offset }),
    prisma.domainEvent.count({ where }),
  ]);
  return page(data, total, limit, offset);
});
