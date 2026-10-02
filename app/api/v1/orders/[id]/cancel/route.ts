import { api, parseBody } from "@/lib/http";
import { cancelSchema } from "@/lib/schemas";
import { cancelOrder } from "@/modules/orders/service";

export const POST = api("orders:write", async ({ req, auth, params }) => {
  const { reason } = await parseBody(req, cancelSchema);
  return cancelOrder(auth, params.id, reason);
});
