import { api } from "@/lib/http";
import { dispatchShipment } from "@/modules/shipments/service";

export const POST = api("shipments:dispatch", ({ auth, params }) =>
  dispatchShipment(auth, params.id),
);
