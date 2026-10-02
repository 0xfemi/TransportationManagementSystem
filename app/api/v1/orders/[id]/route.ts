import { prisma } from "@/lib/prisma";
import { notFound } from "@/lib/errors";
import { api, parseBody } from "@/lib/http";
import { orderUpdateSchema } from "@/lib/schemas";
import { orderInclude, updateOrder } from "@/modules/orders/service";

export const GET = api("orders:read", async ({ auth, params }) => {
  const order = await prisma.order.findFirst({
    where: { id: params.id, organizationId: auth.organizationId },
    include: orderInclude,
  });
  if (!order) throw notFound("Order");
  return order;
});

export const PATCH = api("orders:write", async ({ req, auth, params }) =>
  updateOrder(auth, params.id, await parseBody(req, orderUpdateSchema)),
);
