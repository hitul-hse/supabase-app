import { createClient } from "@/utils/supabase/server";
import { getRunningTimer } from "@/lib/queries/hse";
import { TimerBar } from "@/components/TimerBar";

/**
 * Server half of the timer strip: resolves the signed-in person and their
 * running timer, then hands the state to the client bar.
 *
 * Rendered for every app page, so it stays silent when there's nothing to
 * show -- signed out, or an account with no linked person record can't log
 * time and shouldn't be shown a control that would always fail.
 */
export async function TimerBarSlot() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: profile } = await supabase
    .from("app_user_profile")
    .select("person_id")
    .eq("user_id", user.id)
    .maybeSingle();

  if (!profile?.person_id) return null;

  const running = await getRunningTimer(supabase, profile.person_id);
  return <TimerBar running={running} />;
}
