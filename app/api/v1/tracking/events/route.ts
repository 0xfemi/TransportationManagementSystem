import { api, parseBody } from "@/lib/http";
import { trackingEventSchema } from "@/lib/schemas";
import { ingestTrackingEvent } from "@/modules/tracking/service";

/**
 * Entry point for drivers, carriers and telematics providers. Send
 * `externalId` to make retries safe: a repeated id is acknowledged without
 * being applied twice.
 */
export const POST = api("tracking:write", async ({ req, auth }) => {
  const input = await parseBody(req, trackingEventSchema);
  const result = await ingestTrackingEvent(
    { ...auth, source: auth.via === "api_key" ? "api" : "user" },
    input,
  );
  return Response.json(result, { status: result.duplicate ? 200 : 201 });
});
