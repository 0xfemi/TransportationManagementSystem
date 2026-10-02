import { api } from "@/lib/http";
import { commandCenter } from "@/modules/commandCenter/service";

export const GET = api("shipments:read", ({ auth }) => commandCenter(auth.organizationId));
