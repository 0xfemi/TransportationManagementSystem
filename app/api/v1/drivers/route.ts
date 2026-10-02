import { collectionHandlers } from "@/lib/crud";
import { driverCrud } from "@/lib/masterdata";

const handlers = collectionHandlers(driverCrud);

export const GET = handlers.GET;
export const POST = handlers.POST;
