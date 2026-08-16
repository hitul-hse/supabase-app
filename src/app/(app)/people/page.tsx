import { SyncBar } from "@/components/SyncBar";
import { createClient } from "@/utils/supabase/server";
import { requireUser } from "@/utils/supabase/require-user";
import { getPeopleDirectory, getOrgChart, getLeaveOverview } from "@/lib/queries/hse";
import { PeopleSection } from "./PeopleSection";
import PageTransition from "@/components/animations/PageTransition";

export default async function PeoplePage() {
  await requireUser("/people");
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const [people, orgChartNodes, leaveOverview, { data: profile }] = await Promise.all([
    getPeopleDirectory(supabase),
    getOrgChart(supabase),
    getLeaveOverview(supabase),
    supabase.from("app_user_profile").select("person_id").eq("user_id", user?.id ?? "").maybeSingle(),
  ]);

  return (
    <PageTransition>
      <div className="flex flex-col">
        <SyncBar />
        <PeopleSection
          people={people}
          orgChartNodes={orgChartNodes}
          leaveBalances={leaveOverview.balances}
          leaveRequestsByPerson={leaveOverview.requestsByPerson}
          currentPersonId={profile?.person_id ?? null}
        />
      </div>
    </PageTransition>
  );
}
