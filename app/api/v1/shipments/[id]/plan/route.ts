import { api, parseBody } from "@/lib/http";
import { shipmentPlanSchema } from "@/lib/schemas";
import { planShipment } from "@/modules/shipments/service";

/** Optimizes the stop sequence and schedules the shipment. */
export const POST = api("shipments:plan", async ({ req, auth, params }) =>
  planShipment(auth, params.id, await parseBody(req, shipmentPlanSchema)),
);
