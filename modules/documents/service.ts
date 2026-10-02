import type { DocumentType } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { Actor } from "@/lib/auth/context";
import { badRequest, notFound, unprocessable } from "@/lib/errors";
import { audit, emitEvent } from "@/lib/events";
import { addTrackingEvent } from "@/modules/shipments/service";

export const MAX_DOCUMENT_BYTES = 5 * 1024 * 1024;
export const DOCUMENT_ENTITIES = ["shipment", "order", "carrier"] as const;
export type DocumentEntity = (typeof DOCUMENT_ENTITIES)[number];

/** Accepted types, each with the bytes a real file of that type starts with. */
const ALLOWED: Record<string, number[][]> = {
  "application/pdf": [[0x25, 0x50, 0x44, 0x46]],
  "image/png": [[0x89, 0x50, 0x4e, 0x47]],
  "image/jpeg": [[0xff, 0xd8, 0xff]],
  "image/webp": [[0x52, 0x49, 0x46, 0x46]],
  "text/plain": [],
  "text/csv": [],
};

function assertContentMatches(contentType: string, bytes: Uint8Array) {
  const signatures = ALLOWED[contentType];
  if (!signatures) {
    throw unprocessable("Unsupported file type. Upload a PDF, PNG, JPEG, WebP, TXT or CSV file.");
  }
  if (signatures.length && !signatures.some((sig) => sig.every((b, i) => bytes[i] === b))) {
    throw unprocessable("The file's contents do not match its type");
  }
  if (!signatures.length && bytes.includes(0)) {
    throw unprocessable("The file's contents do not match its type");
  }
}

async function entityLabel(organizationId: string, entityType: DocumentEntity, entityId: string) {
  const where = { id: entityId, organizationId };
  const row =
    entityType === "shipment"
      ? await prisma.shipment.findFirst({ where, select: { number: true, status: true } })
      : entityType === "order"
        ? await prisma.order.findFirst({ where, select: { number: true } })
        : await prisma.carrier.findFirst({ where, select: { name: true } });
  if (!row) throw notFound(entityType[0].toUpperCase() + entityType.slice(1));
  return "number" in row ? row.number : row.name;
}

export async function storeDocument(
  ctx: { organizationId: string; actor: Actor; userId: string | null },
  input: { entityType: DocumentEntity; entityId: string; type: DocumentType; file: File },
) {
  if (input.file.size === 0) throw badRequest("The file is empty");
  if (input.file.size > MAX_DOCUMENT_BYTES) {
    throw unprocessable(`Files can be at most ${MAX_DOCUMENT_BYTES / 1024 / 1024} MB`);
  }
  const bytes = new Uint8Array(await input.file.arrayBuffer());
  const contentType = input.file.type.split(";")[0].trim().toLowerCase();
  assertContentMatches(contentType, bytes);
  const label = await entityLabel(ctx.organizationId, input.entityType, input.entityId);
  // Strip any path and control characters a client may have sent.
  const filename =
    input.file.name.replace(/^.*[\\/]/, "").replace(/[^\w.\- ()]/g, "_").slice(0, 150) || "document";

  return prisma.$transaction(async (tx) => {
    const document = await tx.document.create({
      data: {
        organizationId: ctx.organizationId,
        entityType: input.entityType,
        entityId: input.entityId,
        type: input.type,
        filename,
        contentType,
        sizeBytes: bytes.length,
        data: Buffer.from(bytes),
        uploadedById: ctx.userId,
      },
      select: { id: true, type: true, filename: true, contentType: true, sizeBytes: true, createdAt: true },
    });
    if (input.entityType === "shipment" && input.type === "PROOF_OF_DELIVERY") {
      // Keep the history in order for shipments whose simulated clock ran
      // ahead of the wall clock.
      const shipment = await tx.shipment.findUniqueOrThrow({
        where: { id: input.entityId },
        select: { lastPositionAt: true },
      });
      const now = new Date();
      await addTrackingEvent(tx, ctx, {
        shipmentId: input.entityId,
        type: "POD_RECEIVED",
        occurredAt:
          shipment.lastPositionAt && shipment.lastPositionAt > now ? shipment.lastPositionAt : now,
        message: `Proof of delivery uploaded (${filename})`,
      });
      await emitEvent(tx, {
        organizationId: ctx.organizationId,
        type: "ProofOfDeliveryUploaded",
        entityType: "shipment",
        entityId: input.entityId,
        payload: { documentId: document.id },
        actor: ctx.actor,
      });
    }
    await audit(tx, {
      organizationId: ctx.organizationId,
      actor: ctx.actor,
      action: "document.uploaded",
      entityType: input.entityType,
      entityId: input.entityId,
      summary: `Uploaded ${input.type.toLowerCase().replaceAll("_", " ")} "${filename}" to ${label}`,
    });
    return document;
  });
}
