import { api, parseBody } from "@/lib/http";
import { commitPlanSchema } from "@/lib/schemas";
import { commitPlan } from "@/modules/planning/service";

/** Approves a proposed plan: creates one planned shipment per route. */
export const POST = api("shipments:plan", async ({ req, auth }) =>
  Response.json(await commitPlan(auth, await parseBody(req, commitPlanSchema)), { status: 201 }),
);
