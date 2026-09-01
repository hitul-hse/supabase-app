"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/utils/supabase/server";
import { createAdminClient } from "@/utils/supabase/admin";
import { PERMISSIONS } from "@/lib/permissions";

export type DecisionState = { status: "idle" | "success" | "error"; message?: string };

/**
 * Same shape as assertCanManageUsers in ../users/actions.ts, same permission
 * key. Deciding who a Factorial employee IS in the hub is user management in
 * the only sense that matters: it controls whose hours, absences and contract
 * terms attach to which colleague.
 */
async function assertCanDecide(): Promise<{ userId: string } | { error: string }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated." };
  const { data: allowed } = await supabase.rpc("app_user_has_permission", {
    p_key: PERMISSIONS.ADMIN_USERS_WRITE,
  });
  if (!allowed) return { error: "You do not have permission to decide identities." };
  return { userId: user.id };
}

/* The statuses a human decision may be applied on top of. Mirrors the sync's
 * machine set: a row already carrying a human decision is not re-decidable from
 * this screen — undoing a colleague's signed call deserves more ceremony than a
 * button, and the DB constraint would demand the same evidence anyway. */
const OPEN_STATUSES = ["unmatched", "bridged_unlinked", "ambiguous", "resolved_auto"];

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const crm = () => (createAdminClient() as any).schema("crm");

/**
 * "This Factorial employee IS this person." Writes the decision to the review
 * row AND creates the manual mapping, both signed with the reviewer's id --
 * the factorial_person_reference constraint requires exactly that for
 * match_method 'manual', which is what distinguishes this from anything a
 * sync could do.
 */
export async function resolveToPerson(
  _prev: DecisionState,
  formData: FormData,
): Promise<DecisionState> {
  const guard = await assertCanDecide();
  if ("error" in guard) return { status: "error", message: guard.error };

  const reviewId = String(formData.get("review_id") || "");
  const personId = String(formData.get("person_id") || "");
  const note = String(formData.get("note") || "").trim();
  if (!reviewId || !personId) {
    return { status: "error", message: "Pick a person before linking." };
  }

  const now = new Date().toISOString();
  const { data: row, error: readErr } = await crm()
    .from("factorial_identity_review")
    .select("factorial_company_id, factorial_employee_id, status")
    .eq("id", reviewId)
    .maybeSingle();
  if (readErr || !row) return { status: "error", message: readErr?.message ?? "Row not found." };
  if (!OPEN_STATUSES.includes(row.status)) {
    return { status: "error", message: `Already decided (${row.status}). Undo needs its own ceremony, not this button.` };
  }

  const { error: updErr } = await crm()
    .from("factorial_identity_review")
    .update({
      status: "resolved_manual",
      candidate_person_id: personId,
      reviewed_by: guard.userId,
      reviewed_at: now,
      resolution_note: note || null,
      last_seen_at: now,
    })
    .eq("id", reviewId)
    .in("status", OPEN_STATUSES);
  if (updErr) return { status: "error", message: updErr.message };

  const { error: mapErr } = await crm()
    .from("factorial_person_reference")
    .upsert(
      {
        person_id: personId,
        source_system: "factorial",
        entity_type: "person",
        external_id: row.factorial_employee_id,
        account_ref: row.factorial_company_id,
        match_method: "manual",
        reviewed_by: guard.userId,
        reviewed_at: now,
        last_seen_at: now,
        is_active: true,
      },
      { onConflict: "source_system,external_id,entity_type,account_ref" },
    );
  if (mapErr) return { status: "error", message: `Review updated but mapping failed: ${mapErr.message}` };

  revalidatePath("/admin/factorial-identity");
  return { status: "success", message: "Linked." };
}

/**
 * "This is not a person" (shared mailbox) or "not an employee of ours".
 * Terminal, so it carries the reviewer's name -- which is the entire point:
 * the classifier deliberately cannot reach these states.
 */
export async function excludeRow(
  _prev: DecisionState,
  formData: FormData,
): Promise<DecisionState> {
  const guard = await assertCanDecide();
  if ("error" in guard) return { status: "error", message: guard.error };

  const reviewId = String(formData.get("review_id") || "");
  const kind = String(formData.get("kind") || "");
  const note = String(formData.get("note") || "").trim();
  if (!reviewId) return { status: "error", message: "Missing row." };
  if (kind !== "excluded_not_a_person" && kind !== "excluded_not_employee") {
    return { status: "error", message: "Unknown exclusion kind." };
  }

  const now = new Date().toISOString();
  const { error } = await crm()
    .from("factorial_identity_review")
    .update({
      status: kind,
      reviewed_by: guard.userId,
      reviewed_at: now,
      resolution_note: note || null,
      last_seen_at: now,
    })
    .eq("id", reviewId)
    .in("status", OPEN_STATUSES);
  if (error) return { status: "error", message: error.message };

  revalidatePath("/admin/factorial-identity");
  return { status: "success", message: "Excluded." };
}
