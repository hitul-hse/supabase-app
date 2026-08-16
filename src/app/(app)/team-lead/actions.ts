"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/utils/supabase/server";

export type ApprovalResult = { ok: boolean; message?: string };

/**
 * Both actions report failures back to the caller instead of swallowing them.
 * RLS denies these updates for anyone who isn't exec/dept_head, and that
 * denial used to surface as a successful-looking no-op because the error was
 * never checked and revalidatePath ran unconditionally.
 */
export async function approveDecision(id: string): Promise<ApprovalResult> {
  const supabase = await createClient();
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
  const supabase = await createClient();
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
 * week to approved/rejected. RLS ("lead can approve or reject visible
 * timesheet_entries") is what actually enforces that only a dept_head/exec
 * who can_view_person() this employee can do this -- the .eq("status",
 * "submitted") guard here just avoids touching rows in an unexpected state.
 */
async function setTimesheetWeekStatus(
  personId: string,
  weekStart: string,
  status: "approved" | "rejected",
): Promise<ApprovalResult> {
  const supabase = await createClient();
  const { error, count } = await supabase
    .from("timesheet_entries")
    .update({ status }, { count: "exact" })
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

export async function rejectTimesheetWeek(personId: string, weekStart: string): Promise<ApprovalResult> {
  return setTimesheetWeekStatus(personId, weekStart, "rejected");
}
