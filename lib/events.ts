import type { Prisma, PrismaClient } from "@prisma/client";
import type { Actor } from "@/lib/auth/context";

export type Db = PrismaClient | Prisma.TransactionClient;

/** Appends an immutable domain event (ShipmentCreated, TenderAccepted, …). */
export async function emitEvent(
  db: Db,
  event: {
    organizationId: string;
    type: string;
    entityType: string;
    entityId: string;
    payload?: Prisma.InputJsonValue;
    actor: Actor;
    occurredAt?: Date;
  },
) {
  await db.domainEvent.create({
    data: {
      organizationId: event.organizationId,
      type: event.type,
      entityType: event.entityType,
      entityId: event.entityId,
      payload: event.payload ?? {},
      actorType: event.actor.type,
      actorId: event.actor.id,
      occurredAt: event.occurredAt ?? new Date(),
    },
  });
}

/** Records who changed what, with before/after values where they apply. */
export async function audit(
  db: Db,
  entry: {
    organizationId: string;
    actor: Actor;
    action: string;
    entityType: string;
    entityId: string;
    summary: string;
    before?: Prisma.InputJsonValue;
    after?: Prisma.InputJsonValue;
    reason?: string | null;
    at?: Date;
  },
) {
  await db.auditLog.create({
    data: {
      organizationId: entry.organizationId,
      actorType: entry.actor.type,
      actorId: entry.actor.id,
      actorLabel: entry.actor.label,
      action: entry.action,
      entityType: entry.entityType,
      entityId: entry.entityId,
      summary: entry.summary,
      before: entry.before,
      after: entry.after,
      reason: entry.reason ?? null,
      createdAt: entry.at ?? new Date(),
    },
  });
}

/** Next human-readable number for an organization, e.g. SHP-00042. */
export async function nextNumber(
  db: Db,
  organizationId: string,
  key: string,
  prefix: string,
): Promise<string> {
  const counter = await db.counter.upsert({
    where: { organizationId_key: { organizationId, key } },
    create: { organizationId, key, value: 1 },
    update: { value: { increment: 1 } },
  });
  return `${prefix}-${String(counter.value).padStart(5, "0")}`;
}
