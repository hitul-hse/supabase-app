import { PageHeader } from "@/components/PageHeader";
import PageTransition from "@/components/animations/PageTransition";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/EmptyState";
import { requirePermission } from "@/utils/supabase/require-profile";
import { PERMISSIONS } from "@/lib/permissions";
import { createClient } from "@/utils/supabase/server";
import { FactorialHoursPanel } from "@/components/factorial/factorial-hours-panel";
import { getFactorialHoursReport } from "@/lib/queries/factorial-hours";

export const metadata = {
  title: "Operations Analytics",
  description: "Factorial HR presence vs TrackingTime hours",
};

export default async function OperationsAnalyticsPage() {
  /*
   * HARD PERMISSION GATE — not just RLS. The TrackingTime figures on this page
   * are RLS-scoped, but the Factorial presence data is fetched with the server's
   * API key, which RLS never sees. Without this line, any signed-in colleague
   * could read everyone's clock-in hours. HR_CONTRACT_READ is the same key that
   * gates /dashboard/management (contract hours per person), which is the same
   * sensitivity class: per-person working-time data.
   */
  await requirePermission("/operations-analytics", PERMISSIONS.HR_CONTRACT_READ);

  const supabase = await createClient();

  /*
   * Fetch inside try, render OUTSIDE it. React renders lazily, so a rendering
   * error thrown by the panel would not be caught here anyway — only the data
   * fetch can actually fail in this block, and that is the only thing caught.
   * A thrown error here means the TRACKINGTIME side failed; Factorial failures
   * are caught inside the query and reported inline on the panel.
   */
  let report: Awaited<ReturnType<typeof getFactorialHoursReport>> | null = null;
  let loadError: string | null = null;
  try {
    report = await getFactorialHoursReport(supabase);
  } catch (error) {
    loadError = error instanceof Error ? error.message : String(error);
  }

  const content = report ? (
    <FactorialHoursPanel report={report} />
  ) : (
    <Card>
      <EmptyState title="Report unavailable" description={loadError ?? "Unknown failure"} />
    </Card>
  );

  return (
    <PageTransition>
      <div className="flex flex-col">
        <PageHeader
          title="Operations Analytics"
          meta="FACTORIAL PRESENCE · TRACKINGTIME HOURS · 90 DAYS"
        />
        <main className="flex flex-col gap-4 page-shell">{content}</main>
      </div>
    </PageTransition>
  );
}
