import type { Role } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { API_KEY_PREFIX, hashApiKey } from "./apiKeys";
import { SESSION_COOKIE, readCookie, verifySession } from "./session";

export type Actor = {
  type: "user" | "api_key" | "system" | "simulator";
  id: string | null;
  label: string;
};

export type AuthContext = {
  organizationId: string;
  role: Role;
  actor: Actor;
  userId: string | null;
  via: "session" | "api_key";
};

export const SYSTEM_ACTOR: Actor = { type: "system", id: null, label: "System" };

/**
 * Resolves the caller from an API key (`Authorization: Bearer tms_…`) or the
 * session cookie. The role is read from the database on every request, so
 * removing a member or changing their role takes effect immediately.
 */
export async function authenticate(req: Request): Promise<AuthContext | null> {
  const authorization = req.headers.get("authorization");
  if (authorization?.startsWith("Bearer ")) {
    const key = authorization.slice(7).trim();
    if (!key.startsWith(API_KEY_PREFIX)) return null;
    const apiKey = await prisma.apiKey.findUnique({
      where: { keyHash: hashApiKey(key) },
    });
    if (!apiKey || apiKey.revokedAt) return null;
    await prisma.apiKey.update({
      where: { id: apiKey.id },
      data: { lastUsedAt: new Date() },
    });
    return {
      organizationId: apiKey.organizationId,
      role: apiKey.role,
      actor: { type: "api_key", id: apiKey.id, label: `API key "${apiKey.name}"` },
      userId: null,
      via: "api_key",
    };
  }

  const token = readCookie(req.headers.get("cookie"), SESSION_COOKIE);
  if (!token) return null;
  const claims = await verifySession(token);
  if (!claims) return null;
  const membership = await prisma.membership.findUnique({
    where: {
      organizationId_userId: {
        organizationId: claims.organizationId,
        userId: claims.userId,
      },
    },
    include: { user: { select: { name: true } } },
  });
  if (!membership) return null;
  return {
    organizationId: membership.organizationId,
    role: membership.role,
    actor: { type: "user", id: membership.userId, label: membership.user.name },
    userId: membership.userId,
    via: "session",
  };
}
