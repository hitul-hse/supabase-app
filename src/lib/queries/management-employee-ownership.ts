import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { fetchAllPaged } from "@/lib/queries/paged";
import { PEOPLE, type ManagementPerson } from "@/lib/queries/management-contract-hours";
import { readManagementCustomerMappings } from "@/lib/queries/management-customer-mapping";

type SupabaseTyped = SupabaseClient<Database>;

export type EmployeeOwnershipProject = {
  projectId: string;
  customerName: string;
  projectName: string;
  service: string;
  contractHours: number;
  responsiblePerson: string | null;
  replacementPerson: string | null;
  customerMappingMissing: boolean;
};

export type EmployeeOwnershipRow = {
  person: ManagementPerson;
  openProjects: number;
  contractHours: number;
  servicesInPortfolio: string[];
  replacementCoveragePercent: number | null;
  projectsWithoutReplacement: number | null;
  replacementRelationAvailable: boolean;
  customerMappingIssues: number;
  projects: EmployeeOwnershipProject[];
};

type Project = {
  id: string;
  code: string;
  name: string;
  customer: string;
  contract_hours: number | null;
  status: string | null;
  owner_person_id: string | null;
};

type Assignment = {
  person_id: string;
  project_id: string | null;
  project_name: string;
  share_percent: number | null;
};

type TimeProject = {
  hub_project_id: string | null;
  source_id: string | null;
  service: { name: string } | null;
};

// The generated types only cover public; management reads also use these schemas.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const schema = (supabase: SupabaseTyped, name: string) => (supabase as any).schema(name);

const numberOrZero = (value: unknown): number => {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
};

const isOpen = (status: string | null): boolean => {
  if (!status) return false;
  return !new Set(["closed", "completed", "done", "cancelled", "canceled", "archived", "inactive", "abgeschlossen"])
    .has(status.trim().toLowerCase());
};

const serviceName = (value: string | null): string => {
  const key = (value ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "").replace("engeineer", "engineer");
  if (key.includes("enercon") && key.includes("sigeko")) return "ENERCON SiGeKo / construction coordination";
  if (key.includes("dguvv2") && key.includes("sifa")) return "DGUV V2: SiFa / Safety Engineer";
  if (key.includes("healthandsafetyconsulting") || key.includes("healthsafetyconsulting")) return "Health & Safety Consulting";
  if (key.includes("brandschutzbeauftragter")) return "Brandschutzbeauftragter";
  if (key.includes("sigeko") && key.includes("constructioncoordination")) return "SiGeKo / construction coordination";
  return value || "Nicht zugeordnet";
};

/*
 * The dead readLegalEntityBySourceProject() used to live here. It read
 * crm.trackingtime_project_reference + projects.project_order through
 * PostgREST -- but neither schema is in pgrst.db_schemas, so the catch
 * swallowed "Invalid schema: crm" on every request, and the reference table
 * is empty besides (0 rows, measured). Every project was flagged
 * "Mapping fehlt" against a mapping that covers 219 of 231 orders.
 * Replaced by the shared order-number join (management-customer-mapping.ts,
 * direct pg), the same source the portfolio and matrix queries read.
 */

function emptyRows(): EmployeeOwnershipRow[] {
  return PEOPLE.map((person) => ({
    person,
    openProjects: 0,
    contractHours: 0,
    servicesInPortfolio: [],
    replacementCoveragePercent: null,
    projectsWithoutReplacement: null,
    replacementRelationAvailable: false,
    customerMappingIssues: 0,
    projects: [],
  }));
}

/** Read-only employee ownership portfolio for open projects. */
export async function getEmployeeOwnershipOverview(
  supabase: SupabaseTyped,
): Promise<EmployeeOwnershipRow[]> {
  try {
    const [{ data: projects }, { data: people }, { data: assignments }, timeProjects, customerMappings] = await Promise.all([
      supabase.from("projects").select("id, code, name, customer, contract_hours, status, owner_person_id"),
      supabase.from("people").select("id, name"),
      supabase.from("person_assignments").select("person_id, project_id, project_name, share_percent"),
      fetchAllPaged<Record<string, unknown>>((from, to) =>
        schema(supabase, "time")
          .from("project")
          .select("hub_project_id, source_id, service:service_id(name)")
          .not("hub_project_id", "is", null)
          .range(from, to),
      ),
      readManagementCustomerMappings(),
    ]);

    if (!projects || !people || !assignments) return emptyRows();

    const nameById = new Map((people as { id: string; name: string }[]).map((person) => [person.id, person.name]));
    const personById = new Map<string, ManagementPerson>();
    for (const person of people as { id: string; name: string }[]) {
      const match = PEOPLE.find((wanted) => wanted.toLowerCase() === person.name.toLowerCase());
      if (match) personById.set(person.id, match);
    }

    const projectById = new Map((projects as Project[]).map((project) => [project.id, project]));
    const serviceByProject = new Map<string, string>();
    for (const row of timeProjects.rows as TimeProject[]) {
      if (!row.hub_project_id) continue;
      serviceByProject.set(row.hub_project_id, serviceName(row.service?.name ?? null));
    }

    const rows = new Map(PEOPLE.map((person) => [person, {
      person,
      openProjects: 0,
      contractHours: 0,
      servicesInPortfolio: new Set<string>(),
      replacementCoveragePercent: null,
      projectsWithoutReplacement: null,
      replacementRelationAvailable: false,
      customerMappingIssues: 0,
      projects: [] as EmployeeOwnershipProject[],
    }]));

    /*
     * share_percent ENCODES THE ROLE, per the masterdata import's convention:
     * > 0 carries contract hours (the responsible), = 0 is the named
     * replacement -- assigned for coverage, carrying no load. The import wrote
     * both from the Excel's SiFa/Replacement columns; treating share=0 rows as
     * "no assignment" is what left every Replacement cell reading n/a while
     * 168 replacement rows sat in the table.
     */
    const replacementByProject = new Map<string, string>();
    for (const assignment of assignments as Assignment[]) {
      if (numberOrZero(assignment.share_percent) > 0 || !assignment.project_id) continue;
      const name = nameById.get(assignment.person_id);
      if (name) replacementByProject.set(assignment.project_id, name);
    }

    for (const assignment of assignments as Assignment[]) {
      if (numberOrZero(assignment.share_percent) === 0) continue; // replacements handled above
      const person = personById.get(assignment.person_id);
      const project = assignment.project_id ? projectById.get(assignment.project_id) : null;
      if (!person || !project || !isOpen(project.status)) continue;

      const service = serviceByProject.get(project.id) ?? "Nicht zugeordnet";
      const mappingMissing =
        !customerMappings.available || !customerMappings.entityByOrderNumber.has(project.code);
      const employee = rows.get(person)!;
      const contractHours = numberOrZero(project.contract_hours) * numberOrZero(assignment.share_percent) / 100;
      employee.openProjects += 1;
      employee.contractHours += contractHours;
      employee.servicesInPortfolio.add(service);
      if (mappingMissing) employee.customerMappingIssues += 1;
      employee.projects.push({
        projectId: project.id,
        customerName: project.customer,
        projectName: project.name || assignment.project_name,
        service,
        contractHours,
        responsiblePerson: project.owner_person_id ? nameById.get(project.owner_person_id) ?? null : null,
        replacementPerson: replacementByProject.get(project.id) ?? null,
        customerMappingMissing: mappingMissing,
      });
    }

    return [...rows.values()].map((row) => {
      const covered = row.projects.filter((project) => project.replacementPerson !== null).length;
      return {
        ...row,
        servicesInPortfolio: [...row.servicesInPortfolio].sort(),
        replacementRelationAvailable: replacementByProject.size > 0,
        /*
         * 0/0 stays null: a person with no open projects has no coverage to
         * measure, and 100% there would be a confident claim about nothing.
         */
        replacementCoveragePercent:
          row.projects.length === 0 ? null : Math.round((covered / row.projects.length) * 1000) / 10,
        projectsWithoutReplacement: row.projects.length === 0 ? null : row.projects.length - covered,
      };
    });
  } catch {
    return emptyRows();
  }
}
