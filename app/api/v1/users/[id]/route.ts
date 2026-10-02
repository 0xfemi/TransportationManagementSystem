import { prisma } from "@/lib/prisma";
import { conflict, notFound } from "@/lib/errors";
import { audit } from "@/lib/events";
import { api, parseBody } from "@/lib/http";
import { ROLE_LABELS } from "@/lib/rbac";
import { userUpdateSchema } from "@/lib/schemas";

async function membershipOf(organizationId: string, userId: string) {
  const membership = await prisma.membership.findUnique({
    where: { organizationId_userId: { organizationId, userId } },
    include: { user: { select: { name: true } } },
  });
  if (!membership) throw notFound("User");
  return membership;
}

/** An organization must always keep at least one admin. */
async function assertNotLastAdmin(organizationId: string, userId: string) {
  const otherAdmins = await prisma.membership.count({
    where: { organizationId, role: "ADMIN", userId: { not: userId } },
  });
  if (!otherAdmins) throw conflict("An organization needs at least one admin");
}

export const PATCH = api("users:manage", async ({ req, auth, params }) => {
  const { role } = await parseBody(req, userUpdateSchema);
  const membership = await membershipOf(auth.organizationId, params.id);
  if (membership.role === "ADMIN" && role !== "ADMIN") {
    await assertNotLastAdmin(auth.organizationId, params.id);
  }
  await prisma.membership.update({ where: { id: membership.id }, data: { role } });
  await audit(prisma, {
    organizationId: auth.organizationId,
    actor: auth.actor,
    action: "user.role_changed",
    entityType: "user",
    entityId: params.id,
    summary: `Changed ${membership.user.name}'s role from ${ROLE_LABELS[membership.role]} to ${ROLE_LABELS[role]}`,
    before: { role: membership.role },
    after: { role },
  });
  return { id: params.id, role };
});

export const DELETE = api("users:manage", async ({ auth, params }) => {
  const membership = await membershipOf(auth.organizationId, params.id);
  if (membership.role === "ADMIN") await assertNotLastAdmin(auth.organizationId, params.id);
  await prisma.membership.delete({ where: { id: membership.id } });
  await audit(prisma, {
    organizationId: auth.organizationId,
    actor: auth.actor,
    action: "user.removed",
    entityType: "user",
    entityId: params.id,
    summary: `Removed ${membership.user.name} from the organization`,
  });
  return { ok: true };
});
