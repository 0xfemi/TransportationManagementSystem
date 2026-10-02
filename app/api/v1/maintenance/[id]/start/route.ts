import { api } from "@/lib/http";
import { startMaintenance } from "@/modules/maintenance/service";

export const POST = api("masterdata:write", ({ auth, params }) => startMaintenance(auth, params.id));
