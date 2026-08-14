import { SyncBar } from "@/components/SyncBar";
import { createClient } from "@/utils/supabase/server";
import { getPeopleDirectory } from "@/lib/queries/hse";
import { PeopleDirectory } from "./PeopleDirectory";

export default async function PeoplePage() {
  const supabase = await createClient();
  const people = await getPeopleDirectory(supabase);

  return (
    <div className="flex flex-col">
      <SyncBar />
      <PeopleDirectory people={people} />
    </div>
  );
}
