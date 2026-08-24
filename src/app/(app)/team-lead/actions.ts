"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/utils/supabase/server";
import { PERMISSIONS } from "@/lib/permissions";

export type ApprovalResult = { ok: boolean; message?: string };

const DENIED = "You do not have permission to approve this.";

/**
 * Approving is gated on workload:approve, in the action itself.
 *
 * This became necessary when /team-lead moved from a hardcoded
 * ["exec", "dept_head"] list to requirePermission(WORKLOAD_READ). That key is
 * also held by project_manager, so the board — and its approve buttons — is now
 * reachable by a role that does NOT hold workload:approve. Before the widening,
 * the page gate was the only thing standing between a project manager and these
 * writes: there was no identity or permission check here at all, only RLS.
 *
 * Leaving it to RLS would repeat the mistake fixed in projects/actions.ts —
 * gating a WRITE on READ visibility. workload:approve is the key that names this
 * act, so it is the key that decides it.
 */
async function requireApprover() {
  const supabase = await createClient();
  const { data: allowed } = await supabase.rpc("app_user_has_permission", {
    p_key: PERMISSIONS.WORKLOAD_APPROVE,
  });
  return allowed ? supabase : null;
}

/**
 * Both actions report failures back to the caller instead of swallowing them.
 * A denial used to surface as a successful-looking no-op because the error was
 * never checked and revalidatePath ran unconditionally.
 */
export async function approveDecision(id: string): Promise<ApprovalResult> {
  const supabase = await requireApprover();
  if (!supabase) return { ok: false, message: DENIED };
  const { error, count } = await supabase
    .from("approval_decisions")
    .update({ status: "approved" }, { count: "exact" })
    .eq("id", id);

  if (error) {
    console.error("approveDecision failed:", error);
    return { ok: false, message: error.message };
  }

  if (!count) {
    return { ok: false, message: "That approval is no longer pending, or you can't change it." };
  }

  revalidatePath("/team-lead");
  return { ok: true };
}

export async function approveAllPending(): Promise<ApprovalResult> {
  const supabase = await requireApprover();
  if (!supabase) return { ok: false, message: DENIED };
  const { error, count } = await supabase
    .from("approval_decisions")
    .update({ status: "approved" }, { count: "exact" })
    .eq("status", "pending");

  if (error) {
    console.error("approveAllPending failed:", error);
    return { ok: false, message: error.message };
  }

  revalidatePath("/team-lead");
  return { ok: true, message: count ? `Approved ${count}.` : "Nothing was pending." };
}

/**
 * Bulk-transitions every submitted timesheet_entries row for one person's
 * week to approved/rejected.
 *
 * Gated on workload:approve here, and RLS ("lead can approve or reject visible
 * timesheet_entries") narrows it further to employees this caller may see. The
 * permission answers "may you approve at all", the policy answers "whose" — the
 * .eq("status", "submitted") guard is neither, it just avoids touching rows in
 * an unexpected state.
 */
async function setTimesheetWeekStatus(
  personId: string,
  weekStart: string,
  status: "approved" | "rejected",
  rejectionNote?: string,
): Promise<ApprovalResult> {
  const supabase = await requireApprover();
  if (!supabase) return { ok: false, message: DENIED };
  const { error, count } = await supabase
    .from("timesheet_entries")
    .update(
      status === "rejected"
        ? { status, rejection_note: rejectionNote ?? null }
        : { status, rejection_note: null },
      { count: "exact" },
    )
    .eq("person_id", personId)
    .eq("week_start", weekStart)
    .eq("status", "submitted");

  if (error) {
    console.error(`setTimesheetWeekStatus(${status}) failed:`, error);
    return { ok: false, message: error.message };
  }

  if (!count) {
    return { ok: false, message: "That week is no longer pending, or you can't change it." };
  }

  revalidatePath("/team-lead");
  return { ok: true };
}

export async function approveTimesheetWeek(personId: string, weekStart: string): Promise<ApprovalResult> {
  return setTimesheetWeekStatus(personId, weekStart, "approved");
}

/**
 * Rejection carries a reason. Clockify makes the note mandatory and the
 * reasoning holds: a week sent back with no stated cause just produces
 * another round of guessing about what was wrong with it.
 */
export async function rejectTimesheetWeek(
  personId: string,
  weekStart: string,
  rejectionNote: string,
): Promise<ApprovalResult> {
  const note = rejectionNote.trim();
  if (!note) {
    return { ok: false, message: "Say what needs fixing before sending the week back." };
  }
  return setTimesheetWeekStatus(personId, weekStart, "rejected", note);
}
