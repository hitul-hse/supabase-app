"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/utils/supabase/server";
import { requirePermission } from "@/utils/supabase/require-profile";
import { PERMISSIONS } from "@/lib/permissions";

/**
 * Toggle a single permission on or off for a role.
 * Exec-only — requirePermission enforces this server-side.
 */
export async function toggleRolePermission(
  roleKey: string,
  permissionKey: string,
  grant: boolean,
): Promise<{ error?: string }> {
  await requirePermission("/admin/roles", PERMISSIONS.ADMIN_ROLES_WRITE);
  const supabase = await createClient();

  if (grant) {
    const { error } = await supabase
      .from("app_role_permission")
      .insert({ role_key: roleKey, permission_key: permissionKey });
    if (error) return { error: error.message };
  } else {
    const { error } = await supabase
      .from("app_role_permission")
      .delete()
      .eq("role_key", roleKey)
      .eq("permission_key", permissionKey);
    if (error) return { error: error.message };
  }

  revalidatePath("/admin/roles");
  revalidatePath("/admin/users");
  return {};
}
