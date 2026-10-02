import type { MaintenanceStatus, Prisma } from "@prisma/client";
import type { z } from "zod";
import { prisma } from "@/lib/prisma";
import { conflict, notFound } from "@/lib/errors";
import { audit, emitEvent, nextNumber, type Db } from "@/lib/events";
import type {
  maintenanceCompleteSchema,
  maintenanceCreateSchema,
  maintenanceUpdateSchema,
} from "@/lib/schemas";
import { clock, type ServiceCtx } from "@/modules/shipments/service";

export const maintenanceInclude = {
  vehicle: { select: { id: true, name: true, registration: true, status: true } },
} satisfies Prisma.MaintenanceOrderInclude;

const OPEN: MaintenanceStatus[] = ["SCHEDULED", "IN_PROGRESS"];

async function load(db: Db, organizationId: string, id: string) {
  const order = await db.maintenanceOrder.findFirst({
    where: { id, organizationId },
    include: maintenanceInclude,
  });
  if (!order) throw notFound("Maintenance order");
  return order;
}

function assertOpen(status: MaintenanceStatus) {
  if (!OPEN.includes(status)) {
    throw conflict(`This work order is already ${status.toLowerCase()}`);
  }
}

/**
 * Put a vehicle back in service when its last open work finishes. Only a
 * vehicle maintenance took out of service is touched: one an admin marked
 * inactive by hand stays inactive.
 */
async function releaseVehicle(db: Db, organizationId: string, vehicleId: string, exceptId: string) {
  const stillOpen = await db.maintenanceOrder.count({
    where: { organizationId, vehicleId, status: "IN_PROGRESS", id: { not: exceptId } },
  });
  if (stillOpen > 0) return false;
  const { count } = await db.vehicle.updateMany({
    where: { id: vehicleId, organizationId, status: "MAINTENANCE" },
    data: { status: "AVAILABLE" },
  });
  return count > 0;
}

export async function createMaintenance(ctx: ServiceCtx, input: z.infer<typeof maintenanceCreateSchema>) {
  const at = clock(ctx);
  return prisma.$transaction(async (tx) => {
    const vehicle = await tx.vehicle.findFirst({
      where: { id: input.vehicleId, organizationId: ctx.organizationId, deletedAt: null },
    });
    if (!vehicle) throw notFound("Vehicle");

    const number = await nextNumber(tx, ctx.organizationId, "maintenance", "MNT");
    const order = await tx.maintenanceOrder.create({
      data: { ...input, organizationId: ctx.organizationId, number, createdAt: at },
      include: maintenanceInclude,
    });
    await emitEvent(tx, {
      organizationId: ctx.organizationId,
      type: "MaintenanceScheduled",
      entityType: "maintenance",
      entityId: order.id,
      payload: { number, vehicleId: vehicle.id, type: input.type, scheduledFor: input.scheduledFor.toISOString() },
      actor: ctx.actor,
      occurredAt: at,
    });
    await audit(tx, {
      organizationId: ctx.organizationId,
      actor: ctx.actor,
      action: "maintenance.scheduled",
      entityType: "maintenance",
      entityId: order.id,
      summary: `Scheduled ${number} (${input.title}) for ${vehicle.name}`,
      at,
    });
    return order;
  });
}

export async function updateMaintenance(
  ctx: ServiceCtx,
  id: string,
  input: z.infer<typeof maintenanceUpdateSchema>,
) {
  const existing = await load(prisma, ctx.organizationId, id);
  if (existing.status !== "SCHEDULED") {
    throw conflict("Only a scheduled work order can be edited; this one has started or closed");
  }
  const updated = await prisma.maintenanceOrder.update({ where: { id }, data: input, include: maintenanceInclude });
  const keys = Object.keys(input) as (keyof typeof input)[];
  if (keys.length) {
    await audit(prisma, {
      organizationId: ctx.organizationId,
      actor: ctx.actor,
      action: "maintenance.updated",
      entityType: "maintenance",
      entityId: id,
      summary: `Updated ${existing.number} (${keys.join(", ")})`,
      before: Object.fromEntries(keys.map((k) => [k, existing[k]])) as Prisma.InputJsonValue,
      after: Object.fromEntries(keys.map((k) => [k, updated[k]])) as Prisma.InputJsonValue,
    });
  }
  return updated;
}

/** Begin the work: the vehicle leaves service and the planner stops offering it. */
export async function startMaintenance(ctx: ServiceCtx, id: string) {
  const at = clock(ctx);
  return prisma.$transaction(async (tx) => {
    const order = await load(tx, ctx.organizationId, id);
    if (order.status !== "SCHEDULED") {
      throw conflict(`A ${order.status.toLowerCase().replace("_", " ")} work order cannot be started`);
    }
    const out = await tx.shipment.findFirst({
      where: {
        organizationId: ctx.organizationId,
        vehicleId: order.vehicleId,
        status: { in: ["DISPATCHED", "IN_TRANSIT"] },
      },
      select: { number: true },
    });
    if (out) {
      throw conflict(`${order.vehicle.name} is out on ${out.number}. Start the work once it is delivered or cancelled.`);
    }

    await tx.maintenanceOrder.update({ where: { id }, data: { status: "IN_PROGRESS", startedAt: at } });
    // An inactive vehicle stays inactive; anything else is now in the shop.
    if (order.vehicle.status !== "INACTIVE") {
      await tx.vehicle.update({ where: { id: order.vehicleId }, data: { status: "MAINTENANCE" } });
    }
    await emitEvent(tx, {
      organizationId: ctx.organizationId,
      type: "MaintenanceStarted",
      entityType: "maintenance",
      entityId: id,
      payload: { number: order.number, vehicleId: order.vehicleId },
      actor: ctx.actor,
      occurredAt: at,
    });
    await audit(tx, {
      organizationId: ctx.organizationId,
      actor: ctx.actor,
      action: "maintenance.started",
      entityType: "maintenance",
      entityId: id,
      summary: `Started ${order.number}; ${order.vehicle.name} is out of service`,
      before: { status: order.status, vehicleStatus: order.vehicle.status },
      after: { status: "IN_PROGRESS", vehicleStatus: order.vehicle.status === "INACTIVE" ? "INACTIVE" : "MAINTENANCE" },
      at,
    });
    return load(tx, ctx.organizationId, id);
  });
}

export async function completeMaintenance(
  ctx: ServiceCtx,
  id: string,
  input: z.infer<typeof maintenanceCompleteSchema>,
) {
  const at = clock(ctx);
  return prisma.$transaction(async (tx) => {
    const order = await load(tx, ctx.organizationId, id);
    if (order.status !== "IN_PROGRESS") {
      throw conflict(
        order.status === "SCHEDULED"
          ? "Start the work order before completing it"
          : `This work order is already ${order.status.toLowerCase()}`,
      );
    }
    await tx.maintenanceOrder.update({
      where: { id },
      data: {
        status: "COMPLETED",
        completedAt: at,
        cost: input.cost,
        ...(input.notes ? { notes: input.notes } : {}),
      },
    });
    const released = await releaseVehicle(tx, ctx.organizationId, order.vehicleId, id);
    await emitEvent(tx, {
      organizationId: ctx.organizationId,
      type: "MaintenanceCompleted",
      entityType: "maintenance",
      entityId: id,
      payload: { number: order.number, vehicleId: order.vehicleId, cost: input.cost },
      actor: ctx.actor,
      occurredAt: at,
    });
    await audit(tx, {
      organizationId: ctx.organizationId,
      actor: ctx.actor,
      action: "maintenance.completed",
      entityType: "maintenance",
      entityId: id,
      summary: `Completed ${order.number}${released ? `; ${order.vehicle.name} is back in service` : ""}`,
      before: { status: order.status },
      after: { status: "COMPLETED", cost: input.cost },
      at,
    });
    return load(tx, ctx.organizationId, id);
  });
}

export async function cancelMaintenance(ctx: ServiceCtx, id: string, reason: string) {
  const at = clock(ctx);
  return prisma.$transaction(async (tx) => {
    const order = await load(tx, ctx.organizationId, id);
    assertOpen(order.status);
    await tx.maintenanceOrder.update({
      where: { id },
      data: { status: "CANCELLED", cancelReason: reason },
    });
    const released =
      order.status === "IN_PROGRESS" && (await releaseVehicle(tx, ctx.organizationId, order.vehicleId, id));
    await emitEvent(tx, {
      organizationId: ctx.organizationId,
      type: "MaintenanceCancelled",
      entityType: "maintenance",
      entityId: id,
      payload: { number: order.number, vehicleId: order.vehicleId, reason },
      actor: ctx.actor,
      occurredAt: at,
    });
    await audit(tx, {
      organizationId: ctx.organizationId,
      actor: ctx.actor,
      action: "maintenance.cancelled",
      entityType: "maintenance",
      entityId: id,
      summary: `Cancelled ${order.number}${released ? `; ${order.vehicle.name} is back in service` : ""}`,
      before: { status: order.status },
      after: { status: "CANCELLED" },
      reason,
      at,
    });
    return load(tx, ctx.organizationId, id);
  });
}
