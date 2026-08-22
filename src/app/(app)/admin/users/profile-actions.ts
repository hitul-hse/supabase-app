"use server";

/**
 * Administering SOMEBODY ELSE's record â€” the exec/HR write path.
 *
 * WHY A SEPARATE FILE FROM profile/actions.ts. That file is self-service: every
 * action there resolves the target from the SESSION and can never touch another
 * row. These actions take a target id from the request, which makes them a
 * fundamentally different security problem. Keeping them apart means the
 * self-service path cannot accidentally inherit an "edit anyone" code path, and
 * a reviewer can see at a glance which file needs the paranoid reading.
 *
 * THE RULES, each because the obvious implementation is wrong:
 *
 * 1. EVERY action re-checks the permission server-side. The page hides these
 *    controls without the key, but hiding a button is presentation, not a
 *    boundary â€” a Server Action is a public HTTP endpoint.
 *
 * 2. The permission is asked of the DATABASE (app_user_has_permission), not
 *    compared against a role string. Roles are data: /admin/roles can grant
 *    admin:profiles:write to a role that does not exist yet, and a hardcoded
 *    `role === 'hr'` would silently ignore that grant.
 *
 * 3. Nobody may edit their OWN record through this path. Self-service already
 *    exists for that, and allowing it here would let an HR user quietly change
 *    fields on themselves that the self-service form deliberately does not
 *    expose (contracted hours, for one).
 *
 * 4. An INVOICED time entry is not editable, by anyone, through any path. That
 *    is what is_billed means: the hours already left the building on an invoice,
 *    so the correction is a credit note in the finance system, not a quiet
 *    rewrite here. The owner is already blocked by RLS and by time/actions.ts;
 *    admin:entries:write does not buy an exception.
 */

import { revalidatePath } from "next/cache";
import { createClient } from "@/utils/supabase/server";
import { createAdminClient } from "@/utils/supabase/admin";
import { PERMISSIONS } from "@/lib/permissions";

export type AdminActionResult = { ok: boolean; message?: string };

const DENIED = "You do not have permission to administer other people's records.";

/**
 * Resolve the caller and confirm they hold `key`, returning both clients.
 *
 * The RLS-scoped client is used for reads (so the caller only ever sees what
 * they may see), and the service-role client for the writes that must reach
 * auth.users or bypass a policy written for self-service. Both are returned so
 * a call site cannot accidentally do a privileged write on the wrong one.
 *
 * A DISCRIMINATED union on `ok`, not an optional `error`: with two
 * optional-shaped branches TypeScript cannot narrow after `if ("error" in x)`
 * and every call site silently widens to `| undefined`.
 */
type Authorised = {
  ok: true;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any;
  callerId: string;
};
type Refused = { ok: false; result: AdminActionResult };

async function authorise(key: string): Promise<Authorised | Refused> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, result: { ok: false, message: "You are not signed in." } };

  const { data: allowed } = await supabase.rpc("app_user_has_permission", { p_key: key });
  if (allowed !== true) return { ok: false, result: { ok: false, message: DENIED } };

  return { ok: true, supabase, callerId: user.id };
}

/** A trimmed string, or null when blank. */
function text(raw: FormDataEntryValue | null): string | null {
  if (raw === null) return null;
  const s = String(raw).trim();
  return s.length ? s : null;
}

function revalidateAdmin(userId?: string): void {
  revalidatePath("/admin/users");
  revalidatePath("/people");
  if (userId) revalidatePath(`/admin/users/${userId}`);
}

/* ------------------------------------------------------------------ profile */

/**
 * Change another person's profile fields.
 *
 * display_name lives on app_user_profile rather than public.people on purpose
 * (see add_user_profile_fields.sql): people is destined to be fed by Factorial
 * and TrackingTime, so a name written there is overwritten by the next sync.
 */
export async function adminUpdateProfile(formData: FormData): Promise<AdminActionResult> {
  const auth = await authorise(PERMISSIONS.ADMIN_PROFILES_WRITE);
  if (!auth.ok) return auth.result;

  const userId = text(formData.get("user_id"));
  if (!userId) return { ok: false, message: "No user was specified." };

  // Rule 3: self-service is a different surface with a different field set.
  if (userId === auth.callerId) {
    return {
      ok: false,
      message: "Use your own profile page to change your own details.",
    };
  }

  const displayName = text(formData.get("display_name"));
  // The DB constraint allows 1-60 characters or null; check here so the user
  // gets a sentence instead of a constraint violation.
  if (displayName !== null && displayName.length > 60) {
    return { ok: false, message: "A display name cannot be longer than 60 characters." };
  }

  const department = text(formData.get("department"));

  const { error } = await auth.supabase
    .from("app_user_profile")
    .update({ display_name: displayName, department })
    .eq("user_id", userId);

  if (error) return { ok: false, message: error.message };

  revalidateAdmin(userId);
  return { ok: true, message: "Profile updated." };
}

/* ------------------------------------------------- contracted hours (member) */

/**
 * Set a person's contracted weekly hours on their TrackingTime member row.
 *
 * WHY THIS IS WORTH HAVING. Every one of the 49 imported members reports
 * exactly 40h â€” TrackingTime's account-wide default, not anybody's negotiated
 * contract. That is why every utilisation figure in this app is labelled
 * "against a nominal 40-hour week". Editing this is what turns those figures
 * from nominal into real, so it is the single highest-value field here.
 *
 * Writes through the service role because time.member's update policy is scoped
 * to user admins; the permission check above is the boundary.
 */
export async function adminUpdateWeeklyHours(formData: FormData): Promise<AdminActionResult> {
  const auth = await authorise(PERMISSIONS.ADMIN_PROFILES_WRITE);
  if (!auth.ok) return auth.result;

  const memberId = Number(text(formData.get("member_id")));
  if (!Number.isInteger(memberId) || memberId <= 0) {
    return { ok: false, message: "This person is not linked to a Time Tracking member." };
  }

  const raw = text(formData.get("weekly_hours"));
  const hours = raw === null ? null : Number(raw);
  if (hours === null || !Number.isFinite(hours)) {
    return { ok: false, message: "Enter the contracted hours per week." };
  }
  // A week has 168 hours; the column is numeric(5,2). Reject the absurd rather
  // than storing it and poisoning every utilisation ratio downstream.
  if (hours <= 0 || hours > 80) {
    return { ok: false, message: "Contracted hours must be between 0 and 80 per week." };
  }

  try {
    const admin = createAdminClient();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (admin as any)
      .schema("time")
      .from("member")
      .update({ weekly_hours: hours })
      .eq("id", memberId);
    if (error) return { ok: false, message: error.message };
  } catch (e) {
    return { ok: false, message: (e as Error).message };
  }

  revalidateAdmin();
  revalidatePath("/team-lead");
  revalidatePath("/time/dashboard");
  return { ok: true, message: `Contracted hours set to ${hours}h per week.` };
}

/* -------------------------------------------------------------- time entries */

/**
 * Correct another person's time entry.
 *
 * Only the fields a correction legitimately needs: duration, billable flag and
 * notes. NOT member_id â€” moving an entry to a different person is not a
 * correction, it is a rewrite of who did the work, and it would silently change
 * two people's utilisation at once.
 */
export async function adminUpdateEntry(formData: FormData): Promise<AdminActionResult> {
  const auth = await authorise(PERMISSIONS.ADMIN_ENTRIES_WRITE);
  if (!auth.ok) return auth.result;

  const entryId = Number(text(formData.get("entry_id")));
  if (!Number.isInteger(entryId) || entryId <= 0) {
    return { ok: false, message: "No entry was specified." };
  }

  const admin = createAdminClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const timeSchema = (admin as any).schema("time");

  const { data: existing, error: readError } = await timeSchema
    .from("entry")
    .select("id, is_billed, duration_seconds, member_id")
    .eq("id", entryId)
    .maybeSingle();

  if (readError) return { ok: false, message: readError.message };
  if (!existing) return { ok: false, message: "That entry no longer exists." };

  // Rule 4: invoiced hours are not rewritten here, whatever the permission says.
  if (existing.is_billed) {
    return {
      ok: false,
      message:
        "This entry has been invoiced, so it cannot be edited. The hours have already been billed â€” raise a credit note in the finance system instead of changing the record.",
    };
  }

  const hoursRaw = text(formData.get("hours"));
  const hours = hoursRaw === null ? null : Number(hoursRaw);
  if (hours === null || !Number.isFinite(hours) || hours <= 0 || hours > 24) {
    return { ok: false, message: "Enter a duration between 0 and 24 hours." };
  }

  const isBillable = formData.get("is_billable") === "on";
  const notes = text(formData.get("notes"));

  const { error } = await timeSchema
    .from("entry")
    .update({
      duration_seconds: Math.round(hours * 3600),
      is_billable: isBillable,
      notes,
      updated_at: new Date().toISOString(),
    })
    .eq("id", entryId);

  if (error) return { ok: false, message: error.message };

  revalidateAdmin();
  revalidatePath("/time");
  revalidatePath("/time/dashboard");
  return { ok: true, message: "Entry corrected." };
}

/** Remove another person's time entry. Same invoiced rule applies. */
export async function adminDeleteEntry(formData: FormData): Promise<AdminActionResult> {
  const auth = await authorise(PERMISSIONS.ADMIN_ENTRIES_WRITE);
  if (!auth.ok) return auth.result;

  const entryId = Number(text(formData.get("entry_id")));
  if (!Number.isInteger(entryId) || entryId <= 0) {
    return { ok: false, message: "No entry was specified." };
  }

  const admin = createAdminClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const timeSchema = (admin as any).schema("time");

  const { data: existing } = await timeSchema
    .from("entry")
    .select("id, is_billed")
    .eq("id", entryId)
    .maybeSingle();

  if (!existing) return { ok: false, message: "That entry no longer exists." };
  if (existing.is_billed) {
    return {
      ok: false,
      message:
        "This entry has been invoiced and cannot be deleted. Raise a credit note in the finance system instead.",
    };
  }

  const { error } = await timeSchema.from("entry").delete().eq("id", entryId);
  if (error) return { ok: false, message: error.message };

  revalidateAdmin();
  revalidatePath("/time");
  revalidatePath("/time/dashboard");
  return { ok: true, message: "Entry removed." };
}
