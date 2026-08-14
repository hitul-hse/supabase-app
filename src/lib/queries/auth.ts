import type { SupabaseTyped } from "./types";

export type AppPermission = {
  permissionKey: string;
  displayName: string;
  resource: string;
  action: string;
  description: string | null;
  sortOrder: number;
};

export type RolePermissionMatrix = {
  permissions: AppPermission[];
  /** Map from role_key → Set of granted permission_keys */
  grantedByRole: Record<string, Set<string>>;
};

export type CurrentProfile = {
  userId: string;
  email: string | null;
  roleKey: string;
  roleDisplayName: string;
  department: string | null;
  personId: string | null;
  personName: string | null;
};

/** The logged-in user's role/department/person, or null if no admin has provisioned a profile yet. */
export async function getCurrentProfile(
  supabase: SupabaseTyped,
  userId: string,
  email: string | null,
): Promise<CurrentProfile | null> {
  const { data } = await supabase
    .from("app_user_profile")
    .select("user_id, department, person_id, app_role(role_key, display_name), people(name)")
    .eq("user_id", userId)
    .eq("is_active", true)
    .maybeSingle();

  if (!data || !data.app_role) return null;

  return {
    userId: data.user_id,
    email,
    roleKey: data.app_role.role_key,
    roleDisplayName: data.app_role.display_name,
    department: data.department,
    personId: data.person_id,
    personName: data.people?.name ?? null,
  };
}

export type UserProfileListRow = {
  userId: string;
  roleKey: string;
  roleDisplayName: string;
  department: string | null;
  personName: string | null;
  isActive: boolean;
  createdAt: string;
};

/**
 * Every provisioned account, for the admin user-management page (exec
 * only — RLS also enforces this). Doesn't include email: that lives in
 * auth.users, which isn't exposed to the regular RLS-scoped client. The
 * admin page merges emails in separately via the service-role client when
 * one is configured, so this listing still works without it.
 */
export async function listUserProfiles(supabase: SupabaseTyped): Promise<UserProfileListRow[]> {
  const { data } = await supabase
    .from("app_user_profile")
    .select("user_id, department, is_active, created_at, app_role(role_key, display_name), people(name)")
    .order("created_at");

  if (!data) return [];

  return data
    .filter((row) => row.app_role)
    .map((row) => ({
      userId: row.user_id,
      roleKey: row.app_role!.role_key,
      roleDisplayName: row.app_role!.display_name,
      department: row.department,
      personName: row.people?.name ?? null,
      isActive: row.is_active,
      createdAt: row.created_at,
    }));
}

/** All roles, for populating the invite form's role picker. */
export async function getRoles(supabase: SupabaseTyped) {
  const { data } = await supabase.from("app_role").select("*").order("seniority", { ascending: false });
  return data ?? [];
}

/** All permissions and their current role assignments — for the role editor UI. */
export async function getRolePermissionMatrix(supabase: SupabaseTyped): Promise<RolePermissionMatrix> {
  const [{ data: perms }, { data: grants }] = await Promise.all([
    supabase
      .from("app_permission")
      .select("permission_key, display_name, resource, action, description, sort_order")
      .order("sort_order"),
    supabase
      .from("app_role_permission")
      .select("role_key, permission_key"),
  ]);

  const permissions: AppPermission[] = (perms ?? []).map((p) => ({
    permissionKey: p.permission_key,
    displayName: p.display_name,
    resource: p.resource,
    action: p.action,
    description: p.description,
    sortOrder: p.sort_order,
  }));

  const grantedByRole: Record<string, Set<string>> = {};
  for (const g of grants ?? []) {
    if (!grantedByRole[g.role_key]) grantedByRole[g.role_key] = new Set();
    grantedByRole[g.role_key].add(g.permission_key);
  }

  return { permissions, grantedByRole };
}
