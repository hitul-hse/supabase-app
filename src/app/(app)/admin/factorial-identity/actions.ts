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

/**
 * "This colleague simply never got a hub person -- for leavers, creating one (inactive) is what lets their logged history attribute to a name."
 * Measured 2026-09-01: 17 of 18 bridged_unlinked employees have no
 * same-name person to pick -- they exist in Factorial and TrackingTime but
 * not in public.people, so "Link person" is structurally unanswerable for
 * them. This creates the person the honest way: name from the member's
 * display_name (the fuller of the two sources), everything unknown left
 * NULL rather than invented -- no fabricated role, no fake contract hours.
 * One transaction: person, member wiring, review decision, signed mapping.
 */
export async function createPersonAndLink(
  _prev: DecisionState,
  formData: FormData,
): Promise<DecisionState> {
  const guard = await assertCanDecide();
  if ("error" in guard) return { status: "error", message: guard.error };

  const reviewId = String(formData.get("review_id") || "");
  const note = String(formData.get("note") || "").trim();
  if (!reviewId) return { status: "error", message: "Missing row." };

  try {
    const created = await withDb(async (db) => {
      await db.query("begin");
      try {
        const rev = await db.query(
          `select factorial_company_id, factorial_employee_id, factorial_active,
                  candidate_member_id, status
             from crm.factorial_identity_review
            where id = $1
            for update`,
          [reviewId],
        );
        if (rev.rowCount === 0) throw new Error("Row not found.");
        const r = rev.rows[0] as {
          factorial_company_id: string; factorial_employee_id: string;
          factorial_active: boolean | null; candidate_member_id: number | null; status: string;
        };
        if (!MACHINE_STATUSES.includes(r.status)) {
          throw new Error(`Already decided (${r.status}).`);
        }
        if (!r.candidate_member_id) {
          throw new Error("No TrackingTime member on this row — create-and-link needs the member as the name source.");
        }
        const mem = await db.query(
          "select display_name from time.member where id = $1",
          [r.candidate_member_id],
        );
        const rawName = String((mem.rows[0] as { display_name?: string } | undefined)?.display_name ?? "").replace(/\s+/g, " ").trim();
        if (!rawName) throw new Error("The member has no display name to create a person from.");

        /* fq- prefix mirrors the md- masterdata convention; suffix on collision. */
        const slug = rawName.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);
        let personId: string | null = null;
        for (let i = 0; i < 10 && !personId; i += 1) {
          const candidate = i === 0 ? `fq-${slug}` : `fq-${slug}-${i + 1}`;
          const ins = await db.query(
            `insert into public.people (id, name, is_active, factorial_employee_id, source)
             values ($1, $2, true, $3, 'factorial')
             on conflict (id) do nothing
             returning id`,
            [candidate, rawName, r.factorial_employee_id],
          );
          if (ins.rowCount === 1) personId = candidate;
        }
        if (!personId) throw new Error(`Could not find a free id for fq-${slug}.`);

        const wire = await db.query(
          "update time.member set hub_person_id = $2 where id = $1 and hub_person_id is null",
          [r.candidate_member_id, personId],
        );
        if (wire.rowCount === 0) {
          throw new Error("The member already has a hub person — refresh and use Link person instead.");
        }
        await db.query(
          `update crm.factorial_identity_review
              set status = 'resolved_manual',
                  candidate_person_id = $2,
                  reviewed_by = $3,
                  reviewed_at = now(),
                  resolution_note = nullif($4, ''),
                  last_seen_at = now()
            where id = $1`,
          [reviewId, personId, guard.userId, note],
        );
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
          [personId, r.factorial_employee_id, r.factorial_company_id, guard.userId],
        );
        await db.query("commit");
        return rawName;
      } catch (e) {
        await db.query("rollback");
        throw e;
      }
    });
    revalidatePath("/admin/factorial-identity");
    return { status: "success", message: `Created ${created} and linked.` };
  } catch (e) {
    return { status: "error", message: e instanceof Error ? e.message : JSON.stringify(e) };
  }
}
