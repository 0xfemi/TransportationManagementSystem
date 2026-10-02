import { prisma } from "@/lib/prisma";
import { notFound } from "@/lib/errors";
import { audit } from "@/lib/events";
import { api } from "@/lib/http";

export const DELETE = api("settings:manage", async ({ auth, params }) => {
  const key = await prisma.apiKey.findFirst({
    where: { id: params.id, organizationId: auth.organizationId, revokedAt: null },
  });
  if (!key) throw notFound("API key");
  await prisma.apiKey.update({ where: { id: key.id }, data: { revokedAt: new Date() } });
  await audit(prisma, {
    organizationId: auth.organizationId,
    actor: auth.actor,
    action: "api_key.revoked",
    entityType: "api_key",
    entityId: key.id,
    summary: `Revoked API key "${key.name}"`,
  });
  return { ok: true };
});
