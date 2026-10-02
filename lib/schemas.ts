import { z } from "zod";
import { REPORTABLE_EVENTS } from "@/modules/tracking/service";

const text = (max = 200) => z.string().trim().min(1).max(max);
const optionalText = (max = 200) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((v) => (v ? v : null));
const id = z.string().min(1).max(40);
const optionalId = id.nullish().transform((v) => v ?? null);
const money = z.number().min(0).max(1_000_000_000);
const dateTime = z.coerce.date();
const optionalDateTime = dateTime.nullish().transform((v) => v ?? null);

export const ROLES = [
  "ADMIN",
  "LOGISTICS_MANAGER",
  "PLANNER",
  "DISPATCHER",
  "FINANCE",
  "ANALYST",
  "DRIVER",
] as const;
export const MODES = ["ROAD", "AIR", "OCEAN", "RAIL", "COURIER", "MOTORCYCLE", "DRONE"] as const;
export const LOCATION_TYPES = ["WAREHOUSE", "CUSTOMER", "DEPOT", "PORT", "AIRPORT", "OTHER"] as const;
export const PRIORITIES = ["LOW", "NORMAL", "HIGH", "URGENT"] as const;
export const OBJECTIVE_VALUES = ["cost", "distance", "time"] as const;
export const EXCEPTION_TYPES = [
  "LATE_SHIPMENT",
  "MISSED_APPOINTMENT",
  "CARRIER_REJECTION",
  "TENDER_NOT_ACKNOWLEDGED",
  "VEHICLE_BREAKDOWN",
  "DAMAGED_SHIPMENT",
  "ROUTE_DISRUPTION",
  "OTHER",
] as const;
export const SEVERITIES = ["LOW", "MEDIUM", "HIGH", "CRITICAL"] as const;
export const EXCEPTION_STATUSES = ["OPEN", "INVESTIGATING", "RESOLVED", "IGNORED"] as const;
export const DOCUMENT_TYPES = [
  "BILL_OF_LADING",
  "PROOF_OF_DELIVERY",
  "COMMERCIAL_INVOICE",
  "PACKING_LIST",
  "CARRIER_INVOICE",
  "DELIVERY_RECEIPT",
  "OTHER",
] as const;

// ── Auth & organization ──

const password = z.string().min(10, "Use at least 10 characters").max(200);
const email = z.string().trim().toLowerCase().pipe(z.email()).pipe(z.string().max(200));

export const registerSchema = z.object({
  organizationName: text(120),
  name: text(120),
  email,
  password,
});

export const loginSchema = z.object({ email, password: z.string().min(1).max(200) });

export const organizationUpdateSchema = z.object({
  name: text(120).optional(),
  currency: z.string().trim().toUpperCase().length(3).optional(),
  timezone: z.string().trim().min(1).max(60).optional(),
  distanceUnit: z.enum(["km", "mi"]).optional(),
  weightUnit: z.enum(["kg", "lb"]).optional(),
});

export const userCreateSchema = z.object({
  name: text(120),
  email,
  password,
  role: z.enum(ROLES),
});

export const userUpdateSchema = z.object({ role: z.enum(ROLES) });

export const apiKeyCreateSchema = z.object({ name: text(80), role: z.enum(ROLES) });

// ── Master data ──

export const customerSchema = z.object({
  name: text(),
  email: optionalText(),
  phone: optionalText(40),
  notes: optionalText(2000),
});

export const locationSchema = z.object({
  type: z.enum(LOCATION_TYPES).default("OTHER"),
  name: text(),
  addressLine: optionalText(),
  city: optionalText(100),
  region: optionalText(100),
  postalCode: optionalText(20),
  country: optionalText(100),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  customerId: optionalId,
});

export const carrierSchema = z.object({
  name: text(),
  code: optionalText(20),
  email: optionalText(),
  phone: optionalText(40),
  status: z.enum(["ACTIVE", "INACTIVE"]).default("ACTIVE"),
  modes: z.array(z.enum(MODES)).max(7).default(["ROAD"]),
  baseRate: money.default(0),
  ratePerKm: money.default(0),
  ratePerKg: money.default(0),
  minimumCharge: money.default(0),
  fuelSurchargePct: z.number().min(0).max(100).default(0),
});

export const vehicleSchema = z.object({
  name: text(),
  registration: optionalText(40),
  vehicleType: text(60).default("Truck"),
  mode: z.enum(MODES).default("ROAD"),
  capacityKg: z.number().positive().max(10_000_000),
  capacityM3: z.number().positive().max(1_000_000),
  costPerKm: money.default(0),
  fixedCost: money.default(0),
  status: z.enum(["AVAILABLE", "MAINTENANCE", "INACTIVE"]).default("AVAILABLE"),
  carrierId: optionalId,
  homeLocationId: optionalId,
});

export const driverSchema = z.object({
  name: text(),
  phone: optionalText(40),
  licenseNumber: optionalText(60),
  status: z.enum(["AVAILABLE", "OFF_DUTY", "INACTIVE"]).default("AVAILABLE"),
  vehicleId: optionalId,
});

// ── Orders ──

const windows = {
  pickupWindowStart: optionalDateTime,
  pickupWindowEnd: optionalDateTime,
  deliveryWindowStart: optionalDateTime,
  deliveryWindowEnd: optionalDateTime,
};

const windowOrder = (v: {
  pickupWindowStart?: Date | null;
  pickupWindowEnd?: Date | null;
  deliveryWindowStart?: Date | null;
  deliveryWindowEnd?: Date | null;
}) =>
  !(v.pickupWindowStart && v.pickupWindowEnd && v.pickupWindowStart > v.pickupWindowEnd) &&
  !(v.deliveryWindowStart && v.deliveryWindowEnd && v.deliveryWindowStart > v.deliveryWindowEnd);

export const orderSchema = z
  .object({
    customerId: id,
    pickupLocationId: id,
    deliveryLocationId: id,
    priority: z.enum(PRIORITIES).default("NORMAL"),
    ...windows,
    reference: optionalText(100),
    notes: optionalText(2000),
    lines: z
      .array(
        z.object({
          sku: optionalText(60),
          description: text(),
          quantity: z.number().positive().max(1_000_000),
          weightKg: z.number().min(0).max(10_000_000).default(0),
          volumeM3: z.number().min(0).max(1_000_000).default(0),
        }),
      )
      .min(1, "Add at least one line")
      .max(200),
  })
  .refine((v) => v.pickupLocationId !== v.deliveryLocationId, {
    message: "Pickup and delivery locations must differ",
    path: ["deliveryLocationId"],
  })
  .refine(windowOrder, { message: "A window must start before it ends", path: ["deliveryWindowEnd"] });

export const orderUpdateSchema = z
  .object({
    priority: z.enum(PRIORITIES).optional(),
    pickupWindowStart: dateTime.nullable().optional(),
    pickupWindowEnd: dateTime.nullable().optional(),
    deliveryWindowStart: dateTime.nullable().optional(),
    deliveryWindowEnd: dateTime.nullable().optional(),
    reference: z.string().trim().max(100).nullable().optional(),
    notes: z.string().trim().max(2000).nullable().optional(),
  })
  .refine(windowOrder, { message: "A window must start before it ends", path: ["deliveryWindowEnd"] });

// ── Shipments & planning ──

export const shipmentCreateSchema = z.object({
  orderIds: z.array(id).min(1).max(100),
  mode: z.enum(MODES).default("ROAD"),
});

export const shipmentPlanSchema = z.object({
  vehicleId: optionalId,
  driverId: optionalId,
  departAt: dateTime,
  objective: z.enum(OBJECTIVE_VALUES).default("cost"),
});

export const tenderSchema = z.object({ carrierId: id });

export const tenderResponseSchema = z.object({
  accepted: z.boolean(),
  note: z.string().trim().max(500).optional(),
});

export const cancelSchema = z.object({ reason: text(500) });

export const optimizeSchema = z.object({
  orderIds: z.array(id).min(1).max(200),
  vehicleIds: z.array(id).min(1).max(50),
  departAt: dateTime,
  mode: z.enum(MODES).default("ROAD"),
});

export const commitPlanSchema = optimizeSchema.extend({ objective: z.enum(OBJECTIVE_VALUES) });

// ── Tracking ──

export const trackingEventSchema = z
  .object({
    shipmentId: id,
    type: z.enum(REPORTABLE_EVENTS),
    occurredAt: dateTime.optional(),
    latitude: z.number().min(-90).max(90).optional(),
    longitude: z.number().min(-180).max(180).optional(),
    speedKph: z.number().min(0).max(2000).optional(),
    heading: z.number().min(0).max(360).optional(),
    stopId: id.optional(),
    message: z.string().trim().max(500).optional(),
    externalId: z.string().trim().min(1).max(120).optional(),
  })
  .refine((v) => (v.latitude === undefined) === (v.longitude === undefined), {
    message: "Send latitude and longitude together",
    path: ["longitude"],
  })
  .refine((v) => !v.occurredAt || v.occurredAt.getTime() <= Date.now() + 5 * 60_000, {
    message: "occurredAt cannot be in the future",
    path: ["occurredAt"],
  });

export const simulateSchema = z.object({
  minutes: z.number().min(1).max(2880).default(30),
  speedFactor: z.number().min(0.1).max(3).default(1),
});

// ── Exceptions ──

export const exceptionCreateSchema = z.object({
  shipmentId: optionalId,
  type: z.enum(EXCEPTION_TYPES),
  severity: z.enum(SEVERITIES),
  title: text(200),
  impact: text(1000),
  recommendedAction: z.string().trim().max(1000).default("Review and decide on next steps."),
});

export const exceptionUpdateSchema = z.object({
  status: z.enum(EXCEPTION_STATUSES).optional(),
  severity: z.enum(SEVERITIES).optional(),
  ownerId: id.nullable().optional(),
  resolutionNote: z.string().trim().max(1000).optional(),
});
