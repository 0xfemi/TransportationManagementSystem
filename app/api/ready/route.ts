import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

/** Readiness: the app can reach its database. */
export async function GET() {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return Response.json({ status: "ready" });
  } catch {
    return Response.json({ status: "unavailable", reason: "database" }, { status: 503 });
  }
}
