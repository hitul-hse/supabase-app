import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { fetchAllPaged } from "@/lib/queries/paged";

type SupabaseTyped = SupabaseClient<Database>;

export type DataQualityRating = "Kritisch" | "Prüfen";

export type ManagementDataQualityRow = {
  check: string;
  count: number | null;
  rating: DataQualityRating;
  meaning: string;
};

type Project = {
  id: string;
  status: string | null;
  owner_person_id: string | null;
};

type TimeProject = {
  hub_project_id: string | null;
  source_id: string | null;
  service: { id?: string | number | null } | null;
};
type Order = { id: string; order_number: string | null; legal_entity_id: string | null };
type Reference = { external_id: string; project_id: string };

// The generated types cover public only; these schemas are read through the same
// typed server client and never receive writes from this query.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const schema = (supabase: SupabaseTyped, name: string) => (supabase as any).schema(name);

const isOpen = (status: string | null): boolean => {
  if (!status) return false;
  return !new Set(["closed", "completed", "done", "cancelled", "canceled", "archived", "inactive", "abgeschlossen"])
    .has(status.trim().toLowerCase());
};

async function readCustomerMasterLinks(supabase: SupabaseTyped): Promise<{
  available: boolean;
  orderBySourceId: Map<string, Order>;
  legalEntityIds: Set<string>;
}> {
  try {
    const [{ data: orders, error: ordersError }, { data: references, error: referencesError }, { data: legalEntities, error: legalEntityError }] = await Promise.all([
      schema(supabase, "projects").from("project_order").select("id, order_number, legal_entity_id"),
      schema(supabase, "crm").from("trackingtime_project_reference").select("external_id, project_id").eq("is_active", true),
      schema(supabase, "crm").from("legal_entity").select("id"),
    ]);
    if (ordersError || referencesError || legalEntityError || !orders || !references || !legalEntities) {
      return { available: false, orderBySourceId: new Map(), legalEntityIds: new Set() };
    }

    const orderById = new Map((orders as Order[]).map((order) => [order.id, order]));
    const orderBySourceId = new Map<string, Order>();
    for (const reference of references as Reference[]) {
      const order = orderById.get(reference.project_id);
      if (order) orderBySourceId.set(reference.external_id, order);
    }
    return {
      available: true,
      orderBySourceId,
      legalEntityIds: new Set((legalEntities as { id: string }[]).map((entity) => entity.id)),
    };
  } catch {
    return { available: false, orderBySourceId: new Map(), legalEntityIds: new Set() };
  }
}

function emptyRows(): ManagementDataQualityRow[] {
  return [
    { check: "Offene Projekte ohne Verantwortlichen", count: null, rating: "Kritisch", meaning: "Projekt kann operativ nicht eindeutig gesteuert werden." },
    { check: "Offene Projekte ohne Replacement", count: null, rating: "Prüfen", meaning: "Vertretungs- und Ausfallrisiko; keine bestätigte Replacement-Relation vorhanden." },
    { check: "Offene Projekte ohne Order Number", count: null, rating: "Kritisch", meaning: "Eindeutige Projektidentifikation fehlt." },
    { check: "Offene Projekte ohne Customer Mapping", count: null, rating: "Kritisch", meaning: "Projekt ist keiner Customer-Master-Legal-Entity zugeordnet." },
    { check: "Projekte ohne Contract Status", count: null, rating: "Prüfen", meaning: "Offen-/Geschlossen-Auswertung ist nicht zuverlässig." },
    { check: "Projekte ohne Service Mapping", count: null, rating: "Prüfen", meaning: "Servicebezogene Steuerung ist nicht vollständig möglich." },
    { check: "Projekte ohne eindeutige Projektzuordnung", count: null, rating: "Kritisch", meaning: "Projekt kann keiner eindeutigen TrackingTime-/Hub-Referenz zugeordnet werden." },
  ];
}

/** Read-only data quality checks for the management dashboard. */
export async function getManagementDataQuality(
  supabase: SupabaseTyped,
): Promise<ManagementDataQualityRow[]> {
  try {
    const [{ data: projects }, timeProjects, customerMaster] = await Promise.all([
      supabase.from("projects").select("id, status, owner_person_id"),
      fetchAllPaged<Record<string, unknown>>((from, to) =>
        schema(supabase, "time")
          .from("project")
          .select("hub_project_id, source_id, service:service_id(id)")
          .range(from, to),
      ),
      readCustomerMasterLinks(supabase),
    ]);
    if (!projects || timeProjects.truncated) return emptyRows();

    const rows = projects as Project[];
    const timeByHubProject = new Map<string, TimeProject>();
    for (const timeProject of timeProjects.rows as TimeProject[]) {
      if (timeProject.hub_project_id) timeByHubProject.set(timeProject.hub_project_id, timeProject);
    }

    const openProjects = rows.filter((project) => isOpen(project.status));
    const withoutOwner = openProjects.filter((project) => !project.owner_person_id).length;
    const withoutStatus = rows.filter((project) => !project.status).length;
    const withoutService = rows.filter((project) => {
      const timeProject = timeByHubProject.get(project.id);
      return !timeProject || !timeProject.service?.id;
    }).length;
    const withoutProjectLink = rows.filter((project) => !timeByHubProject.has(project.id)).length;

    const customerMasterChecksAvailable = customerMaster.available;
    const withoutOrderNumber = customerMasterChecksAvailable
      ? openProjects.filter((project) => {
          const timeProject = timeByHubProject.get(project.id);
          const order = timeProject?.source_id ? customerMaster.orderBySourceId.get(timeProject.source_id) : null;
          return !order?.order_number;
        }).length
      : null;
    const withoutCustomerMapping = customerMasterChecksAvailable
      ? openProjects.filter((project) => {
          const timeProject = timeByHubProject.get(project.id);
          const order = timeProject?.source_id ? customerMaster.orderBySourceId.get(timeProject.source_id) : null;
          return !order?.legal_entity_id || !customerMaster.legalEntityIds.has(order.legal_entity_id);
        }).length
      : null;

    return [
      { check: "Offene Projekte ohne Verantwortlichen", count: withoutOwner, rating: "Kritisch", meaning: "Projekt kann operativ nicht eindeutig gesteuert werden." },
      { check: "Offene Projekte ohne Replacement", count: null, rating: "Prüfen", meaning: "Vertretungs- und Ausfallrisiko; keine bestätigte servicebezogene Replacement-Relation vorhanden." },
      { check: "Offene Projekte ohne Order Number", count: withoutOrderNumber, rating: "Kritisch", meaning: "Eindeutige Projektidentifikation fehlt." },
      { check: "Offene Projekte ohne Customer Mapping", count: withoutCustomerMapping, rating: "Kritisch", meaning: "Projekt ist keiner Customer-Master-Legal-Entity zugeordnet." },
      { check: "Projekte ohne Contract Status", count: withoutStatus, rating: "Prüfen", meaning: "Offen-/Geschlossen-Auswertung ist nicht zuverlässig." },
      { check: "Projekte ohne Service Mapping", count: withoutService, rating: "Prüfen", meaning: "Servicebezogene Steuerung ist nicht vollständig möglich." },
      { check: "Projekte ohne eindeutige Projektzuordnung", count: withoutProjectLink, rating: "Kritisch", meaning: "Projekt kann keiner eindeutigen TrackingTime-/Hub-Referenz zugeordnet werden." },
    ];
  } catch {
    return emptyRows();
  }
}
