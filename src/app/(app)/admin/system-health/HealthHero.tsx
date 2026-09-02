"use client";

import { useTranslations } from "next-intl";
import { Card, CardHeader } from "@/components/ui/Card";
import { Gauge, Meter } from "@/components/ui/Charts";
import { DrillTrigger } from "@/components/DrillDialog";
import { FIGURE_TRIGGER, Reason, SECTION_STYLE } from "./bits";
import type { HeroView } from "./view";

/**
 * The hero: the composite as a gauge, the four sub-scores as meters. The one
 * `tone="hero"` card on the page.
 *
 * HIERARCHY. The composite is the loudest thing on the page -- a 48px
 * proportional figure inside the arc -- and the one sentence under it says
 * which sub-score is holding it down. The meters are the second read: label
 * in sentence case, weight as a muted qualifier, score right-aligned on
 * tabular digits so the four numbers line up as a column.
 *
 * The gauge and every meter are drill triggers. The drills' rows sum to the
 * number shown (see drills.ts), which is the whole point of showing a score:
 * a 63 that cannot be taken apart is an opinion.
 */
export function HealthHero({ hero }: { hero: HeroView }) {
  const t = useTranslations("systemHealth");
  const { composite, subs, status, compositeDrill, labels } = hero;

  return (
    <Card tone="hero" as="section" data-section="score" style={SECTION_STYLE} aria-label={t("hero.title")}>
      <CardHeader title={t("hero.title")} qualifier={t("hero.qualifier")} />
      <div className="grid grid-cols-1 gap-6 px-4 pb-5 sm:grid-cols-[auto_minmax(0,1fr)] sm:items-center sm:gap-10 sm:px-6">
        <DrillTrigger drill={compositeDrill} id="score-composite" className={`${FIGURE_TRIGGER} sm:w-auto`}>
          <div className="flex flex-col items-center gap-3 px-2 py-2" data-metric="composite-score">
            {composite.ok ? (
              <Gauge
                figure="hero"
                value={composite.score}
                max={100}
                tone={composite.tone}
                centreLabel={labels.composite}
                label={t("hero.gaugeLabel", { score: composite.score })}
                width={184}
              />
            ) : (
              <Gauge
                figure="hero"
                value={0}
                max={100}
                tone="neutral"
                centre={labels.na}
                unit=""
                centreLabel={labels.composite}
                label={t("hero.gaugeNa")}
                width={184}
              />
            )}
            {composite.ok ? (
              <p className="max-w-[17rem] text-center text-[12px] leading-[17px] text-[var(--text-secondary)]">{status}</p>
            ) : (
              <span className="max-w-[18rem] text-center"><Reason reason={composite.reason} /></span>
            )}
          </div>
        </DrillTrigger>

        <div className="grid grid-cols-1 gap-x-10 gap-y-4 sm:grid-cols-2">
          {subs.map((s) => (
            <DrillTrigger key={s.key} drill={s.drill} id={`score-${s.key}`} className={`${FIGURE_TRIGGER} px-2 py-1.5`} data-metric={`score-${s.key}`}>
              <Meter
                label={s.label}
                qualifier={`· ${s.weight}`}
                value={s.score ?? 0}
                max={100}
                tone={s.tone}
                caption={s.caption}
              />
              {s.reason && (
                <span className="mt-1 block truncate" title={s.reason}>
                  <Reason reason={s.reason} />
                </span>
              )}
            </DrillTrigger>
          ))}
        </div>
      </div>
    </Card>
  );
}
