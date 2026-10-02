import { itemHandlers } from "@/lib/crud";
import { carrierCrud } from "@/lib/masterdata";

const handlers = itemHandlers(carrierCrud);

export const GET = handlers.GET;
export const PATCH = handlers.PATCH;
export const DELETE = handlers.DELETE;
