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

import { Card, CardHeader } from "@/components/ui/Card";
import { LegendDot } from "@/components/ui/Charts";
import type { CapacityView, CapacityRow } from "@/lib/queries/time-insights";

const h = (n: number) => n.toLocaleString("en-GB", { maximumFractionDigits: 1 });

/** Band -> colour + label. The judgement lives here, once. */
const BAND: Record<CapacityRow["band"], { color: string; label: string }> = {
  over: { color: "var(--critical)", label: "OVER CAPACITY" },
  full: { color: "var(--warning)", label: "AT CAPACITY" },
  steady: { color: "var(--accent)", label: "STEADY" },
  light: { color: "var(--good)", label: "ROOM TO TAKE ON MORE" },
  open: { color: "var(--good)", label: "WIDE OPEN" },
};

export function CapacityPanel({ data }: { data: CapacityView }) {
  const { rows, weeks, available } = data;

  if (rows.length === 0) {
    return (
      <Card className="flex flex-col lg:col-span-12">
        <CardHeader title="Capacity to take on work" qualifier="LOGGED LOAD vs NOMINAL" />
        <p className="px-4 pb-5 text-[12px] text-[var(--text-faint)]">
          No tracked time in this selection, so there is no load to judge capacity against.
        </p>
      </Card>
    );
  }

  const maxLoad = Math.max(100, ...rows.map((r) => r.loadPercent));

  return (
    <Card className="flex flex-col lg:col-span-12">
      <CardHeader
        title="Capacity to take on work"
        qualifier={`LOGGED LOAD vs NOMINAL 40H/WEEK · ${weeks % 1 === 0 ? weeks : weeks.toFixed(1)} ${weeks === 1 ? "WEEK" : "WEEKS"} IN RANGE`}
        actions={
          <div className="flex flex-wrap items-center gap-3">
            <LegendDot color="var(--good)">ROOM</LegendDot>
            <LegendDot color="var(--accent)">STEADY</LegendDot>
            <LegendDot color="var(--warning)">AT CAP.</LegendDot>
            <LegendDot color="var(--critical)">OVER</LegendDot>
          </div>
        }
      />

      <div className="flex flex-col gap-4 px-4 pb-4">
        {/* The shortlist: who can pick up more, most spare first. */}
        {available.length > 0 ? (
          <div className="flex flex-col gap-2 rounded-[var(--radius-card)] border border-[var(--good)] bg-[var(--good-wash)] p-3">
            <span className="font-mono text-[10px] tracking-[0.12em] text-[var(--text-secondary)]">
              AVAILABLE TO TAKE ON WORK · {available.length} {available.length === 1 ? "PERSON" : "PEOPLE"}
            </span>
            <div className="flex flex-wrap gap-2">
              {available.map((r) => (
                <span
                  key={r.memberId}
                  className="inline-flex items-baseline gap-1.5 rounded-full border border-[var(--border)] bg-[var(--surface)] px-2.5 py-1"
                  title={`${r.name}: ${r.loadPercent}% logged load, about ${h(r.spareHours)}h of nominal capacity spare across ${weeks % 1 === 0 ? weeks : weeks.toFixed(1)} ${weeks === 1 ? "week" : "weeks"}`}
                >
                  <span className="text-[12px] text-[var(--text-primary)]">{r.name}</span>
                  <span className="font-mono text-[10px] tabular-nums text-[var(--good)]">
                    ~{h(r.spareHours)}h free
                  </span>
                </span>
              ))}
            </div>
          </div>
        ) : (
          <p className="rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--surface-2)] p-3 text-[11px] text-[var(--text-secondary)]">
            Nobody is sitting light in this selection — everyone with logged time is at
            better than half their nominal load. To free someone up, look at the busiest
            rows below and what they are spending time on.
          </p>
        )}

        {/* Every person's load, busiest first. */}
        <div className="flex flex-col gap-1.5">
          {rows.map((r) => {
            const band = BAND[r.band];
            return (
              <div key={r.memberId} className="flex items-center gap-2" title={`${r.name}: ${h(r.trackedHours)}h logged of ~${h(r.nominalHours)}h nominal`}>
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
                      background: band.color,
                      opacity: 0.85,
                    }}
                  />
                </div>
                <span
                  className="w-11 flex-none text-right font-mono text-[10px] tabular-nums"
                  style={{ color: band.color }}
                >
                  {r.loadPercent}%
                </span>
                <span className="hidden w-[9.5rem] flex-none font-mono text-[9px] tracking-[0.08em] text-[var(--text-faint)] sm:block">
                  {band.label}
                </span>
              </div>
            );
          })}
        </div>

        <p className="text-[10px] leading-relaxed text-[var(--text-faint)]">
          &ldquo;Load&rdquo; is tracked hours over a nominal 40h/week — a planning signal, not a
          verdict: consultancy weeks also hold unlogged office work, so a light bar
          means room on tracked project work, not an empty desk. Filter by service or
          customer above to ask who has room on a specific kind of work.
        </p>
      </div>
    </Card>
  );
}
