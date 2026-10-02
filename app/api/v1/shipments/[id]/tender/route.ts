import { api, parseBody } from "@/lib/http";
import { tenderSchema } from "@/lib/schemas";
import { tenderShipment } from "@/modules/shipments/service";

export const POST = api("shipments:plan", async ({ req, auth, params }) => {
  const { carrierId } = await parseBody(req, tenderSchema);
  return Response.json(await tenderShipment(auth, params.id, carrierId), { status: 201 });
});
