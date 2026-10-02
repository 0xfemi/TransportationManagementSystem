import { itemHandlers } from "@/lib/crud";
import { vehicleCrud } from "@/lib/masterdata";

const handlers = itemHandlers(vehicleCrud);

export const GET = handlers.GET;
export const PATCH = handlers.PATCH;
export const DELETE = handlers.DELETE;
