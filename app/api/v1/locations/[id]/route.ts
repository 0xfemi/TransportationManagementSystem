import { itemHandlers } from "@/lib/crud";
import { locationCrud } from "@/lib/masterdata";

const handlers = itemHandlers(locationCrud);

export const GET = handlers.GET;
export const PATCH = handlers.PATCH;
export const DELETE = handlers.DELETE;
