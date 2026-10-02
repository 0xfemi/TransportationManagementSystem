import { api, parseBody } from "@/lib/http";
import { cancelSchema } from "@/lib/schemas";
import { cancelMaintenance } from "@/modules/maintenance/service";

export const POST = api("masterdata:write", async ({ req, auth, params }) => {
  const { reason } = await parseBody(req, cancelSchema);
  return cancelMaintenance(auth, params.id, reason);
});
