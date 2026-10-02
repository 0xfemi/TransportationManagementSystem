import { api, parseBody } from "@/lib/http";
import { simulateSchema } from "@/lib/schemas";
import { simulateTracking } from "@/modules/tracking/simulator";

/**
 * Demo and test aid: generates the tracking events a vehicle would have sent
 * over the next N minutes. Events are stored with source "simulator".
 */
export const POST = api("tracking:write", async ({ req, auth, params }) =>
  simulateTracking(auth, params.id, await parseBody(req, simulateSchema)),
);
