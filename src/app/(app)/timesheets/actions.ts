"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/utils/supabase/server";
import { currentWeekStart } from "@/lib/queries/hse";
import { parseDuration } from "@/lib/duration";

export type AddEntryState = { status: "idle" | "success" | "error"; message?: string };

async function currentPersonId(supabase: Awaited<ReturnType<typeof createClient>>) {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: profile } = await supabase
    .from("app_user_profile")
    .select("person_id")
    .eq("user_id", user.id)
    .maybeSingle();

  return profile?.person_id ?? null;
}

export async function addTimesheetEntry(
  _prevState: AddEntryState,
  formData: FormData,
): Promise<AddEntryState> {
  const supabase = await createClient();
  const personId = await currentPersonId(supabase);
  if (!personId) {
    return { status: "error", message: "No linked person profile -- contact an admin." };
  }

  const taskName = String(formData.get("task_name") || "").trim();
  const projectName = String(formData.get("project_name") || "").trim();
  const customer = String(formData.get("customer") || "").trim() || null;
  const isBillable = formData.get("is_billable") === "on";

  if (!taskName || !projectName) {
    return { status: "error", message: "Task and project name are required." };
  }

  const { data: existing } = await supabase
    .from("timesheet_entries")
    .select("entry_group")
    .eq("person_id", personId)
    .order("entry_group", { ascending: false })
    .limit(1)
    .maybeSingle();

  const nextGroup = (existing?.entry_group ?? 0) + 1;
  const requestedWeek = String(formData.get("week_start") || "");
  const weekStart = /^\d{4}-\d{2}-\d{2}$/.test(requestedWeek) ? requestedWeek : currentWeekStart();

  // One row per day of the week, all starting at 0h -- matches the shape
  // every existing seeded row already uses, so editing an hour is always a
  // plain UPDATE by row id, never an upsert.
  const rows = Array.from({ length: 7 }, (_, dayOfWeek) => ({
    entry_group: nextGroup,
    task_name: taskName,
    project_name: projectName,
    customer,
    is_billable: isBillable,
    day_of_week: dayOfWeek,
    hours: 0,
    person_id: personId,
    week_start: weekStart,
  }));

  const { error } = await supabase.from("timesheet_entries").insert(rows);

  if (error) {
    return { status: "error", message: error.message };
  }

  revalidatePath("/timesheets");
  return { status: "success", message: `Added "${taskName}".` };
}

export async function updateDayHours(formData: FormData): Promise<void> {
  const supabase = await createClient();
  const rowId = Number(formData.get("row_id"));
  const raw = String(formData.get("hours") ?? "");

  // Clearing a cell is a real intent, not a parse failure.
  if (!raw.trim()) {
    if (Number.isFinite(rowId)) {
      await supabase.from("timesheet_entries").update({ hours: 0 }).eq("id", rowId);
      revalidatePath("/timesheets");
    }
    return;
  }

  // Accepts "1:30", "1.5", "1,5", "90m", "1h30m" -- see src/lib/duration.ts.
  // Anything unparseable is left alone rather than silently written as 0.
  const hours = parseDuration(raw);

  if (!Number.isFinite(rowId) || hours === null || hours < 0 || hours > 24) return;

  await supabase.from("timesheet_entries").update({ hours }).eq("id", rowId);

  revalidatePath("/timesheets");
}

export async function deleteTimesheetRow(formData: FormData): Promise<void> {
  const supabase = await createClient();
  const entryGroup = Number(formData.get("entry_group"));
  if (!Number.isFinite(entryGroup)) return;

  const personId = await currentPersonId(supabase);
  if (!personId) return;

  await supabase
    .from("timesheet_entries")
    .delete()
    .eq("entry_group", entryGroup)
    .eq("person_id", personId);

  revalidatePath("/timesheets");
}

export async function submitWeek(formData: FormData): Promise<void> {
  const supabase = await createClient();
  const personId = await currentPersonId(supabase);
  if (!personId) return;

  const requestedWeek = String(formData.get("week_start") || "");
  const weekStart = /^\d{4}-\d{2}-\d{2}$/.test(requestedWeek) ? requestedWeek : currentWeekStart();

  await supabase
    .from("timesheet_entries")
    .update({ status: "submitted", submitted_at: new Date().toISOString() })
    .eq("person_id", personId)
    .eq("week_start", weekStart)
    .eq("status", "draft");

  revalidatePath("/timesheets");
}

/**
 * Pulls a submitted week back to draft.
 *
 * RLS ("owner can withdraw their own submitted timesheet_entries") is what
 * actually permits this, and only submitted -> draft; the status guard here
 * just avoids touching rows that have already been decided.
 */
export async function withdrawWeek(formData: FormData): Promise<void> {
  const supabase = await createClient();
  const personId = await currentPersonId(supabase);
  if (!personId) return;

  const requestedWeek = String(formData.get("week_start") || "");
  const weekStart = /^\d{4}-\d{2}-\d{2}$/.test(requestedWeek) ? requestedWeek : currentWeekStart();

  await supabase
    .from("timesheet_entries")
    .update({ status: "draft", submitted_at: null })
    .eq("person_id", personId)
    .eq("week_start", weekStart)
    .eq("status", "submitted");

  revalidatePath("/timesheets");
}

/**
 * Recreates last week's rows in the target week with no hours on them.
 *
 * Copies the shape of the week (which tasks, on which projects, billable or
 * not) rather than the hours, because the point is to skip retyping the rows,
 * not to assert you worked the same pattern twice. Skips anything already
 * present so pressing it twice doesn't duplicate the grid.
 */
export async function copyLastWeek(formData: FormData): Promise<void> {
  const supabase = await createClient();
  const personId = await currentPersonId(supabase);
  if (!personId) return;

  const requestedWeek = String(formData.get("week_start") || "");
  const weekStart = /^\d{4}-\d{2}-\d{2}$/.test(requestedWeek) ? requestedWeek : currentWeekStart();

  const previous = new Date(`${weekStart}T00:00:00Z`);
  previous.setUTCDate(previous.getUTCDate() - 7);
  const previousWeek = previous.toISOString().slice(0, 10);

  const [{ data: sourceRows }, { data: existingRows }] = await Promise.all([
    supabase
      .from("timesheet_entries")
      .select("task_name, project_name, project_id, customer, is_billable")
      .eq("person_id", personId)
      .eq("week_start", previousWeek),
    supabase
      .from("timesheet_entries")
      .select("task_name, project_name, entry_group")
      .eq("person_id", personId)
      .eq("week_start", weekStart),
  ]);

  if (!sourceRows?.length) return;

  const existingKeys = new Set(
    (existingRows ?? []).map((r) => `${r.task_name}__${r.project_name}`),
  );
  // Dedupe within the source too: last week holds one row per day, and we
  // want one row per task here, not seven.
  const seen = new Set<string>();
  const toCreate = sourceRows.filter((r) => {
    const key = `${r.task_name}__${r.project_name}`;
    if (existingKeys.has(key) || seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  if (!toCreate.length) return;

  let nextGroup =
    Math.max(0, ...(existingRows ?? []).map((r) => r.entry_group ?? 0)) + 1;

  await supabase.from("timesheet_entries").insert(
    toCreate.map((r) => ({
      person_id: personId,
      week_start: weekStart,
      task_name: r.task_name,
      project_name: r.project_name,
      project_id: r.project_id,
      customer: r.customer,
      is_billable: r.is_billable,
      day_of_week: 0,
      hours: 0,
      entry_group: nextGroup++,
      status: "draft",
    })),
  );

  revalidatePath("/timesheets");
}
