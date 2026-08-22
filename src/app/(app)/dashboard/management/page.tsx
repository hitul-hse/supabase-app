import { PageHeader } from "@/components/PageHeader";
import PageTransition from "@/components/animations/PageTransition";
import { EmptyState } from "@/components/EmptyState";
import { Card } from "@/components/ui/Card";
import { createClient } from "@/utils/supabase/server";
import { requirePermission } from "@/utils/supabase/require-profile";
import { PERMISSIONS } from "@/lib/permissions";
import { getManagementContractHours } from "@/lib/queries/management-contract-hours";
import { getEmployeeOwnershipOverview } from "@/lib/queries/management-employee-ownership";
import { getManagementDataQuality } from "@/lib/queries/management-data-quality";
import { getManagementProjectRisks } from "@/lib/queries/management-project-risks";
import { ManagementMatrix } from "./ManagementMatrix";

export default async function ManagementPage() {
  await requirePermission("/dashboard/management", PERMISSIONS.HR_CONTRACT_READ);
  const supabase = await createClient();
  const [model, ownershipRows, dataQualityRows, projectRiskRows] = await Promise.all([
    getManagementContractHours(supabase),
    getEmployeeOwnershipOverview(supabase),
    getManagementDataQuality(supabase),
    getManagementProjectRisks(supabase),
  ]);

  return (
    <PageTransition>
      <div className="flex flex-col">
        <PageHeader title="Vertragsstunden" meta="MANAGEMENT · READ MODEL" />
        <main className="flex flex-col gap-4 p-4 sm:p-6">
          {model.projectCount === 0 ? (
            <Card><EmptyState title="Keine Vertragsstunden verfügbar" description="Das Read Model liefert aktuell keine sichtbaren Projekte aus public.projects." /></Card>
          ) : <ManagementMatrix model={model} ownershipRows={ownershipRows} dataQualityRows={dataQualityRows} projectRiskRows={projectRiskRows} />}
        </main>
      </div>
    </PageTransition>
  );
}
