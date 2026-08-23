import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { fetchAllPaged } from "@/lib/queries/paged";

type SupabaseTyped = SupabaseClient<Database>;

const PEOPLE = ["Thorsten", "Mathias", "Ousmane", "Hendryk", "Stephan", "Serhii", "Mustafa"] as const;
const SERVICES = [
  "DGUV V2: SiFa / Safety Engineer",
  "Health & Safety Consulting",
  "Brandschutzbeauftragter",
  "SiGeKo / construction coordination",
  "ENERCON SiGeKo / construction coordination",
] as const;

export type ManagementPerson = (typeof PEOPLE)[number];
export type ManagementService = (typeof SERVICES)[number];

export type ManagementProject = {
  projectId: string;
  projectName: string;
  customerName: string;
  contractHours: number;
  sharePercent: number;
  allocatedHours: number;
};

export type ManagementRow = {
  service: ManagementService | "Nicht zugeordnet";
  cells: Record<ManagementPerson, number>;
  totalHours: number;
};

export type UtilisationStatus = "Unterauslastung" | "Gesunde Auslastung" | "Kapazitätsrisiko";

export type UtilisationOutlookRow = {
  person: ManagementPerson;
  planHoursPerYear: number;
  boundContractHours: number;
  utilisationPercent: number;
  status: UtilisationStatus;
};

export type ManagementContractHours = {
  totalContractHours: number;
  rows: ManagementRow[];
  drilldown: Record<ManagementPerson, ManagementProject[]>;
  unmappedContractHours: number;
  projectCount: number;
  utilisationOutlook: UtilisationOutlookRow[];
};

const ALL_SERVICES: Array<ManagementService | "Nicht zugeordnet"> = [...SERVICES, "Nicht zugeordnet"];
export const ANNUAL_PLAN_HOURS = 1304;

// `time` is absent from generated public types, as in the existing time query layer.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const timeSchema = (s: SupabaseTyped) => (s as any).schema("time");

const n = (value: unknown) => {
  const valueAsNumber = Number(value);
  return Number.isFinite(valueAsNumber) ? valueAsNumber : 0;
};

const emptyCells = (): Record<ManagementPerson, number> =>
  Object.fromEntries(PEOPLE.map((person) => [person, 0])) as Record<ManagementPerson, number>;

const normalized = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, "");

function canonicalService(value: string): ManagementService | null {
  const key = normalized(value).replace("engeineer", "engineer");
  if (key.includes("enercon") && key.includes("sigeko")) return "ENERCON SiGeKo / construction coordination";
  if (key.includes("dguvv2") && key.includes("sifa")) return "DGUV V2: SiFa / Safety Engineer";
  if (key.includes("healthandsafetyconsulting") || key.includes("healthsafetyconsulting")) return "Health & Safety Consulting";
  if (key.includes("brandschutzbeauftragter")) return "Brandschutzbeauftragter";
  if (key.includes("sigeko") && key.includes("constructioncoordination")) return "SiGeKo / construction coordination";
  return null;
}

/**
 * Read-only management model.
 *
 * Contract hours come from public.projects. The only safe service relation is
 * time.project.hub_project_id -> public.projects.id -> time.service.name;
 * matching on project names would silently misclassify renamed projects.
 * person_assignments.share_percent is the stored allocation basis for each cell.
 */
export async function getManagementContractHours(
  supabase: SupabaseTyped,
): Promise<ManagementContractHours> {
  const empty: ManagementContractHours = {
    totalContractHours: 0,
    rows: ALL_SERVICES.map((service) => ({
      service,
      cells: emptyCells(),
      totalHours: 0,
    })),
    drilldown: Object.fromEntries(PEOPLE.map((person) => [person, []])) as unknown as Record<ManagementPerson, ManagementProject[]>,
    unmappedContractHours: 0,
    projectCount: 0,
    utilisationOutlook: PEOPLE.map((person) => ({
      person,
      planHoursPerYear: ANNUAL_PLAN_HOURS,
      boundContractHours: 0,
      utilisationPercent: 0,
      status: "Unterauslastung",
    })),
  };

  try {
    const [{ data: projects }, { data: people }, { data: assignments }, timeProjects] = await Promise.all([
      supabase.from("projects").select("id, name, customer, contract_hours"),
      supabase.from("people").select("id, name"),
      supabase.from("person_assignments").select("person_id, project_id, project_name, share_percent"),
      fetchAllPaged<Record<string, unknown>>((from, to) =>
        timeSchema(supabase)
          .from("project")
          .select("hub_project_id, service:service_id(name)")
          .not("hub_project_id", "is", null)
          // Ordered: unordered .range() paging repeats and skips rows
          // (PostgREST has no stable default order). Measured on this repo.
          .order("id", { ascending: true })
          .range(from, to),
      ),
    ]);

    if (!projects || !people || !assignments) return empty;

    const wantedPeople = new Map<string, ManagementPerson>();
    for (const person of people as { id: string; name: string }[]) {
      const match = PEOPLE.find((wanted) => normalized(person.name) === normalized(wanted));
      if (match) wantedPeople.set(person.id, match);
    }

    const serviceByProject = new Map<string, ManagementService>();
    for (const project of timeProjects.rows) {
      const serviceName = typeof project.service === "object" && project.service !== null
        ? String((project.service as { name?: unknown }).name ?? "")
        : "";
      const match = canonicalService(serviceName);
      if (project.hub_project_id && match) serviceByProject.set(String(project.hub_project_id), match);
    }

    const rows = new Map(empty.rows.map((row) => [row.service, row]));
    const projectById = new Map((projects as { id: string; name: string; customer: string; contract_hours: number }[]).map((project) => [project.id, project]));
    const assignmentsByPerson = new Map<ManagementPerson, ManagementProject[]>();

    for (const project of projects as { id: string; name: string; customer: string; contract_hours: number }[]) {
      empty.totalContractHours += n(project.contract_hours);
    }

    for (const assignment of assignments as { person_id: string; project_id: string | null; project_name: string; share_percent: number }[]) {
      const person = wantedPeople.get(assignment.person_id);
      const project = assignment.project_id ? projectById.get(assignment.project_id) : undefined;
      if (!person || !project) continue;

      const contractHours = n(project.contract_hours);
      const sharePercent = n(assignment.share_percent);
      const allocatedHours = Math.round(contractHours * sharePercent) / 100;
      const service = serviceByProject.get(project.id) ?? "Nicht zugeordnet";
      const row = rows.get(service)!;
      row.cells[person] += allocatedHours;
      row.totalHours += allocatedHours;

      const detail: ManagementProject = {
        projectId: project.id,
        projectName: project.name || assignment.project_name,
        customerName: project.customer,
        contractHours,
        sharePercent,
        allocatedHours,
      };
      const details = assignmentsByPerson.get(person) ?? [];
      details.push(detail);
      assignmentsByPerson.set(person, details);
    }

    const mappedProjectIds = new Set(
      [...serviceByProject.keys()].filter((projectId) => projectById.has(projectId)),
    );
    empty.unmappedContractHours = (projects as { id: string; contract_hours: number }[])
      .filter((project) => !mappedProjectIds.has(project.id))
      .reduce((sum, project) => sum + n(project.contract_hours), 0);
    empty.projectCount = projects.length;
    empty.drilldown = Object.fromEntries(
      PEOPLE.map((person) => [
        person,
        (assignmentsByPerson.get(person) ?? []).sort((a, b) => b.allocatedHours - a.allocatedHours),
      ]),
    ) as Record<ManagementPerson, ManagementProject[]>;
    empty.rows = [...rows.values()];
    const totalsByPerson = Object.fromEntries(
      PEOPLE.map((person) => [person, empty.rows.reduce((sum, row) => sum + row.cells[person], 0)]),
    ) as Record<ManagementPerson, number>;
    empty.utilisationOutlook = PEOPLE.map((person) => {
      const boundContractHours = totalsByPerson[person];
      const utilisationPercent = Math.round((boundContractHours / ANNUAL_PLAN_HOURS) * 1000) / 10;
      return {
        person,
        planHoursPerYear: ANNUAL_PLAN_HOURS,
        boundContractHours,
        utilisationPercent,
        status: utilisationPercent < 50
          ? "Unterauslastung"
          : utilisationPercent <= 90
            ? "Gesunde Auslastung"
            : "Kapazitätsrisiko",
      };
    });
    return empty;
  } catch {
    return empty;
  }
}

export { PEOPLE, SERVICES };
