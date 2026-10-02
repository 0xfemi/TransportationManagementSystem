import { api, parseBody } from "@/lib/http";
import { cancelSchema } from "@/lib/schemas";
import { cancelShipment } from "@/modules/shipments/service";

export const POST = api("shipments:write", async ({ req, auth, params }) => {
  const { reason } = await parseBody(req, cancelSchema);
  return cancelShipment(auth, params.id, reason);
});
