"use server";

import { revalidatePath } from "next/cache";
import { getTranslations } from "next-intl/server";
import { createClient } from "@/utils/supabase/server";
import { PERMISSIONS } from "@/lib/permissions";
import { getReassignmentCandidates, type CandidateLoad } from "@/lib/queries/reassignment-candidates";

export type ManagementChangeActionState = {
  status: "idle" | "success" | "error";
  message?: string;
};

async function authorisedWriter() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data: allowed } = await supabase.rpc("app_user_has_permission", { p_key: PERMISSIONS.PROJECTS_WRITE });
  return allowed ? supabase : null;
}

export type CandidateLoadState =
  | { status: "ok"; candidates: CandidateLoad[] }
  | { status: "error"; message: string };

/**
 * Load the capacity picture for one project's reassignment picker.
 *
 * A READ, deliberately shaped as an action rather than prefetched on the page:
 * getReassignmentCandidates is per-project and does four reads plus a paged
 * scan of time.entry, so prefetching it for all 93 portfolio rows would be ~370
 * round trips for a panel the user opens once. The disclosure asks for it when
 * it opens.
 *
 * Gated on PROJECTS_WRITE, not the page's read permission: the only reason to
 * see who is loaded enough to take a project over is to request the change, and
 * this exposes per-person workload.
 *
 * Messages are resolved in the caller's locale (the same cookie the page
 * reads), so the status line under the form speaks the page's language.
 */
export async function loadReassignmentCandidates(projectId: string): Promise<CandidateLoadState> {
  const t = await getTranslations("management.actions");
  const supabase = await authorisedWriter();
  if (!supabase) return { status: "error", message: t("noPermissionLoad") };
  const id = projectId.trim();
  if (!id) return { status: "error", message: t("noProject") };
  try {
    return { status: "ok", candidates: await getReassignmentCandidates(supabase, id) };
  } catch {
    return { status: "error", message: t("loadFailed") };
  }
}

export async function requestResponsibleChange(
  _previous: ManagementChangeActionState,
  formData: FormData,
): Promise<ManagementChangeActionState> {
  const t = await getTranslations("management.actions");
  const supabase = await authorisedWriter();
  if (!supabase) return { status: "error", message: t("noPermission") };

  const projectId = String(formData.get("project_id") ?? "").trim();
  const personId = String(formData.get("person_id") ?? "").trim();
  const reason = String(formData.get("reason") ?? "").trim();
  if (!projectId || !personId || reason.length < 3) {
    return { status: "error", message: t("requestFieldsRequired") };
  }

  // The generated Database type predates the change-control migration.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase as any).rpc("request_project_responsible_change", {
    p_project_id: projectId,
    p_requested_person_id: personId,
    p_reason: reason,
  });
  if (error) return { status: "error", message: error.message };

  revalidatePath("/dashboard/management");
  return { status: "success", message: t("requestCreated") };
}

export async function decideResponsibleChange(
  _previous: ManagementChangeActionState,
  formData: FormData,
): Promise<ManagementChangeActionState> {
  const t = await getTranslations("management.actions");
  const supabase = await authorisedWriter();
  if (!supabase) return { status: "error", message: t("noPermission") };

  const requestId = String(formData.get("request_id") ?? "").trim();
  const approve = String(formData.get("decision") ?? "") === "approve";
  const reason = String(formData.get("reason") ?? "").trim();
  if (!requestId || reason.length < 3) return { status: "error", message: t("decisionFieldsRequired") };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase as any).rpc("decide_project_responsible_change", {
    p_request_id: requestId,
    p_approve: approve,
    p_reason: reason,
  });
  if (error) return { status: "error", message: error.message };

  revalidatePath("/dashboard/management");
  return { status: "success", message: approve ? t("changeApplied") : t("requestRejected") };
}
