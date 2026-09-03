"use server";

import { revalidatePath } from "next/cache";
import { getTranslations } from "next-intl/server";
import { createClient } from "@/utils/supabase/server";
import { PERMISSIONS } from "@/lib/permissions";

export type CreateTaskState = { status: "idle" | "success" | "error"; message?: string };

/**
 * The stored status values, English in every locale: this is what
 * `project_tasks.status` holds and what the <select> posts back. TaskRow.tsx
 * translates the option text against exactly this list.
 */
const TASK_STATUSES = ["NOT STARTED", "IN PROGRESS", "OVER 33%", "DONE"] as const;

/**
 * Refusals are resolved in the CALLER'S locale, the way
 * project-drilldown.ts and management/actions.ts do it: the form renders the
 * sentence it is handed, so a German reader must be handed German. Postgres
 * error messages (`error.message`) stay as they come -- they are operator
 * text, not a sentence for the reader.
 */
async function words() {
  return getTranslations("projects.actions");
}

/**
 * The single authorisation point for every mutation in this file.
 *
 * Five of the actions below previously had no check at all and leaned entirely
 * on RLS. That reads as safe -- the policies are `to authenticated` and scope
 * writes with can_view_project() -- but it gates WRITING on READ visibility, so
 * anyone who could see a project could delete every task in it. projects:write
 * existed and was asked for at no layer.
 *
 * Two deliberate choices:
 *  - The permission is resolved by app_user_has_permission() in the DB, never
 *    from a role string, so a grant made in /admin/roles takes effect without a
 *    deploy. That is the contract permissions.ts states.
 *  - It reuses the ONE client the caller already needs rather than calling
 *    userHasPermission(), which builds a second client and re-reads cookies for
 *    the same RPC. Same question, half the round trips.
 *
 * RLS remains underneath as defence in depth; this is the authorisation
 * boundary, never the only one.
 */
async function requireProjectWriter() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return null;

  const { data: allowed } = await supabase.rpc("app_user_has_permission", {
    p_key: PERMISSIONS.PROJECTS_WRITE,
  });

  if (!allowed) return null;

  return { supabase, user };
}

/**
 * Which project a form is talking about.
 *
 * A board hangs off EITHER a Hub project (public.projects, text id) or a
 * TrackingTime one (time.project, bigint) -- the schema allows both and a CHECK
 * enforces exactly one. The form says which by the field name it posts, so a
 * caller cannot set both, and a request naming neither is rejected here rather
 * than reaching a constraint violation the user would read as a raw Postgres
 * error.
 */
type TaskParent =
  | { column: "project_id"; value: string }
  | { column: "time_project_id"; value: number };

function readParent(formData: FormData): TaskParent | null {
  const hub = String(formData.get("project_id") || "").trim();
  const timeRaw = String(formData.get("time_project_id") || "").trim();

  if (hub && timeRaw) return null;
  if (hub) return { column: "project_id", value: hub };
  if (timeRaw) {
    const id = Number(timeRaw);
    // Integer, not merely finite: Number("1.5") is finite and would reach the
    // query as a comparison that matches nothing.
    if (!Number.isInteger(id) || id <= 0) return null;
    return { column: "time_project_id", value: id };
  }
  return null;
}

async function insertTask(
  formData: FormData,
): Promise<{ error?: string; name?: string }> {
  const t = await words();
  const auth = await requireProjectWriter();
  if (!auth) {
    return { error: t("denied") };
  }
  const { supabase, user } = auth;

  const parent = readParent(formData);
  const name = String(formData.get("name") || "").trim();
  const owner = String(formData.get("owner") || "").trim();
  const estimateHours = Number(formData.get("estimate_hours") || 0);
  const parentTaskIdRaw = formData.get("parent_task_id");
  const parentTaskId = parentTaskIdRaw ? Number(parentTaskIdRaw) : null;

  if (!parent) {
    return { error: t("noParent") };
  }
  if (!name) {
    return { error: t("nameRequired") };
  }

  const { data: sortRow } = await supabase
    .from("project_tasks")
    .select("sort_order")
    .eq(parent.column, parent.value)
    .order("sort_order", { ascending: false })
    .limit(1)
    .maybeSingle();

  const { error } = await supabase.from("project_tasks").insert({
    ...(parent.column === "project_id"
      ? { project_id: parent.value }
      : { time_project_id: parent.value }),
    name,
    owner,
    estimate_hours: Number.isFinite(estimateHours) ? estimateHours : 0,
    logged_hours: 0,
    status: "NOT STARTED",
    sort_order: (sortRow?.sort_order ?? 0) + 1,
    created_by: user.id,
    parent_task_id: Number.isFinite(parentTaskId) ? parentTaskId : null,
  });

  if (error) {
    return { error: error.message };
  }

  revalidatePath("/projects");
  return { name };
}

export async function createTask(
  _prevState: CreateTaskState,
  formData: FormData,
): Promise<CreateTaskState> {
  const result = await insertTask(formData);
  if (result.error) {
    return { status: "error", message: result.error };
  }
  const t = await words();
  return { status: "success", message: t("added", { name: result.name ?? "" }) };
}

export async function addSubtask(formData: FormData): Promise<void> {
  await insertTask(formData);
}

export async function updateTaskStatus(formData: FormData): Promise<void> {
  const auth = await requireProjectWriter();
  if (!auth) return;
  const { supabase } = auth;

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
  const auth = await requireProjectWriter();
  if (!auth) return;
  const { supabase } = auth;

  const taskId = Number(formData.get("task_id"));
  if (!Number.isFinite(taskId)) return;

  await supabase.from("project_tasks").delete().eq("id", taskId);

  revalidatePath("/projects");
}

export async function addComment(formData: FormData): Promise<void> {
  const auth = await requireProjectWriter();
  if (!auth) return;
  const { supabase, user } = auth;

  const taskId = Number(formData.get("task_id"));
  const body = String(formData.get("body") || "").trim();
  if (!Number.isFinite(taskId) || !body) return;

  await supabase.from("task_comments").insert({ task_id: taskId, author_id: user.id, body });

  revalidatePath("/projects");
}

export async function deleteComment(formData: FormData): Promise<void> {
  const auth = await requireProjectWriter();
  if (!auth) return;
  const { supabase } = auth;

  const commentId = Number(formData.get("comment_id"));
  if (!Number.isFinite(commentId)) return;

  await supabase.from("task_comments").delete().eq("id", commentId);

  revalidatePath("/projects");
}

/**
 * Moves a task into a section (a board column). RLS rejects a section that
 * belongs to a different project, so a task can't be dropped into another
 * client's column.
 */
export async function moveTaskToSection(formData: FormData): Promise<void> {
  const auth = await requireProjectWriter();
  if (!auth) return;
  const { supabase } = auth;

  const taskId = Number(formData.get("task_id"));
  const raw = formData.get("section_id");
  const sectionId = raw === null || raw === "" ? null : Number(raw);

  if (!Number.isFinite(taskId)) return;
  if (sectionId !== null && !Number.isFinite(sectionId)) return;

  await supabase
    .from("project_tasks")
    .update({ section_id: sectionId, updated_at: new Date().toISOString() })
    .eq("id", taskId);

  revalidatePath("/projects");
}

export type SectionState = { status: "idle" | "success" | "error"; message?: string };

export async function createSection(
  _prev: SectionState,
  formData: FormData,
): Promise<SectionState> {
  const t = await words();
  const auth = await requireProjectWriter();
  if (!auth) return { status: "error", message: t("denied") };
  const { supabase } = auth;

  const parent = readParent(formData);
  const name = String(formData.get("name") || "").trim();
  if (!parent) return { status: "error", message: t("sectionNoParent") };
  if (!name) return { status: "error", message: t("sectionNameRequired") };

  const { data: last } = await supabase
    .from("project_sections")
    .select("position")
    .eq(parent.column, parent.value)
    .order("position", { ascending: false })
    .limit(1)
    .maybeSingle();

  const { error } = await supabase
    .from("project_sections")
    .insert({
      ...(parent.column === "project_id"
        ? { project_id: parent.value }
        : { time_project_id: parent.value }),
      name,
      position: (last?.position ?? -1) + 1,
    });

  if (error) return { status: "error", message: error.message };

  revalidatePath("/projects");
  return { status: "success" };
}
