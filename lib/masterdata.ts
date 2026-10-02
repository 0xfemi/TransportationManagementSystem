import type { CrudConfig } from "@/lib/crud";
import {
  LOCATION_TYPES,
  carrierSchema,
  customerSchema,
  driverSchema,
  locationSchema,
  vehicleSchema,
} from "@/lib/schemas";

export const customerCrud: CrudConfig = {
  model: "customer",
  label: "customer",
  schema: customerSchema,
  searchFields: ["name", "email"],
};

export const locationCrud: CrudConfig = {
  model: "location",
  label: "location",
  schema: locationSchema,
  searchFields: ["name", "city", "addressLine"],
  include: { customer: { select: { id: true, name: true } } },
  references: { customerId: "customer" },
  filters: (req) => {
    const type = req.nextUrl.searchParams.get("type");
    const customerId = req.nextUrl.searchParams.get("customerId");
    const knownType = (LOCATION_TYPES as readonly string[]).includes(type ?? "");
    return { ...(knownType ? { type } : {}), ...(customerId ? { customerId } : {}) };
  },
};

export const carrierCrud: CrudConfig = {
  model: "carrier",
  label: "carrier",
  schema: carrierSchema,
  searchFields: ["name", "code"],
};

export const vehicleCrud: CrudConfig = {
  model: "vehicle",
  label: "vehicle",
  schema: vehicleSchema,
  searchFields: ["name", "registration", "vehicleType"],
  include: {
    carrier: { select: { id: true, name: true } },
    homeLocation: { select: { id: true, name: true } },
    drivers: { where: { deletedAt: null }, select: { id: true, name: true } },
  },
  references: { carrierId: "carrier", homeLocationId: "location" },
  filters: (req) => {
    const status = req.nextUrl.searchParams.get("status");
    const known = ["AVAILABLE", "IN_USE", "MAINTENANCE", "INACTIVE"].includes(status ?? "");
    return known ? { status } : {};
  },
};

export const driverCrud: CrudConfig = {
  model: "driver",
  label: "driver",
  schema: driverSchema,
  searchFields: ["name", "phone", "licenseNumber"],
  include: { vehicle: { select: { id: true, name: true } } },
  references: { vehicleId: "vehicle" },
};
