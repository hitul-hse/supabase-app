"use client";

import { useTranslations } from "next-intl";
import { Card, CardDivider, CardHeader, ChartNote } from "@/components/ui/Card";
import { Gauge, HBar, ProportionBar, Sparkline, toneColor } from "@/components/ui/Charts";
import { DrillTrigger } from "@/components/DrillDialog";
import { BIG, DrillChip, FIGURE_TRIGGER, KICKER, Reason, SECTION_STYLE, CARD_WITH_DRILL } from "./bits";
import { fmt1, fmtInt, fmtMs, fmtTime } from "./format";
import type { EfficiencyView } from "./view";

/**
 * Processing efficiency: two gauges (cache hit, connections), the commit /
 * rollback split, the DB round trip with its history, and the heaviest
 * statements ranked. Gate runs and request timings are shown as their
 * reasons -- they are n/a today and hiding them would suggest they exist.
 */
export function EfficiencyPanel({ view, dbError }: { view: EfficiencyView | null; dbError: string | null }) {
  const t = useTranslations("systemHealth");

  if (!view) {
    return (
      <section data-section="efficiency" style={SECTION_STYLE} className="grid gap-[var(--card-gap)]">
        <Card as="div" className={CARD_WITH_DRILL}>
          <CardHeader title={t("efficiency.title")} qualifier={t("efficiency.qualifier")} />
          <p className="px-4 pb-4"><Reason reason={dbError ?? t("dbUnreachable")} /></p>
        </Card>
      </section>
    );
  }

  const { cache, connections, xact, statements, latency, gateRuns, requestTimings, statsReset } = view;

  return (
    <section data-section="efficiency" style={SECTION_STYLE} className="grid grid-cols-1 gap-[var(--card-gap)] lg:grid-cols-2">
      <Card as="div" className={CARD_WITH_DRILL}>
        <CardHeader title={t("efficiency.title")} qualifier={t("efficiency.qualifier")} />
        <div className="grid grid-cols-2 gap-x-2 gap-y-4 px-4 pb-4 sm:grid-cols-3">
          {/* Cache hit */}
          <div className="flex flex-col items-center gap-1">
            {cache.ok ? (
              <DrillTrigger drill={cache.drill} id="efficiency-cache" className={`${FIGURE_TRIGGER} flex justify-center py-1`}>
                <Gauge value={cache.pct} max={100} tone={cache.tone} centre={fmt1(cache.pct)} centreLabel={t("efficiency.cacheHit")} label={t("efficiency.cacheLabel", { pct: fmt1(cache.pct) })} width={112} />
              </DrillTrigger>
            ) : (
              <div className="flex flex-col items-center gap-1 py-1">
                <span className={KICKER}>{t("efficiency.cacheHit")}</span>
                <Reason reason={cache.reason} className="text-center" />
              </div>
            )}
          </div>
          {/* Connections */}
          <div className="flex flex-col items-center gap-1">
            {connections.ok ? (
              <DrillTrigger drill={connections.drill} id="efficiency-connections" className={`${FIGURE_TRIGGER} flex justify-center py-1`}>
                <Gauge value={connections.active} max={connections.max} tone={connections.tone} centreLabel={t("efficiency.connections")} label={t("efficiency.connLabel", { active: connections.active, max: connections.max })} width={112} />
              </DrillTrigger>
            ) : (
              <div className="flex flex-col items-center gap-1 py-1">
                <span className={KICKER}>{t("efficiency.connections")}</span>
                <Reason reason={connections.reason} className="text-center" />
              </div>
            )}
          </div>
          {/* DB round trip: live value + sparkline of history */}
          <div className="col-span-2 flex flex-col gap-1.5 sm:col-span-1" data-metric="db-latency" data-stat-tile>
            <span className={KICKER}>{t("efficiency.latency")}</span>
            {latency.live.ok ? (
              <span className="flex items-baseline gap-1">
                <span className={BIG} style={{ color: latency.live.tone === "critical" ? "var(--critical)" : "var(--text-primary)" }}>{fmt1(latency.live.ms)}</span>
                <span className="font-mono text-[11px] text-[var(--text-muted)]">ms</span>
              </span>
            ) : (
              <Reason reason={latency.live.reason} />
            )}
            {latency.spark.ok ? (
              <Sparkline points={latency.spark.points} label={t("efficiency.sparkLabel", { count: latency.spark.points.length })} width={120} height={32} color={toneColor(latency.live.ok ? latency.live.tone : "neutral")} />
            ) : (
              <Reason reason={latency.spark.reason} />
            )}
            <span className="font-mono text-[10px] leading-snug text-[var(--text-faint)]">{t("efficiency.latencyHint")}</span>
          </div>
        </div>

        {/* Commits vs rollbacks */}
        <div className="flex items-baseline justify-between gap-3 px-4">
          <span className={KICKER}>{t("efficiency.xactKicker")}</span>
          {xact.ok && <DrillChip drill={xact.drill} id="efficiency-xact" />}
        </div>
        <div className="px-4 pb-3 pt-2">
          {xact.ok ? (
            <ProportionBar
              label={t("efficiency.xactLabel", { commits: fmtInt(xact.commits), rollbacks: fmtInt(xact.rollbacks) })}
              valueFormat={fmtInt}
              segments={[
                { key: "commit", label: t("drills.commits"), value: xact.commits, color: "var(--accent)" },
                { key: "rollback", label: t("drills.rollbacks"), value: xact.rollbacks, color: "var(--critical)" },
              ]}
            />
          ) : (
            <Reason reason={xact.reason} />
          )}
        </div>
        <ChartNote>
          {statsReset ? t("efficiency.statsNote", { at: fmtTime(statsReset) }) : t("efficiency.statsNoteNoReset")}
        </ChartNote>

        <CardDivider />
        {/* Not measured today; shown so nobody assumes they are. */}
        <div className="grid grid-cols-1 gap-x-6 gap-y-2 px-4 py-3 sm:grid-cols-2">
          <div className="flex flex-col gap-0.5">
            <span className={KICKER}>{t("efficiency.gateRuns")}</span>
            <Reason reason={gateRuns} />
          </div>
          <div className="flex flex-col gap-0.5">
            <span className={KICKER}>{t("efficiency.requestTimings")}</span>
            <Reason reason={requestTimings} />
          </div>
        </div>
      </Card>

      <Card as="div" className={CARD_WITH_DRILL}>
        <CardHeader
          title={t("efficiency.statementsTitle")}
          qualifier={statements.ok ? t("efficiency.statementsQualifier", { total: fmtMs(statements.totalMs) }) : t("efficiency.statementsQualifierNa")}
          actions={statements.ok ? <DrillChip drill={statements.drill} id="efficiency-statements" label={t("efficiency.showAll", { count: statements.count })} /> : undefined}
        />
        <div className="px-4 pb-3">
          {statements.ok ? (
            <HBar label={t("efficiency.statementsLabel")} rows={statements.top} valueFormat={fmtMs} thickness={10} />
          ) : (
            <Reason reason={statements.reason} />
          )}
        </div>
        <ChartNote>{t("efficiency.statementsNote")}</ChartNote>
      </Card>
    </section>
  );
}
