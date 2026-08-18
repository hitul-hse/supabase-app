"use server";

/**
 * Recording the organisation structure: who reports to whom, teams, job titles.
 *
 * WHY THESE WRITES EXIST AT ALL. TrackingTime cannot supply a hierarchy -- its
 * API exposes `supervisor` and `user_group_id`, but asked against the live
 * account both are empty for all 49 users. So the structure has to be recorded
 * by a person, and this is where that happens.
 *
 * WHY THE SERVICE ROLE. `time.member` has no UPDATE policy for authenticated
 * users: it is a vendor-sync table, and opening it to writes would let anyone
 * signed in rewrite the roster, including `user_id` -- which decides whose hours
 * someone sees. So the write goes through the service role behind an explicit
 * permission check. The gate below is the whole security boundary, and it is
 * re-checked server-side on every call rather than trusting the page that
 * rendered the form.
 *
 * CYCLES ARE REFUSED HERE, not in the database. Postgres blocks self-reference
 * via a CHECK, but a longer loop (A -> B -> A) needs a recursive trigger on every
 * write, which is a real cost on a table this small and hand-edited. So the loop
 * check runs before the write: it walks the proposed manager's own chain and
 * refuses if it comes back to the person being edited. The org chart ALSO detects
 * cycles on read, because data can arrive by other routes, but refusing at the
 * point of entry means the person who made the mistake is told immediately.
 */

import { revalidatePath } from "next/cache";
import { createClient } from "@/utils/supabase/server";
import { createAdminClient } from "@/utils/supabase/admin";
import { userHasPermission } from "@/utils/supabase/require-profile";
import { PERMISSIONS } from "@/lib/permissions";

export type OrgEditState = { status: "idle" | "success" | "error"; message?: string };

/**
 * The time schema, reached through one deliberate cast.
 *
 * database.types.ts is generated from the public schema, so a typed client will
 * not accept .schema("time") at all. The alternative to this helper is an `as any`
 * at every call site, which hides how many places are actually untyped. Kept to one
 * line so the cost is visible.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const timeSchema = (client: any) => client.schema("time");

/**
 * Only a holder of people:write may record structure.
 *
 * Not a role comparison: asking for the permission means the "Edit People" toggle
 * in /admin/roles actually decides the answer, rather than the grant reaching no
 * code -- which is a bug this codebase has had before.
 */
async function assertCanEditPeople(): Promise<{ ok: true } | { error: string }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "You are not signed in." };
  const allowed = await userHasPermission(PERMISSIONS.PEOPLE_WRITE);
  if (!allowed) return { error: "You do not have permission to edit people." };
  return { ok: true };
}

/**
 * Would setting `supervisorId` as `memberId`'s manager create a loop?
 *
 * Walks up from the proposed manager. If the chain reaches `memberId`, the edit
 * would close a cycle. Bounded by the roster size so corrupt data cannot spin
 * forever -- a guard that costs nothing and removes a whole failure mode.
 */
async function wouldCreateCycle(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  admin: any,
  memberId: number,
  supervisorId: number,
): Promise<boolean> {
  if (memberId === supervisorId) return true;

  const { data } = await timeSchema(admin).from("member").select("id, supervisor_member_id");
  const parentOf = new Map<number, number | null>(
    (data ?? []).map((r: { id: number; supervisor_member_id: number | null }) => [
      Number(r.id),
      r.supervisor_member_id === null ? null : Number(r.supervisor_member_id),
    ]),
  );

  let cursor: number | null = supervisorId;
  for (let hops = 0; hops <= parentOf.size + 1 && cursor !== null; hops += 1) {
    if (cursor === memberId) return true;
    cursor = parentOf.get(cursor) ?? null;
  }
  return false;
}

/** Set or clear one member's manager. */
export async function setSupervisor(
  _prev: OrgEditState,
  formData: FormData,
): Promise<OrgEditState> {
  const guard = await assertCanEditPeople();
  if ("error" in guard) return { status: "error", message: guard.error };

  const memberId = Number(formData.get("member_id"));
  const raw = String(formData.get("supervisor_member_id") ?? "").trim();
  const supervisorId = raw === "" ? null : Number(raw);

  if (!Number.isFinite(memberId)) {
    return { status: "error", message: "Which person? The member id was missing." };
  }
  if (supervisorId !== null && !Number.isFinite(supervisorId)) {
    return { status: "error", message: "That manager could not be identified." };
  }

  let admin;
  try {
    admin = createAdminClient();
  } catch (err) {
    return { status: "error", message: err instanceof Error ? err.message : "Admin client unavailable." };
  }

  if (supervisorId !== null) {
    if (memberId === supervisorId) {
      return { status: "error", message: "Somebody cannot report to themselves." };
    }
    if (await wouldCreateCycle(admin, memberId, supervisorId)) {
      return {
        status: "error",
        message: "That would create a reporting loop — the person you picked already reports to this one, directly or through someone else.",
      };
    }
  }

  const { error } = await timeSchema(admin)
    .from("member")
    .update({
      supervisor_member_id: supervisorId,
      // Provenance is required alongside a link, and cleared with it by a trigger.
      // 'manual' records that a person decided this, so a future import from
      // TrackingTime can refresh vendor-sourced links without overwriting it.
      supervisor_source: supervisorId === null ? null : "manual",
    })
    .eq("id", memberId);

  if (error) return { status: "error", message: error.message };

  revalidatePath("/people");
  return {
    status: "success",
    message: supervisorId === null ? "Reporting line cleared." : "Reporting line saved.",
  };
}

/** Set or clear a member's team and job title. */
export async function setMemberDetails(
  _prev: OrgEditState,
  formData: FormData,
): Promise<OrgEditState> {
  const guard = await assertCanEditPeople();
  if ("error" in guard) return { status: "error", message: guard.error };

  const memberId = Number(formData.get("member_id"));
  if (!Number.isFinite(memberId)) {
    return { status: "error", message: "Which person? The member id was missing." };
  }

  // Empty means "not recorded", stored as null rather than "". An empty string
  // would appear in the team list as a blank option and read as a real team.
  const team = String(formData.get("team") ?? "").trim() || null;
  const jobTitle = String(formData.get("job_title") ?? "").trim() || null;

  let admin;
  try {
    admin = createAdminClient();
  } catch (err) {
    return { status: "error", message: err instanceof Error ? err.message : "Admin client unavailable." };
  }

  const { error } = await timeSchema(admin)
    .from("member")
    .update({ team, job_title: jobTitle })
    .eq("id", memberId);

  if (error) return { status: "error", message: error.message };

  revalidatePath("/people");
  return { status: "success", message: "Saved." };
}
