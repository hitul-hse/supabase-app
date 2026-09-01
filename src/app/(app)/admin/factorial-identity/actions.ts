"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/utils/supabase/server";
import { PERMISSIONS } from "@/lib/permissions";
import { withDb, MACHINE_STATUSES } from "./db";

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

/**
 * "This Factorial employee IS this person." Writes the decision to the review
 * row AND creates the manual mapping, both signed with the reviewer's id --
 * the factorial_person_reference constraint requires exactly that for
 * match_method 'manual', which is what distinguishes this from anything a
 * sync could do. One transaction: a decision that half-lands is worse than one
 * that fails loudly.
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

  try {
    await withDb(async (db) => {
      await db.query("begin");
      try {
        const upd = await db.query(
          `update crm.factorial_identity_review
              set status = 'resolved_manual',
                  candidate_person_id = $2,
                  reviewed_by = $3,
                  reviewed_at = now(),
                  resolution_note = nullif($4, ''),
                  last_seen_at = now()
            where id = $1 and status = any($5)
            returning factorial_company_id, factorial_employee_id`,
          [reviewId, personId, guard.userId, note, MACHINE_STATUSES],
        );
        if (upd.rowCount === 0) {
          throw new Error("Row not found or already decided — undoing a signed call needs more ceremony than this button.");
        }
        const row = upd.rows[0];
        await db.query(
          `insert into crm.factorial_person_reference
             (person_id, source_system, entity_type, external_id, account_ref,
              match_method, reviewed_by, reviewed_at, last_seen_at, is_active)
           values ($1, 'factorial', 'person', $2, $3, 'manual', $4, now(), now(), true)
           on conflict (source_system, external_id, entity_type, account_ref)
           do update set person_id = excluded.person_id,
                         match_method = 'manual',
                         reviewed_by = excluded.reviewed_by,
                         reviewed_at = now(),
                         last_seen_at = now(),
                         is_active = true`,
          [personId, row.factorial_employee_id, row.factorial_company_id, guard.userId],
        );
        await db.query("commit");
      } catch (e) {
        await db.query("rollback");
        throw e;
      }
    });
  } catch (e) {
    return { status: "error", message: e instanceof Error ? e.message : JSON.stringify(e) };
  }

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

  try {
    await withDb(async (db) => {
      const upd = await db.query(
        `update crm.factorial_identity_review
            set status = $2,
                reviewed_by = $3,
                reviewed_at = now(),
                resolution_note = nullif($4, ''),
                last_seen_at = now()
          where id = $1 and status = any($5)`,
        [reviewId, kind, guard.userId, note, MACHINE_STATUSES],
      );
      if (upd.rowCount === 0) {
        throw new Error("Row not found or already decided.");
      }
    });
  } catch (e) {
    return { status: "error", message: e instanceof Error ? e.message : JSON.stringify(e) };
  }

  revalidatePath("/admin/factorial-identity");
  return { status: "success", message: "Excluded." };
}
