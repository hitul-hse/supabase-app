import { SyncBar } from "@/components/SyncBar";
import { createClient } from "@/utils/supabase/server";
import { getTeamLeadBoard } from "@/lib/queries/hse";
import { TeamLeadBoard } from "./TeamLeadBoard";

export default async function TeamLeadPage() {
  const supabase = await createClient();
  const { bookings, decisions } = await getTeamLeadBoard(supabase);

  return (
    <div className="flex flex-col">
      <SyncBar />
      <TeamLeadBoard bookings={bookings} initialDecisions={decisions} />
    </div>
  );
}
