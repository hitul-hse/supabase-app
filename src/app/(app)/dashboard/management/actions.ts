"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/utils/supabase/server";
import { PERMISSIONS } from "@/lib/permissions";

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

export async function requestResponsibleChange(
  _previous: ManagementChangeActionState,
  formData: FormData,
): Promise<ManagementChangeActionState> {
  const supabase = await authorisedWriter();
  if (!supabase) return { status: "error", message: "Keine Berechtigung oder keine authentifizierte Sitzung." };

  const projectId = String(formData.get("project_id") ?? "").trim();
  const personId = String(formData.get("person_id") ?? "").trim();
  const reason = String(formData.get("reason") ?? "").trim();
  if (!projectId || !personId || reason.length < 3) {
    return { status: "error", message: "Projekt, Mitarbeiter und ein Änderungsgrund sind erforderlich." };
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
  return { status: "success", message: "Änderungsantrag erstellt. Eine zweite berechtigte Person muss ihn freigeben." };
}

export async function decideResponsibleChange(
  _previous: ManagementChangeActionState,
  formData: FormData,
): Promise<ManagementChangeActionState> {
  const supabase = await authorisedWriter();
  if (!supabase) return { status: "error", message: "Keine Berechtigung oder keine authentifizierte Sitzung." };

  const requestId = String(formData.get("request_id") ?? "").trim();
  const approve = String(formData.get("decision") ?? "") === "approve";
  const reason = String(formData.get("reason") ?? "").trim();
  if (!requestId || reason.length < 3) return { status: "error", message: "Antrag und Entscheidungsgrund sind erforderlich." };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase as any).rpc("decide_project_responsible_change", {
    p_request_id: requestId,
    p_approve: approve,
    p_reason: reason,
  });
  if (error) return { status: "error", message: error.message };

  revalidatePath("/dashboard/management");
  return { status: "success", message: approve ? "Änderung angewendet." : "Änderungsantrag abgelehnt." };
}
