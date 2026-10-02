import { prisma } from "@/lib/prisma";
import { notFound } from "@/lib/errors";
import { api, parseBody } from "@/lib/http";
import { maintenanceUpdateSchema } from "@/lib/schemas";
import { maintenanceInclude, updateMaintenance } from "@/modules/maintenance/service";

/** A work order with its audit history. */
export const GET = api("masterdata:read", async ({ auth, params }) => {
  const order = await prisma.maintenanceOrder.findFirst({
    where: { id: params.id, organizationId: auth.organizationId },
    include: maintenanceInclude,
  });
  if (!order) throw notFound("Maintenance order");
  const history = await prisma.auditLog.findMany({
    where: { organizationId: auth.organizationId, entityType: "maintenance", entityId: order.id },
    orderBy: { createdAt: "asc" },
  });
  return { ...order, history };
});

export const PATCH = api("masterdata:write", async ({ req, auth, params }) =>
  updateMaintenance(auth, params.id, await parseBody(req, maintenanceUpdateSchema)),
);
