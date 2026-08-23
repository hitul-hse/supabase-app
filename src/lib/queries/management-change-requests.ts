import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";

type SupabaseTyped = SupabaseClient<Database>;

export type ManagementChangeRequest = {
  id: string;
  projectId: string;
  projectName: string;
  requestedPerson: string;
  requestedBy: string;
  requestedAt: string;
  reason: string;
};

type RawChangeRequest = {
  id: string;
  project_id: string;
  requested_person_id: string;
  requested_by: string;
  requested_at: string;
  reason: string;
};

/** Read-only pending request queue. The mutation itself is only possible via DB functions. */
export async function getManagementChangeRequests(supabase: SupabaseTyped): Promise<ManagementChangeRequest[]> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (supabase as any)
      .from("project_change_request")
      .select("id, project_id, requested_person_id, requested_by, requested_at, reason")
      .eq("status", "pending")
      .order("requested_at", { ascending: false });
    if (error || !data?.length) return [];

    const rows = data as RawChangeRequest[];
    const projectIds = [...new Set(rows.map((row) => String(row.project_id)))];
    const personIds = [...new Set(rows.map((row) => String(row.requested_person_id)))];
    const [{ data: projects }, { data: people }] = await Promise.all([
      supabase.from("projects").select("id, name").in("id", projectIds),
      supabase.from("people").select("id, name").in("id", personIds),
    ]);
    const projectNames = new Map((projects ?? []).map((row) => [row.id, row.name]));
    const personNames = new Map((people ?? []).map((row) => [row.id, row.name]));

    return rows.map((row) => ({
      id: String(row.id),
      projectId: String(row.project_id),
      projectName: projectNames.get(String(row.project_id)) ?? String(row.project_id),
      requestedPerson: personNames.get(String(row.requested_person_id)) ?? "Nicht aufgelöst",
      requestedBy: String(row.requested_by),
      requestedAt: String(row.requested_at),
      reason: String(row.reason),
    }));
  } catch {
    return [];
  }
}
