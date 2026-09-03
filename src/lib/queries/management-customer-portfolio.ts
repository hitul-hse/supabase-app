import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { fetchAllPaged } from "@/lib/queries/paged";
import { readManagementCustomerMappings, type ManagementCustomerEntity } from "@/lib/queries/management-customer-mapping";
import { canReadBudgets, budgetAwareColumns } from "@/lib/budget-visibility";

/**
 * The `projects` read for this panel, with the budget column present only when
 * the caller holds projects:contracts:read.
 *
 * Omitted rather than blanked afterwards, so the figure never enters the
 * payload at all -- see src/lib/budget-visibility.ts. The dynamic column list
 * is invisible to PostgREST's generated types (a non-literal .select() argument
 * resolves to ParserError), so the cast is confined to this one helper and the
 * rows are re-narrowed at the call site, the same escape hatch my-work.ts uses.
 */
function projectsSelect(supabase: SupabaseTyped, columns: string, canSeeBudgets: boolean) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (supabase as any).from("projects").select(budgetAwareColumns(columns, canSeeBudgets)) as any;
}


type SupabaseTyped = SupabaseClient<Database>;

export type CustomerPortfolioService = {
  service: string;
  contractHours: number | null;
  responsible: string[];
};

export type CustomerPortfolioProject = {
  projectId: string;
  project: string;
  responsiblePersonId: string | null;
  service: string;
  contractHours: number | null;
  status: string | null;
  responsible: string[];
  links: {
    asana: string | null;
    chat: string | null;
    trackingTime: string | null;
    drive: string | null;
    microsoftTeams: string | null;
  };
};

export type CustomerPortfolioRow = {
  legalEntityId: string;
  customer: string;
  legalEntity: string;
  locations: string[];
  locationsAvailable: boolean;
  activeServices: string[];
  projectCount: number;
  contractHours: number | null;
  responsible: string[];
  risks: string[];
  services: CustomerPortfolioService[];
  projects: CustomerPortfolioProject[];
};

export type ManagementCustomerPortfolio = {
  rows: CustomerPortfolioRow[];
  customerMappingAvailable: boolean;
  projectsWithoutCustomerMapping: number | null;
  projectsWithoutServiceMapping: number | null;
  operationalLinksAvailable: boolean;
};

type Project = { id: string; code: string; name: string; contract_hours: number | null; status: string | null; owner_person_id: string | null };
type Person = { id: string; name: string };
type Assignment = { person_id: string; project_id: string | null };
type TimeProject = { hub_project_id: string | null; source_id: string | null; service: { name: string } | null };

// The generated types cover public only; these schemas are read through the same
// typed server client and never receive writes from this query.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const schema = (supabase: SupabaseTyped, name: string) => (supabase as any).schema(name);

const CLOSED_STATUSES = new Set(["closed", "completed", "done", "cancelled", "canceled", "archived", "inactive", "abgeschlossen"]);
const isOpen = (status: string | null): boolean => Boolean(status) && !CLOSED_STATUSES.has(status!.trim().toLowerCase());
const normalized = (value: string): string => value.toLowerCase().replace(/[^a-z0-9]+/g, "");
const unique = (values: (string | null)[]): string[] => [...new Set(values.filter((value): value is string => Boolean(value)))].sort();

function canonicalService(value: string | null): string {
  const key = normalized(value ?? "");
  if (key.includes("enercon") && key.includes("sigeko")) return "ENERCON SiGeKo";
  if (key.includes("dguvv2") && key.includes("sifa")) return "DGUV V2 SiFa";
  if (key.includes("healthandsafetyconsulting") || key.includes("healthsafetyconsulting") || key.includes("hsconsulting")) return "H&S Consulting";
  if (key.includes("brandschutz")) return "Brandschutzbeauftragter";
  if (key.includes("sigeko") && key.includes("constructioncoordination")) return "SiGeKo";
  if (key.includes("betriebsarzt") || key.includes("arbeitsmedizin") || key.includes("occupationalmedicine")) return "Betriebsarzt";
  if (key.includes("reteach") || key.includes("akademie") || key.includes("academy")) return "Reteach / Akademie";
  return "Nicht zugeordnet";
}

function emptyModel(): ManagementCustomerPortfolio {
  return { rows: [], customerMappingAvailable: false, projectsWithoutCustomerMapping: null, projectsWithoutServiceMapping: null, operationalLinksAvailable: false };
}

/** Read-only customer portfolio for active/open projects. */
export async function getManagementCustomerPortfolio(supabase: SupabaseTyped): Promise<ManagementCustomerPortfolio> {
  /*
   * Asked before the reads, and it decides the SELECT LIST: when the caller may
   * not see budgets, contract_hours is never requested, so the figure does not
   * reach the payload. The page-level banner on the Management dashboard states
   * that the figures are withheld -- without it, an omitted column arrives as
   * 0 h and reads as a real allocation of zero.
   */
  const canSeeBudgets = await canReadBudgets(supabase);

  try {
    const [{ data: projects }, { data: people }, { data: assignments }, timeProjects, customerMappings] = await Promise.all([
      projectsSelect(supabase, "id, code, name, contract_hours, status, owner_person_id", canSeeBudgets),
      supabase.from("people").select("id, name"),
      supabase.from("person_assignments").select("person_id, project_id"),
      fetchAllPaged<Record<string, unknown>>((from, to) => schema(supabase, "time").from("project").select("hub_project_id, source_id, service:service_id(name)").range(from, to)),
      readManagementCustomerMappings(),
    ]);
    if (!projects || !people || !assignments || timeProjects.truncated) return emptyModel();

    const activeProjects = (projects as Project[]).filter((project) => isOpen(project.status));
    const peopleById = new Map((people as Person[]).map((person) => [person.id, person.name]));
    const assignmentsByProject = new Map<string, string[]>();
    for (const assignment of assignments as Assignment[]) {
      if (!assignment.project_id) continue;
      const names = assignmentsByProject.get(assignment.project_id) ?? [];
      const name = peopleById.get(assignment.person_id);
      if (name) names.push(name);
      assignmentsByProject.set(assignment.project_id, names);
    }
    const timeByProject = new Map<string, TimeProject[]>();
    for (const timeProject of timeProjects.rows as TimeProject[]) {
      if (!timeProject.hub_project_id) continue;
      const rows = timeByProject.get(timeProject.hub_project_id) ?? [];
      rows.push(timeProject);
      timeByProject.set(timeProject.hub_project_id, rows);
    }

    const rowsByEntity = new Map<string, { entity: ManagementCustomerEntity; projects: Project[] }>();
    let projectsWithoutCustomerMapping = 0;
    let projectsWithoutServiceMapping = 0;
    for (const project of activeProjects) {
      const timeRows = timeByProject.get(project.id) ?? [];
      const entity = customerMappings.entityByOrderNumber.get(project.code);
      const services = unique(timeRows.map((row) => canonicalService(row.service?.name ?? null))).filter((service) => service !== "Nicht zugeordnet");
      if (!customerMappings.available || !entity) {
        projectsWithoutCustomerMapping += 1;
        continue;
      }
      if (services.length === 0) projectsWithoutServiceMapping += 1;
      const row = rowsByEntity.get(entity.id) ?? { entity, projects: [] };
      row.projects.push(project);
      rowsByEntity.set(entity.id, row);
    }

    const rows = [...rowsByEntity.values()].map(({ entity, projects: entityProjects }): CustomerPortfolioRow => {
      const serviceProjects = new Map<string, Project[]>();
      const risks = new Set<string>();
      const responsible = new Set<string>();
      let serviceHoursIncomplete = false;
      const projectDetails = entityProjects.map((project): CustomerPortfolioProject => {
        const timeRows = timeByProject.get(project.id) ?? [];
        const services = unique(timeRows.map((row) => canonicalService(row.service?.name ?? null))).filter((service) => service !== "Nicht zugeordnet");
        const projectResponsible = unique([project.owner_person_id ? peopleById.get(project.owner_person_id) ?? "Nicht aufgelöst" : null, ...(assignmentsByProject.get(project.id) ?? [])]);
        projectResponsible.forEach((person) => responsible.add(person));
        if (!project.owner_person_id) risks.add("Projekt ohne Verantwortlichen");
        if (!project.status) risks.add("Projekt ohne Status");
        if (services.length === 0) risks.add("Projekt ohne Service Mapping");
        else {
          services.forEach((service) => serviceProjects.set(service, [...(serviceProjects.get(service) ?? []), project]));
          if (services.length > 1) serviceHoursIncomplete = true;
        }
        return { projectId: project.id, project: project.name, responsiblePersonId: project.owner_person_id, service: services.join(", ") || "Nicht zugeordnet", contractHours: project.contract_hours, status: project.status, responsible: projectResponsible, links: { asana: null, chat: null, trackingTime: null, drive: null, microsoftTeams: null } };
      });
      const services = [...serviceProjects.entries()].map(([service, serviceRows]) => ({
        service,
        contractHours: serviceHoursIncomplete ? null : serviceRows.reduce((sum, project) => sum + (project.contract_hours ?? 0), 0),
        responsible: unique(serviceRows.flatMap((project) => [project.owner_person_id ? peopleById.get(project.owner_person_id) ?? "Nicht aufgelöst" : null, ...(assignmentsByProject.get(project.id) ?? [])])),
      })).sort((left, right) => left.service.localeCompare(right.service, "de"));
      if (serviceHoursIncomplete) risks.add("Mehrfach-Service-Zuordnung: Stunden nicht eindeutig verteilbar");
      if (projectDetails.some((project) => project.contractHours === null)) risks.add("Vertragsstunden unvollständig");
      return {
        legalEntityId: entity.id,
        customer: entity.legalName,
        legalEntity: entity.legalName,
        locations: [],
        locationsAvailable: false,
        activeServices: services.map((service) => service.service),
        projectCount: entityProjects.length,
        contractHours: entityProjects.some((project) => project.contract_hours === null) ? null : entityProjects.reduce((sum, project) => sum + (project.contract_hours ?? 0), 0),
        responsible: [...responsible].sort(),
        risks: [...risks],
        services,
        projects: projectDetails,
      };
    }).sort(
      (left, right) =>
        // Customers with flagged risks lead, then by contract volume. The
        // portfolio is a management attention list, not a phone book.
        (right.risks.length > 0 ? 1 : 0) - (left.risks.length > 0 ? 1 : 0) ||
        (right.contractHours ?? 0) - (left.contractHours ?? 0) ||
        left.customer.localeCompare(right.customer, "de"),
    );

    return { rows, customerMappingAvailable: customerMappings.available, projectsWithoutCustomerMapping: customerMappings.available ? projectsWithoutCustomerMapping : null, projectsWithoutServiceMapping, operationalLinksAvailable: false };
  } catch {
    return emptyModel();
  }
}
