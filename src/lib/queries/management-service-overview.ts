import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";

type SupabaseTyped = SupabaseClient<Database>;

export type ServiceOverviewUnit = "HOURS" | "USERS";

export type ServiceOverviewRow = {
  service: string;
  unit: ServiceOverviewUnit;
  openProjects: number;
  /** Null when one or more projects lacks a canonical Legal Entity mapping. */
  uniqueCustomers: number | null;
  openContractHours: number;
  projectsWithoutOwner: number;
  /**
   * Open projects in this service with nobody named as cover. Null only when
   * `project_responsibility` carries no replacement rows at all, i.e. the
   * relation genuinely is not populated -- not merely because reading it was
   * skipped.
   */
  projectsWithoutReplacement: number | null;
  missingOrderNumber: number;
  missingCustomerMapping: number;
  missingStatus: number;
};

type ProjectRow = {
  id: string;
  contract_hours: number | null;
  status: string | null;
  owner_person_id: string | null;
};

type AssignmentRow = {
  project_id: string | null;
  person_id: string;
};

type ResponsibilityRow = {
  project_id: string;
  person_id: string;
  role: string;
};

type TimeProjectRow = {
  hub_project_id: string | null;
  source_id: string | null;
  service: { name: string } | null;
};

type ProjectOrderRow = {
  id: string;
  order_number: string | null;
  legal_entity_id: string | null;
};

type TrackingTimeProjectReference = {
  external_id: string;
  project_id: string;
};

// `time`, `projects` and `crm` are not represented in the generated public types.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const schema = (supabase: SupabaseTyped, name: string) => (supabase as any).schema(name);

const numberOrZero = (value: unknown): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const canonicalService = (value: string): string => {
  const key = value.toLowerCase().replace(/[^a-z0-9]+/g, "").replace("engeineer", "engineer");
  if (key.includes("enercon") && key.includes("sigeko")) return "ENERCON SiGeKo / construction coordination";
  if (key.includes("dguvv2") && key.includes("sifa")) return "DGUV V2: SiFa / Safety Engineer";
  if (key.includes("healthandsafetyconsulting") || key.includes("healthsafetyconsulting")) return "Health & Safety Consulting";
  if (key.includes("brandschutzbeauftragter")) return "Brandschutzbeauftragter";
  if (key.includes("sigeko") && key.includes("constructioncoordination")) return "SiGeKo / construction coordination";
  return value || "Nicht zugeordnet";
};

const isOpen = (status: string | null): boolean => {
  if (!status) return false;
  return !new Set(["closed", "completed", "done", "cancelled", "canceled", "archived", "inactive", "abgeschlossen"])
    .has(status.trim().toLowerCase());
};

/**
 * Read-only references from the Customer Master foundation.
 *
 * The canonical project table lives in schema `projects`, while its
 * TrackingTime reference lives in schema `crm`. If the foundation is not
 * available to the current caller, an empty map is returned; the overview then
 * reports the missing mappings instead of falling back to customer text.
 */
async function readCustomerMasterReferences(
  supabase: SupabaseTyped,
): Promise<{ bySourceProject: Map<string, ProjectOrderRow>; available: boolean }> {
  try {
    const [{ data: orders, error: ordersError }, { data: refs, error: refsError }] = await Promise.all([
      schema(supabase, "projects").from("project_order").select("id, order_number, legal_entity_id"),
      schema(supabase, "crm").from("trackingtime_project_reference").select("external_id, project_id").eq("is_active", true),
    ]);
    if (ordersError || refsError || !orders || !refs) return { bySourceProject: new Map(), available: false };

    const ordersById = new Map((orders as ProjectOrderRow[]).map((order) => [order.id, order]));
    const bySourceProject = new Map<string, ProjectOrderRow>();
    for (const reference of refs as TrackingTimeProjectReference[]) {
      const order = ordersById.get(reference.project_id);
      if (order) bySourceProject.set(reference.external_id, order);
    }
    return { bySourceProject, available: true };
  } catch {
    return { bySourceProject: new Map(), available: false };
  }
}

/**
 * Aggregates open contractual project data by service.
 *
 * This query deliberately does not count customers from `public.projects.customer`.
 * A customer count is only returned when every included project resolves to a
 * canonical Customer-Master Legal Entity. Reteach is a separate USERS concern
 * and has no source field in the current model, so no fabricated user row is
 * emitted.
 *
 * Replacement coverage is read from `public.project_responsibility` where
 * `role = 'replacement'` -- the canonical role table, 140 rows over 140
 * projects. It is a strict subset of the share_percent = 0 convention in
 * `person_assignments` (140 agree, 0 disagree), so the role table is the
 * narrower and safer source. Reporting `n/a` here while those rows existed
 * understated a real operational risk.
 *
 * 65 of those 140 rows name the responsible person as their own replacement,
 * faithfully copied from the workbook. Those are not cover, so they are
 * excluded: 156 of 231 open projects have nobody independent named.
 */
export async function getManagementServiceOverview(
  supabase: SupabaseTyped,
): Promise<ServiceOverviewRow[]> {
  try {
    const [{ data: projects }, { data: assignments }, { data: replacements }, timeProjects, customerMaster] = await Promise.all([
      supabase.from("projects").select("id, contract_hours, status, owner_person_id"),
      supabase.from("person_assignments").select("project_id, person_id"),
      /*
       * Untyped through a cast because `project_responsibility` is newer than
       * the checked-in `database.types.ts`, which this change does not own and
       * must not regenerate. Same convention as my-work.ts:444. The rows are
       * narrowed to `ResponsibilityRow` immediately below.
       */
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (supabase as any)
        .from("project_responsibility")
        .select("project_id, person_id, role"),
      schema(supabase, "time")
        .from("project")
        .select("hub_project_id, source_id, service:service_id(name)")
        .not("hub_project_id", "is", null),
      readCustomerMasterReferences(supabase),
    ]);

    if (!projects || !assignments || timeProjects.error) return [];

    /*
     * Absent rows (relation not populated) must stay n/a; an empty result is not
     * evidence that every project is uncovered.
     *
     * SELF-COVER IS NOT COVER. The source workbook repeats the responsible
     * person in the Vertretung column on 78 rows, which the import faithfully
     * reproduced as 65 projects whose named replacement is the very person they
     * would have to cover for. Counting those as covered overstates resilience
     * precisely where the risk is, so they are excluded and the project reads as
     * uncovered -- which is what it operationally is.
     */
    const responsibilityRows = (replacements ?? []) as unknown as ResponsibilityRow[];
    const replacementRelationAvailable = responsibilityRows.some((row) => row.role === "replacement");
    const responsibleByProject = new Map<string, string>();
    for (const row of responsibilityRows) {
      if (row.role === "responsible") responsibleByProject.set(row.project_id, row.person_id);
    }
    const projectsWithReplacement = new Set(
      responsibilityRows
        .filter((row) => row.role === "replacement" && responsibleByProject.get(row.project_id) !== row.person_id)
        .map((row) => row.project_id),
    );

    const projectRows = projects as ProjectRow[];
    const assignmentsByProject = new Map<string, Set<string>>();
    for (const assignment of assignments as AssignmentRow[]) {
      if (!assignment.project_id) continue;
      const people = assignmentsByProject.get(assignment.project_id) ?? new Set<string>();
      people.add(assignment.person_id);
      assignmentsByProject.set(assignment.project_id, people);
    }

    const projectLinks = new Map<string, { service: string; order: ProjectOrderRow | null }>();
    for (const timeProject of (timeProjects.data ?? []) as TimeProjectRow[]) {
      if (!timeProject.hub_project_id) continue;
      projectLinks.set(String(timeProject.hub_project_id), {
        service: canonicalService(timeProject.service?.name ?? ""),
        order: timeProject.source_id
          ? customerMaster.bySourceProject.get(timeProject.source_id) ?? null
          : null,
      });
    }

    const aggregates = new Map<string, {
      openProjects: number;
      customerEntityIds: Set<string>;
      hasMissingCustomerMapping: boolean;
      openContractHours: number;
      projectsWithoutOwner: number;
      projectsWithoutReplacement: number;
      missingOrderNumber: number;
      missingCustomerMapping: number;
      missingStatus: number;
    }>();

    for (const project of projectRows) {
      const link = projectLinks.get(project.id);
      const service = link?.service ?? "Nicht zugeordnet";
      const aggregate = aggregates.get(service) ?? {
        openProjects: 0,
        customerEntityIds: new Set<string>(),
        hasMissingCustomerMapping: false,
        openContractHours: 0,
        projectsWithoutOwner: 0,
        projectsWithoutReplacement: 0,
        missingOrderNumber: 0,
        missingCustomerMapping: 0,
        missingStatus: 0,
      };

      if (link?.order?.legal_entity_id) aggregate.customerEntityIds.add(link.order.legal_entity_id);
      if (!link?.order?.legal_entity_id) aggregate.hasMissingCustomerMapping = true;
      if (!project.status) aggregate.missingStatus += 1;

      if (isOpen(project.status)) {
        aggregate.openProjects += 1;
        aggregate.openContractHours += numberOrZero(project.contract_hours);
        if (!project.owner_person_id) aggregate.projectsWithoutOwner += 1;
        if (!projectsWithReplacement.has(project.id)) aggregate.projectsWithoutReplacement += 1;
        if (!link?.order?.order_number) aggregate.missingOrderNumber += 1;
        if (!link?.order?.legal_entity_id) aggregate.missingCustomerMapping += 1;
      }

      aggregates.set(service, aggregate);
    }

    return [...aggregates.entries()]
      .sort(([serviceA], [serviceB]) => serviceA.localeCompare(serviceB))
      .map(([service, aggregate]) => ({
        service,
        unit: "HOURS" as const,
        openProjects: aggregate.openProjects,
        uniqueCustomers: aggregate.hasMissingCustomerMapping ? null : aggregate.customerEntityIds.size,
        openContractHours: aggregate.openContractHours,
        projectsWithoutOwner: aggregate.projectsWithoutOwner,
        projectsWithoutReplacement: replacementRelationAvailable ? aggregate.projectsWithoutReplacement : null,
        missingOrderNumber: aggregate.missingOrderNumber,
        missingCustomerMapping: aggregate.missingCustomerMapping,
        missingStatus: aggregate.missingStatus,
      }));
  } catch {
    return [];
  }
}
