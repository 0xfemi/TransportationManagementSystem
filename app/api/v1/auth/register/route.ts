import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { conflict } from "@/lib/errors";
import { audit } from "@/lib/events";
import { parseBody, publicApi } from "@/lib/http";
import { hashPassword } from "@/lib/auth/password";
import { sessionCookie, signSession } from "@/lib/auth/session";
import { clientIp, rateLimit } from "@/lib/rateLimit";
import { registerSchema } from "@/lib/schemas";

/** Creates a new organization with its first admin and signs them in. */
export const POST = publicApi(async (req) => {
  await rateLimit(`register:${clientIp(req)}`, 10, 3600);
  const input = await parseBody(req, registerSchema);

  if (await prisma.user.findUnique({ where: { email: input.email } })) {
    throw conflict("An account with this email already exists");
  }
  const passwordHash = await hashPassword(input.password);
  const { user, organization } = await prisma.$transaction(async (tx) => {
    const organization = await tx.organization.create({ data: { name: input.organizationName } });
    const user = await tx.user.create({
      data: {
        email: input.email,
        name: input.name,
        passwordHash,
        memberships: { create: { organizationId: organization.id, role: "ADMIN" } },
      },
    });
    await audit(tx, {
      organizationId: organization.id,
      actor: { type: "user", id: user.id, label: user.name },
      action: "organization.created",
      entityType: "organization",
      entityId: organization.id,
      summary: `Created organization "${organization.name}"`,
    });
    return { user, organization };
  });

  const response = NextResponse.json(
    {
      user: { id: user.id, name: user.name, email: user.email },
      organization: { id: organization.id, name: organization.name },
      role: "ADMIN",
    },
    { status: 201 },
  );
  response.headers.set(
    "Set-Cookie",
    sessionCookie(await signSession({ userId: user.id, organizationId: organization.id })),
  );
  return response;
});
