import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { fetchAllPaged } from "@/lib/queries/paged";
import { PEOPLE, type ManagementPerson } from "@/lib/queries/management-contract-hours";

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

type Order = { id: string; legal_entity_id: string | null };
type ProjectReference = { external_id: string; project_id: string };

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
  if (key.includes("healthandsafetyconsulting")) return "Health & Safety Consulting";
  if (key.includes("brandschutzbeauftragter")) return "Brandschutzbeauftragter";
  if (key.includes("sigeko") && key.includes("constructioncoordination")) return "SiGeKo / construction coordination";
  return value || "Nicht zugeordnet";
};

async function readLegalEntityBySourceProject(supabase: SupabaseTyped): Promise<Map<string, string>> {
  try {
    const [{ data: references, error: referenceError }, { data: orders, error: orderError }] = await Promise.all([
      schema(supabase, "crm")
        .from("trackingtime_project_reference")
        .select("external_id, project_id")
        .eq("is_active", true),
      schema(supabase, "projects").from("project_order").select("id, legal_entity_id"),
    ]);
    if (referenceError || orderError || !references || !orders) return new Map();

    const legalEntityByOrder = new Map(
      (orders as Order[])
        .filter((order) => order.legal_entity_id)
        .map((order) => [order.id, order.legal_entity_id!] as const),
    );
    return new Map(
      (references as ProjectReference[])
        .map((reference) => [reference.external_id, legalEntityByOrder.get(reference.project_id)] as const)
        .filter((entry): entry is readonly [string, string] => Boolean(entry[1])),
    );
  } catch {
    return new Map();
  }
}

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
    const [{ data: projects }, { data: people }, { data: assignments }, timeProjects, legalEntities] = await Promise.all([
      supabase.from("projects").select("id, name, customer, contract_hours, status, owner_person_id"),
      supabase.from("people").select("id, name"),
      supabase.from("person_assignments").select("person_id, project_id, project_name, share_percent"),
      fetchAllPaged<Record<string, unknown>>((from, to) =>
        schema(supabase, "time")
          .from("project")
          .select("hub_project_id, source_id, service:service_id(name)")
          .not("hub_project_id", "is", null)
          .range(from, to),
      ),
      readLegalEntityBySourceProject(supabase),
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
    const legalEntityByHubProject = new Map<string, string>();
    for (const row of timeProjects.rows as TimeProject[]) {
      if (!row.hub_project_id) continue;
      serviceByProject.set(row.hub_project_id, serviceName(row.service?.name ?? null));
      if (row.source_id && legalEntities.has(row.source_id)) {
        legalEntityByHubProject.set(row.hub_project_id, legalEntities.get(row.source_id)!);
      }
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

    for (const assignment of assignments as Assignment[]) {
      const person = personById.get(assignment.person_id);
      const project = assignment.project_id ? projectById.get(assignment.project_id) : null;
      if (!person || !project || !isOpen(project.status)) continue;

      const service = serviceByProject.get(project.id) ?? "Nicht zugeordnet";
      const mappingMissing = !legalEntityByHubProject.has(project.id);
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
        replacementPerson: null,
        customerMappingMissing: mappingMissing,
      });
    }

    return [...rows.values()].map((row) => ({
      ...row,
      servicesInPortfolio: [...row.servicesInPortfolio].sort(),
    }));
  } catch {
    return emptyRows();
  }
}
