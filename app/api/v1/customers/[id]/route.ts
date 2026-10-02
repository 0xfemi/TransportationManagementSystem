import { itemHandlers } from "@/lib/crud";
import { customerCrud } from "@/lib/masterdata";

const handlers = itemHandlers(customerCrud);

export const GET = handlers.GET;
export const PATCH = handlers.PATCH;
export const DELETE = handlers.DELETE;
