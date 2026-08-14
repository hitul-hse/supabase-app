"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/utils/supabase/server";
import { createAdminClient } from "@/utils/supabase/admin";
import { getSiteUrl } from "@/utils/site-url";

export type InviteState = { status: "idle" | "success" | "error"; message?: string };

export async function inviteUser(
  _prevState: InviteState,
  formData: FormData,
): Promise<InviteState> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { status: "error", message: "Not authenticated." };
  }

  // Re-check the caller is exec server-side — don't just trust the page gate.
  const { data: callerProfile } = await supabase
    .from("app_user_profile")
    .select("role_key")
    .eq("user_id", user.id)
    .maybeSingle();

  if (callerProfile?.role_key !== "exec") {
    return { status: "error", message: "Only execs can invite users." };
  }

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

  // Without an explicit redirectTo, Supabase falls back to the project's Site
  // URL — which is how an invited colleague ends up with a localhost link they
  // cannot open. The target must also be listed under the project's redirect
  // allowlist, or Supabase silently substitutes the Site URL again.
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
