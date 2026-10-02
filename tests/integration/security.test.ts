import { beforeAll, describe, expect, it } from "vitest";
import { call, unique } from "../helpers";
import * as register from "@/app/api/v1/auth/register/route";
import * as login from "@/app/api/v1/auth/login/route";
import * as me from "@/app/api/v1/auth/me/route";
import * as users from "@/app/api/v1/users/route";
import * as user from "@/app/api/v1/users/[id]/route";
import * as apiKeys from "@/app/api/v1/api-keys/route";
import * as apiKey from "@/app/api/v1/api-keys/[id]/route";
import * as customers from "@/app/api/v1/customers/route";
import * as customer from "@/app/api/v1/customers/[id]/route";
import * as locations from "@/app/api/v1/locations/route";
import * as orders from "@/app/api/v1/orders/route";
import * as order from "@/app/api/v1/orders/[id]/route";
import * as shipments from "@/app/api/v1/shipments/route";
import * as shipment from "@/app/api/v1/shipments/[id]/route";
import * as dispatch from "@/app/api/v1/shipments/[id]/dispatch/route";
import * as trackingEvents from "@/app/api/v1/tracking/events/route";
import * as auditLog from "@/app/api/v1/audit-log/route";
import * as organization from "@/app/api/v1/organization/route";

const PASSWORD = "correct-horse-battery";

async function newOrganization(name: string) {
  const email = `${unique("sec")}@example.com`;
  const res = await call(register.POST, {
    body: { organizationName: name, name: `${name} Admin`, email, password: PASSWORD },
  });
  return { cookie: res.cookie!, email, userId: res.body.user.id as string };
}

async function addMember(adminCookie: string, role: string) {
  const email = `${unique(role.toLowerCase())}@example.com`;
  const created = await call(users.POST, {
    cookie: adminCookie,
    body: { name: `${role} user`, email, password: PASSWORD, role },
  });
  const session = await call(login.POST, { body: { email, password: PASSWORD } });
  return { cookie: session.cookie!, id: created.body.id as string, email };
}

describe("security", () => {
  let a: Awaited<ReturnType<typeof newOrganization>>;
  let b: Awaited<ReturnType<typeof newOrganization>>;
  const ids: Record<string, string> = {};

  beforeAll(async () => {
    a = await newOrganization("Tenant A");
    b = await newOrganization("Tenant B");

    const cust = await call(customers.POST, { cookie: a.cookie, body: { name: "A's customer" } });
    ids.customer = cust.body.id;
    const from = await call(locations.POST, {
      cookie: a.cookie,
      body: { name: "A warehouse", type: "WAREHOUSE", latitude: 43.65, longitude: -79.38 },
    });
    const to = await call(locations.POST, {
      cookie: a.cookie,
      body: { name: "A store", type: "CUSTOMER", latitude: 45.42, longitude: -75.69 },
    });
    ids.from = from.body.id;
    ids.to = to.body.id;
    const ord = await call(orders.POST, {
      cookie: a.cookie,
      body: {
        customerId: ids.customer,
        pickupLocationId: ids.from,
        deliveryLocationId: ids.to,
        lines: [{ description: "Goods", quantity: 1, weightKg: 10, volumeM3: 1 }],
      },
    });
    ids.order = ord.body.id;
    const shp = await call(shipments.POST, { cookie: a.cookie, body: { orderIds: [ids.order] } });
    ids.shipment = shp.body.id;
  });

  describe("authentication", () => {
    it("rejects requests with no credentials", async () => {
      expect((await call(shipments.GET)).status).toBe(401);
      expect((await call(me.GET)).status).toBe(401);
    });

    it("rejects a tampered session token", async () => {
      const tampered = a.cookie.slice(0, -4) + "AAAA";
      expect((await call(me.GET, { cookie: tampered })).status).toBe(401);
    });

    it("issues an HttpOnly, SameSite session cookie", async () => {
      const res = await call(login.POST, { body: { email: a.email, password: PASSWORD } });
      const header = res.headers.get("set-cookie")!;
      expect(header).toContain("HttpOnly");
      expect(header).toContain("SameSite=Lax");
    });

    it("gives the same answer for a wrong password and an unknown email", async () => {
      const wrong = await call(login.POST, { body: { email: a.email, password: "not-the-password" } });
      const unknown = await call(login.POST, {
        body: { email: "nobody@example.com", password: "not-the-password" },
      });
      expect(wrong.status).toBe(401);
      expect(unknown.status).toBe(401);
      expect(wrong.body).toEqual(unknown.body);
    });

    it("rate-limits repeated login attempts", async () => {
      const email = `${unique("brute")}@example.com`;
      const statuses: number[] = [];
      for (let i = 0; i < 12; i++) {
        const res = await call(login.POST, { body: { email, password: "guess-number-" + i }, ip: "203.0.113.9" });
        statuses.push(res.status);
      }
      expect(statuses.slice(0, 10).every((s) => s === 401)).toBe(true);
      expect(statuses.slice(10)).toEqual([429, 429]);
    });

    it("refuses weak passwords and never returns password hashes", async () => {
      const weak = await call(register.POST, {
        body: { organizationName: "X", name: "X", email: `${unique("weak")}@example.com`, password: "short" },
      });
      expect(weak.status).toBe(422);
      const list = await call(users.GET, { cookie: a.cookie });
      expect(JSON.stringify(list.body)).not.toContain("passwordHash");
    });
  });

  describe("tenant isolation", () => {
    it("hides another organization's records", async () => {
      expect((await call(shipment.GET, { cookie: b.cookie, params: { id: ids.shipment } })).status).toBe(404);
      expect((await call(order.GET, { cookie: b.cookie, params: { id: ids.order } })).status).toBe(404);
      expect((await call(customer.GET, { cookie: b.cookie, params: { id: ids.customer } })).status).toBe(404);
      expect((await call(shipments.GET, { cookie: b.cookie })).body.total).toBe(0);
      expect((await call(customers.GET, { cookie: b.cookie })).body.total).toBe(0);
      expect((await call(auditLog.GET, { cookie: b.cookie })).body.data.every(
        (e: any) => !e.summary.includes("A's customer"),
      )).toBe(true);
    });

    it("blocks changes to another organization's records", async () => {
      const patch = await call(customer.PATCH, {
        cookie: b.cookie,
        method: "PATCH",
        params: { id: ids.customer },
        body: { name: "Hijacked" },
      });
      expect(patch.status).toBe(404);
      const del = await call(customer.DELETE, { cookie: b.cookie, method: "DELETE", params: { id: ids.customer } });
      expect(del.status).toBe(404);
      const still = await call(customer.GET, { cookie: a.cookie, params: { id: ids.customer } });
      expect(still.body.name).toBe("A's customer");
    });

    it("refuses to build records from another organization's ids", async () => {
      const ownCustomer = await call(customers.POST, { cookie: b.cookie, body: { name: "B's customer" } });
      const res = await call(orders.POST, {
        cookie: b.cookie,
        body: {
          customerId: ownCustomer.body.id,
          pickupLocationId: ids.from,
          deliveryLocationId: ids.to,
          lines: [{ description: "Goods", quantity: 1 }],
        },
      });
      expect(res.status).toBe(404);
      const ship = await call(shipments.POST, { cookie: b.cookie, body: { orderIds: [ids.order] } });
      expect(ship.status).toBe(404);
      const loc = await call(locations.POST, {
        cookie: b.cookie,
        body: { name: "Sneaky", latitude: 1, longitude: 1, customerId: ids.customer },
      });
      expect(loc.status).toBe(404);
    });

    it("rejects tracking events for another organization's shipment", async () => {
      const res = await call(trackingEvents.POST, {
        cookie: b.cookie,
        body: { shipmentId: ids.shipment, type: "LOCATION_UPDATE", latitude: 1, longitude: 1 },
      });
      expect(res.status).toBe(404);
    });
  });

  describe("authorization", () => {
    it("enforces role permissions", async () => {
      const analyst = await addMember(a.cookie, "ANALYST");
      expect((await call(shipments.GET, { cookie: analyst.cookie })).status).toBe(200);
      expect((await call(customers.POST, { cookie: analyst.cookie, body: { name: "Nope" } })).status).toBe(403);
      expect((await call(auditLog.GET, { cookie: analyst.cookie })).status).toBe(403);

      const planner = await addMember(a.cookie, "PLANNER");
      expect((await call(customers.POST, { cookie: planner.cookie, body: { name: "Planner's customer" } })).status).toBe(201);
      const d = await call(dispatch.POST, { cookie: planner.cookie, method: "POST", params: { id: ids.shipment } });
      expect(d.status).toBe(403);
      const u = await call(users.POST, {
        cookie: planner.cookie,
        body: { name: "X", email: `${unique("x")}@example.com`, password: PASSWORD, role: "ADMIN" },
      });
      expect(u.status).toBe(403);
      expect((await call(organization.PATCH, { cookie: planner.cookie, method: "PATCH", body: { name: "Renamed" } })).status).toBe(403);
      expect((await call(apiKeys.POST, { cookie: planner.cookie, body: { name: "k", role: "ADMIN" } })).status).toBe(403);

      const driver = await addMember(a.cookie, "DRIVER");
      expect((await call(orders.GET, { cookie: driver.cookie })).status).toBe(403);
      expect((await call(customers.GET, { cookie: driver.cookie })).status).toBe(403);
    });

    it("applies a role change on the very next request", async () => {
      const member = await addMember(a.cookie, "PLANNER");
      expect((await call(customers.POST, { cookie: member.cookie, body: { name: "Before" } })).status).toBe(201);
      await call(user.PATCH, { cookie: a.cookie, method: "PATCH", params: { id: member.id }, body: { role: "ANALYST" } });
      expect((await call(customers.POST, { cookie: member.cookie, body: { name: "After" } })).status).toBe(403);
      await call(user.DELETE, { cookie: a.cookie, method: "DELETE", params: { id: member.id } });
      expect((await call(me.GET, { cookie: member.cookie })).status).toBe(401);
    });

    it("cannot manage users of another organization", async () => {
      const res = await call(user.PATCH, {
        cookie: b.cookie,
        method: "PATCH",
        params: { id: a.userId },
        body: { role: "DRIVER" },
      });
      expect(res.status).toBe(404);
    });

    it("keeps at least one admin", async () => {
      const demote = await call(user.PATCH, {
        cookie: a.cookie,
        method: "PATCH",
        params: { id: a.userId },
        body: { role: "ANALYST" },
      });
      expect(demote.status).toBe(409);
      const remove = await call(user.DELETE, { cookie: a.cookie, method: "DELETE", params: { id: a.userId } });
      expect(remove.status).toBe(409);
    });
  });

  describe("CSRF", () => {
    it("blocks cookie-authenticated writes from another origin", async () => {
      const cross = await call(customers.POST, {
        cookie: a.cookie,
        body: { name: "Forged" },
        origin: "https://evil.example",
      });
      expect(cross.status).toBe(403);
      const missing = await call(customers.POST, { cookie: a.cookie, body: { name: "Forged" }, origin: null });
      expect(missing.status).toBe(403);
      const list = await call(customers.GET, { cookie: a.cookie, path: "/?q=Forged" });
      expect(list.body.total).toBe(0);
    });

    it("allows reads without an Origin header", async () => {
      expect((await call(customers.GET, { cookie: a.cookie, origin: null })).status).toBe(200);
    });
  });

  describe("API keys", () => {
    it("authenticates with a key, scoped to its role and organization", async () => {
      const created = await call(apiKeys.POST, { cookie: a.cookie, body: { name: "Telematics", role: "DISPATCHER" } });
      expect(created.status).toBe(201);
      const key = created.body.key as string;
      expect(key.startsWith("tms_")).toBe(true);

      const listed = await call(apiKeys.GET, { cookie: a.cookie });
      expect(JSON.stringify(listed.body)).not.toContain(key);
      expect(listed.body.data[0].prefix).toBe(key.slice(0, 12));

      // No cookie, no Origin: a server-to-server call.
      const read = await call(shipments.GET, { apiKey: key, origin: null });
      expect(read.status).toBe(200);
      expect(read.body.total).toBe(1);
      const write = await call(customers.POST, { apiKey: key, origin: null, body: { name: "Via key" } });
      expect(write.status).toBe(403);
      expect((await call(shipment.GET, { apiKey: key, origin: null, params: { id: ids.shipment } })).status).toBe(200);

      await call(apiKey.DELETE, { cookie: a.cookie, method: "DELETE", params: { id: created.body.id } });
      expect((await call(shipments.GET, { apiKey: key, origin: null })).status).toBe(401);
    });

    it("rejects unknown keys", async () => {
      expect((await call(shipments.GET, { apiKey: "tms_not-a-real-key", origin: null })).status).toBe(401);
    });
  });

  describe("input validation", () => {
    it("returns field-level errors for bad input", async () => {
      const res = await call(locations.POST, {
        cookie: a.cookie,
        body: { name: "", latitude: 123, longitude: -79 },
      });
      expect(res.status).toBe(422);
      const paths = res.body.error.details.map((d: any) => d.path);
      expect(paths).toContain("name");
      expect(paths).toContain("latitude");
    });

    it("treats SQL metacharacters in search as plain text", async () => {
      const res = await call(customers.GET, { cookie: a.cookie, path: `/?q=${encodeURIComponent("'; DROP TABLE \"Customer\"; --")}` });
      expect(res.status).toBe(200);
      expect(res.body.total).toBe(0);
      expect((await call(customers.GET, { cookie: a.cookie })).body.total).toBeGreaterThan(0);
    });

    it("rejects malformed JSON", async () => {
      const { NextRequest } = await import("next/server");
      const req = new NextRequest("http://localhost:3000/", {
        method: "POST",
        headers: { host: "localhost:3000", origin: "http://localhost:3000", cookie: a.cookie, "content-type": "application/json" },
        body: "{not json",
      });
      const res = await customers.POST(req, { params: {} });
      expect(res.status).toBe(400);
    });
  });
});
