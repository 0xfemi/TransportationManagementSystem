import type { Prisma, ShipmentStatus } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { api, page, pageQuery, parseBody, parseQuery } from "@/lib/http";
import { shipmentCreateSchema } from "@/lib/schemas";
import { createShipment } from "@/modules/shipments/service";

const STATUSES = [
  "DRAFT",
  "PLANNED",
  "TENDERED",
  "ACCEPTED",
  "DISPATCHED",
  "IN_TRANSIT",
  "DELIVERED",
  "CANCELLED",
] as const;

const query = pageQuery.extend({
  // Comma-separated, e.g. status=DISPATCHED,IN_TRANSIT
  status: z
    .string()
    .optional()
    .transform((v) => v?.split(",").filter((s): s is ShipmentStatus => (STATUSES as readonly string[]).includes(s))),
  carrierId: z.string().optional(),
  delayed: z.enum(["true", "false"]).optional(),
});

export const GET = api("shipments:read", async ({ req, auth }) => {
  const { limit, offset, q, status, carrierId, delayed } = parseQuery(req, query);
  const where: Prisma.ShipmentWhereInput = {
    organizationId: auth.organizationId,
    ...(status?.length ? { status: { in: status } } : {}),
    ...(carrierId ? { carrierId } : {}),
    ...(delayed === "true"
      ? { delayMinutes: { gte: 15 }, status: { in: ["DISPATCHED", "IN_TRANSIT"] } }
      : {}),
    ...(q
      ? {
          OR: [
            { number: { contains: q, mode: "insensitive" } },
            { carrier: { name: { contains: q, mode: "insensitive" } } },
            { orders: { some: { number: { contains: q, mode: "insensitive" } } } },
            { orders: { some: { customer: { name: { contains: q, mode: "insensitive" } } } } },
          ],
        }
      : {}),
  };
  const [data, total] = await Promise.all([
    prisma.shipment.findMany({
      where,
      select: {
        id: true,
        number: true,
        status: true,
        mode: true,
        plannedStart: true,
        plannedEnd: true,
        actualStart: true,
        actualEnd: true,
        currentEta: true,
        delayMinutes: true,
        estimatedCost: true,
        plannedDistanceKm: true,
        totalWeightKg: true,
        createdAt: true,
        carrier: { select: { id: true, name: true } },
        vehicle: { select: { id: true, name: true } },
        driver: { select: { id: true, name: true } },
        orders: { select: { id: true, number: true, customer: { select: { name: true } } } },
        stops: {
          orderBy: { sequence: "asc" },
          select: { type: true, status: true, location: { select: { name: true, city: true } } },
        },
      },
      orderBy: { createdAt: "desc" },
      take: limit,
      skip: offset,
    }),
    prisma.shipment.count({ where }),
  ]);
  return page(data, total, limit, offset);
});

/** Converts one or more open orders into a draft shipment. */
export const POST = api("shipments:write", async ({ req, auth }) => {
  const shipment = await createShipment(auth, await parseBody(req, shipmentCreateSchema));
  return Response.json(shipment, { status: 201 });
});
