import { prisma } from "@/lib/prisma";
import { notFound } from "@/lib/errors";
import { api } from "@/lib/http";
import { transportationAnalytics } from "@/modules/analytics/service";

const DAYS = 90;

/** Measured performance for one carrier over the last 90 days. */
export const GET = api("analytics:read", async ({ auth, params }) => {
  const carrier = await prisma.carrier.findFirst({
    where: { id: params.id, organizationId: auth.organizationId, deletedAt: null },
    select: { id: true },
  });
  if (!carrier) throw notFound("Carrier");
  const analytics = await transportationAnalytics(auth.organizationId, {
    from: new Date(Date.now() - DAYS * 86_400_000),
    carrierId: carrier.id,
  });
  return {
    periodDays: DAYS,
    ...analytics.totals,
    methodology: analytics.methodology,
  };
});
