"use client";

import { useTranslations } from "next-intl";
import { Card, CardHeader, ChartNote, StatTile } from "@/components/ui/Card";
import { ProportionBar } from "@/components/ui/Charts";
import { DrillChip, KICKER, Reason, SECTION_STYLE, CARD_WITH_DRILL } from "./bits";
import { fmt1, fmtBytes, fmtInt } from "./format";
import type { ConsumptionView } from "./view";

/**
 * Consumption: the eight largest relations against the rest as one
 * proportion bar (one hue stepped -- size is not a judgement) with its legend
 * as a three-column table under the bar, and the database size against its
 * documented budget with the growth rate from history when there is enough
 * of it to state one.
 */
export function ConsumptionPanel({ view, dbError }: { view: ConsumptionView | null; dbError: string | null }) {
  const t = useTranslations("systemHealth");

  if (!view) {
    return (
      <section data-section="consumption" style={SECTION_STYLE} className="grid gap-[var(--card-gap)]">
        <Card as="div" className={CARD_WITH_DRILL}>
          <CardHeader title={t("consumption.title")} qualifier={t("consumption.qualifier")} />
          <p className="px-4 pb-4"><Reason reason={dbError ?? t("dbUnreachable")} /></p>
        </Card>
      </section>
    );
  }

  const { relations, size, growth } = view;
  const usedPct = size.ok && size.budget.ok ? size.budget.usedPct : null;

  return (
    <section data-section="consumption" style={SECTION_STYLE} className="grid gap-[var(--card-gap)]">
      <Card as="div" className={CARD_WITH_DRILL}>
        <CardHeader
          title={t("consumption.title")}
          qualifier={relations.ok ? t("consumption.qualifierCount", { count: fmtInt(relations.count), total: fmtBytes(relations.totalBytes) }) : t("consumption.qualifier")}
          actions={relations.ok ? <DrillChip drill={relations.drill} id="consumption-relations" /> : undefined}
        />
        <div className="grid grid-cols-1 gap-5 px-4 pb-3 lg:grid-cols-[minmax(0,1fr)_18rem] lg:gap-8">
          <div className="min-w-0 pt-1">
            {relations.ok ? (
              <ProportionBar
                label={t("consumption.relationsLabel", { count: relations.segments.length })}
                segments={relations.segments}
                valueFormat={fmtBytes}
                height={18}
                legend="grid"
              />
            ) : (
              <Reason reason={relations.reason} />
            )}
          </div>
          <div className="flex flex-col gap-3">
            <StatTile
              data-metric="db-size"
              label={t("consumption.sizeLabel")}
              value={size.ok ? size.pretty : null}
              hint={
                size.ok
                  ? size.budget.ok
                    ? t("consumption.budgetHint", { budget: fmtBytes(size.budget.bytes), pct: fmt1(size.budget.usedPct), source: size.budget.source })
                    : `${t("na")} — ${size.budget.reason}`
                  : size.reason
              }
              tone={usedPct === null ? "neutral" : usedPct >= 80 ? "critical" : usedPct >= 50 ? "warning" : "good"}
              progressPercent={usedPct}
            />
            <div className="flex flex-col gap-1 px-1">
              <span className={KICKER}>{t("consumption.growthKicker")}</span>
              {growth.ok ? (
                <span className="font-mono text-[11px] tabular-nums text-[var(--text-primary)]">{growth.text}</span>
              ) : (
                <Reason reason={growth.reason} />
              )}
            </div>
          </div>
        </div>
        <ChartNote>{t("consumption.note")}</ChartNote>
      </Card>
    </section>
  );
}
