import { SyncBar } from "@/components/SyncBar";
import { createClient } from "@/utils/supabase/server";
import { requireProfile } from "@/utils/supabase/require-profile";
import { getPeopleDirectory, getOrgChart, getLeaveBalances, getBillableValues } from "@/lib/queries/hse";
import { PeopleSection } from "./PeopleSection";
import PageTransition from "@/components/animations/PageTransition";

export default async function PeoplePage() {
  const profile = await requireProfile("/people");
  const supabase = await createClient();

  const [people, orgChartNodes, leaveBalances, billableValues] = await Promise.all([
    getPeopleDirectory(supabase),
    getOrgChart(supabase),
    getLeaveBalances(supabase),
    getBillableValues(supabase),
  ]);

  return (
    <PageTransition>
      <div className="flex flex-col">
        <SyncBar />
        <PeopleSection
          people={people}
          orgChartNodes={orgChartNodes}
          leaveBalances={leaveBalances}
          billableValues={billableValues}
          viewerRole={profile.roleKey}
        />
      </div>
    </PageTransition>
  );
}
