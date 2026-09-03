import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { fetchAllPaged } from "@/lib/queries/paged";
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

export type ProjectRiskCategory =
  | "BUDGET_OVERRUN"
  | "PROJECT_WITHOUT_OWNER"
  | "PROJECT_WITHOUT_STATUS"
  | "PROJECT_WITHOUT_CUSTOMER_MAPPING"
  | "PROJECT_WITHOUT_SERVICE_MAPPING"
  | "HIGH_DEPENDENCY_PERSON"
  | "REPLACEMENT_RISK";

export type ProjectRiskRating = "Kritisch" | "Prüfen";
export type CustomerMappingStatus = "mapped" | "missing" | "unavailable";

export type ManagementProjectRiskDetail = {
  projectId: string;
  customer: string;
  customerMapping: CustomerMappingStatus;
  project: string;
  service: string;
  responsible: string | null;
  replacement: string | null;
  contractHours: number | null;
  status: string | null;
};

export type ManagementProjectRiskRow = {
  category: ProjectRiskCategory;
  risk: string;
  count: number | null;
  rating: ProjectRiskRating;
  affectedProjects: ManagementProjectRiskDetail[];
  responsible: string[];
  services: string[];
  contractHours: number | null;
  available: boolean;
  meaning: string;
};

type Project = {
  id: string;
  name: string;
  customer: string;
  contract_hours: number | null;
  logged_hours: number | null;
  consumed_percent: number | null;
  status: string | null;
  owner_person_id: string | null;
};

type Person = { id: string; name: string };
type Assignment = { person_id: string; project_id: string | null; share_percent: number | null };
type TimeProject = {
  hub_project_id: string | null;
  source_id: string | null;
  service: { name: string } | null;
};
type Order = { id: string; legal_entity_id: string | null };
type ProjectReference = { external_id: string; project_id: string };

// The generated types cover public only; these schemas are read through the same
// typed server client and never receive writes from this query.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const schema = (supabase: SupabaseTyped, name: string) => (supabase as any).schema(name);

const CLOSED_STATUSES = new Set([
  "closed",
  "completed",
  "done",
  "cancelled",
  "canceled",
  "archived",
  "inactive",
  "abgeschlossen",
]);

const isOpen = (status: string | null): boolean => {
  if (!status) return false;
  return !CLOSED_STATUSES.has(status.trim().toLowerCase());
};

const serviceName = (value: string | null): string => value || "Nicht zugeordnet";

const aggregateHours = (projects: ManagementProjectRiskDetail[]): number | null => {
  if (projects.some((project) => project.contractHours === null)) return null;
  return projects.reduce((sum, project) => sum + (project.contractHours ?? 0), 0);
};

const unique = (values: (string | null)[]): string[] => [...new Set(values.filter((value): value is string => Boolean(value)))].sort();

function emptyRiskRows(): ManagementProjectRiskRow[] {
  return [
    {
      category: "BUDGET_OVERRUN",
      risk: "Vertragsstunden ueberschritten",
      count: null,
      rating: "Kritisch",
      affectedProjects: [],
      responsible: [],
      services: [],
      contractHours: null,
      available: false,
      meaning: "Gebuchte Stunden konnten nicht gegen Vertragsstunden geprueft werden.",
    },
    {
      category: "PROJECT_WITHOUT_OWNER",
      risk: "Projekt ohne Verantwortlichen",
      count: null,
      rating: "Kritisch",
      affectedProjects: [],
      responsible: [],
      services: [],
      contractHours: null,
      available: false,
      meaning: "Offene Projekte können ohne Owner nicht eindeutig gesteuert werden.",
    },
    {
      category: "PROJECT_WITHOUT_STATUS",
      risk: "Projekt ohne Status",
      count: null,
      rating: "Prüfen",
      affectedProjects: [],
      responsible: [],
      services: [],
      contractHours: null,
      available: false,
      meaning: "Ohne Status ist die Offen-/Geschlossen-Auswertung nicht belastbar.",
    },
    {
      category: "PROJECT_WITHOUT_CUSTOMER_MAPPING",
      risk: "Projekt ohne Customer Mapping",
      count: null,
      rating: "Kritisch",
      affectedProjects: [],
      responsible: [],
      services: [],
      contractHours: null,
      available: false,
      meaning: "Eine stabile Customer-Master-Legal-Entity konnte nicht geprüft werden.",
    },
    {
      category: "PROJECT_WITHOUT_SERVICE_MAPPING",
      risk: "Projekt ohne Service Mapping",
      count: null,
      rating: "Prüfen",
      affectedProjects: [],
      responsible: [],
      services: [],
      contractHours: null,
      available: false,
      meaning: "Die servicebezogene Steuerung ist ohne Service-Zuordnung eingeschränkt.",
    },
    {
      category: "HIGH_DEPENDENCY_PERSON",
      risk: "Hohe Personenabhängigkeit",
      count: null,
      rating: "Prüfen",
      affectedProjects: [],
      responsible: [],
      services: [],
      contractHours: null,
      available: false,
      meaning: "Eine harte Schwelle für Projektanzahl oder Vertragsvolumen ist noch nicht fachlich validiert.",
    },
    {
      category: "REPLACEMENT_RISK",
      risk: "Replacement-Risiko",
      count: null,
      rating: "Prüfen",
      affectedProjects: [],
      responsible: [],
      services: [],
      contractHours: null,
      available: false,
      meaning: "Keine bestätigte servicebezogene Replacement-Relation ist im aktuellen Datenmodell verfügbar.",
    },
  ];
}

async function readCustomerMappings(supabase: SupabaseTyped): Promise<{
  available: boolean;
  legalEntityBySourceId: Map<string, string>;
}> {
  try {
    const [{ data: references, error: referenceError }, { data: orders, error: orderError }, { data: legalEntities, error: legalEntityError }] = await Promise.all([
      schema(supabase, "crm")
        .from("trackingtime_project_reference")
        .select("external_id, project_id")
        .eq("is_active", true),
      schema(supabase, "projects").from("project_order").select("id, legal_entity_id"),
      schema(supabase, "crm").from("legal_entity").select("id"),
    ]);
    if (referenceError || orderError || legalEntityError || !references || !orders || !legalEntities) {
      return { available: false, legalEntityBySourceId: new Map() };
    }

    const legalEntityIds = new Set((legalEntities as { id: string }[]).map((entity) => entity.id));
    const legalEntityByOrder = new Map(
      (orders as Order[])
        .filter((order) => order.legal_entity_id && legalEntityIds.has(order.legal_entity_id))
        .map((order) => [order.id, order.legal_entity_id!] as const),
    );
    return {
      available: true,
      legalEntityBySourceId: new Map(
        (references as ProjectReference[])
          .map((reference) => [reference.external_id, legalEntityByOrder.get(reference.project_id)] as const)
          .filter((entry): entry is readonly [string, string] => Boolean(entry[1])),
      ),
    };
  } catch {
    return { available: false, legalEntityBySourceId: new Map() };
  }
}

function createRiskRow(
  category: ProjectRiskCategory,
  risk: string,
  rating: ProjectRiskRating,
  projects: ManagementProjectRiskDetail[],
  meaning: string,
): ManagementProjectRiskRow {
  return {
    category,
    risk,
    count: projects.length,
    rating,
    affectedProjects: projects,
    responsible: unique(projects.map((project) => project.responsible)),
    services: unique(projects.map((project) => project.service)),
    contractHours: aggregateHours(projects),
    available: true,
    meaning,
  };
}

/** Read-only operational project risks for the management dashboard. */
export async function getManagementProjectRisks(
  supabase: SupabaseTyped,
): Promise<ManagementProjectRiskRow[]> {
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
      projectsSelect(supabase, "id, name, customer, contract_hours, logged_hours, consumed_percent, status, owner_person_id", canSeeBudgets),
      supabase.from("people").select("id, name"),
      supabase.from("person_assignments").select("person_id, project_id, share_percent"),
      fetchAllPaged<Record<string, unknown>>((from, to) =>
        schema(supabase, "time")
          .from("project")
          .select("hub_project_id, source_id, service:service_id(name)")
          // Ordered: same paging defect as management-contract-hours.
          .order("id", { ascending: true })
          .range(from, to),
      ),
      readCustomerMappings(supabase),
    ]);

    if (!projects || !people || !assignments || timeProjects.truncated) return emptyRiskRows();

    const projectRows = projects as Project[];
    const peopleById = new Map((people as Person[]).map((person) => [person.id, person.name]));
    const timeByProject = new Map<string, TimeProject>();
    for (const timeProject of timeProjects.rows as TimeProject[]) {
      if (timeProject.hub_project_id) timeByProject.set(timeProject.hub_project_id, timeProject);
    }

    const assignmentCountByPerson = new Map<string, Set<string>>();
    const assignmentHoursByPerson = new Map<string, number>();
    for (const assignment of assignments as Assignment[]) {
      if (!assignment.project_id) continue;
      const projectIds = assignmentCountByPerson.get(assignment.person_id) ?? new Set<string>();
      projectIds.add(assignment.project_id);
      assignmentCountByPerson.set(assignment.person_id, projectIds);
      const project = projectRows.find((row) => row.id === assignment.project_id);
      if (project?.contract_hours !== null && project?.contract_hours !== undefined) {
        assignmentHoursByPerson.set(
          assignment.person_id,
          (assignmentHoursByPerson.get(assignment.person_id) ?? 0) + project.contract_hours * (assignment.share_percent ?? 0) / 100,
        );
      }
    }

    const details = projectRows.map((project): ManagementProjectRiskDetail => {
      const timeProject = timeByProject.get(project.id);
      const sourceHasMapping = Boolean(timeProject?.source_id && customerMappings.legalEntityBySourceId.has(timeProject.source_id));
      return {
        projectId: project.id,
        customer: project.customer,
        customerMapping: !customerMappings.available ? "unavailable" : sourceHasMapping ? "mapped" : "missing",
        project: project.name,
        service: serviceName(timeProject?.service?.name ?? null),
        responsible: project.owner_person_id ? peopleById.get(project.owner_person_id) ?? "Nicht aufgelöst" : null,
        replacement: null,
        contractHours: project.contract_hours,
        status: project.status,
      };
    });

    const detailById = new Map(details.map((detail) => [detail.projectId, detail]));

    /*
     * BUDGET OVERRUN: logged hours exceed the contract hours sales agreed.
     * Only orders with a real contract (> 0h) and real logged hours are
     * judged -- an order whose hours never linked shows 0h and must not be
     * called healthy OR overrun on that basis. 100%+ is the risk; the
     * approaching band (>=80%) is deliberately NOT flagged here because the
     * budget guard already warns the person booking -- this panel is for
     * money already burnt.
     */
    const overBudget = projectRows
      .filter(
        (project) =>
          (project.contract_hours ?? 0) > 0 &&
          (project.logged_hours ?? 0) > 0 &&
          (project.consumed_percent ?? 0) > 100,
      )
      .sort((a, b) => (b.consumed_percent ?? 0) - (a.consumed_percent ?? 0))
      .map((project) => detailById.get(project.id)!);
    const openWithoutOwner = projectRows
      .filter((project) => isOpen(project.status) && !project.owner_person_id)
      .map((project) => detailById.get(project.id)!);
    /*
     * "Kein Status gesetzt" must mean somebody FORGOT, not "there is nothing
     * to measure".
     *
     * Migration 20260826120000 sets status to NULL for the 54 orders with no
     * TrackingTime link, because inventing NORMAL for an unmeasured order is
     * the plausible-zero this codebase spent a migration removing. A bare
     * `!project.status` filter would then accuse all 54 of an omission, and
     * the likely human response to 54 false alarms is either to distrust the
     * panel or to "fix" it by setting NORMAL -- reintroducing the exact lie.
     *
     * The two cases are distinguishable from the same row: an unmeasured order
     * has NULL logged_hours as well. So a statusless order counts as forgotten
     * only when its hours ARE known. Verified by
     * scripts/check-risk-panel-survives-nulls.mjs, which replays this
     * predicate over the real before/after populations.
     */
    const withoutStatus = projectRows
      .filter((project) => !project.status && project.logged_hours !== null)
      .map((project) => detailById.get(project.id)!);
    const withoutCustomerMapping = customerMappings.available
      ? details.filter((detail) => detail.customerMapping === "missing")
      : [];
    const withoutServiceMapping = details.filter((detail) => detail.service === "Nicht zugeordnet");

    // The candidate data is intentionally prepared but not classified until a
    // business-approved dependency threshold exists.
    void assignmentCountByPerson;
    void assignmentHoursByPerson;

    return [
      createRiskRow(
        "BUDGET_OVERRUN",
        "Vertragsstunden ueberschritten",
        "Kritisch",
        overBudget,
        "Gebuchte Stunden liegen ueber den vertraglich vereinbarten Stunden. Budget nachverhandeln, Vertrag verlaengern oder Leistung stoppen.",
      ),
      createRiskRow(
        "PROJECT_WITHOUT_OWNER",
        "Projekt ohne Verantwortlichen",
        "Kritisch",
        openWithoutOwner,
        "Offenes Projekt ohne owner_person_id kann operativ nicht eindeutig gesteuert werden.",
      ),
      createRiskRow(
        "PROJECT_WITHOUT_STATUS",
        "Projekt ohne Status",
        "Prüfen",
        withoutStatus,
        "Fehlender Status verhindert eine belastbare Offen-/Geschlossen-Auswertung.",
      ),
      customerMappings.available
        ? createRiskRow(
            "PROJECT_WITHOUT_CUSTOMER_MAPPING",
            "Projekt ohne Customer Mapping",
            "Kritisch",
            withoutCustomerMapping,
            "Projekt besitzt keine stabile Customer-Master-Legal-Entity-Referenz.",
          )
        : emptyRiskRows()[3],
      createRiskRow(
        "PROJECT_WITHOUT_SERVICE_MAPPING",
        "Projekt ohne Service Mapping",
        "Prüfen",
        withoutServiceMapping,
        "Projekt ist keiner belastbaren time.service-Zuordnung zugeordnet.",
      ),
      emptyRiskRows()[5],
      emptyRiskRows()[6],
    ];
  } catch {
    return emptyRiskRows();
  }
}
