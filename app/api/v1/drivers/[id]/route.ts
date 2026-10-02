import { itemHandlers } from "@/lib/crud";
import { driverCrud } from "@/lib/masterdata";

const handlers = itemHandlers(driverCrud);

export const GET = handlers.GET;
export const PATCH = handlers.PATCH;
export const DELETE = handlers.DELETE;
