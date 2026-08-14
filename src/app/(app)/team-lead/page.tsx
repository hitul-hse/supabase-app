import { SyncBar } from "@/components/SyncBar";
import { createClient } from "@/utils/supabase/server";
import { requireProfile } from "@/utils/supabase/require-profile";
import { getTeamLeadBoard } from "@/lib/queries/hse";
import { TeamLeadBoard } from "./TeamLeadBoard";

export default async function TeamLeadPage() {
  await requireProfile("/team-lead", ["exec", "dept_head"]);
  const supabase = await createClient();
  const { bookings, decisions, weeks } = await getTeamLeadBoard(supabase);

  return (
    <div className="flex flex-col">
      <SyncBar />
      <TeamLeadBoard bookings={bookings} initialDecisions={decisions} weeks={weeks} />
    </div>
  );
}
