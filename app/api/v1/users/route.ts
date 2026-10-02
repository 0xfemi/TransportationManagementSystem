import { prisma } from "@/lib/prisma";
import { conflict } from "@/lib/errors";
import { audit } from "@/lib/events";
import { api, parseBody } from "@/lib/http";
import { hashPassword } from "@/lib/auth/password";
import { ROLE_LABELS } from "@/lib/rbac";
import { userCreateSchema } from "@/lib/schemas";

/** Members of the caller's organization. Readable by anyone signed in. */
export const GET = api(null, async ({ auth }) => {
  const memberships = await prisma.membership.findMany({
    where: { organizationId: auth.organizationId },
    include: { user: { select: { id: true, name: true, email: true, createdAt: true } } },
    orderBy: { createdAt: "asc" },
  });
  return {
    data: memberships.map((m) => ({ ...m.user, role: m.role, memberSince: m.createdAt })),
  };
});

export const POST = api("users:manage", async ({ req, auth }) => {
  const input = await parseBody(req, userCreateSchema);
  if (await prisma.user.findUnique({ where: { email: input.email } })) {
    throw conflict("An account with this email already exists");
  }
  const user = await prisma.user.create({
    data: {
      email: input.email,
      name: input.name,
      passwordHash: await hashPassword(input.password),
      memberships: { create: { organizationId: auth.organizationId, role: input.role } },
    },
    select: { id: true, name: true, email: true, createdAt: true },
  });
  await audit(prisma, {
    organizationId: auth.organizationId,
    actor: auth.actor,
    action: "user.added",
    entityType: "user",
    entityId: user.id,
    summary: `Added ${user.name} as ${ROLE_LABELS[input.role]}`,
  });
  return Response.json({ ...user, role: input.role }, { status: 201 });
});
