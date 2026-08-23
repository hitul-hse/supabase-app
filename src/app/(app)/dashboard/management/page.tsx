import { PageHeader } from "@/components/PageHeader";
import PageTransition from "@/components/animations/PageTransition";
import { EmptyState } from "@/components/EmptyState";
import { Card } from "@/components/ui/Card";
import { createManagementReadClient } from "@/utils/supabase/management-read";
import { requirePermission } from "@/utils/supabase/require-profile";
import { PERMISSIONS } from "@/lib/permissions";
import { getManagementContractHours } from "@/lib/queries/management-contract-hours";
import { getEmployeeOwnershipOverview } from "@/lib/queries/management-employee-ownership";
import { getManagementDataQuality } from "@/lib/queries/management-data-quality";
import { getManagementProjectRisks } from "@/lib/queries/management-project-risks";
import { getManagementMultiServiceMatrix } from "@/lib/queries/management-multi-service-matrix";
import { getManagementCustomerPortfolio } from "@/lib/queries/management-customer-portfolio";
import { getManagementChangeRequests } from "@/lib/queries/management-change-requests";
import { ManagementMatrix } from "./ManagementMatrix";

export default async function ManagementPage() {
  await requirePermission("/dashboard/management", PERMISSIONS.HR_CONTRACT_READ);
  const supabase = await createManagementReadClient();
  const [model, ownershipRows, dataQualityRows, projectRiskRows, multiServiceModel, customerPortfolio, peopleResult, changeRequests] = await Promise.all([
    getManagementContractHours(supabase),
    getEmployeeOwnershipOverview(supabase),
    getManagementDataQuality(supabase),
    getManagementProjectRisks(supabase),
    getManagementMultiServiceMatrix(supabase),
    getManagementCustomerPortfolio(supabase),
    supabase.from("people").select("id, name").eq("is_active", true).order("name"),
    getManagementChangeRequests(supabase),
  ]);

  return (
    <PageTransition>
      <div className="flex flex-col">
        <PageHeader title="Vertragsstunden" meta="MANAGEMENT · READ MODEL" />
        <main className="flex flex-col gap-4 p-4 sm:p-6">
          {model.projectCount === 0 ? (
            <Card><EmptyState title="Keine Vertragsstunden verfügbar" description="Das Read Model liefert aktuell keine sichtbaren Projekte aus public.projects." /></Card>
          ) : <ManagementMatrix model={model} ownershipRows={ownershipRows} dataQualityRows={dataQualityRows} projectRiskRows={projectRiskRows} multiServiceModel={multiServiceModel} customerPortfolio={customerPortfolio} people={(peopleResult.data ?? []).map((person) => ({ id: person.id, name: person.name }))} changeRequests={changeRequests} />}
        </main>
      </div>
    </PageTransition>
  );
}
