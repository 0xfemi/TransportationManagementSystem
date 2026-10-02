import { collectionHandlers } from "@/lib/crud";
import { carrierCrud } from "@/lib/masterdata";

const handlers = collectionHandlers(carrierCrud);

export const GET = handlers.GET;
export const POST = handlers.POST;
