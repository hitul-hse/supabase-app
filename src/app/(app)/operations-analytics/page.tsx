import { requirePermission } from "@/utils/supabase/require-profile";
import { PERMISSIONS } from "@/lib/permissions";
import { createClient } from "@/utils/supabase/server";
import { FactorialHoursPanel } from "@/components/factorial/factorial-hours-panel";
import { getFactorialHoursReport } from "@/lib/queries/factorial-hours";

export const metadata = {
  title: "Operations Analytics",
  description: "Factorial HR vs TrackingTime hours comparison",
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
  try {
    const report = await getFactorialHoursReport(supabase);
    return (
      <div className="space-y-6 p-6">
        <div>
          <h1 className="text-3xl font-bold">Operations Analytics</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Factorial HR presence (90-day window) vs TrackingTime logged hours.
          </p>
        </div>
        <FactorialHoursPanel report={report} />
      </div>
    );
  } catch (error) {
    return (
      <div className="space-y-6 p-6">
        <div>
          <h1 className="text-3xl font-bold">Operations Analytics</h1>
          <p className="mt-2 text-sm text-muted-foreground">Error loading report.</p>
        </div>
        <div className="rounded-lg border border-destructive bg-destructive/10 p-4">
          <pre className="text-sm">{error instanceof Error ? error.message : String(error)}</pre>
        </div>
      </div>
    );
  }
}
