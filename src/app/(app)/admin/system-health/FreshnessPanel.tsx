"use client";

import { useTranslations } from "next-intl";
import { Card, CardDivider, CardHeader, ChartNote } from "@/components/ui/Card";
import { HBar, Timeline, toneColor } from "@/components/ui/Charts";
import { DrillTrigger } from "@/components/DrillDialog";
import { DrillChip, FIGURE_TRIGGER, KICKER, Reason, SECTION_STYLE, CARD_WITH_DRILL } from "./bits";
import { fmtHours, fmtInt } from "./format";
import type { FreshnessView } from "./view";

/**
 * Data freshness: age against the SLA, thirty days of runs, the typed layer
 * each connector feeds, and the legacy sync table shown as a caveat.
 *
 * A connector that never ran is NOT drawn as a zero-length bar -- an absent
 * bar is honest, a zero bar says "just finished". It is listed under the
 * chart in words. The same for a relation whose count could not be read.
 */
export function FreshnessPanel({ view, dbError }: { view: FreshnessView | null; dbError: string | null }) {
  const t = useTranslations("systemHealth");

  if (!view) {
    return (
      <section data-section="freshness" style={SECTION_STYLE} className="grid gap-[var(--card-gap)]">
        <Card as="div" className={CARD_WITH_DRILL}>
          <CardHeader title={t("freshness.title")} qualifier={t("freshness.qualifier")} />
          <p className="px-4 pb-4"><Reason reason={dbError ?? t("dbUnreachable")} /></p>
        </Card>
      </section>
    );
  }

  const { age, runs, runsDrill, typed, legacy } = view;

  return (
    <section data-section="freshness" style={SECTION_STYLE} className="grid grid-cols-1 gap-[var(--card-gap)] lg:grid-cols-2">
      {/* Age vs SLA */}
      <Card as="div" className={CARD_WITH_DRILL}>
        <CardHeader title={t("freshness.title")} qualifier={t("freshness.qualifier")} />
        <div className="px-3 pb-3">
          <DrillTrigger drill={age.drill} id="freshness-age" className={`${FIGURE_TRIGGER} px-1 py-1`}>
            {age.rows.length > 0 ? (
              <HBar
                label={t("freshness.ageLabel")}
                rows={age.rows}
                limit={age.limit ?? undefined}
                valueFormat={fmtHours}
                thickness={10}
              />
            ) : (
              <span className="block py-2"><Reason reason={t("freshness.noBars")} /></span>
            )}
          </DrillTrigger>
          {age.listed.length > 0 && (
            <ul className="mt-2 flex flex-col gap-1 px-1">
              {age.listed.map((r) => (
                <li key={r.source} className="grid grid-cols-[minmax(0,7.5rem)_minmax(0,1fr)] items-baseline gap-x-3 text-[12px] leading-[16px]">
                  <span className="truncate text-[var(--text-secondary)]">{r.source}</span>
                  <span className="font-mono text-[10px] leading-snug" style={{ color: toneColor(r.tone) }}>{r.text}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
        <ChartNote>{age.note}</ChartNote>
      </Card>

      {/* Sync runs, 30 days + legacy caveat */}
      <Card as="div" className={CARD_WITH_DRILL}>
        <CardHeader
          title={t("freshness.runsTitle")}
          qualifier={runs.ok ? t("freshness.runsQualifier", { count: fmtInt(runs.count) }) : t("freshness.runsQualifierNa")}
          actions={runsDrill ? <DrillChip drill={runsDrill} id="freshness-runs" /> : undefined}
        />
        <div className="px-4 pb-3">
          {runs.ok ? (
            // The lanes need ~400px to keep day slots apart (a half-width card
            // at 1280 has ~468px); on a phone the figure scrolls inside the
            // card rather than the page overflowing.
            <div className="overflow-x-auto">
              <div className="min-w-[400px]">
                <Timeline
                  label={t("freshness.runsLabel")}
                  lanes={runs.lanes}
                  events={runs.events}
                  from={runs.from}
                  to={runs.to}
                />
              </div>
            </div>
          ) : (
            <Reason reason={runs.reason} />
          )}
          {runs.ok && runs.capped && <p className="mt-1"><Reason reason={t("freshness.runsCapped")} /></p>}
        </div>

        <CardDivider />
        <div className="px-4 py-3">
          <span className={KICKER}>{t("freshness.legacyKicker")}</span>
          <div className="mt-2 border-l-2 border-[var(--warning)] pl-3">
            {legacy.ok ? (
              <ul className="flex flex-col gap-0.5">
                {legacy.rows.map((r) => (
                  <li key={r.source} className="font-mono text-[10px] leading-snug text-[var(--text-muted)]">
                    <span className="text-[var(--text-primary)]">{r.source}</span> · {r.status} · {r.freshness}
                    {r.message ? ` · ${r.message}` : ""}
                  </li>
                ))}
              </ul>
            ) : (
              <Reason reason={legacy.reason} />
            )}
            <p className="mt-1.5 font-mono text-[10px] leading-snug text-[var(--warning)]">{t("freshness.legacyNote")}</p>
          </div>
        </div>
      </Card>

      {/* Typed layer, grouped by source */}
      <Card as="div" className={`lg:col-span-2 ${CARD_WITH_DRILL}`}>
        <CardHeader title={t("freshness.typedTitle")} qualifier={t("freshness.typedQualifier")} />
        <div className="px-3 pb-3">
          <DrillTrigger drill={typed.drill} id="freshness-typed" className={`${FIGURE_TRIGGER} px-1 py-1`}>
            {typed.rows.length > 0 ? (
              <HBar
                label={t("freshness.typedLabel")}
                rows={typed.rows}
                groupOrder={typed.groupOrder}
                valueFormat={fmtInt}
                thickness={8}
              />
            ) : (
              <span className="block py-2"><Reason reason={t("freshness.noTyped")} /></span>
            )}
          </DrillTrigger>
          {typed.missing.length > 0 && (
            <ul className="mt-2 flex flex-col gap-1 px-1">
              {typed.missing.map((m) => (
                <li key={m.relation} className="grid grid-cols-[minmax(0,7.5rem)_minmax(0,1fr)] items-baseline gap-x-3 text-[12px] leading-[16px]">
                  <span className="truncate text-[var(--text-secondary)]">{m.relation}</span>
                  <Reason reason={m.reason} />
                </li>
              ))}
            </ul>
          )}
        </div>
        <ChartNote>{t("freshness.typedNote")}</ChartNote>
      </Card>
    </section>
  );
}
