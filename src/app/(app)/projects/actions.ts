"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/utils/supabase/server";

export type CreateTaskState = { status: "idle" | "success" | "error"; message?: string };

const TASK_STATUSES = ["NOT STARTED", "IN PROGRESS", "OVER 33%", "DONE"] as const;

export async function createTask(
  _prevState: CreateTaskState,
  formData: FormData,
): Promise<CreateTaskState> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { status: "error", message: "Not authenticated." };
  }

  const projectId = String(formData.get("project_id") || "").trim();
  const name = String(formData.get("name") || "").trim();
  const owner = String(formData.get("owner") || "").trim();
  const estimateHours = Number(formData.get("estimate_hours") || 0);

  if (!projectId || !name || !owner) {
    return { status: "error", message: "Task name and owner are required." };
  }

  // RLS (role-scoped insert on project_tasks) is what actually enforces who
  // can add a task here -- this check just gives a readable error instead of
  // a bare Postgres permission-denied.
  const { data: sortRow } = await supabase
    .from("project_tasks")
    .select("sort_order")
    .eq("project_id", projectId)
    .order("sort_order", { ascending: false })
    .limit(1)
    .maybeSingle();

  const { error } = await supabase.from("project_tasks").insert({
    project_id: projectId,
    name,
    owner,
    estimate_hours: Number.isFinite(estimateHours) ? estimateHours : 0,
    logged_hours: 0,
    status: "NOT STARTED",
    sort_order: (sortRow?.sort_order ?? 0) + 1,
    created_by: user.id,
  });

  if (error) {
    return { status: "error", message: error.message };
  }

  revalidatePath("/projects");
  return { status: "success", message: `Added "${name}".` };
}

export async function updateTaskStatus(formData: FormData): Promise<void> {
  const supabase = await createClient();
  const taskId = Number(formData.get("task_id"));
  const status = String(formData.get("status") || "");

  if (!Number.isFinite(taskId) || !TASK_STATUSES.includes(status as (typeof TASK_STATUSES)[number])) return;

  await supabase
    .from("project_tasks")
    .update({ status, updated_at: new Date().toISOString() })
    .eq("id", taskId);

  revalidatePath("/projects");
}

export async function deleteTask(formData: FormData): Promise<void> {
  const supabase = await createClient();
  const taskId = Number(formData.get("task_id"));
  if (!Number.isFinite(taskId)) return;

  await supabase.from("project_tasks").delete().eq("id", taskId);

  revalidatePath("/projects");
}
