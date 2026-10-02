import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { unauthorized } from "@/lib/errors";
import { parseBody, publicApi } from "@/lib/http";
import { hashPassword, verifyPassword } from "@/lib/auth/password";
import { sessionCookie, signSession } from "@/lib/auth/session";
import { clientIp, rateLimit } from "@/lib/rateLimit";
import { loginSchema } from "@/lib/schemas";

// Compared against when the email is unknown, so a miss costs the same
// time as a wrong password and does not reveal which emails exist.
let dummyHash: Promise<string> | undefined;

export const POST = publicApi(async (req) => {
  const input = await parseBody(req, loginSchema);
  await rateLimit(`login:${clientIp(req)}:${input.email}`, 10, 900);

  const user = await prisma.user.findUnique({
    where: { email: input.email },
    include: {
      memberships: { orderBy: { createdAt: "asc" }, take: 1, include: { organization: true } },
    },
  });
  dummyHash ??= hashPassword("placeholder-for-unknown-accounts");
  const valid = await verifyPassword(input.password, user?.passwordHash ?? (await dummyHash));
  const membership = user?.memberships[0];
  if (!user || !valid || !membership) throw unauthorized("Incorrect email or password");

  const response = NextResponse.json({
    user: { id: user.id, name: user.name, email: user.email },
    organization: { id: membership.organizationId, name: membership.organization.name },
    role: membership.role,
  });
  response.headers.set(
    "Set-Cookie",
    sessionCookie(await signSession({ userId: user.id, organizationId: membership.organizationId })),
  );
  return response;
});
