import { prisma } from "@/lib/prisma";
import { api } from "@/lib/http";
import { permissionsFor } from "@/lib/rbac";

export const GET = api(null, async ({ auth }) => {
  const [organization, user] = await Promise.all([
    prisma.organization.findUniqueOrThrow({ where: { id: auth.organizationId } }),
    auth.userId
      ? prisma.user.findUnique({
          where: { id: auth.userId },
          select: { id: true, name: true, email: true },
        })
      : null,
  ]);
  return {
    user,
    actor: auth.actor,
    organization,
    role: auth.role,
    permissions: permissionsFor(auth.role),
  };
});
