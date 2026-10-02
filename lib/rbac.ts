import type { Role } from "@prisma/client";

export const PERMISSIONS = [
  "masterdata:read",
  "masterdata:write",
  "orders:read",
  "orders:write",
  "shipments:read",
  "shipments:write",
  "shipments:plan",
  "shipments:dispatch",
  "tracking:write",
  "exceptions:read",
  "exceptions:write",
  "documents:read",
  "documents:write",
  "analytics:read",
  "audit:read",
  "users:manage",
  "settings:manage",
] as const;

export type Permission = (typeof PERMISSIONS)[number];

const READ_ALL: Permission[] = [
  "masterdata:read",
  "orders:read",
  "shipments:read",
  "exceptions:read",
  "documents:read",
];

const ROLE_PERMISSIONS: Record<Role, readonly Permission[]> = {
  ADMIN: PERMISSIONS,
  LOGISTICS_MANAGER: PERMISSIONS.filter(
    (p) => p !== "users:manage" && p !== "settings:manage",
  ),
  PLANNER: [
    ...READ_ALL,
    "masterdata:write",
    "orders:write",
    "shipments:write",
    "shipments:plan",
    "exceptions:write",
    "documents:write",
    "analytics:read",
  ],
  DISPATCHER: [
    ...READ_ALL,
    "shipments:dispatch",
    "tracking:write",
    "exceptions:write",
    "documents:write",
  ],
  FINANCE: [...READ_ALL, "documents:write", "analytics:read", "audit:read"],
  ANALYST: [...READ_ALL, "analytics:read"],
  DRIVER: ["shipments:read", "tracking:write", "documents:read", "documents:write"],
};

export function can(role: Role, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role].includes(permission);
}

export function permissionsFor(role: Role): readonly Permission[] {
  return ROLE_PERMISSIONS[role];
}

export const ROLE_LABELS: Record<Role, string> = {
  ADMIN: "Admin",
  LOGISTICS_MANAGER: "Logistics manager",
  PLANNER: "Planner",
  DISPATCHER: "Dispatcher",
  FINANCE: "Finance",
  ANALYST: "Analyst",
  DRIVER: "Driver",
};
