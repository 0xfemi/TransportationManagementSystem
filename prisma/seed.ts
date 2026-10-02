/**
 * Demo data: "NorthStar Distribution", a Canadian distributor with three
 * distribution centres. Everything is created through the same services the
 * API uses, so the history (tracking events, exceptions, audit log, costs)
 * is what the system itself would have produced.
 *
 *   npm run db:seed
 */
import { prisma } from "@/lib/prisma";
import type { Actor } from "@/lib/auth/context";
import { hashPassword } from "@/lib/auth/password";
import { createOrder } from "@/modules/orders/service";
import {
  createShipment,
  dispatchShipment,
  planShipment,
  respondToTender,
  tenderShipment,
} from "@/modules/shipments/service";
import { updateException } from "@/modules/exceptions/service";
import { simulateTracking } from "@/modules/tracking/simulator";

const DEMO_EMAIL = "demo@northstar.example";
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

// Small deterministic generator so every seed run produces the same data.
function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const random = mulberry32(20261002);
const pick = <T>(items: T[]): T => items[Math.floor(random() * items.length)];
const between = (min: number, max: number) => min + random() * (max - min);

const DCS = [
  { name: "Toronto DC", city: "Toronto", region: "ON", lat: 43.7001, lng: -79.4163 },
  { name: "Winnipeg DC", city: "Winnipeg", region: "MB", lat: 49.8951, lng: -97.1384 },
  { name: "Calgary DC", city: "Calgary", region: "AB", lat: 51.0447, lng: -114.0719 },
];

const SITES: { customer: string; name: string; city: string; region: string; lat: number; lng: number; dc: number }[] = [
  { customer: "Retailer A", name: "Retailer A Ottawa", city: "Ottawa", region: "ON", lat: 45.4215, lng: -75.6972, dc: 0 },
  { customer: "Retailer A", name: "Retailer A Kingston", city: "Kingston", region: "ON", lat: 44.2312, lng: -76.486, dc: 0 },
  { customer: "Retailer A", name: "Retailer A London", city: "London", region: "ON", lat: 42.9849, lng: -81.2453, dc: 0 },
  { customer: "Retailer B", name: "Retailer B Hamilton", city: "Hamilton", region: "ON", lat: 43.2557, lng: -79.8711, dc: 0 },
  { customer: "Retailer B", name: "Retailer B Barrie", city: "Barrie", region: "ON", lat: 44.3894, lng: -79.6903, dc: 0 },
  { customer: "Hospital A", name: "Hospital A Main Campus", city: "Peterborough", region: "ON", lat: 44.3091, lng: -78.3197, dc: 0 },
  { customer: "Retailer B", name: "Retailer B Brandon", city: "Brandon", region: "MB", lat: 49.8485, lng: -99.9501, dc: 1 },
  { customer: "Hospital A", name: "Hospital A Kenora Clinic", city: "Kenora", region: "ON", lat: 49.767, lng: -94.4894, dc: 1 },
  { customer: "Manufacturer A", name: "Manufacturer A Portage Plant", city: "Portage la Prairie", region: "MB", lat: 49.9728, lng: -98.2926, dc: 1 },
  { customer: "Retailer A", name: "Retailer A Edmonton", city: "Edmonton", region: "AB", lat: 53.5461, lng: -113.4938, dc: 2 },
  { customer: "Manufacturer A", name: "Manufacturer A Red Deer Plant", city: "Red Deer", region: "AB", lat: 52.2681, lng: -113.8112, dc: 2 },
  { customer: "Retailer B", name: "Retailer B Lethbridge", city: "Lethbridge", region: "AB", lat: 49.6956, lng: -112.8451, dc: 2 },
];

const GOODS = [
  { description: "Palletised beverages", weightKg: 900, volumeM3: 4.2 },
  { description: "Household goods, mixed cartons", weightKg: 420, volumeM3: 5.5 },
  { description: "Medical supplies", weightKg: 180, volumeM3: 1.6 },
  { description: "Machine parts, crated", weightKg: 1350, volumeM3: 3.1 },
  { description: "Packaged food, ambient", weightKg: 760, volumeM3: 4.8 },
  { description: "Retail display fixtures", weightKg: 240, volumeM3: 6.0 },
];

async function main() {
  if (process.env.NODE_ENV === "production" && process.env.ALLOW_DEMO_SEED !== "true") {
    throw new Error("Refusing to seed demo data in production. Set ALLOW_DEMO_SEED=true to override.");
  }
  if (await prisma.user.findUnique({ where: { email: DEMO_EMAIL } })) {
    console.log("Demo data already present, nothing to do.");
    return;
  }
  const password = process.env.SEED_PASSWORD || "northstar-demo";
  const now = new Date();

  // ── Organization and people ──
  const organization = await prisma.organization.create({
    data: { name: "NorthStar Distribution", currency: "CAD", timezone: "America/Toronto", createdAt: new Date(now.getTime() - 30 * DAY) },
  });
  const organizationId = organization.id;
  const passwordHash = await hashPassword(password);
  const people: [string, string, "ADMIN" | "PLANNER" | "DISPATCHER" | "ANALYST"][] = [
    ["Morgan Reyes", DEMO_EMAIL, "ADMIN"],
    ["Priya Nair", "planner@northstar.example", "PLANNER"],
    ["Sam Okafor", "dispatcher@northstar.example", "DISPATCHER"],
    ["Lee Tremblay", "analyst@northstar.example", "ANALYST"],
  ];
  const users = [];
  for (const [name, email, role] of people) {
    users.push(
      await prisma.user.create({
        data: { name, email, passwordHash, memberships: { create: { organizationId, role } } },
      }),
    );
  }
  const planner: Actor = { type: "user", id: users[1].id, label: users[1].name };
  const dispatcher: Actor = { type: "user", id: users[2].id, label: users[2].name };

  // ── Network ──
  const dcs: { id: string }[] = [];
  for (const dc of DCS) {
    dcs.push(
      await prisma.location.create({
        data: { organizationId, type: "WAREHOUSE", name: dc.name, city: dc.city, region: dc.region, country: "Canada", latitude: dc.lat, longitude: dc.lng },
      }),
    );
  }
  const customers = new Map<string, string>();
  for (const name of ["Retailer A", "Retailer B", "Hospital A", "Manufacturer A"]) {
    const customer = await prisma.customer.create({
      data: { organizationId, name, email: `logistics@${name.toLowerCase().replace(/\s+/g, "")}.example` },
    });
    customers.set(name, customer.id);
  }
  const sites: ((typeof SITES)[number] & { id: string; customerId: string })[] = [];
  for (const site of SITES) {
    const location = await prisma.location.create({
      data: {
        organizationId,
        type: "CUSTOMER",
        name: site.name,
        city: site.city,
        region: site.region,
        country: "Canada",
        latitude: site.lat,
        longitude: site.lng,
        customerId: customers.get(site.customer)!,
      },
    });
    sites.push({ ...site, id: location.id, customerId: customers.get(site.customer)! });
  }

  const carrierRates = [
    { name: "Carrier Alpha", code: "ALPH", baseRate: 180, ratePerKm: 1.65, ratePerKg: 0.02, minimumCharge: 350, fuelSurchargePct: 12 },
    { name: "Carrier Beta", code: "BETA", baseRate: 120, ratePerKm: 1.9, ratePerKg: 0, minimumCharge: 300, fuelSurchargePct: 9.5 },
    { name: "Carrier Gamma", code: "GAMM", baseRate: 250, ratePerKm: 1.45, ratePerKg: 0.03, minimumCharge: 400, fuelSurchargePct: 14 },
  ];
  const carriers: { id: string }[] = [];
  for (const rate of carrierRates) {
    carriers.push(
      await prisma.carrier.create({
        data: { organizationId, ...rate, modes: ["ROAD"], email: `dispatch@${rate.code.toLowerCase()}.example`, phone: "+1 555 0100" },
      }),
    );
  }

  const fleetTypes = [
    { suffix: "V", vehicleType: "Van", capacityKg: 1200, capacityM3: 11, costPerKm: 0.85, fixedCost: 60 },
    { suffix: "B", vehicleType: "Box Truck", capacityKg: 4500, capacityM3: 32, costPerKm: 1.25, fixedCost: 110 },
    { suffix: "S", vehicleType: "Semi Trailer", capacityKg: 22000, capacityM3: 86, costPerKm: 1.9, fixedCost: 220 },
  ];
  const driverNames = ["Alex Chen", "Jordan Bell", "Riley Singh", "Casey Dubois", "Taylor Novak", "Jamie Fraser", "Robin Cardinal", "Drew Lavoie", "Quinn Morin"];
  const fleet: { id: string; dc: number; capacityKg: number; capacityM3: number }[] = [];
  for (const [d, dc] of dcs.entries()) {
    for (const [t, type] of fleetTypes.entries()) {
      const vehicle = await prisma.vehicle.create({
        data: {
          organizationId,
          name: `${DCS[d].city.slice(0, 3).toUpperCase()}-${type.suffix}${d + 1}0${t + 1}`,
          registration: `NS${d + 1}${t + 1} ${100 + d * 10 + t}`,
          vehicleType: type.vehicleType,
          capacityKg: type.capacityKg,
          capacityM3: type.capacityM3,
          costPerKm: type.costPerKm,
          fixedCost: type.fixedCost,
          homeLocationId: dc.id,
          lastLatitude: DCS[d].lat,
          lastLongitude: DCS[d].lng,
        },
      });
      fleet.push({ id: vehicle.id, dc: d, capacityKg: type.capacityKg, capacityM3: type.capacityM3 });
      await prisma.driver.create({
        data: { organizationId, name: driverNames[d * 3 + t], phone: `+1 555 01${d}${t}`, licenseNumber: `D${d}${t}-48213`, vehicleId: vehicle.id },
      });
    }
  }

  // ── Helpers ──
  const newOrder = async (at: Date, dc: number, siteIndex?: number, slackHours = between(1.5, 5)) => {
    const options = sites.filter((s) => s.dc === dc);
    const site = siteIndex === undefined ? pick(options) : options[siteIndex % options.length];
    const goods = pick(GOODS);
    const quantity = Math.ceil(between(1, 4));
    // Deadline: drive time at planning speed plus some slack.
    const driveHours = (haversine(DCS[dc], site) * 1.3) / 65;
    return createOrder(
      { organizationId, actor: planner, at },
      {
        customerId: site.customerId,
        pickupLocationId: dcs[dc].id,
        deliveryLocationId: site.id,
        priority: random() < 0.15 ? "HIGH" : random() < 0.08 ? "URGENT" : "NORMAL",
        pickupWindowStart: null,
        pickupWindowEnd: null,
        deliveryWindowStart: null,
        deliveryWindowEnd: new Date(at.getTime() + (2 + driveHours + slackHours) * HOUR),
        reference: `PO-${Math.floor(between(40000, 99999))}`,
        notes: null,
        lines: [
          {
            sku: null,
            description: goods.description,
            quantity,
            weightKg: Math.round(goods.weightKg * quantity * between(0.6, 1)),
            volumeM3: Math.round(goods.volumeM3 * quantity * between(0.6, 1) * 10) / 10,
          },
        ],
      },
    );
  };

  /** Order → shipment → plan → (tender) → dispatch, all at the given time. */
  const launch = async (at: Date, dc: number, useCarrier: boolean, orderCount: number, slackHours?: number) => {
    const orders = [];
    for (let i = 0; i < orderCount; i++) orders.push(await newOrder(new Date(at.getTime() - 2 * HOUR), dc, i + Math.floor(random() * 3), slackHours));
    const weight = orders.reduce((sum, o) => sum + o.totalWeightKg, 0);
    const volume = orders.reduce((sum, o) => sum + o.totalVolumeM3, 0);
    const vehicle =
      fleet.find((v) => v.dc === dc && v.capacityKg >= weight && v.capacityM3 >= volume) ??
      fleet.filter((v) => v.dc === dc)[2];
    const planCtx = { organizationId, actor: planner, at: new Date(at.getTime() - HOUR) };
    const shipment = await createShipment(planCtx, { orderIds: orders.map((o) => o.id), mode: "ROAD" });
    await planShipment(planCtx, shipment.id, { vehicleId: useCarrier ? null : vehicle.id, departAt: at, objective: "cost" });
    if (useCarrier) {
      await tenderShipment(planCtx, shipment.id, pick(carriers).id);
      await respondToTender({ ...planCtx, at: new Date(at.getTime() - 0.5 * HOUR) }, shipment.id, { accepted: true });
    }
    await dispatchShipment({ organizationId, actor: dispatcher, at }, shipment.id);
    return shipment;
  };

  // ── Three weeks of history ──
  let delivered = 0;
  for (let day = 21; day >= 1; day--) {
    const runs = day % 7 === 0 ? 1 : 2;
    for (let r = 0; r < runs; r++) {
      const at = new Date(now.getTime() - day * DAY + (r * 3 - 2) * HOUR);
      const dc = (day + r) % 3;
      const shipment = await launch(at, dc, random() < 0.55, random() < 0.3 ? 2 : 1);
      // Most runs go to plan; roughly one in five hits traffic.
      const speedFactor = random() < 0.2 ? between(0.5, 0.7) : between(0.95, 1.05);
      await simulateTracking({ organizationId, actor: dispatcher, at }, shipment.id, { minutes: 2880, speedFactor });
      // Exceptions on finished shipments were handled at the time.
      const open = await prisma.shipmentException.findMany({ where: { shipmentId: shipment.id, status: "OPEN" } });
      for (const exception of open) {
        await updateException({ organizationId, actor: dispatcher, at: new Date(at.getTime() + 4 * HOUR) }, exception.id, {
          status: "RESOLVED",
          resolutionNote: "Customer informed of revised arrival time.",
        });
      }
      delivered++;
    }
  }

  // ── What is happening right now ──
  // On the road and on schedule.
  const onTime = await launch(new Date(now.getTime() - 1.5 * HOUR), 0, false, 2);
  await simulateTracking({ organizationId, actor: dispatcher }, onTime.id, { minutes: 90, speedFactor: 1 });
  const onTime2 = await launch(new Date(now.getTime() - 1 * HOUR), 2, true, 1);
  await simulateTracking({ organizationId, actor: dispatcher }, onTime2.id, { minutes: 60, speedFactor: 1 });
  // On the road and running late: a tight deadline and slow traffic.
  const late = await launch(new Date(now.getTime() - 2.5 * HOUR), 1, true, 1, 0.4);
  await simulateTracking({ organizationId, actor: dispatcher }, late.id, { minutes: 150, speedFactor: 0.45 });

  // Planned on our own fleet, ready to dispatch.
  {
    const order = await newOrder(new Date(now.getTime() - 3 * HOUR), 0, 3, 6);
    const ctx = { organizationId, actor: planner, at: new Date(now.getTime() - 2 * HOUR) };
    const shipment = await createShipment(ctx, { orderIds: [order.id], mode: "ROAD" });
    const free = await prisma.vehicle.findFirstOrThrow({
      where: {
        organizationId,
        homeLocationId: dcs[0].id,
        status: "AVAILABLE",
        capacityKg: { gte: order.totalWeightKg },
        capacityM3: { gte: order.totalVolumeM3 },
      },
      orderBy: { capacityKg: "asc" },
    });
    await planShipment(ctx, shipment.id, { vehicleId: free.id, departAt: new Date(now.getTime() + 1 * HOUR), objective: "cost" });
  }
  // Tendered three hours ago, carrier has not answered.
  {
    const order = await newOrder(new Date(now.getTime() - 5 * HOUR), 2, 1, 8);
    const ctx = { organizationId, actor: planner, at: new Date(now.getTime() - 3 * HOUR) };
    const shipment = await createShipment(ctx, { orderIds: [order.id], mode: "ROAD" });
    await planShipment(ctx, shipment.id, { vehicleId: null, departAt: new Date(now.getTime() + 2 * HOUR), objective: "cost" });
    await tenderShipment(ctx, shipment.id, carriers[2].id);
  }
  // Tender rejected an hour ago: needs another carrier.
  {
    const order = await newOrder(new Date(now.getTime() - 6 * HOUR), 1, 0, 9);
    const ctx = { organizationId, actor: planner, at: new Date(now.getTime() - 4 * HOUR) };
    const shipment = await createShipment(ctx, { orderIds: [order.id], mode: "ROAD" });
    await planShipment(ctx, shipment.id, { vehicleId: null, departAt: new Date(now.getTime() + 3 * HOUR), objective: "cost" });
    await tenderShipment(ctx, shipment.id, carriers[1].id);
    await respondToTender({ organizationId, actor: planner, at: new Date(now.getTime() - 1 * HOUR) }, shipment.id, {
      accepted: false,
      note: "No equipment available on this lane today",
    });
  }
  // Open orders waiting to be planned.
  for (let i = 0; i < 9; i++) {
    await newOrder(new Date(now.getTime() - between(0.5, 6) * HOUR), i % 3, i, between(6, 20));
  }

  const counts = await prisma.shipment.groupBy({ by: ["status"], where: { organizationId }, _count: true });
  console.log(`Seeded NorthStar Distribution: ${delivered} delivered shipments of history.`);
  console.log(counts.map((c) => `  ${c.status}: ${c._count}`).join("\n"));
  console.log(`\nSign in as ${DEMO_EMAIL} with password "${password}".`);
  console.log("Other demo users (same password): planner@, dispatcher@ and analyst@northstar.example");
}

function haversine(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const rad = (d: number) => (d * Math.PI) / 180;
  const h =
    Math.sin(rad(b.lat - a.lat) / 2) ** 2 +
    Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(rad(b.lng - a.lng) / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
