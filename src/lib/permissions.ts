/**
 * Permission constants and server-side helpers for fine-grained RBAC.
 *
 * Every route/feature that needs an access gate calls requirePermission() or
 * userHasPermission() from here — never hardcodes role strings inline.
 * Permissions are resolved via app_user_has_permission() in the DB, which
 * reads the user's role → app_role_permission → app_permission chain.
 *
 * Adding a new capability: add the constant here, insert a row in
 * app_permission (via the migration or the admin UI), and assign it to the
 * appropriate roles via app_role_permission.
 */

// ─── Permission keys (must match app_permission.permission_key in DB) ────────

export const PERMISSIONS = {
  // Overview
  OVERVIEW_READ:           "overview:read",
  OVERVIEW_EXPORT:         "overview:export",

  // People
  PEOPLE_READ_OWN:         "people:read_own",
  PEOPLE_READ_DEPT:        "people:read_dept",
  PEOPLE_READ_ALL:         "people:read_all",
  PEOPLE_WRITE:            "people:write",

  // Projects
  PROJECTS_READ_OWN:       "projects:read_own",
  PROJECTS_READ_DEPT:      "projects:read_dept",
  PROJECTS_READ_ALL:       "projects:read_all",
  PROJECTS_WRITE:          "projects:write",

  // Timesheets
  TIMESHEETS_READ_OWN:     "timesheets:read_own",
  TIMESHEETS_READ_DEPT:    "timesheets:read_dept",
  TIMESHEETS_READ_ALL:     "timesheets:read_all",
  TIMESHEETS_WRITE:        "timesheets:write",

  // Workload / Team Lead
  WORKLOAD_READ:           "workload:read",
  WORKLOAD_APPROVE:        "workload:approve",

  // Admin
  ADMIN_USERS_READ:        "admin:users:read",
  ADMIN_USERS_WRITE:       "admin:users:write",
  ADMIN_ROLES_READ:        "admin:roles:read",
  ADMIN_ROLES_WRITE:       "admin:roles:write",

  // Sync
  SYNC_READ:               "sync:read",
  SYNC_TRIGGER:            "sync:trigger",
} as const;

export type PermissionKey = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];

// ─── Route → required permission map ─────────────────────────────────────────
// Middleware and requirePermission() use this to gate routes without
// hardcoding role strings at every call site.

export const ROUTE_PERMISSIONS: Record<string, PermissionKey> = {
  "/":              PERMISSIONS.OVERVIEW_READ,
  "/people":        PERMISSIONS.PEOPLE_READ_OWN,
  "/projects":      PERMISSIONS.PROJECTS_READ_OWN,
  "/timesheets":    PERMISSIONS.TIMESHEETS_READ_OWN,
  "/team-lead":     PERMISSIONS.WORKLOAD_READ,
  "/admin/users":   PERMISSIONS.ADMIN_USERS_READ,
  "/admin/roles":   PERMISSIONS.ADMIN_ROLES_READ,
};
