"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/utils/supabase/server";
import { createAdminClient } from "@/utils/supabase/admin";
import { getSiteUrl } from "@/utils/site-url";
import { PERMISSIONS } from "@/lib/permissions";

export type InviteState = { status: "idle" | "success" | "error"; message?: string };

/**
 * Shared guard — re-checks server-side, never trusts the page gate alone.
 *
 * Asks for admin:users:write rather than comparing role_key to "exec". Only exec
 * holds that key today, so this changes nothing about who may act; what it
 * changes is that the "Manage User Accounts" toggle in /admin/roles now decides
 * the answer. Before, an administrator could grant that permission and the
 * grant reached no code — the toggle saved successfully and meant nothing.
 */
async function assertCanManageUsers(): Promise<{ userId: string } | { error: string }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated." };

  const { data: allowed } = await supabase.rpc("app_user_has_permission", {
    p_key: PERMISSIONS.ADMIN_USERS_WRITE,
  });

  if (!allowed) return { error: "You do not have permission to manage user accounts." };
  return { userId: user.id };
}

export async function inviteUser(
  _prevState: InviteState,
  formData: FormData,
): Promise<InviteState> {
  const guard = await assertCanManageUsers();
  if ("error" in guard) return { status: "error", message: guard.error };

  const email = String(formData.get("email") || "").trim();
  const roleKey = String(formData.get("role_key") || "").trim();
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
    // Deliberately not set. This used to carry the id of one of eight seeded
    // mockup people, chosen from a dropdown, which after the People rewire meant
    // linking a real colleague to a fictional one. The column stays in the schema
    // because app_user_person_id() gates timesheets and leave; it is simply no
    // longer populated from invented data.
    person_id: null,
    department: department || null,
  });

  if (profileError) {
    return {
      status: "error",
      message: `Invite sent, but saving the role failed: ${profileError.message}`,
    };
  }

  /**
   * Link the new account to its TrackingTime member, by email.
   *
   * This is the link that does the work: time.current_member_id() resolves
   *   where m.user_id = auth.uid() or (m.hub_person_id = app_user_person_id())
   * and checks user_id first, so setting it is what makes someone's own logged
   * hours visible on their Time page.
   *
   * Measured on live before writing this: all three Hub accounts on a real work
   * address already match a TrackingTime member on email exactly, and the only
   * unmatched accounts are throwaway test addresses. So email is the natural key
   * and the admin does not need to choose anything.
   *
   * A miss is NOT an error. Someone can legitimately have a Hub account with no
   * TrackingTime record -- an office manager who approves timesheets but logs
   * none -- so a failure to match must not undo a successful invite. It is
   * reported in the success message instead, because an admin who expected the
   * link deserves to know it did not happen.
   */
  let linkNote = "";
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const timeAdmin = (admin as any).schema("time");
    const { data: member } = await timeAdmin
      .from("member")
      .select("id, display_name, user_id")
      // ilike, not eq: TrackingTime addresses are not case-normalised, and a
      // case mismatch would silently skip the link.
      .ilike("email", email)
      .maybeSingle();

    if (!member) {
      linkNote = " No TrackingTime account matches that address, so no hours are linked yet.";
    } else if (member.user_id && member.user_id !== invited.user.id) {
      // Someone else already owns this member record. Overwriting would move one
      // person's hours onto another's account, so refuse and say so.
      linkNote = ` Warning: TrackingTime member "${member.display_name}" is already linked to a different account, so it was left alone.`;
    } else {
      const { error: linkError } = await timeAdmin
        .from("member")
        .update({ user_id: invited.user.id })
        .eq("id", member.id);
      linkNote = linkError
        ? ` Their TrackingTime record could not be linked: ${linkError.message}`
        : ` Linked to TrackingTime member "${member.display_name}".`;
    }
  } catch (err) {
    linkNote = ` Their TrackingTime record could not be linked: ${err instanceof Error ? err.message : "unknown error"}`;
  }

  revalidatePath("/admin/users");
  return { status: "success", message: `Invited ${email}.${linkNote}` };
}

/** Activate or deactivate a user account. */
export async function setUserActive(
  userId: string,
  isActive: boolean,
): Promise<{ error?: string }> {
  const guard = await assertCanManageUsers();
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
  const guard = await assertCanManageUsers();
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
  const guard = await assertCanManageUsers();
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
