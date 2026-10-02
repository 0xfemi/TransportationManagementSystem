import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { api, page, pageQuery, parseBody, parseQuery } from "@/lib/http";
import { orderSchema } from "@/lib/schemas";
import { createOrder, orderInclude } from "@/modules/orders/service";

const query = pageQuery.extend({
  status: z.enum(["OPEN", "PLANNED", "IN_TRANSIT", "DELIVERED", "CANCELLED"]).optional(),
  customerId: z.string().optional(),
});

export const GET = api("orders:read", async ({ req, auth }) => {
  const { limit, offset, q, status, customerId } = parseQuery(req, query);
  const where: Prisma.OrderWhereInput = {
    organizationId: auth.organizationId,
    ...(status ? { status } : {}),
    ...(customerId ? { customerId } : {}),
    ...(q
      ? {
          OR: [
            { number: { contains: q, mode: "insensitive" } },
            { reference: { contains: q, mode: "insensitive" } },
            { customer: { name: { contains: q, mode: "insensitive" } } },
          ],
        }
      : {}),
  };
  const [data, total] = await Promise.all([
    prisma.order.findMany({
      where,
      include: orderInclude,
      orderBy: { createdAt: "desc" },
      take: limit,
      skip: offset,
    }),
    prisma.order.count({ where }),
  ]);
  return page(data, total, limit, offset);
});

export const POST = api("orders:write", async ({ req, auth }) => {
  const order = await createOrder(auth, await parseBody(req, orderSchema));
  return Response.json(order, { status: 201 });
});
