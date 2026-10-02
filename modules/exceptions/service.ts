import type { ExceptionSeverity, ExceptionStatus, ExceptionType } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { Actor } from "@/lib/auth/context";
import { SYSTEM_ACTOR } from "@/lib/auth/context";
import { notFound } from "@/lib/errors";
import { audit, emitEvent, type Db } from "@/lib/events";

type Ctx = { organizationId: string; actor: Actor; at?: Date };

/** A closed exception reopens only if the measured value worsens this much. */
const REOPEN_DELTA = 30;
export const TENDER_ACK_HOURS = 2;

export type ExceptionInput = {
  shipmentId?: string | null;
  type: ExceptionType;
  severity: ExceptionSeverity;
  title: string;
  impact: string;
  recommendedAction: string;
  dedupeKey?: string;
  metricValue?: number;
};

/**
 * Creates an exception, or refreshes the existing one for the same cause so
 * repeated detections (every GPS ping of a late truck) do not flood the feed.
 */
export async function raiseException(db: Db, ctx: Ctx, input: ExceptionInput) {
  const at = ctx.at ?? new Date();
  const existing = input.dedupeKey
    ? await db.shipmentException.findUnique({
        where: {
          organizationId_dedupeKey: { organizationId: ctx.organizationId, dedupeKey: input.dedupeKey },
        },
      })
    : null;

  if (existing) {
    const closed = existing.status === "RESOLVED" || existing.status === "IGNORED";
    if (closed) {
      const worsened =
        input.metricValue !== undefined &&
        input.metricValue >= (existing.metricValue ?? 0) + REOPEN_DELTA;
      if (!worsened) return existing;
    }
    return db.shipmentException.update({
      where: { id: existing.id },
      data: {
        severity: input.severity,
        title: input.title,
        impact: input.impact,
        recommendedAction: input.recommendedAction,
        metricValue: input.metricValue,
        ...(closed ? { status: "OPEN", resolvedAt: null, resolutionNote: null, detectedAt: at } : {}),
      },
    });
  }

  const created = await db.shipmentException.create({
    data: {
      organizationId: ctx.organizationId,
      shipmentId: input.shipmentId ?? null,
      type: input.type,
      severity: input.severity,
      title: input.title,
      impact: input.impact,
      recommendedAction: input.recommendedAction,
      dedupeKey: input.dedupeKey,
      metricValue: input.metricValue,
      detectedAt: at,
      createdAt: at,
    },
  });
  await emitEvent(db, {
    organizationId: ctx.organizationId,
    type: "ExceptionRaised",
    entityType: "exception",
    entityId: created.id,
    payload: { type: input.type, severity: input.severity, shipmentId: input.shipmentId ?? null },
    actor: ctx.actor,
    occurredAt: at,
  });
  return created;
}

export async function resolveByDedupeKey(db: Db, ctx: Ctx, dedupeKey: string, note: string) {
  await db.shipmentException.updateMany({
    where: {
      organizationId: ctx.organizationId,
      dedupeKey,
      status: { in: ["OPEN", "INVESTIGATING"] },
    },
    data: { status: "RESOLVED", resolvedAt: ctx.at ?? new Date(), resolutionNote: note },
  });
}

export async function updateException(
  ctx: Ctx,
  id: string,
  input: {
    status?: ExceptionStatus;
    ownerId?: string | null;
    severity?: ExceptionSeverity;
    resolutionNote?: string;
  },
) {
  const at = ctx.at ?? new Date();
  return prisma.$transaction(async (tx) => {
    const existing = await tx.shipmentException.findFirst({
      where: { id, organizationId: ctx.organizationId },
    });
    if (!existing) throw notFound("Exception");
    if (input.ownerId) {
      const member = await tx.membership.findUnique({
        where: {
          organizationId_userId: { organizationId: ctx.organizationId, userId: input.ownerId },
        },
      });
      if (!member) throw notFound("Owner");
    }

    const closing = input.status === "RESOLVED" || input.status === "IGNORED";
    const reopening = input.status === "OPEN" || input.status === "INVESTIGATING";
    const updated = await tx.shipmentException.update({
      where: { id },
      data: {
        status: input.status,
        severity: input.severity,
        ownerId: input.ownerId,
        resolutionNote: input.resolutionNote,
        ...(closing ? { resolvedAt: at } : {}),
        ...(reopening ? { resolvedAt: null } : {}),
      },
    });
    await audit(tx, {
      organizationId: ctx.organizationId,
      actor: ctx.actor,
      action: "exception.updated",
      entityType: "exception",
      entityId: id,
      summary: input.status
        ? `Marked exception "${existing.title}" as ${input.status.toLowerCase()}`
        : `Updated exception "${existing.title}"`,
      before: { status: existing.status, ownerId: existing.ownerId, severity: existing.severity },
      after: { status: updated.status, ownerId: updated.ownerId, severity: updated.severity },
      reason: input.resolutionNote,
      at,
    });
    if (input.status && input.status !== existing.status) {
      await emitEvent(tx, {
        organizationId: ctx.organizationId,
        type: closing ? "ExceptionClosed" : "ExceptionReopened",
        entityType: "exception",
        entityId: id,
        payload: { status: input.status },
        actor: ctx.actor,
        occurredAt: at,
      });
    }
    return updated;
  });
}

/**
 * Finds tenders a carrier has sat on for too long. There is no background
 * worker in the MVP, so this runs whenever exceptions are listed.
 */
export async function sweepStaleTenders(organizationId: string, now = new Date()) {
  const cutoff = new Date(now.getTime() - TENDER_ACK_HOURS * 3_600_000);
  const stale = await prisma.tender.findMany({
    where: { organizationId, status: "SENT", sentAt: { lt: cutoff } },
    include: { carrier: { select: { name: true } }, shipment: { select: { number: true } } },
  });
  for (const tender of stale) {
    const hours = Math.floor((now.getTime() - tender.sentAt.getTime()) / 3_600_000);
    await raiseException(prisma, { organizationId, actor: SYSTEM_ACTOR, at: now }, {
      shipmentId: tender.shipmentId,
      type: "TENDER_NOT_ACKNOWLEDGED",
      severity: hours >= 8 ? "HIGH" : "MEDIUM",
      title: `${tender.carrier.name} has not acknowledged the tender for ${tender.shipment.number}`,
      impact: `The tender has been waiting ${hours} hours. ${tender.shipment.number} cannot be dispatched until a carrier accepts.`,
      recommendedAction: "Contact the carrier, or cancel this tender by recording a rejection and tendering to another carrier.",
      dedupeKey: `tender-unack:${tender.id}`,
    });
  }
}
