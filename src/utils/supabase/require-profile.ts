import { redirect } from "next/navigation";
import { createClient } from "./server";
import { getCurrentProfile, type CurrentProfile } from "@/lib/queries/auth";
import { getSignedInUser } from "@/lib/queries/request-cache";
import { isRouteAllowedForRole, roleHome } from "@/components/nav-access";
import type { PermissionKey } from "@/lib/permissions";

/**
 * Server-side auth + profile gate. Redirects to:
 *  - /auth/login  — if not authenticated
 *  - /access-pending — if authenticated but no admin-provisioned profile
 *  - /            — if profile exists but role isn't in allowedRoles
 *
 * Most pages don't need this — RLS scopes the data automatically. Use it
 * where a hard role gate matters (team-lead board, admin console).
 */
export async function requireProfile(
  currentPath: string,
  allowedRoles?: string[],
): Promise<CurrentProfile> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect(`/auth/login?redirect_to=${encodeURIComponent(currentPath)}`);
  }

  const profile = await getCurrentProfile(supabase, user.id, user.email ?? null);

  if (!profile) {
    redirect("/access-pending");
  }

  if (allowedRoles && !allowedRoles.includes(profile.roleKey)) {
    redirect("/");
  }

  return profile;
}

/**
 * Like requireProfile() but gates on a fine-grained permission key rather
 * than a role string. Use this for new code; prefer it over requireProfile()
 * with allowedRoles when the permission catalogue covers the use case.
 */
export async function requirePermission(
  currentPath: string,
  permission: PermissionKey,
): Promise<CurrentProfile> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect(`/auth/login?redirect_to=${encodeURIComponent(currentPath)}`);
  }

  const profile = await getCurrentProfile(supabase, user.id, user.email ?? null);

  if (!profile) {
    redirect("/access-pending");
  }

  // Ask the DB — single RPC that respects the permission table
  const { data: hasPermission } = await supabase.rpc("app_user_has_permission", {
    p_key: permission,
  });

  if (!hasPermission) {
    redirect("/");
  }

  return profile;
}

/**
 * Refuse a page to a role that is restricted to a fixed route list.
 *
 * WHY THIS IS SEPARATE FROM requireProfile()
 * ------------------------------------------
 * It is deliberately ADDITIVE and can only ever affect a role named in
 * ROLE_ROUTE_ALLOWLIST. Every other caller — every role that exists today —
 * takes the early return and reaches the page exactly as before. That is what
 * lets this be dropped into pages whose current gate is `requireUser()` (the
 * Overview, Timesheets) without changing anything else about them: swapping
 * those for requireProfile() would ALSO start redirecting a signed-in user who
 * has no app_user_profile row to /access-pending, which is a different decision
 * that nobody asked for.
 *
 * It is the second half of the pair. nav-access.ts hides the link; this closes
 * the door, from the same list, so the menu and the door cannot disagree.
 * A hidden nav item on its own is decoration — anyone can type /people.
 *
 * COST. `getSignedInUser` and `getCurrentProfile` are both memoised per request
 * (see request-cache.ts), so on a page that already resolves the profile this
 * is free, and on one that does not it is a single indexed single-row read.
 *
 * @param currentPath the ROUTE ROOT, not the resolved URL: pass "/projects" from
 *        /projects/[id]. The allow-list names roots and matches their children
 *        on a segment boundary.
 */
export async function enforceRoleRouteAccess(currentPath: string): Promise<void> {
  const supabase = await createClient();
  const user = await getSignedInUser(supabase);
  // No session, or no provisioned profile: not this function's business. The
  // page's own requireUser()/requireProfile() gate has already decided, or is
  // about to. Answering here would duplicate that decision and could contradict
  // it.
  if (!user) return;

  const profile = await getCurrentProfile(supabase, user.id, user.email ?? null);
  if (!profile) return;

  if (isRouteAllowedForRole(profile.roleKey, currentPath)) return;

  const home = roleHome(profile.roleKey);
  // A home that is itself off the allow-list would redirect to itself forever.
  // check-operations-role.mjs asserts that cannot happen for any configured
  // role; this is the backstop that turns a config error into a rendered page
  // rather than a browser redirect loop.
  if (home === currentPath) return;
  redirect(home);
}

/**
 * Non-redirecting version — returns true/false for conditional rendering.
 * The caller is responsible for having a valid authenticated session already.
 */
export async function userHasPermission(permission: PermissionKey): Promise<boolean> {
  const supabase = await createClient();
  const { data } = await supabase.rpc("app_user_has_permission", { p_key: permission });
  return !!data;
}
