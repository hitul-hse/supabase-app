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
      <div className="flex flex-col gap-5 px-4 pb-4 sm:flex-row sm:items-center sm:gap-8">
        <DrillTrigger drill={compositeDrill} id="score-composite" className={`${FIGURE_TRIGGER} sm:w-auto`}>
          <div className="flex flex-col items-center gap-2 py-1" data-metric="composite-score">
            {composite.ok ? (
              <Gauge
                value={composite.score}
                max={100}
                tone={composite.tone}
                centreLabel={labels.composite}
                label={t("hero.gaugeLabel", { score: composite.score })}
                width={140}
              />
            ) : (
              <Gauge value={0} max={100} tone="neutral" centre={labels.na} centreLabel={labels.composite} label={t("hero.gaugeNa")} width={140} />
            )}
            {composite.ok ? (
              <span className="max-w-[16rem] text-center font-mono text-[10px] leading-snug text-[var(--text-muted)]">{status}</span>
            ) : (
              <span className="max-w-[18rem] text-center"><Reason reason={composite.reason} /></span>
            )}
          </div>
        </DrillTrigger>

        <div className="grid flex-1 grid-cols-1 gap-x-8 gap-y-3 sm:grid-cols-2">
          {subs.map((s) => (
            <DrillTrigger key={s.key} drill={s.drill} id={`score-${s.key}`} className={`${FIGURE_TRIGGER} px-1 py-1`} data-metric={`score-${s.key}`}>
              <Meter
                label={`${s.label} · ${s.weight}`}
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
