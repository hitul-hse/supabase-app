import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { fetchAllPaged } from "@/lib/queries/paged";
import { readManagementCustomerMappings } from "@/lib/queries/management-customer-mapping";
import { MULTI_SERVICE_COLUMNS, type ManagementMultiServiceMatrix, type ManagementMultiServiceRow, type MultiServiceKey, type MultiServiceUsage } from "@/lib/queries/management-multi-service-matrix.types";

type SupabaseTyped = SupabaseClient<Database>;

export type { ManagementMultiServiceMatrix, ManagementMultiServiceRow, MultiServiceKey, MultiServiceUsage } from "@/lib/queries/management-multi-service-matrix.types";

type Project = {
  id: string;
  code: string;
  contract_hours: number | null;
  status: string | null;
};
type TimeProject = {
  hub_project_id: string | null;
  source_id: string | null;
  service: { name: string } | null;
};

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

const normalized = (value: string): string => value.toLowerCase().replace(/[^a-z0-9]+/g, "");

function canonicalService(value: string | null): MultiServiceKey | null {
  const key = normalized(value ?? "");
  if (key.includes("enercon") && key.includes("sigeko")) return "ENERCON_SIGEKO";
  if (key.includes("dguvv2") && key.includes("sifa")) return "DGUV_V2_SIFA";
  if (key.includes("healthandsafetyconsulting") || key.includes("healthsafetyconsulting") || key.includes("hsconsulting")) return "HS_CONSULTING";
  if (key.includes("brandschutz")) return "BRANDSCHUTZ";
  if (key.includes("sigeko") && key.includes("constructioncoordination")) return "SIGEKO";
  if (key.includes("betriebsarzt") || key.includes("arbeitsmedizin") || key.includes("occupationalmedicine")) return "BETRIEBSARZT";
  if (key.includes("reteach") || key.includes("akademie") || key.includes("academy")) return "RETEACH_AKADEMIE";
  return null;
}

const emptyUsage = (): MultiServiceUsage =>
  Object.fromEntries(MULTI_SERVICE_COLUMNS.map(({ key }) => [key, 0])) as MultiServiceUsage;

const aggregateHours = (projects: Project[]): number | null => {
  if (projects.some((project) => project.contract_hours === null)) return null;
  return projects.reduce((sum, project) => sum + (project.contract_hours ?? 0), 0);
};

function emptyModel(): ManagementMultiServiceMatrix {
  return {
    rows: [],
    customerMappingAvailable: false,
    activeProjectsWithoutCustomerMapping: null,
    activeProjectsWithoutServiceMapping: null,
    unmappedContractHours: null,
  };
}

/** Read-only matrix of active services by stable Customer-Master Legal Entity. */
export async function getManagementMultiServiceMatrix(
  supabase: SupabaseTyped,
): Promise<ManagementMultiServiceMatrix> {
  try {
    const [{ data: projects }, timeProjects, customerMappings] = await Promise.all([
      supabase.from("projects").select("id, code, contract_hours, status"),
      fetchAllPaged<Record<string, unknown>>((from, to) =>
        schema(supabase, "time")
          .from("project")
          .select("hub_project_id, source_id, service:service_id(name)")
          .range(from, to),
      ),
      readManagementCustomerMappings(),
    ]);
    if (!projects || timeProjects.truncated) return emptyModel();

    const activeProjects = (projects as Project[]).filter((project) => isOpen(project.status));
    const timeByProject = new Map<string, TimeProject[]>();
    for (const timeProject of timeProjects.rows as TimeProject[]) {
      if (!timeProject.hub_project_id) continue;
      const projectRows = timeByProject.get(timeProject.hub_project_id) ?? [];
      projectRows.push(timeProject);
      timeByProject.set(timeProject.hub_project_id, projectRows);
    }

    const rowsByEntity = new Map<string, { projects: Project[]; services: MultiServiceUsage }>();
    let activeProjectsWithoutCustomerMapping = 0;
    let activeProjectsWithoutServiceMapping = 0;
    let unmappedContractHours = 0;
    let hasUnmappedHours = false;

    for (const project of activeProjects) {
      const timeRows = timeByProject.get(project.id) ?? [];
      const entityIds = new Set(
        [customerMappings.entityByOrderNumber.get(project.code)?.id].filter((entityId): entityId is string => Boolean(entityId)),
      );
      const serviceKeys = new Set(
        timeRows
          .map((timeRow) => canonicalService(timeRow.service?.name ?? null))
          .filter((service): service is MultiServiceKey => Boolean(service)),
      );

      if (!customerMappings.available || entityIds.size !== 1) {
        activeProjectsWithoutCustomerMapping += 1;
        if (project.contract_hours === null) hasUnmappedHours = true;
        else unmappedContractHours += project.contract_hours;
        continue;
      }
      if (serviceKeys.size === 0) {
        activeProjectsWithoutServiceMapping += 1;
        if (project.contract_hours === null) hasUnmappedHours = true;
        else unmappedContractHours += project.contract_hours;
        continue;
      }

      const entityId = [...entityIds][0];
      const row = rowsByEntity.get(entityId) ?? { projects: [], services: emptyUsage() };
      row.projects.push(project);
      for (const service of serviceKeys) row.services[service] += 1;
      rowsByEntity.set(entityId, row);
    }

    const rows = [...rowsByEntity.entries()]
      .map(([legalEntityId, value]) => {
        const activeServiceKeys = MULTI_SERVICE_COLUMNS
          .map(({ key }) => key)
          .filter((key) => value.services[key] > 0);
        return {
          legalEntityId,
          customer: customerMappings.entities.get(legalEntityId)?.legalName ?? "Nicht aufgelöst",
          services: value.services,
          activeServiceCount: activeServiceKeys.length,
          contractHours: aggregateHours(value.projects),
          projectCount: value.projects.length,
          possibleMissingServices: MULTI_SERVICE_COLUMNS
            .map(({ key }) => key)
            .filter((key) => value.services[key] === 0),
        } satisfies ManagementMultiServiceRow;
      })
      .sort(
        (left, right) =>
          // Fewest active services first: a customer with ONE service and large
          // contract volume is the cross-selling case this matrix exists to
          // surface. Alphabetical order buried those under the As and Bs.
          left.activeServiceCount - right.activeServiceCount ||
          (right.contractHours ?? 0) - (left.contractHours ?? 0) ||
          left.customer.localeCompare(right.customer, "de"),
      );

    return {
      rows,
      customerMappingAvailable: customerMappings.available,
      activeProjectsWithoutCustomerMapping: customerMappings.available ? activeProjectsWithoutCustomerMapping : null,
      activeProjectsWithoutServiceMapping,
      unmappedContractHours: hasUnmappedHours ? null : unmappedContractHours,
    };
  } catch {
    return emptyModel();
  }
}
