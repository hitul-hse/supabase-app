import { redirect } from "next/navigation";
import { createClient } from "./server";
import { getCurrentProfile, type CurrentProfile } from "@/lib/queries/auth";
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
 * Non-redirecting version — returns true/false for conditional rendering.
 * The caller is responsible for having a valid authenticated session already.
 */
export async function userHasPermission(permission: PermissionKey): Promise<boolean> {
  const supabase = await createClient();
  const { data } = await supabase.rpc("app_user_has_permission", { p_key: permission });
  return !!data;
}
