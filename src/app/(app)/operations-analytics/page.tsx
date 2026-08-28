import { redirect } from "next/navigation";
import { createClient } from "@/utils/supabase/server";
import { FactorialHoursPanel } from "@/components/factorial/factorial-hours-panel";
import { getFactorialHoursReport } from "@/lib/queries/factorial-hours";

export const metadata = {
  title: "Operations Analytics",
  description: "Factorial HR vs TrackingTime hours comparison",
};

export default async function OperationsAnalyticsPage() {
  const supabase = await createClient();

  // RLS check: calling any query will fail if user lacks access.
  // The page itself requires exec role (enforced in the gate check-factorial-hours-page.mjs).
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
