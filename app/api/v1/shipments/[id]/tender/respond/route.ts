import { api, parseBody } from "@/lib/http";
import { tenderResponseSchema } from "@/lib/schemas";
import { respondToTender } from "@/modules/shipments/service";

/**
 * Records the carrier's answer to the open tender. Until the carrier portal
 * exists, a planner enters it on the carrier's behalf (or a carrier system
 * calls this with an API key).
 */
export const POST = api("shipments:plan", async ({ req, auth, params }) =>
  respondToTender(auth, params.id, await parseBody(req, tenderResponseSchema)),
);
