import type { NextRequest } from "next/server";
import type { z } from "zod";
import { prisma } from "@/lib/prisma";
import { notFound } from "@/lib/errors";
import { audit } from "@/lib/events";
import { api, page, pageQuery, parseBody, parseQuery } from "@/lib/http";

type ModelName = "customer" | "location" | "carrier" | "vehicle" | "driver";

/** Foreign keys a payload may carry, and the model each must belong to. */
type References = Record<string, ModelName>;

export type CrudConfig = {
  model: ModelName;
  label: string;
  schema: z.ZodObject;
  searchFields: string[];
  include?: Record<string, unknown>;
  references?: References;
  /** Extra filters read from the query string. */
  filters?: (req: NextRequest) => Record<string, unknown>;
};

// The five master-data models share this shape; Prisma's per-model delegate
// types cannot be expressed generically, hence the cast.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const delegate = (model: ModelName) => (prisma as any)[model];

async function assertReferences(
  organizationId: string,
  references: References | undefined,
  data: Record<string, unknown>,
) {
  for (const [field, model] of Object.entries(references ?? {})) {
    const value = data[field];
    if (!value) continue;
    const found = await delegate(model).findFirst({
      where: { id: value, organizationId, deletedAt: null },
      select: { id: true },
    });
    if (!found) throw notFound(`Referenced ${model}`);
  }
}

export function collectionHandlers(config: CrudConfig) {
  const GET = api("masterdata:read", async ({ req, auth }) => {
    const { limit, offset, q } = parseQuery(req, pageQuery);
    const where = {
      organizationId: auth.organizationId,
      deletedAt: null,
      ...(config.filters?.(req) ?? {}),
      ...(q
        ? { OR: config.searchFields.map((f) => ({ [f]: { contains: q, mode: "insensitive" } })) }
        : {}),
    };
    const [data, total] = await Promise.all([
      delegate(config.model).findMany({
        where,
        include: config.include,
        orderBy: { name: "asc" },
        take: limit,
        skip: offset,
      }),
      delegate(config.model).count({ where }),
    ]);
    return page(data, total, limit, offset);
  });

  const POST = api("masterdata:write", async ({ req, auth }) => {
    const data = (await parseBody(req, config.schema)) as Record<string, unknown>;
    await assertReferences(auth.organizationId, config.references, data);
    const created = await delegate(config.model).create({
      data: { ...data, organizationId: auth.organizationId },
      include: config.include,
    });
    await audit(prisma, {
      organizationId: auth.organizationId,
      actor: auth.actor,
      action: `${config.model}.created`,
      entityType: config.model,
      entityId: created.id,
      summary: `Added ${config.label} "${created.name}"`,
    });
    return Response.json(created, { status: 201 });
  });

  return { GET, POST };
}

export function itemHandlers(config: CrudConfig) {
  const find = async (organizationId: string, id: string) => {
    const row = await delegate(config.model).findFirst({
      where: { id, organizationId, deletedAt: null },
      include: config.include,
    });
    if (!row) throw notFound(config.label[0].toUpperCase() + config.label.slice(1));
    return row;
  };

  const GET = api("masterdata:read", ({ auth, params }) => find(auth.organizationId, params.id));

  const PATCH = api("masterdata:write", async ({ req, auth, params }) => {
    const before = await find(auth.organizationId, params.id);
    const data = (await parseBody(req, config.schema.partial())) as Record<string, unknown>;
    await assertReferences(auth.organizationId, config.references, data);
    const updated = await delegate(config.model).update({
      where: { id: params.id },
      data,
      include: config.include,
    });
    const changed = Object.keys(data).filter(
      (key) => JSON.stringify(before[key]) !== JSON.stringify(updated[key]),
    );
    if (changed.length) {
      await audit(prisma, {
        organizationId: auth.organizationId,
        actor: auth.actor,
        action: `${config.model}.updated`,
        entityType: config.model,
        entityId: params.id,
        summary: `Updated ${config.label} "${updated.name}" (${changed.join(", ")})`,
        before: Object.fromEntries(changed.map((key) => [key, before[key]])),
        after: Object.fromEntries(changed.map((key) => [key, updated[key]])),
      });
    }
    return updated;
  });

  const DELETE = api("masterdata:write", async ({ auth, params }) => {
    const existing = await find(auth.organizationId, params.id);
    // Soft delete: orders and shipments keep pointing at the record.
    await delegate(config.model).update({
      where: { id: params.id },
      data: { deletedAt: new Date() },
    });
    await audit(prisma, {
      organizationId: auth.organizationId,
      actor: auth.actor,
      action: `${config.model}.deleted`,
      entityType: config.model,
      entityId: params.id,
      summary: `Removed ${config.label} "${existing.name}"`,
    });
    return { ok: true };
  });

  return { GET, PATCH, DELETE };
}
