import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { badRequest } from "@/lib/errors";
import { api, parseQuery } from "@/lib/http";
import { DOCUMENT_TYPES } from "@/lib/schemas";
import { DOCUMENT_ENTITIES, storeDocument } from "@/modules/documents/service";

const target = z.object({
  entityType: z.enum(DOCUMENT_ENTITIES),
  entityId: z.string().min(1).max(40),
});

export const GET = api("documents:read", async ({ req, auth }) => {
  const { entityType, entityId } = parseQuery(req, target);
  return {
    data: await prisma.document.findMany({
      where: { organizationId: auth.organizationId, entityType, entityId },
      select: { id: true, type: true, filename: true, contentType: true, sizeBytes: true, createdAt: true },
      orderBy: { createdAt: "desc" },
    }),
  };
});

/** multipart/form-data with fields: file, entityType, entityId, type. */
export const POST = api("documents:write", async ({ req, auth }) => {
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    throw badRequest("Send the upload as multipart/form-data");
  }
  const file = form.get("file");
  if (!(file instanceof File)) throw badRequest('Missing "file" field');
  const fields = target
    .extend({ type: z.enum(DOCUMENT_TYPES) })
    .parse({
      entityType: form.get("entityType"),
      entityId: form.get("entityId"),
      type: form.get("type"),
    });
  return Response.json(await storeDocument(auth, { ...fields, file }), { status: 201 });
});
