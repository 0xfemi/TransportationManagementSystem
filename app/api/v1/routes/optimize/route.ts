import { api, parseBody } from "@/lib/http";
import { optimizeSchema } from "@/lib/schemas";
import { proposePlans } from "@/modules/planning/service";

/** Proposes route plans for a set of orders and vehicles. Saves nothing. */
export const POST = api("shipments:plan", async ({ req, auth }) =>
  proposePlans(auth, await parseBody(req, optimizeSchema)),
);
