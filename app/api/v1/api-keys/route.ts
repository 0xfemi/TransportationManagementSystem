import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/events";
import { api, parseBody } from "@/lib/http";
import { generateApiKey } from "@/lib/auth/apiKeys";
import { apiKeyCreateSchema } from "@/lib/schemas";

export const GET = api("settings:manage", async ({ auth }) => ({
  data: await prisma.apiKey.findMany({
    where: { organizationId: auth.organizationId, revokedAt: null },
    select: { id: true, name: true, role: true, prefix: true, lastUsedAt: true, createdAt: true },
    orderBy: { createdAt: "desc" },
  }),
}));

export const POST = api("settings:manage", async ({ req, auth }) => {
  const input = await parseBody(req, apiKeyCreateSchema);
  const { key, prefix, keyHash } = generateApiKey();
  const created = await prisma.apiKey.create({
    data: {
      organizationId: auth.organizationId,
      name: input.name,
      role: input.role,
      prefix,
      keyHash,
      createdById: auth.userId,
    },
    select: { id: true, name: true, role: true, prefix: true, createdAt: true },
  });
  await audit(prisma, {
    organizationId: auth.organizationId,
    actor: auth.actor,
    action: "api_key.created",
    entityType: "api_key",
    entityId: created.id,
    summary: `Created API key "${created.name}"`,
  });
  // The only time the full key is ever returned.
  return Response.json({ ...created, key }, { status: 201 });
});
