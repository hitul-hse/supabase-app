"use client";

import { useLocale, useTranslations } from "next-intl";
import type { Locale } from "@/i18n/request";
import { Card, CardDivider, CardHeader, ChartNote } from "@/components/ui/Card";
import { HBar, Timeline, toneColor } from "@/components/ui/Charts";
import { DrillTrigger } from "@/components/DrillDialog";
import { DrillChip, FIGURE_TRIGGER, KICKER, Reason, SECTION_STYLE, CARD_WITH_DRILL } from "./bits";
import { fmtDay, fmtHours, fmtInt } from "./format";
import type { FreshnessView } from "./view";

/**
 * Data freshness: age against the SLA, thirty days of runs, the typed layer
 * each connector feeds, and the legacy sync table shown as a caveat.
 *
 * A connector that never ran is NOT drawn as a zero-length bar -- an absent
 * bar is honest, a zero bar says "just finished". It is listed under the
 * chart in words, with a tone dot rather than coloured text. The same for a
 * relation whose count could not be read.
 *
 * LAYOUT. The age chart and the 30-day timeline are the two half-width cards
 * and carry the same content height. The legacy caveat is a full-width strip
 * under the typed layer: it is the older, free-text claim about the same
 * connectors, and as a block in either half-width card it left the other one
 * half empty.
 */
export function FreshnessPanel({ view, dbError }: { view: FreshnessView | null; dbError: string | null }) {
  const t = useTranslations("systemHealth");
  const locale = useLocale() as Locale;

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
  const listGrid = "grid grid-cols-[minmax(0,7.5rem)_minmax(0,1fr)] items-baseline gap-x-3";

  return (
    <section data-section="freshness" style={SECTION_STYLE} className="grid grid-cols-1 gap-[var(--card-gap)] lg:grid-cols-2">
      {/* Age vs SLA + the legacy caveat */}
      <Card as="div" className={`flex flex-col ${CARD_WITH_DRILL}`}>
        <CardHeader title={t("freshness.title")} qualifier={t("freshness.qualifier")} />
        <div className="px-3 pb-3">
          <DrillTrigger drill={age.drill} id="freshness-age" className={`${FIGURE_TRIGGER} px-1 py-1`}>
            {age.rows.length > 0 ? (
              <HBar
                label={t("freshness.ageLabel")}
                rows={age.rows}
                limit={age.limit ?? undefined}
                valueFormat={(h) => fmtHours(h, locale)}
                thickness={10}
              />
            ) : (
              <span className="block py-2"><Reason reason={t("freshness.noBars")} /></span>
            )}
          </DrillTrigger>
          {age.listed.length > 0 && (
            <ul className="mt-1 flex flex-col gap-1.5 px-1">
              {age.listed.map((r) => (
                <li key={r.source} className={`${listGrid} py-[3px]`}>
                  <span className="truncate text-[12px] leading-[16px] text-[var(--text-secondary)]">{r.source}</span>
                  <span className="flex items-baseline gap-2 font-mono text-[10px] leading-[14px] text-[var(--text-muted)]">
                    <span aria-hidden className="h-2 w-2 shrink-0 translate-y-px rounded-full" style={{ background: toneColor(r.tone) }} />
                    <span>{r.text}</span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="mt-auto">
          <ChartNote>{age.note}</ChartNote>
        </div>
      </Card>

      {/* Sync runs, 30 days */}
      <Card as="div" className={`flex flex-col ${CARD_WITH_DRILL}`}>
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
                  tickFormat={(d) => fmtDay(d, locale)}
                  kindLabels={{ ok: t("freshness.runStatus.ok"), failed: t("freshness.runStatus.failed"), running: t("freshness.runStatus.running") }}
                />
              </div>
            </div>
          ) : (
            <Reason reason={runs.reason} />
          )}
          {runs.ok && runs.capped && <p className="mt-1"><Reason reason={t("freshness.runsCapped")} /></p>}
        </div>
        <div className="mt-auto">
          <ChartNote>{t("freshness.runsNote")}</ChartNote>
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
                thickness={10}
                labelWidth="wide"
              />
            ) : (
              <span className="block py-2"><Reason reason={t("freshness.noTyped")} /></span>
            )}
          </DrillTrigger>
          {typed.missing.length > 0 && (
            <ul className="mt-2 flex flex-col gap-1 px-1">
              {typed.missing.map((m) => (
                <li key={m.relation} className="grid grid-cols-1 items-baseline gap-x-3 text-[12px] leading-[16px] sm:grid-cols-[minmax(0,15rem)_minmax(0,1fr)]">
                  <span className="truncate text-[var(--text-secondary)]">{m.relation}</span>
                  <Reason reason={m.reason} />
                </li>
              ))}
            </ul>
          )}
        </div>
        <ChartNote>{t("freshness.typedNote")}</ChartNote>

        <CardDivider />
        <div className="flex flex-col gap-2 px-4 py-3">
          <span className={KICKER}>{t("freshness.legacyKicker")}</span>
          {legacy.ok ? (
            <ul className="flex flex-wrap gap-1.5">
              {legacy.rows.map((r) => (
                <li key={r.source} className="flex max-w-full items-baseline gap-1.5 rounded-[var(--radius-sm)] bg-[var(--warning-wash)] px-2 py-1 font-mono text-[10px] leading-[14px] text-[var(--text-muted)]">
                  <span className="text-[var(--text-primary)]">{r.source}</span>
                  <span className="truncate">
                    {r.status} · {r.freshness}
                    {r.message ? ` · ${r.message}` : ""}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <Reason reason={legacy.reason} />
          )}
          <p className="max-w-[72ch] text-[11px] leading-[15px] text-[var(--text-secondary)]">{t("freshness.legacyNote")}</p>
        </div>
      </Card>
    </section>
  );
}
