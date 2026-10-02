import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as {
  prisma?: PrismaClient;
};

/**
 * Supabase's transaction pooler (port 6543) hands each transaction to any
 * backend connection, so Prisma's named prepared statements collide
 * ("prepared statement \"s0\" already exists" / "does not exist") and queries
 * fail at random. `pgbouncer=true` turns prepared statements off. Enforce it
 * here so a DATABASE_URL set without it still works.
 */
function withPoolerParams(raw: string | undefined): string | undefined {
  if (!raw) return raw;
  try {
    const url = new URL(raw);
    if (url.port === "6543" && url.searchParams.get("pgbouncer") !== "true") {
      url.searchParams.set("pgbouncer", "true");
    }
    return url.toString();
  } catch {
    return raw;
  }
}

const databaseUrl = withPoolerParams(process.env.DATABASE_URL);

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    ...(databaseUrl ? { datasources: { db: { url: databaseUrl } } } : {}),
    log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
