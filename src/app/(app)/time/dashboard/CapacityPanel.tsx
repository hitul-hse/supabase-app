"use client";

/**
 * Capacity to take on work — who is free to pick up a project or cover a
 * holiday. Answers the planning question the "when the work happens" heatmap
 * could not: not WHEN people work, but WHO has room right now.
 *
 * Two reads in one card:
 *   TOP — the people with spare capacity, most-free first, as a "who can take
 *         this on" shortlist (the holiday-cover / load-balancing answer).
 *   BELOW — every person's logged load against nominal, busiest first, as bars
 *         so overload and slack are both visible at a glance.
 *
 * Framed as LOGGED LOAD, not idleness: consultancy weeks carry unlogged office
 * work, so low tracked hours mean "room on tracked project work", a planning
 * signal, not "doing nothing". The card says so rather than letting the bar
 * imply a verdict. All of it derives from the same filtered entries the rest of
 * the dashboard uses (time-insights.ts capacityByMember), so picking a service
 * or customer above answers "who has room on THIS kind of work".
 */

import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Card, CardHeader } from "@/components/ui/Card";
import { LegendDot } from "@/components/ui/Charts";
import { DrillDialog, type Drill } from "@/components/DrillDialog";
import type { CapacityView, CapacityRow } from "@/lib/queries/time-insights";
import { secondsToHours } from "@/lib/time-transform";
import { fmtHours, fmtPct } from "@/lib/locale-format";
import type { DrillDatum } from "./drill-data";

/**
 * Band -> colour. The COLOUR is a judgement about the number and never changes
 * with the language; the WORD beside it does, so it lives in the catalogue under
 * `timeDashboard.capacity.band.*` keyed by the same band name.
 */
const BAND_COLOUR: Record<CapacityRow["band"], string> = {
  over: "var(--critical)",
  full: "var(--warning)",
  steady: "var(--accent)",
  light: "var(--good)",
  open: "var(--good)",
};

export function CapacityPanel({
  data,
  projectsByMember,
}: {
  data: CapacityView;
  /**
   * Each person's hours by project, keyed by member id, folded by the page
   * from the SAME entries `data` came from. When present, every load bar
   * opens the answer to "what are they spending that time on" in place.
   */
  projectsByMember?: Record<string, DrillDatum[]>;
}) {
  const { rows, weeks, available } = data;
  const t = useTranslations("drill");
  const c = useTranslations("timeDashboard.capacity");
  const locale = useLocale();
  const [drill, setDrill] = useState<Drill | null>(null);
  const h = (n: number) => fmtHours(n, locale);
  const pct = (n: number) => fmtPct(n, locale);
  const band = (b: CapacityRow["band"]) => c(`band.${b}`);

  const openPerson = (r: CapacityRow) => {
    const projects = projectsByMember?.[String(r.memberId)] ?? [];
    setDrill({
      kicker: c("drillKicker", { percent: pct(r.loadPercent), band: band(r.band) }),
      title: t("time.personProjects.title", { name: r.name }),
      headline: h(r.trackedHours),
      headlineValue: r.trackedHours,
      check: "sum",
      subline:
        r.billablePercent === null
          ? c("drillSubPlain", { nominal: h(r.nominalHours) })
          : c("drillSub", {
              share: t("billableShare", { percent: r.billablePercent }),
              nominal: h(r.nominalHours),
            }),
      rows: projects.map((d) => ({
        name: d.name ?? t("noProject"),
        sub: d.sub ?? undefined,
        value: `${h(secondsToHours(d.seconds))} · ${t("entries", { count: d.entries })}`,
        magnitude: d.seconds / 3600,
        tone: d.name === null ? "muted" : "accent",
      })),
      footer: t("time.personProjects.footer"),
    });
  };

  if (rows.length === 0) {
    return (
      <Card className="flex flex-col lg:col-span-12">
        <CardHeader title={c("title")} qualifier={c("qualifierEmpty")} />
        <p className="px-4 pb-5 text-[12px] text-[var(--text-faint)]">{c("empty")}</p>
      </Card>
    );
  }

  const maxLoad = Math.max(100, ...rows.map((r) => r.loadPercent));

  return (
    <Card className="flex flex-col lg:col-span-12">
      <CardHeader
        title={c("title")}
        // ICU formats the week count itself, so "4.3 WEEKS" becomes "4,3 WOCHEN"
        // without a second rounding rule living here.
        qualifier={c("qualifier", { weeks: weeks % 1 === 0 ? weeks : Number(weeks.toFixed(1)) })}
        actions={
          <div className="flex flex-wrap items-center gap-3">
            <LegendDot color="var(--good)">{c("legend.room")}</LegendDot>
            <LegendDot color="var(--accent)">{c("legend.steady")}</LegendDot>
            <LegendDot color="var(--warning)">{c("legend.atCap")}</LegendDot>
            <LegendDot color="var(--critical)">{c("legend.over")}</LegendDot>
          </div>
        }
      />

      <div className="flex flex-col gap-4 px-4 pb-4">
        {/* The shortlist: who can pick up more, most spare first. */}
        {available.length > 0 ? (
          <div className="flex flex-col gap-2 rounded-[var(--radius-card)] border border-[var(--good)] bg-[var(--good-wash)] p-3">
            <span className="font-mono text-[10px] tracking-[0.12em] text-[var(--text-secondary)]">
              {c("availableLabel", { count: available.length })}
            </span>
            <div className="flex flex-wrap gap-2">
              {available.map((r) => (
                <span
                  key={r.memberId}
                  className="inline-flex items-baseline gap-1.5 rounded-full border border-[var(--border)] bg-[var(--surface)] px-2.5 py-1"
                  title={c("availableTitle", {
                    name: r.name,
                    percent: pct(r.loadPercent),
                    spare: h(r.spareHours),
                    weeks: weeks % 1 === 0 ? weeks : Number(weeks.toFixed(1)),
                  })}
                >
                  <span className="text-[12px] text-[var(--text-primary)]">{r.name}</span>
                  <span className="font-mono text-[10px] tabular-nums text-[var(--good)]">
                    {c("spareFree", { hours: h(r.spareHours) })}
                  </span>
                </span>
              ))}
            </div>
          </div>
        ) : (
          <p className="rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--surface-2)] p-3 text-[11px] text-[var(--text-secondary)]">
            {c("noneAvailable")}
          </p>
        )}

        {/* Every person's load, busiest first. */}
        <div className="flex flex-col gap-1.5">
          {rows.map((r) => {
            const colour = BAND_COLOUR[r.band];
            const readout = c("rowTitle", {
              name: r.name,
              tracked: h(r.trackedHours),
              nominal: h(r.nominalHours),
            });
            const inner = (
              <>
                <span className="w-[8.5rem] flex-none truncate text-right text-[11px] text-[var(--text-secondary)]">
                  {r.name}
                </span>
                <div className="relative h-4 flex-1 overflow-hidden rounded-[3px] bg-[var(--surface-2)]">
                  {/* Nominal (100%) marker, so a bar past it reads as overload. */}
                  <span
                    className="absolute top-0 h-full w-px bg-[var(--border-strong)]"
                    style={{ left: `${(100 / maxLoad) * 100}%` }}
                  />
                  <span
                    className="absolute left-0 top-0 h-full rounded-[3px] transition-all"
                    style={{
                      width: `${Math.min(100, (r.loadPercent / maxLoad) * 100)}%`,
                      background: colour,
                      opacity: 0.85,
                    }}
                  />
                </div>
                <span
                  className="w-11 flex-none text-right font-mono text-[10px] tabular-nums"
                  style={{ color: colour }}
                >
                  {pct(r.loadPercent)}
                </span>
                <span className="hidden w-[9.5rem] flex-none font-mono text-[9px] tracking-[0.08em] text-[var(--text-faint)] sm:block">
                  {band(r.band)}
                </span>
              </>
            );
            // The whole row is the hit target when a drill exists: a bar is a
            // poor thing to aim at and the name alone is narrow. Without drill
            // data the row stays the plain div it always was.
            return projectsByMember ? (
              <button
                key={r.memberId}
                type="button"
                onClick={() => openPerson(r)}
                aria-haspopup="dialog"
                aria-label={t("open", { title: r.name })}
                data-drill-trigger={`capacity-${r.memberId}`}
                title={readout}
                className="flex w-full cursor-pointer items-center gap-2 rounded-[var(--radius-sm)] text-left transition-colors hover:bg-[var(--surface-hover)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)]"
              >
                {inner}
              </button>
            ) : (
              <div key={r.memberId} className="flex items-center gap-2" title={readout}>
                {inner}
              </div>
            );
          })}
        </div>

        {drill && <DrillDialog drill={drill} onClose={() => setDrill(null)} />}

        <p className="text-[10px] leading-relaxed text-[var(--text-faint)]">{c("note")}</p>
      </div>
    </Card>
  );
}
