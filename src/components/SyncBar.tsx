import { createClient } from "@/utils/supabase/server";
import { getSyncFreshness } from "@/lib/queries/time-dashboard";

/**
 * The freshness strip at the top of every Hub page.
 *
 * WHAT THIS USED TO DO, AND WHY IT WAS WORSE THAN NOTHING
 * ------------------------------------------------------
 * It read `public.sync_sources`, a seeded table holding five hardcoded rows:
 * "ASANA 4m ok", "TRACKINGTIME 4m ok", "FACTORIAL 18m ok", "SAMDOCK 2h RETRY",
 * "HUBSPOT 11m ok". Those strings were written once for a mockup and never
 * changed again. Four of those five pipelines have never run at all, and the
 * "4m" was frozen in the database -- it read "4m" whether the last import was
 * four minutes or four months ago.
 *
 * That is an active lie in the most trusted position on the page. A staleness
 * indicator that cannot go stale is worse than having none: it converts "I
 * don't know how fresh this is" into "I have checked, and it is fresh".
 *
 * WHAT IT DOES NOW
 * ----------------
 * Reads `raw.sync_run` through getSyncFreshness() -- the same read behind the
 * TrackingTime dashboard's banner, so the two can never disagree. It reports
 * the last SUCCESSFUL run, counts failures since it separately (a cron failing
 * nightly behind an old green row is the exact case this must not show as
 * healthy), and it degrades to "NEVER RUN" rather than inventing a duration.
 *
 * Only TrackingTime is listed, because TrackingTime is the only pipeline that
 * exists. When Factorial or Asana genuinely land, they get a row here and a
 * `raw.sync_run` source string to go with it.
 */
export async function SyncBar() {
  const supabase = await createClient();
  const freshness = await getSyncFreshness(supabase, "trackingtime");

  const colour =
    freshness.status === "ok"
      ? "var(--accent)"
      : freshness.status === "stale"
        ? "var(--warning)"
        : "var(--critical)";

  const textClass =
    freshness.status === "ok"
      ? "text-[var(--text-secondary)]"
      : freshness.status === "stale"
        ? "text-[var(--warning)]"
        : "text-[var(--critical)]";

  return (
    <div
      data-tour="tour-sync"
      data-sync-status={freshness.status}
      className="flex items-center gap-4 overflow-x-auto border-b border-[var(--border)] bg-[#0b0d0f] px-4 py-2 font-mono text-[11px] sm:px-6 [&::-webkit-scrollbar]:hidden"
    >
      <span className="flex-none tracking-[0.12em] text-[var(--text-faint)]">SYNC</span>

      <span className={`flex flex-none items-center gap-1.5 ${textClass}`}>
        <span className="h-1.5 w-1.5 flex-none" style={{ background: colour }} />
        TRACKINGTIME {describeAge(freshness.hoursSince)}
      </span>

      {freshness.inProgress ? (
        <span className="flex-none text-[var(--text-muted)]">SYNC RUNNING</span>
      ) : null}

      {/*
        Surfaced separately rather than folded into the status dot. A run that
        failed after a recent success still shows a recent timestamp, and
        without this the strip would look healthy while the pipeline is broken.
      */}
      {freshness.failedSince > 0 ? (
        <span className="flex-none text-[var(--critical)]">
          {freshness.failedSince} FAILED SINCE
        </span>
      ) : null}

      {freshness.recordCount !== null ? (
        <span className="hidden flex-none text-[var(--text-faint)] sm:inline">
          {freshness.recordCount.toLocaleString("de-DE")} ROWS
        </span>
      ) : null}
    </div>
  );
}

/**
 * Hours since the last success as something a human reads at a glance.
 *
 * Null means no successful run has EVER been recorded, which is a different
 * statement from "0h ago" and must not render as one.
 */
function describeAge(hoursSince: number | null): string {
  if (hoursSince === null) return "NEVER RUN";
  if (hoursSince < 1) return "< 1H AGO";
  if (hoursSince < 48) return `${hoursSince}H AGO`;
  return `${Math.floor(hoursSince / 24)}D AGO`;
}
