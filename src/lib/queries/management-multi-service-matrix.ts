import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { fetchAllPaged } from "@/lib/queries/paged";

type SupabaseTyped = SupabaseClient<Database>;

export const MULTI_SERVICE_COLUMNS = [
  { key: "DGUV_V2_SIFA", label: "DGUV V2 SiFa" },
  { key: "HS_CONSULTING", label: "H&S Consulting" },
  { key: "BRANDSCHUTZ", label: "Brandschutzbeauftragter" },
  { key: "SIGEKO", label: "SiGeKo" },
  { key: "ENERCON_SIGEKO", label: "ENERCON SiGeKo" },
  { key: "BETRIEBSARZT", label: "Betriebsarzt" },
  { key: "RETEACH_AKADEMIE", label: "Reteach / Akademie" },
] as const;

export type MultiServiceKey = (typeof MULTI_SERVICE_COLUMNS)[number]["key"];
export type MultiServiceUsage = Record<MultiServiceKey, number>;

export type ManagementMultiServiceRow = {
  legalEntityId: string;
  customer: string;
  services: MultiServiceUsage;
  activeServiceCount: number;
  contractHours: number | null;
  projectCount: number;
  possibleMissingServices: MultiServiceKey[];
};

export type ManagementMultiServiceMatrix = {
  rows: ManagementMultiServiceRow[];
  customerMappingAvailable: boolean;
  activeProjectsWithoutCustomerMapping: number | null;
  activeProjectsWithoutServiceMapping: number | null;
  unmappedContractHours: number | null;
};

type Project = {
  id: string;
  contract_hours: number | null;
  status: string | null;
};
type TimeProject = {
  hub_project_id: string | null;
  source_id: string | null;
  service: { name: string } | null;
};
type Order = { id: string; legal_entity_id: string | null };
type ProjectReference = { external_id: string; project_id: string };
type LegalEntity = { id: string; legal_name: string };

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
  if (key.includes("healthandsafetyconsulting") || key.includes("hsconsulting")) return "HS_CONSULTING";
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

async function readCustomerMappings(supabase: SupabaseTyped): Promise<{
  available: boolean;
  entityBySourceId: Map<string, string>;
  entities: Map<string, string>;
}> {
  try {
    const [{ data: references, error: referenceError }, { data: orders, error: orderError }, { data: legalEntities, error: entityError }] = await Promise.all([
      schema(supabase, "crm")
        .from("trackingtime_project_reference")
        .select("external_id, project_id")
        .eq("is_active", true),
      schema(supabase, "projects").from("project_order").select("id, legal_entity_id"),
      schema(supabase, "crm").from("legal_entity").select("id, legal_name"),
    ]);
    if (referenceError || orderError || entityError || !references || !orders || !legalEntities) {
      return { available: false, entityBySourceId: new Map(), entities: new Map() };
    }

    const entities = new Map((legalEntities as LegalEntity[]).map((entity) => [entity.id, entity.legal_name]));
    const entityByOrder = new Map(
      (orders as Order[])
        .filter((order) => order.legal_entity_id && entities.has(order.legal_entity_id))
        .map((order) => [order.id, order.legal_entity_id!] as const),
    );
    const entityBySourceId = new Map(
      (references as ProjectReference[])
        .map((reference) => [reference.external_id, entityByOrder.get(reference.project_id)] as const)
        .filter((entry): entry is readonly [string, string] => Boolean(entry[1])),
    );
    return { available: true, entityBySourceId, entities };
  } catch {
    return { available: false, entityBySourceId: new Map(), entities: new Map() };
  }
}

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
      supabase.from("projects").select("id, contract_hours, status"),
      fetchAllPaged<Record<string, unknown>>((from, to) =>
        schema(supabase, "time")
          .from("project")
          .select("hub_project_id, source_id, service:service_id(name)")
          .range(from, to),
      ),
      readCustomerMappings(supabase),
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
        timeRows
          .map((timeRow) => timeRow.source_id ? customerMappings.entityBySourceId.get(timeRow.source_id) : undefined)
          .filter((entityId): entityId is string => Boolean(entityId)),
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
          customer: customerMappings.entities.get(legalEntityId) ?? "Nicht aufgelöst",
          services: value.services,
          activeServiceCount: activeServiceKeys.length,
          contractHours: aggregateHours(value.projects),
          projectCount: value.projects.length,
          possibleMissingServices: MULTI_SERVICE_COLUMNS
            .map(({ key }) => key)
            .filter((key) => value.services[key] === 0),
        } satisfies ManagementMultiServiceRow;
      })
      .sort((left, right) => left.customer.localeCompare(right.customer, "de"));

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
