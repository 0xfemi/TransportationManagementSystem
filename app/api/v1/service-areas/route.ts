import { collectionHandlers } from "@/lib/crud";
import { serviceAreaCrud } from "@/lib/masterdata";

const handlers = collectionHandlers(serviceAreaCrud);

export const GET = handlers.GET;
export const POST = handlers.POST;
