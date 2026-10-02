import { prisma } from "@/lib/prisma";
import { notFound } from "@/lib/errors";
import { audit } from "@/lib/events";
import { api } from "@/lib/http";

/** Downloads the file. Always served as an attachment, never rendered inline. */
export const GET = api("documents:read", async ({ auth, params }) => {
  const document = await prisma.document.findFirst({
    where: { id: params.id, organizationId: auth.organizationId },
  });
  if (!document) throw notFound("Document");
  return new Response(new Uint8Array(document.data), {
    headers: {
      "Content-Type": document.contentType,
      "Content-Length": String(document.sizeBytes),
      "Content-Disposition": `attachment; filename="${document.filename.replace(/"/g, "")}"`,
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, no-store",
    },
  });
});

export const DELETE = api("documents:write", async ({ auth, params }) => {
  const document = await prisma.document.findFirst({
    where: { id: params.id, organizationId: auth.organizationId },
    select: { id: true, filename: true, entityType: true, entityId: true },
  });
  if (!document) throw notFound("Document");
  await prisma.document.delete({ where: { id: document.id } });
  await audit(prisma, {
    organizationId: auth.organizationId,
    actor: auth.actor,
    action: "document.deleted",
    entityType: document.entityType,
    entityId: document.entityId,
    summary: `Deleted document "${document.filename}"`,
  });
  return { ok: true };
});
