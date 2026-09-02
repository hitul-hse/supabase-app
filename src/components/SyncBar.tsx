import { getTranslations } from "next-intl/server";
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
 *
 * Wording comes from messages/{en,de}.json under `common.sync` -- this strip
 * sits on every page, so it is shared vocabulary rather than the Overview's.
 */
export async function SyncBar() {
  const supabase = await createClient();
  const freshness = await getSyncFreshness(supabase, "trackingtime");
  const t = await getTranslations("common.sync");

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
      /* --surface-2, not the hardcoded #0b0d0f this carried: a colour in no
         token and in no design doc, nearly black against a #2a3038 page, and
         the darkest surface anywhere in the app. */
      className="flex items-center gap-4 overflow-x-auto border-b border-[var(--border)] bg-[var(--surface-2)] px-4 py-1.5 font-mono text-[10px] sm:px-6 [&::-webkit-scrollbar]:hidden"
    >
      <span className="flex-none tracking-[0.12em] text-[var(--text-faint)]">{t("label")}</span>

      <span className={`flex flex-none items-center gap-1.5 ${textClass}`}>
        <span className="h-1.5 w-1.5 flex-none" style={{ background: colour }} />
        {t("trackingTime", { age: describeAge(t, freshness.hoursSince) })}
      </span>

      {freshness.inProgress ? (
        <span className="flex-none text-[var(--text-muted)]">{t("running")}</span>
      ) : null}

      {/*
        Surfaced separately rather than folded into the status dot. A run that
        failed after a recent success still shows a recent timestamp, and
        without this the strip would look healthy while the pipeline is broken.
      */}
      {freshness.failedSince > 0 ? (
        <span className="flex-none text-[var(--critical)]">
          {t("failedSince", { count: freshness.failedSince })}
        </span>
      ) : null}

      {freshness.recordCount !== null ? (
        <span className="hidden flex-none text-[var(--text-faint)] sm:inline">
          {t("rows", { count: freshness.recordCount.toLocaleString("de-DE") })}
        </span>
      ) : null}
    </div>
  );
}

/** The translator for the `common.sync` namespace, as SyncBar resolves it. */
type SyncTranslator = Awaited<ReturnType<typeof getTranslations<"common.sync">>>;

/**
 * Hours since the last success as something a human reads at a glance.
 *
 * Null means no successful run has EVER been recorded, which is a different
 * statement from "0h ago" and must not render as one.
 */
function describeAge(t: SyncTranslator, hoursSince: number | null): string {
  if (hoursSince === null) return t("neverRun");
  if (hoursSince < 1) return t("underOneHour");
  if (hoursSince < 48) return t("hoursAgo", { hours: hoursSince });
  return t("daysAgo", { days: Math.floor(hoursSince / 24) });
}
