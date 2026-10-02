import { api, parseBody } from "@/lib/http";
import { maintenanceCompleteSchema } from "@/lib/schemas";
import { completeMaintenance } from "@/modules/maintenance/service";

export const POST = api("masterdata:write", async ({ req, auth, params }) =>
  completeMaintenance(auth, params.id, await parseBody(req, maintenanceCompleteSchema)),
);
