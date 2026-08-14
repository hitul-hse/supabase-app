import { redirect } from "next/navigation";
import { createClient } from "./server";
import { getCurrentProfile, type CurrentProfile } from "@/lib/queries/auth";

/**
 * Like requireUser(), but also resolves the caller's role. Redirects to
 * /access-pending if an admin hasn't provisioned a profile yet, and to "/"
 * if allowedRoles is given and their role isn't in it. Most pages don't need
 * this — RLS already scopes what comes back for them. Use it only where a
 * hard role gate is required (e.g. the Team Lead view, the admin console).
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
