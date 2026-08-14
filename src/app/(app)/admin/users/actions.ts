"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/utils/supabase/server";
import { createAdminClient } from "@/utils/supabase/admin";
import { getSiteUrl } from "@/utils/site-url";

export type InviteState = { status: "idle" | "success" | "error"; message?: string };

/** Shared exec guard — re-checks role server-side, never trusts the page gate alone. */
async function assertExec(): Promise<{ userId: string } | { error: string }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated." };

  const { data: profile } = await supabase
    .from("app_user_profile")
    .select("role_key")
    .eq("user_id", user.id)
    .maybeSingle();

  if (profile?.role_key !== "exec") return { error: "Only executives can perform this action." };
  return { userId: user.id };
}

export async function inviteUser(
  _prevState: InviteState,
  formData: FormData,
): Promise<InviteState> {
  const guard = await assertExec();
  if ("error" in guard) return { status: "error", message: guard.error };

  const email = String(formData.get("email") || "").trim();
  const roleKey = String(formData.get("role_key") || "").trim();
  const personId = String(formData.get("person_id") || "").trim();
  const department = String(formData.get("department") || "").trim();

  if (!email || !roleKey) {
    return { status: "error", message: "Email and role are required." };
  }

  let admin;
  try {
    admin = createAdminClient();
  } catch (err) {
    return { status: "error", message: err instanceof Error ? err.message : "Admin client unavailable." };
  }

  const { data: invited, error: inviteError } = await admin.auth.admin.inviteUserByEmail(email, {
    redirectTo: `${getSiteUrl()}/auth/callback?next=%2Fauth%2Fset-password`,
  });

  if (inviteError || !invited.user) {
    return { status: "error", message: inviteError?.message ?? "Could not send invite." };
  }

  const { error: profileError } = await admin.from("app_user_profile").insert({
    user_id: invited.user.id,
    role_key: roleKey,
    person_id: personId || null,
    department: department || null,
  });

  if (profileError) {
    return {
      status: "error",
      message: `Invite sent, but saving the role failed: ${profileError.message}`,
    };
  }

  revalidatePath("/admin/users");
  return { status: "success", message: `Invited ${email}.` };
}

/** Activate or deactivate a user account. */
export async function setUserActive(
  userId: string,
  isActive: boolean,
): Promise<{ error?: string }> {
  const guard = await assertExec();
  if ("error" in guard) return { error: guard.error };

  const supabase = await createClient();
  const { error } = await supabase
    .from("app_user_profile")
    .update({ is_active: isActive })
    .eq("user_id", userId);

  if (error) return { error: error.message };
  revalidatePath("/admin/users");
  return {};
}

/** Change a user's role. */
export async function changeUserRole(
  userId: string,
  newRoleKey: string,
): Promise<{ error?: string }> {
  const guard = await assertExec();
  if ("error" in guard) return { error: guard.error };

  const supabase = await createClient();
  const { error } = await supabase
    .from("app_user_profile")
    .update({ role_key: newRoleKey })
    .eq("user_id", userId);

  if (error) return { error: error.message };
  revalidatePath("/admin/users");
  return {};
}

/** Change a user's department. */
export async function changeUserDepartment(
  userId: string,
  department: string,
): Promise<{ error?: string }> {
  const guard = await assertExec();
  if ("error" in guard) return { error: guard.error };

  const supabase = await createClient();
  const { error } = await supabase
    .from("app_user_profile")
    .update({ department: department || null })
    .eq("user_id", userId);

  if (error) return { error: error.message };
  revalidatePath("/admin/users");
  return {};
}
