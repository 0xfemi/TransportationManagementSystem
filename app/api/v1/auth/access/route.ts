import { createHash, randomBytes, timingSafeEqual } from "crypto";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { notFound, unauthorized } from "@/lib/errors";
import { audit } from "@/lib/events";
import { publicApi } from "@/lib/http";
import { hashPassword } from "@/lib/auth/password";
import { sessionCookie, signSession } from "@/lib/auth/session";
import { clientIp, rateLimit } from "@/lib/rateLimit";

/** Shortest key accepted; anything weaker leaves the link switched off. */
const MIN_KEY_LENGTH = 32;
const DEFAULT_EMAIL = "admin@tms.local";

function configuredKey(): string | null {
  const key = process.env.ADMIN_ACCESS_KEY?.trim();
  return key && key.length >= MIN_KEY_LENGTH ? key : null;
}

/** Compares hashes so neither the length nor the content leaks through timing. */
function matches(candidate: string, key: string): boolean {
  const digest = (value: string) => createHash("sha256").update(value).digest();
  return timingSafeEqual(digest(candidate), digest(key));
}

/** Only same-site paths, so the link cannot be turned into an open redirect. */
function safeNext(value: string | null): string {
  return value && value.startsWith("/") && !value.startsWith("//") ? value : "/command-center";
}

/**
 * The admin membership the link signs into: ADMIN_ACCESS_EMAIL's, else the
 * oldest admin anywhere. On an empty database it creates an organization and
 * an admin whose password is random and never shown, so the link is the only
 * way in until a password is set by another admin.
 */
async function adminMembership() {
  const email = process.env.ADMIN_ACCESS_EMAIL?.trim().toLowerCase() || null;
  const existing = await prisma.membership.findFirst({
    where: { role: "ADMIN", ...(email ? { user: { email } } : {}) },
    orderBy: { createdAt: "asc" },
    include: { user: true },
  });
  if (existing) return existing;

  if (email && (await prisma.user.findUnique({ where: { email } }))) {
    throw unauthorized(`${email} is not an admin of any organization`);
  }

  const passwordHash = await hashPassword(randomBytes(32).toString("hex"));
  return prisma.$transaction(async (tx) => {
    const organization = await tx.organization.create({ data: { name: "My organization" } });
    const user = await tx.user.create({
      data: { email: email ?? DEFAULT_EMAIL, name: "Administrator", passwordHash },
    });
    const membership = await tx.membership.create({
      data: { organizationId: organization.id, userId: user.id, role: "ADMIN" },
      include: { user: true },
    });
    await audit(tx, {
      organizationId: organization.id,
      actor: { type: "system", id: null, label: "Admin access link" },
      action: "organization.created",
      entityType: "organization",
      entityId: organization.id,
      summary: `Created organization "${organization.name}" and its administrator on first use of the admin access link`,
    });
    return membership;
  });
}

/**
 * GET /api/v1/auth/access?key=…[&next=/path]
 *
 * One-click admin sign-in for the owner of the deployment. Off unless
 * ADMIN_ACCESS_KEY is set (32+ characters); rotating that variable revokes
 * every copy of the link. Sessions it creates are ordinary sessions.
 */
export const GET = publicApi(async (req) => {
  const key = configuredKey();
  if (!key) throw notFound("Page");

  await rateLimit(`access:${clientIp(req)}`, 10, 900);
  const url = new URL(req.url);
  if (!matches(url.searchParams.get("key") ?? "", key)) {
    throw unauthorized("This access link is not valid");
  }

  const membership = await adminMembership();
  await audit(prisma, {
    organizationId: membership.organizationId,
    actor: { type: "user", id: membership.userId, label: membership.user.name },
    action: "auth.access_link",
    entityType: "user",
    entityId: membership.userId,
    summary: `${membership.user.name} signed in with the admin access link`,
  });

  const response = NextResponse.redirect(new URL(safeNext(url.searchParams.get("next")), url), 303);
  response.headers.set(
    "Set-Cookie",
    sessionCookie(await signSession({ userId: membership.userId, organizationId: membership.organizationId })),
  );
  // The key is in the URL; keep it out of caches and referrers.
  response.headers.set("Cache-Control", "no-store");
  response.headers.set("Referrer-Policy", "no-referrer");
  return response;
});
