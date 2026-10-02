import { prisma } from "@/lib/prisma";
import { unprocessable } from "@/lib/errors";
import { audit } from "@/lib/events";
import { api, parseBody } from "@/lib/http";
import { organizationUpdateSchema } from "@/lib/schemas";
import { isValidTimeZone } from "@/lib/time";

export const GET = api(null, ({ auth }) =>
  prisma.organization.findUniqueOrThrow({ where: { id: auth.organizationId } }),
);

export const PATCH = api("settings:manage", async ({ req, auth }) => {
  const input = await parseBody(req, organizationUpdateSchema);
  if (input.timezone && !isValidTimeZone(input.timezone)) {
    throw unprocessable(`"${input.timezone}" is not a recognised IANA time zone`);
  }
  const before = await prisma.organization.findUniqueOrThrow({ where: { id: auth.organizationId } });
  const updated = await prisma.organization.update({ where: { id: auth.organizationId }, data: input });
  const keys = Object.keys(input) as (keyof typeof input)[];
  await audit(prisma, {
    organizationId: auth.organizationId,
    actor: auth.actor,
    action: "organization.updated",
    entityType: "organization",
    entityId: auth.organizationId,
    summary: `Updated organization settings (${keys.join(", ")})`,
    before: Object.fromEntries(keys.map((k) => [k, before[k]])),
    after: Object.fromEntries(keys.map((k) => [k, updated[k]])),
  });
  return updated;
});
