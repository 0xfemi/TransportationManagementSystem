import { z } from "zod";
import { unprocessable } from "@/lib/errors";
import { api, parseQuery } from "@/lib/http";
import { csvResponse } from "@/lib/csv";
import { analyticsCsv, transportationAnalytics } from "@/modules/analytics/service";

const query = z.object({
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  carrierId: z.string().optional(),
  customerId: z.string().optional(),
  // csv returns one table as a spreadsheet download.
  format: z.enum(["json", "csv"]).default("json"),
  table: z.enum(["daily", "carriers"]).default("daily"),
});

/**
 * Defaults to the last 30 days with no upper bound, so deliveries stamped
 * ahead of the server clock (simulated runs, device clock skew) still count.
 */
export const GET = api("analytics:read", async ({ req, auth }) => {
  const input = parseQuery(req, query);
  const from = input.from ?? new Date(Date.now() - 30 * 86_400_000);
  if (input.to && from >= input.to) throw unprocessable('"from" must be before "to"');
  const result = await transportationAnalytics(auth.organizationId, {
    from,
    to: input.to,
    carrierId: input.carrierId,
    customerId: input.customerId,
  });
  if (input.format === "csv") {
    const day = from.toISOString().slice(0, 10);
    return csvResponse(`transportation-${input.table}-from-${day}.csv`, analyticsCsv(result, input.table));
  }
  return result;
});
