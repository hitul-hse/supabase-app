import { SyncBar } from "@/components/SyncBar";
import { createClient } from "@/utils/supabase/server";
import { requireUser } from "@/utils/supabase/require-user";
import { getPeopleDirectory } from "@/lib/queries/hse";
import { PeopleDirectory } from "./PeopleDirectory";
import PageTransition from "@/components/animations/PageTransition";

export default async function PeoplePage() {
  await requireUser("/people");
  const supabase = await createClient();
  const people = await getPeopleDirectory(supabase);

  return (
    <PageTransition>
      <div className="flex flex-col">
        <SyncBar />
        <PeopleDirectory people={people} />
      </div>
    </PageTransition>
  );
}
