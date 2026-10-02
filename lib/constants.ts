// Shared by server and browser code: keep this file free of server imports.

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
export const MAINTENANCE_TYPES = ["INSPECTION", "SERVICE", "REPAIR", "TIRES", "BATTERY", "OTHER"] as const;
export const MAINTENANCE_STATUSES = ["SCHEDULED", "IN_PROGRESS", "COMPLETED", "CANCELLED"] as const;
export const SEVERITIES =["LOW", "MEDIUM", "HIGH", "CRITICAL"] as const;
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

/** Event types a driver, carrier or telematics feed may report. */
export const REPORTABLE_EVENTS = [
  "LOCATION_UPDATE",
  "IN_TRANSIT",
  "ARRIVED_PICKUP",
  "DEPARTED_PICKUP",
  "ARRIVED_DESTINATION",
  "OUT_FOR_DELIVERY",
  "DELIVERED",
  "EXCEPTION",
] as const;
