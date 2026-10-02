import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { api, parseQuery } from "@/lib/http";
import { can } from "@/lib/rbac";

const query = z.object({ q: z.string().trim().min(1).max(100) });
const PER_TYPE = 5;

type Hit = { type: string; id: string; title: string; subtitle: string; href: string };

/** Global search across the records the caller is allowed to read. */
export const GET = api(null, async ({ req, auth }) => {
  const { q } = parseQuery(req, query);
  const organizationId = auth.organizationId;
  const contains = { contains: q, mode: "insensitive" as const };
  const none = Promise.resolve([]);
  const master = can(auth.role, "masterdata:read");

  const [shipments, orders, customers, carriers, vehicles, drivers, locations] = await Promise.all([
    can(auth.role, "shipments:read")
      ? prisma.shipment.findMany({
          where: { organizationId, number: contains },
          select: { id: true, number: true, status: true },
          take: PER_TYPE,
          orderBy: { createdAt: "desc" },
        })
      : none,
    can(auth.role, "orders:read")
      ? prisma.order.findMany({
          where: { organizationId, OR: [{ number: contains }, { reference: contains }] },
          select: { id: true, number: true, status: true, customer: { select: { name: true } } },
          take: PER_TYPE,
          orderBy: { createdAt: "desc" },
        })
      : none,
    master
      ? prisma.customer.findMany({
          where: { organizationId, deletedAt: null, name: contains },
          select: { id: true, name: true, email: true },
          take: PER_TYPE,
        })
      : none,
    master
      ? prisma.carrier.findMany({
          where: { organizationId, deletedAt: null, OR: [{ name: contains }, { code: contains }] },
          select: { id: true, name: true, status: true },
          take: PER_TYPE,
        })
      : none,
    master
      ? prisma.vehicle.findMany({
          where: { organizationId, deletedAt: null, OR: [{ name: contains }, { registration: contains }] },
          select: { id: true, name: true, vehicleType: true },
          take: PER_TYPE,
        })
      : none,
    master
      ? prisma.driver.findMany({
          where: { organizationId, deletedAt: null, name: contains },
          select: { id: true, name: true, phone: true },
          take: PER_TYPE,
        })
      : none,
    master
      ? prisma.location.findMany({
          where: { organizationId, deletedAt: null, OR: [{ name: contains }, { city: contains }] },
          select: { id: true, name: true, city: true, type: true },
          take: PER_TYPE,
        })
      : none,
  ]);

  const lower = (s: string) => s.toLowerCase().replaceAll("_", " ");
  const hits: Hit[] = [
    ...shipments.map((s) => ({
      type: "Shipment",
      id: s.id,
      title: s.number,
      subtitle: lower(s.status),
      href: `/shipments/${s.id}`,
    })),
    ...orders.map((o) => ({
      type: "Order",
      id: o.id,
      title: o.number,
      subtitle: `${o.customer.name} · ${lower(o.status)}`,
      href: `/orders/${o.id}`,
    })),
    ...customers.map((c) => ({
      type: "Customer",
      id: c.id,
      title: c.name,
      subtitle: c.email ?? "",
      href: `/customers?q=${encodeURIComponent(c.name)}`,
    })),
    ...carriers.map((c) => ({
      type: "Carrier",
      id: c.id,
      title: c.name,
      subtitle: lower(c.status),
      href: `/carriers/${c.id}`,
    })),
    ...vehicles.map((v) => ({
      type: "Vehicle",
      id: v.id,
      title: v.name,
      subtitle: v.vehicleType,
      href: `/vehicles?q=${encodeURIComponent(v.name)}`,
    })),
    ...drivers.map((d) => ({
      type: "Driver",
      id: d.id,
      title: d.name,
      subtitle: d.phone ?? "",
      href: `/drivers?q=${encodeURIComponent(d.name)}`,
    })),
    ...locations.map((l) => ({
      type: "Location",
      id: l.id,
      title: l.name,
      subtitle: [lower(l.type), l.city].filter(Boolean).join(" · "),
      href: `/locations?q=${encodeURIComponent(l.name)}`,
    })),
  ];
  return { data: hits };
});
