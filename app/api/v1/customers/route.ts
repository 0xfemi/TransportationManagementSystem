import { collectionHandlers } from "@/lib/crud";
import { customerCrud } from "@/lib/masterdata";

const handlers = collectionHandlers(customerCrud);

export const GET = handlers.GET;
export const POST = handlers.POST;
