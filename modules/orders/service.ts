import type { Prisma } from "@prisma/client";
import type { z } from "zod";
import { prisma } from "@/lib/prisma";
import { conflict, notFound, unprocessable } from "@/lib/errors";
import { audit, emitEvent, nextNumber } from "@/lib/events";
import type { orderSchema, orderUpdateSchema } from "@/lib/schemas";
import { clock, type ServiceCtx } from "@/modules/shipments/service";
import { uncovered } from "@/modules/serviceAreas/coverage";

export const orderInclude = {
  customer: { select: { id: true, name: true } },
  pickupLocation: { select: { id: true, name: true, city: true, latitude: true, longitude: true } },
  deliveryLocation: { select: { id: true, name: true, city: true, latitude: true, longitude: true } },
  shipment: { select: { id: true, number: true, status: true } },
  lines: true,
} satisfies Prisma.OrderInclude;

export async function createOrder(ctx: ServiceCtx, input: z.infer<typeof orderSchema>) {
  const at = clock(ctx);
  return prisma.$transaction(async (tx) => {
    const [customer, locations] = await Promise.all([
      tx.customer.findFirst({
        where: { id: input.customerId, organizationId: ctx.organizationId, deletedAt: null },
      }),
      tx.location.findMany({
        where: {
          id: { in: [input.pickupLocationId, input.deliveryLocationId] },
          organizationId: ctx.organizationId,
          deletedAt: null,
        },
      }),
    ]);
    if (!customer) throw notFound("Customer");
    if (locations.length !== 2) throw notFound("Pickup or delivery location");

    const areas = await tx.serviceArea.findMany({
      where: { organizationId: ctx.organizationId, active: true, deletedAt: null },
    });
    const outside = uncovered(locations, areas);
    if (outside.length) {
      throw unprocessable(
        `${outside.map((l) => l.name).join(" and ")} ${outside.length > 1 ? "are" : "is"} outside every active service area. Add or widen a service area, or choose another location.`,
        { locations: outside.map((l) => ({ id: l.id, name: l.name })) },
      );
    }

    const number = await nextNumber(tx, ctx.organizationId, "order", "ORD");
    const { lines, ...fields } = input;
    const order = await tx.order.create({
      data: {
        ...fields,
        organizationId: ctx.organizationId,
        number,
        // Line weights and volumes are per line, not per unit.
        totalWeightKg: lines.reduce((sum, l) => sum + l.weightKg, 0),
        totalVolumeM3: lines.reduce((sum, l) => sum + l.volumeM3, 0),
        createdAt: at,
        lines: { create: lines },
      },
      include: orderInclude,
    });
    await emitEvent(tx, {
      organizationId: ctx.organizationId,
      type: "OrderCreated",
      entityType: "order",
      entityId: order.id,
      payload: { number, customerId: input.customerId },
      actor: ctx.actor,
      occurredAt: at,
    });
    await audit(tx, {
      organizationId: ctx.organizationId,
      actor: ctx.actor,
      action: "order.created",
      entityType: "order",
      entityId: order.id,
      summary: `Created order ${number} for ${customer.name}`,
      at,
    });
    return order;
  });
}

export async function updateOrder(
  ctx: ServiceCtx,
  id: string,
  input: z.infer<typeof orderUpdateSchema>,
) {
  const existing = await prisma.order.findFirst({ where: { id, organizationId: ctx.organizationId } });
  if (!existing) throw notFound("Order");
  if (existing.status !== "OPEN") {
    throw conflict("Only open orders can be edited; this one is already on a shipment");
  }
  const updated = await prisma.order.update({ where: { id }, data: input, include: orderInclude });
  const keys = Object.keys(input) as (keyof typeof input)[];
  await audit(prisma, {
    organizationId: ctx.organizationId,
    actor: ctx.actor,
    action: "order.updated",
    entityType: "order",
    entityId: id,
    summary: `Updated order ${existing.number} (${keys.join(", ")})`,
    before: Object.fromEntries(keys.map((k) => [k, existing[k]])) as Prisma.InputJsonValue,
    after: Object.fromEntries(keys.map((k) => [k, updated[k]])) as Prisma.InputJsonValue,
  });
  return updated;
}

export async function cancelOrder(ctx: ServiceCtx, id: string, reason: string) {
  const at = clock(ctx);
  return prisma.$transaction(async (tx) => {
    const order = await tx.order.findFirst({ where: { id, organizationId: ctx.organizationId } });
    if (!order) throw notFound("Order");
    if (order.status !== "OPEN") {
      throw conflict("Only open orders can be cancelled. Cancel the shipment first to release this order.");
    }
    await tx.order.update({ where: { id }, data: { status: "CANCELLED" } });
    await emitEvent(tx, {
      organizationId: ctx.organizationId,
      type: "OrderCancelled",
      entityType: "order",
      entityId: id,
      payload: { reason },
      actor: ctx.actor,
      occurredAt: at,
    });
    await audit(tx, {
      organizationId: ctx.organizationId,
      actor: ctx.actor,
      action: "order.cancelled",
      entityType: "order",
      entityId: id,
      summary: `Cancelled order ${order.number}`,
      before: { status: order.status },
      after: { status: "CANCELLED" },
      reason,
      at,
    });
    return { status: "CANCELLED" };
  });
}
