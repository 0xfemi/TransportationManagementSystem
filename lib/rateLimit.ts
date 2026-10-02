import { prisma } from "@/lib/prisma";
import { tooManyRequests } from "@/lib/errors";

/**
 * Fixed-window limiter backed by Postgres so the count is shared by every
 * server instance (serverless functions do not share memory).
 */
export async function rateLimit(
  key: string,
  limit: number,
  windowSec: number,
): Promise<void> {
  const now = new Date();
  const windowStartsAfter = new Date(now.getTime() - windowSec * 1000);
  const rows = await prisma.$queryRaw<{ count: number; windowStart: Date }[]>`
    INSERT INTO "RateLimit" ("key", "count", "windowStart")
    VALUES (${key}, 1, ${now})
    ON CONFLICT ("key") DO UPDATE SET
      "count" = CASE WHEN "RateLimit"."windowStart" < ${windowStartsAfter}
                     THEN 1 ELSE "RateLimit"."count" + 1 END,
      "windowStart" = CASE WHEN "RateLimit"."windowStart" < ${windowStartsAfter}
                           THEN ${now} ELSE "RateLimit"."windowStart" END
    RETURNING "count", "windowStart"
  `;
  const row = rows[0];
  if (row.count > limit) {
    const retryAfter = Math.max(
      1,
      Math.ceil((row.windowStart.getTime() + windowSec * 1000 - now.getTime()) / 1000),
    );
    throw tooManyRequests(retryAfter);
  }
}

export function clientIp(req: Request): string {
  return req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
}
