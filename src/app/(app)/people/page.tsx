import { SyncBar } from "@/components/SyncBar";
import { createClient } from "@/utils/supabase/server";
import { requireUser } from "@/utils/supabase/require-user";
import { getPeopleDirectory, getOrgChart } from "@/lib/queries/hse";
import { PeopleSection } from "./PeopleSection";
import PageTransition from "@/components/animations/PageTransition";

export default async function PeoplePage() {
  await requireUser("/people");
  const supabase = await createClient();
  const [people, orgChartNodes] = await Promise.all([
    getPeopleDirectory(supabase),
    getOrgChart(supabase),
  ]);

  return (
    <PageTransition>
      <div className="flex flex-col">
        <SyncBar />
        <PeopleSection people={people} orgChartNodes={orgChartNodes} />
      </div>
    </PageTransition>
  );
}
