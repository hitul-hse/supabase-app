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
  // Administering SOMEBODY ELSE's record. Separate from people:write (the person
  // directory) and from a user's own profile edit, because "may I edit my own
  // profile" and "may I edit a colleague's" are different questions that must be
  // separately grantable in /admin/roles. Held by exec and hr — see
  // supabase/migrations/add_hr_role_and_profile_admin.sql.
  ADMIN_PROFILES_READ:     "admin:profiles:read",
  ADMIN_PROFILES_WRITE:    "admin:profiles:write",
  // The most dangerous key in the system: it rewrites the hours invoices are
  // based on. Deliberately NOT implied by admin:profiles:write.
  ADMIN_ENTRIES_WRITE:     "admin:entries:write",

  // Sync
  SYNC_READ:               "sync:read",
  SYNC_TRIGGER:            "sync:trigger",

  // ── Module-scoped keys (module:resource:action) ───────────────────────────
  // The keys above predate the module split and are deliberately left in their
  // original two-part shape: renaming them would break every existing call site
  // and grant row for no functional gain. Everything new uses three parts, so
  // app_permission.module_key can be derived and the bridge portal can decide
  // tile visibility from permission data alone.
  //
  // HR and CRM keys exist before their modules do, on purpose: it makes each
  // module's access model reviewable before any of its code is written, and it
  // is safe because app_module.is_live is false for both, which hides the tile
  // regardless of who holds the permission.

  // HR module
  HR_LEAVE_READ:           "hr:leave:read",
  HR_LEAVE_WRITE:          "hr:leave:write",
  HR_LEAVE_APPROVE:        "hr:leave:approve",
  HR_CONTRACT_READ:        "hr:contract:read",
  HR_CLOCKING_WRITE:       "hr:clocking:write",

  // CRM module
  CRM_DEAL_READ:           "crm:deal:read",
  CRM_DEAL_WRITE:          "crm:deal:write",
} as const;

export type PermissionKey = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];

// ─── Modules ─────────────────────────────────────────────────────────────────
// Mirrors app_module.module_key. The bridge portal reads its tiles from the DB
// via app_user_modules(), so this type exists for type-safety at call sites —
// NOT as a second source of truth for what modules exist or who may see them.

export type ModuleKey = "hub" | "projects" | "time" | "hr" | "crm";

export type ModuleTile = {
  moduleKey: ModuleKey;
  displayName: string;
  tagline: string | null;
  href: string | null;
  accent: string;
};

// ─── Route → required permission map ─────────────────────────────────────────
// NOT WIRED UP YET. Nothing imports this — every gated route currently passes
// its permission key directly to requirePermission(), and the middleware only
// checks whether a session exists, not what it may reach.
//
// The previous comment here claimed "middleware and requirePermission() use
// this", which was never true and is the kind of thing that makes a reader
// assume routes are centrally gated when they are gated one page at a time.
// Kept because it is the right shape for the bridge portal (one place to answer
// "what does this path require"), but treat it as a plan, not as live config.

export const ROUTE_PERMISSIONS: Record<string, PermissionKey> = {
  "/":              PERMISSIONS.OVERVIEW_READ,
  "/people":        PERMISSIONS.PEOPLE_READ_OWN,
  "/projects":      PERMISSIONS.PROJECTS_READ_OWN,
  "/timesheets":    PERMISSIONS.TIMESHEETS_READ_OWN,
  "/team-lead":     PERMISSIONS.WORKLOAD_READ,
  "/admin/users":   PERMISSIONS.ADMIN_USERS_READ,
  "/admin/roles":   PERMISSIONS.ADMIN_ROLES_READ,
};
