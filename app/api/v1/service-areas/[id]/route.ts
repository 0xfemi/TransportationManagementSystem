import { itemHandlers } from "@/lib/crud";
import { serviceAreaCrud } from "@/lib/masterdata";

const handlers = itemHandlers(serviceAreaCrud);

export const GET = handlers.GET;
export const PATCH = handlers.PATCH;
export const DELETE = handlers.DELETE;
