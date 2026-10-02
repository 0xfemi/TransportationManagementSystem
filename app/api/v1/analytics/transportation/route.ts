import { z } from "zod";
import { unprocessable } from "@/lib/errors";
import { api, parseQuery } from "@/lib/http";
import { transportationAnalytics } from "@/modules/analytics/service";

const query = z.object({
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  carrierId: z.string().optional(),
  customerId: z.string().optional(),
});

/**
 * Defaults to the last 30 days with no upper bound, so deliveries stamped
 * ahead of the server clock (simulated runs, device clock skew) still count.
 */
export const GET = api("analytics:read", async ({ req, auth }) => {
  const input = parseQuery(req, query);
  const from = input.from ?? new Date(Date.now() - 30 * 86_400_000);
  if (input.to && from >= input.to) throw unprocessable('"from" must be before "to"');
  return transportationAnalytics(auth.organizationId, {
    from,
    to: input.to,
    carrierId: input.carrierId,
    customerId: input.customerId,
  });
});
