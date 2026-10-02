import { collectionHandlers } from "@/lib/crud";
import { locationCrud } from "@/lib/masterdata";

const handlers = collectionHandlers(locationCrud);

export const GET = handlers.GET;
export const POST = handlers.POST;
