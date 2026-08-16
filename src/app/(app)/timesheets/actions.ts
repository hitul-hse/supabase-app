"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/utils/supabase/server";
import { currentWeekStart } from "@/lib/queries/hse";

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
  const weekStart = currentWeekStart();

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
  const hours = Number(formData.get("hours"));

  if (!Number.isFinite(rowId) || !Number.isFinite(hours) || hours < 0) return;

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

export async function submitWeek(): Promise<void> {
  const supabase = await createClient();
  const personId = await currentPersonId(supabase);
  if (!personId) return;

  await supabase
    .from("timesheet_entries")
    .update({ status: "submitted", submitted_at: new Date().toISOString() })
    .eq("person_id", personId)
    .eq("week_start", currentWeekStart())
    .eq("status", "draft");

  revalidatePath("/timesheets");
}
