import { afterEach, describe, expect, it } from "vitest";
import { call, unique } from "../helpers";
import * as access from "@/app/api/v1/auth/access/route";
import * as register from "@/app/api/v1/auth/register/route";
import * as me from "@/app/api/v1/auth/me/route";
import * as auditLog from "@/app/api/v1/audit-log/route";

const KEY = "k".repeat(20) + "-access-key-for-tests-0001";

const open = (key: string, extra = "", ip = unique("ip")) =>
  call(access.GET, { path: `/api/v1/auth/access?key=${encodeURIComponent(key)}${extra}`, ip, origin: null });

afterEach(() => {
  delete process.env.ADMIN_ACCESS_KEY;
  delete process.env.ADMIN_ACCESS_EMAIL;
});

describe("admin access link", () => {
  it("does not exist unless a long enough key is configured", async () => {
    expect((await open(KEY)).status).toBe(404);
    process.env.ADMIN_ACCESS_KEY = "too-short";
    expect((await open("too-short")).status).toBe(404);
  });

  it("rejects a wrong key without signing in", async () => {
    process.env.ADMIN_ACCESS_KEY = KEY;
    const res = await open(`${KEY}x`);
    expect(res.status).toBe(401);
    expect(res.cookie).toBeUndefined();
    expect((await open("")).status).toBe(401);
  });

  it("signs in as the configured admin and records it", async () => {
    const email = `${unique("owner")}@example.com`;
    const owner = await call(register.POST, {
      body: { organizationName: "Owner Freight", name: "Olu Owner", email, password: "correct-horse-battery" },
    });
    process.env.ADMIN_ACCESS_KEY = KEY;
    process.env.ADMIN_ACCESS_EMAIL = email.toUpperCase();

    const res = await open(KEY, "&next=/maintenance");
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("http://localhost:3000/maintenance");
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.cookie).toMatch(/^tms_session=/);

    const who = await call(me.GET, { cookie: res.cookie });
    expect(who.body.role).toBe("ADMIN");
    expect(who.body.organization.name).toBe("Owner Freight");

    const log = await call(auditLog.GET, { cookie: owner.cookie, path: "/api/v1/audit-log?entityType=user" });
    expect(log.body.data.map((e: any) => e.action)).toContain("auth.access_link");
  });

  it("never redirects off-site", async () => {
    process.env.ADMIN_ACCESS_KEY = KEY;
    for (const next of ["//evil.example/x", "https://evil.example", "evil"]) {
      const res = await open(KEY, `&next=${encodeURIComponent(next)}`);
      expect(res.headers.get("location")).toBe("http://localhost:3000/command-center");
    }
  });

  it("creates the organization and admin on first use when that account does not exist", async () => {
    const email = `${unique("fresh")}@example.com`;
    process.env.ADMIN_ACCESS_KEY = KEY;
    process.env.ADMIN_ACCESS_EMAIL = email;

    const first = await open(KEY);
    expect(first.status).toBe(303);
    const who = await call(me.GET, { cookie: first.cookie });
    expect(who.body.user.email).toBe(email);
    expect(who.body.role).toBe("ADMIN");

    // Later visits reuse it rather than creating another organization.
    const again = await call(me.GET, { cookie: (await open(KEY)).cookie });
    expect(again.body.organization.id).toBe(who.body.organization.id);
  });

  it("limits guessing", async () => {
    process.env.ADMIN_ACCESS_KEY = KEY;
    const ip = unique("guesser");
    for (let i = 0; i < 10; i++) expect((await open("wrong", "", ip)).status).toBe(401);
    expect((await open(KEY, "", ip)).status).toBe(429);
  });
});
