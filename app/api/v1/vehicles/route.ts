import { collectionHandlers } from "@/lib/crud";
import { vehicleCrud } from "@/lib/masterdata";

const handlers = collectionHandlers(vehicleCrud);

export const GET = handlers.GET;
export const POST = handlers.POST;
