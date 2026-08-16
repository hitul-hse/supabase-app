"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/utils/supabase/server";

export type TimerResult = { ok: boolean; message?: string };

/** The signed-in user's linked person row, or null if none is provisioned. */
async function currentPersonId(
  supabase: Awaited<ReturnType<typeof createClient>>,
): Promise<string | null> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data } = await supabase
    .from("app_user_profile")
    .select("person_id")
    .eq("user_id", user.id)
    .maybeSingle();

  return data?.person_id ?? null;
}

/**
 * Starts a timer: a timesheet_entries row with started_at set and stopped_at
 * still null. The "only one running timer per person" rule is enforced by a
 * partial unique index, so a double-click surfaces as a unique violation here
 * rather than quietly creating a second timer that double-counts hours.
 */
export async function startTimer(formData: FormData): Promise<TimerResult> {
  const supabase = await createClient();
  const personId = await currentPersonId(supabase);
  if (!personId) return { ok: false, message: "No person record is linked to your account." };

  const taskName = String(formData.get("task_name") || "").trim();
  const projectName = String(formData.get("project_name") || "").trim();
  const isBillable = formData.get("is_billable") === "on";

  if (!taskName || !projectName) {
    return { ok: false, message: "Task and project are required to start a timer." };
  }

  const now = new Date();
  // Postgres/ISO weeks run Monday-first; getDay() is Sunday-first, so shift it.
  const dayOfWeek = (now.getDay() + 6) % 7;

  const { data: lastGroup } = await supabase
    .from("timesheet_entries")
    .select("entry_group")
    .eq("person_id", personId)
    .order("entry_group", { ascending: false })
    .limit(1)
    .maybeSingle();

  const { error } = await supabase.from("timesheet_entries").insert({
    person_id: personId,
    task_name: taskName,
    project_name: projectName,
    is_billable: isBillable,
    day_of_week: dayOfWeek,
    hours: 0,
    entry_group: (lastGroup?.entry_group ?? 0) + 1,
    started_at: now.toISOString(),
  });

  if (error) {
    // 23505 = unique_violation, i.e. the partial index caught a second timer.
    if (error.code === "23505") {
      return { ok: false, message: "A timer is already running. Stop it before starting another." };
    }
    return { ok: false, message: error.message };
  }

  revalidatePath("/timesheets");
  return { ok: true };
}

/**
 * Stops the running timer and writes the elapsed duration into `hours`.
 *
 * The duration is computed from the stored started_at rather than from
 * anything the client sends, so a tampered or merely stale browser clock
 * can't inflate logged hours.
 */
export async function stopTimer(): Promise<TimerResult> {
  const supabase = await createClient();
  const personId = await currentPersonId(supabase);
  if (!personId) return { ok: false, message: "No person record is linked to your account." };

  const { data: running } = await supabase
    .from("timesheet_entries")
    .select("id, started_at")
    .eq("person_id", personId)
    .not("started_at", "is", null)
    .is("stopped_at", null)
    .maybeSingle();

  if (!running?.started_at) return { ok: false, message: "No timer is running." };

  const stoppedAt = new Date();
  const elapsedMs = stoppedAt.getTime() - new Date(running.started_at).getTime();
  // Round to 2dp: hours is numeric, and sub-second precision is noise on a
  // timesheet people read in decimal hours.
  const hours = Math.max(0, Math.round((elapsedMs / 3_600_000) * 100) / 100);

  const { error } = await supabase
    .from("timesheet_entries")
    .update({ stopped_at: stoppedAt.toISOString(), hours })
    .eq("id", running.id);

  if (error) return { ok: false, message: error.message };

  revalidatePath("/timesheets");
  return { ok: true };
}

/** Abandons the running timer without logging any time. */
export async function discardTimer(): Promise<TimerResult> {
  const supabase = await createClient();
  const personId = await currentPersonId(supabase);
  if (!personId) return { ok: false, message: "No person record is linked to your account." };

  const { error } = await supabase
    .from("timesheet_entries")
    .delete()
    .eq("person_id", personId)
    .not("started_at", "is", null)
    .is("stopped_at", null);

  if (error) return { ok: false, message: error.message };

  revalidatePath("/timesheets");
  return { ok: true };
}
