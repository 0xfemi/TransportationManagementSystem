import { z } from "zod";
import type { Permission } from "@/lib/rbac";
import * as s from "@/lib/schemas";

type Op = {
  method: "get" | "post" | "patch" | "delete";
  path: string;
  summary: string;
  tag: string;
  permission?: Permission | "public" | "any signed-in user";
  body?: z.ZodType;
  multipart?: boolean;
  query?: string[];
};

const crud = (path: string, tag: string, noun: string, schema: z.ZodObject): Op[] => [
  { method: "get", path, tag, summary: `List ${noun}s`, permission: "masterdata:read", query: ["q", "limit", "offset"] },
  { method: "post", path, tag, summary: `Create a ${noun}`, permission: "masterdata:write", body: schema },
  { method: "get", path: `${path}/{id}`, tag, summary: `Get a ${noun}`, permission: "masterdata:read" },
  { method: "patch", path: `${path}/{id}`, tag, summary: `Update a ${noun}`, permission: "masterdata:write", body: schema.partial() },
  { method: "delete", path: `${path}/{id}`, tag, summary: `Remove a ${noun} (soft delete)`, permission: "masterdata:write" },
];

const OPERATIONS: Op[] = [
  { method: "post", path: "/auth/register", tag: "Auth", summary: "Create an organization and its first admin", permission: "public", body: s.registerSchema },
  { method: "post", path: "/auth/login", tag: "Auth", summary: "Sign in and receive a session cookie", permission: "public", body: s.loginSchema },
  { method: "post", path: "/auth/logout", tag: "Auth", summary: "Clear the session cookie", permission: "public" },
  { method: "get", path: "/auth/me", tag: "Auth", summary: "Current user, organization, role and permissions", permission: "any signed-in user" },
  { method: "get", path: "/organization", tag: "Organization", summary: "Get organization settings", permission: "any signed-in user" },
  { method: "patch", path: "/organization", tag: "Organization", summary: "Update organization settings", permission: "settings:manage", body: s.organizationUpdateSchema },
  { method: "get", path: "/users", tag: "Organization", summary: "List members", permission: "any signed-in user" },
  { method: "post", path: "/users", tag: "Organization", summary: "Add a member", permission: "users:manage", body: s.userCreateSchema },
  { method: "patch", path: "/users/{id}", tag: "Organization", summary: "Change a member's role", permission: "users:manage", body: s.userUpdateSchema },
  { method: "delete", path: "/users/{id}", tag: "Organization", summary: "Remove a member", permission: "users:manage" },
  { method: "get", path: "/api-keys", tag: "Organization", summary: "List API keys", permission: "settings:manage" },
  { method: "post", path: "/api-keys", tag: "Organization", summary: "Create an API key (returned once)", permission: "settings:manage", body: s.apiKeyCreateSchema },
  { method: "delete", path: "/api-keys/{id}", tag: "Organization", summary: "Revoke an API key", permission: "settings:manage" },
  ...crud("/customers", "Master data", "customer", s.customerSchema),
  ...crud("/locations", "Master data", "location", s.locationSchema),
  ...crud("/carriers", "Master data", "carrier", s.carrierSchema),
  { method: "get", path: "/carriers/{id}/scorecard", tag: "Master data", summary: "Measured carrier performance, last 90 days", permission: "analytics:read" },
  ...crud("/vehicles", "Master data", "vehicle", s.vehicleSchema),
  ...crud("/drivers", "Master data", "driver", s.driverSchema),
  ...crud("/service-areas", "Master data", "service area", s.serviceAreaSchema),
  { method: "get", path: "/maintenance", tag: "Maintenance", summary: "List vehicle work orders", permission: "masterdata:read", query: ["q", "status", "vehicleId", "limit", "offset"] },
  { method: "post", path: "/maintenance", tag: "Maintenance", summary: "Schedule a work order", permission: "masterdata:write", body: s.maintenanceCreateSchema },
  { method: "get", path: "/maintenance/{id}", tag: "Maintenance", summary: "Get a work order with its history", permission: "masterdata:read" },
  { method: "patch", path: "/maintenance/{id}", tag: "Maintenance", summary: "Edit a scheduled work order", permission: "masterdata:write", body: s.maintenanceUpdateSchema },
  { method: "post", path: "/maintenance/{id}/start", tag: "Maintenance", summary: "Start the work; the vehicle leaves service", permission: "masterdata:write" },
  { method: "post", path: "/maintenance/{id}/complete", tag: "Maintenance", summary: "Complete the work and record its cost", permission: "masterdata:write", body: s.maintenanceCompleteSchema },
  { method: "post", path: "/maintenance/{id}/cancel", tag: "Maintenance", summary: "Cancel a scheduled or in-progress work order", permission: "masterdata:write", body: s.cancelSchema },
  { method: "get", path: "/orders", tag: "Orders", summary: "List orders", permission: "orders:read", query: ["q", "status", "customerId", "limit", "offset"] },
  { method: "post", path: "/orders", tag: "Orders", summary: "Create an order", permission: "orders:write", body: s.orderSchema },
  { method: "get", path: "/orders/{id}", tag: "Orders", summary: "Get an order", permission: "orders:read" },
  { method: "patch", path: "/orders/{id}", tag: "Orders", summary: "Update an open order", permission: "orders:write", body: s.orderUpdateSchema },
  { method: "post", path: "/orders/{id}/cancel", tag: "Orders", summary: "Cancel an open order", permission: "orders:write", body: s.cancelSchema },
  { method: "get", path: "/shipments", tag: "Shipments", summary: "List shipments", permission: "shipments:read", query: ["q", "status", "carrierId", "delayed", "limit", "offset"] },
  { method: "post", path: "/shipments", tag: "Shipments", summary: "Create a draft shipment from open orders", permission: "shipments:write", body: s.shipmentCreateSchema },
  { method: "get", path: "/shipments/{id}", tag: "Shipments", summary: "Get a shipment with stops, tenders, exceptions and documents", permission: "shipments:read" },
  { method: "post", path: "/shipments/{id}/plan", tag: "Shipments", summary: "Optimize the stop sequence and schedule the shipment", permission: "shipments:plan", body: s.shipmentPlanSchema },
  { method: "post", path: "/shipments/{id}/tender", tag: "Shipments", summary: "Tender the shipment to a carrier", permission: "shipments:plan", body: s.tenderSchema },
  { method: "post", path: "/shipments/{id}/tender/respond", tag: "Shipments", summary: "Record the carrier's acceptance or rejection", permission: "shipments:plan", body: s.tenderResponseSchema },
  { method: "post", path: "/shipments/{id}/dispatch", tag: "Shipments", summary: "Dispatch the shipment", permission: "shipments:dispatch" },
  { method: "post", path: "/shipments/{id}/cancel", tag: "Shipments", summary: "Cancel the shipment and release its orders", permission: "shipments:write", body: s.cancelSchema },
  { method: "get", path: "/shipments/{id}/tracking", tag: "Tracking", summary: "Tracking history and travelled path", permission: "shipments:read" },
  { method: "post", path: "/shipments/{id}/simulate", tag: "Tracking", summary: "Demo aid: generate the tracking events for the next N minutes", permission: "tracking:write", body: s.simulateSchema },
  { method: "post", path: "/tracking/events", tag: "Tracking", summary: "Report a tracking event (GPS position, arrival, delivery, problem)", permission: "tracking:write", body: s.trackingEventSchema },
  { method: "post", path: "/routes/optimize", tag: "Planning", summary: "Propose route plans for orders and vehicles; saves nothing", permission: "shipments:plan", body: s.optimizeSchema },
  { method: "post", path: "/routes/commit", tag: "Planning", summary: "Approve a plan: one planned shipment per route", permission: "shipments:plan", body: s.commitPlanSchema },
  { method: "get", path: "/exceptions", tag: "Exceptions", summary: "List exceptions", permission: "exceptions:read", query: ["q", "status", "severity", "shipmentId", "limit", "offset"] },
  { method: "post", path: "/exceptions", tag: "Exceptions", summary: "Report an exception", permission: "exceptions:write", body: s.exceptionCreateSchema },
  { method: "get", path: "/exceptions/{id}", tag: "Exceptions", summary: "Get an exception with its timeline", permission: "exceptions:read" },
  { method: "patch", path: "/exceptions/{id}", tag: "Exceptions", summary: "Assign, investigate, resolve, ignore or reopen", permission: "exceptions:write", body: s.exceptionUpdateSchema },
  { method: "get", path: "/documents", tag: "Documents", summary: "List documents attached to a record", permission: "documents:read", query: ["entityType", "entityId"] },
  { method: "post", path: "/documents", tag: "Documents", summary: "Upload a document (fields: file, entityType, entityId, type)", permission: "documents:write", multipart: true },
  { method: "get", path: "/documents/{id}", tag: "Documents", summary: "Download a document", permission: "documents:read" },
  { method: "delete", path: "/documents/{id}", tag: "Documents", summary: "Delete a document", permission: "documents:write" },
  { method: "get", path: "/analytics/transportation", tag: "Analytics", summary: "Transportation KPIs; format=csv with table=daily|carriers downloads one table", permission: "analytics:read", query: ["from", "to", "carrierId", "customerId", "format", "table"] },
  { method: "get", path: "/command-center", tag: "Analytics", summary: "Live operations summary, map data and exception feed", permission: "shipments:read" },
  { method: "get", path: "/search", tag: "Search", summary: "Search across records", permission: "any signed-in user", query: ["q"] },
  { method: "get", path: "/audit-log", tag: "Audit", summary: "Audit log", permission: "audit:read", query: ["q", "entityType", "entityId", "limit", "offset"] },
  { method: "get", path: "/events", tag: "Audit", summary: "Append-only domain event log", permission: "audit:read", query: ["type", "entityType", "entityId", "since", "limit", "offset"] },
];

const ERROR = {
  type: "object",
  properties: {
    error: {
      type: "object",
      properties: { code: { type: "string" }, message: { type: "string" }, details: {} },
      required: ["code", "message"],
    },
  },
};

/** OpenAPI 3.1 document, generated from the same Zod schemas the routes validate with. */
export function buildOpenApi() {
  const paths: Record<string, Record<string, unknown>> = {};
  for (const op of OPERATIONS) {
    const open = op.permission === "public";
    const pathParams = [...op.path.matchAll(/\{(\w+)\}/g)].map((m) => ({
      name: m[1],
      in: "path",
      required: true,
      schema: { type: "string" },
    }));
    const queryParams = (op.query ?? []).map((name) => ({ name, in: "query", schema: { type: "string" } }));
    (paths[op.path] ??= {})[op.method] = {
      tags: [op.tag],
      summary: op.summary,
      description: open ? "No authentication required." : `Requires: \`${op.permission}\`.`,
      security: open ? [] : [{ apiKey: [] }, { session: [] }],
      parameters: [...pathParams, ...queryParams],
      ...(op.body
        ? { requestBody: { required: true, content: { "application/json": { schema: z.toJSONSchema(op.body, { io: "input", unrepresentable: "any" }) } } } }
        : {}),
      ...(op.multipart
        ? { requestBody: { required: true, content: { "multipart/form-data": { schema: { type: "object", properties: { file: { type: "string", format: "binary" }, entityType: { type: "string" }, entityId: { type: "string" }, type: { type: "string" } } } } } } }
        : {}),
      responses: {
        "200": { description: "Success" },
        ...(open ? {} : { "401": { description: "Not authenticated" }, "403": { description: "Not permitted" } }),
        "422": { description: "Validation failed", content: { "application/json": { schema: ERROR } } },
      },
    };
  }
  return {
    openapi: "3.1.0",
    info: {
      title: "Transportation Management System API",
      version: "0.1.0",
      description:
        "Everything the web app does goes through this API. Authenticate with an API key (`Authorization: Bearer tms_…`) or a browser session cookie. Errors have the shape `{ error: { code, message, details } }`. List endpoints return `{ data, total, limit, offset }`.",
    },
    servers: [{ url: "/api/v1" }],
    components: {
      securitySchemes: {
        apiKey: { type: "http", scheme: "bearer" },
        session: { type: "apiKey", in: "cookie", name: "tms_session" },
      },
    },
    paths,
  };
}
