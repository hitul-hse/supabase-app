"use client";

/**
 * The TrackingTime dashboard's deep-analysis panels: customer concentration
 * (waffle), the weekday x hour work pattern (heatmap), and the service mix by
 * month (percent-stacked columns).
 *
 * All three fold the same filtered entries the tables render, so the filter
 * bar governs them for free and they can never disagree with the totals strip.
 * Shapes per the analysis spec (.context-bridge/analysis-spec.md #3, #5, #10).
 */

import { useState, type ReactNode } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Card, CardHeader } from "@/components/ui/Card";
import {
  HeatmapMatrix,
  StackedColumns100,
  Waffle,
} from "@/components/ui/AnalyticsCharts";
import { LegendDot } from "@/components/ui/Charts";
import { MobileDisclosure } from "@/components/MobileDisclosure";
import { DrillDialog, type Drill, type DrillRow } from "@/components/DrillDialog";
import type {
  CustomerShare,
  ServiceMixMonth,
  WeekPatternCell,
} from "@/lib/queries/time-insights";
import { WEEKDAY_LABELS } from "@/lib/queries/time-insights";
import { secondsToHours } from "@/lib/time-transform";
import { fmtDate, fmtHours, fmtPct } from "@/lib/locale-format";
import { NO_CUSTOMER_LABEL, type CustomerDrillData, type DrillDatum } from "./drill-data";

/**
 * The heatmap's row labels, in the reader's language.
 *
 * WEEKDAY_LABELS is the ORDER contract (index 0 is Monday) and lives in the
 * query module, where it is English by necessity. The words a reader sees are
 * derived here from the locale instead: 2024-01-01 was a Monday, so day i of
 * that week is weekday i. en-GB reproduces WEEKDAY_LABELS character for
 * character ("Mon"…"Sun"), so the English heatmap is untouched; de gets
 * "Mo"…"So".
 */
const MONDAY_EPOCH = Date.UTC(2024, 0, 1);
const weekdayLabels = (locale: string): string[] =>
  WEEKDAY_LABELS.map((_, i) =>
    fmtDate(new Date(MONDAY_EPOCH + i * 86_400_000), locale, {
      weekday: "short",
      timeZone: "UTC",
    }),
  );

/**
 * One legend line, a button when it can open its composition. The hit target
 * is the whole line rather than the name: the figure on the right is what the
 * reader is looking at when the question "which projects?" occurs to them.
 */
function LegendRow({
  onOpen,
  label,
  id,
  children,
}: {
  onOpen?: () => void;
  label: string;
  id: string;
  children: ReactNode;
}) {
  const t = useTranslations("drill");
  return onOpen ? (
    <button
      type="button"
      onClick={onOpen}
      aria-haspopup="dialog"
      aria-label={t("open", { title: label })}
      data-drill-trigger={id}
      className="flex w-full cursor-pointer items-baseline justify-between gap-2 rounded-[var(--radius-sm)] px-1 py-0.5 text-left transition-colors hover:bg-[var(--surface-hover)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)]"
    >
      {children}
    </button>
  ) : (
    <span className="flex items-baseline justify-between gap-2">{children}</span>
  );
}

/** Stable series palette: distinguishable in both themes, all tokens. */
const SERIES = [
  "var(--accent)",
  "var(--good)",
  "var(--warning)",
  "var(--critical)",
  "var(--text-secondary)",
  "var(--text-faint)",
];

export function InsightPanels({
  customers,
  otherHours,
  totalHours,
  pattern,
  serviceMix,
  customerDrills,
}: {
  customers: CustomerShare[];
  otherHours: number;
  totalHours: number;
  pattern: { hourLabels: string[]; cells: WeekPatternCell[][]; maxHours: number };
  serviceMix: ServiceMixMonth[];
  /**
   * Every customer's hours by project, folded by the page from the SAME
   * entries the waffle is cut from (drill-data.ts). When present, each legend
   * line opens that customer's projects, and "everything else" opens the
   * customers it folds together.
   */
  customerDrills?: CustomerDrillData;
}) {
  const t = useTranslations("drill");
  const ins = useTranslations("timeDashboard.insights");
  const locale = useLocale();
  const [drill, setDrill] = useState<Drill | null>(null);
  const h = (n: number) => fmtHours(n, locale);
  const pct = (n: number) => fmtPct(n, locale);

  /**
   * A customer's name as the reader sees it.
   *
   * "(no customer)" is a JOIN KEY, not a label: time-insights.ts and
   * drill-data.ts both emit that exact string so the waffle legend and the
   * popup it opens agree row for row, and `projectsByCustomer` is indexed by
   * it. So it stays English in the DATA and is translated here, at render,
   * on an exact match with the shared constant -- never on similarity, and
   * never at the point the two sides are keyed together.
   */
  const shown = (name: string | null) =>
    name === null || name === NO_CUSTOMER_LABEL ? t("noCustomer") : name;

  const projectRows = (list: DrillDatum[]): DrillRow[] =>
    list.map((d) => ({
      name: d.name ?? t("noProject"),
      value: `${h(secondsToHours(d.seconds))} · ${t("entries", { count: d.entries })}`,
      magnitude: d.seconds / 3600,
      tone: d.name === null ? "muted" : "accent",
    }));

  const openCustomer = (c: CustomerShare) => {
    if (!customerDrills) return;
    setDrill({
      kicker: ins("shareKicker", { percent: pct(c.percent), hours: h(totalHours) }),
      title: t("time.customerProjects.title", { name: shown(c.name) }),
      headline: h(c.hours),
      headlineValue: c.hours,
      check: "sum",
      rows: projectRows(customerDrills.projectsByCustomer[c.name] ?? []),
      footer: t("time.customerProjects.footer"),
    });
  };

  // The long tail the waffle folds away: one row per customer NOT in the top
  // list, so the rows sum to the "everything else" figure exactly.
  const openOthers = () => {
    if (!customerDrills) return;
    const named = new Set(customers.map((c) => c.name));
    setDrill({
      kicker: ins("shareKicker", {
        percent: fmtPct(
          Math.round(
            ((totalHours - customers.reduce((s, c) => s + c.hours, 0)) /
              Math.max(totalHours, 0.01)) *
              1000,
          ) / 10,
          locale,
          1,
        ),
        hours: h(totalHours),
      }),
      title: t("time.otherCustomers.title"),
      headline: h(otherHours),
      headlineValue: otherHours,
      check: "sum",
      rows: customerDrills.byCustomer
        .filter((d) => !named.has(d.name ?? ""))
        .map((d) => ({
          name: shown(d.name),
          value: `${h(secondsToHours(d.seconds))} · ${t("entries", { count: d.entries })}`,
          magnitude: d.seconds / 3600,
        })),
      footer: t("time.otherCustomers.footer"),
    });
  };

  /* ---------------------------------------------------------- waffle */
  const waffleSlices = customers.map((c, i) => ({
    label: shown(c.name),
    value: c.hours,
    color: SERIES[i % SERIES.length],
  }));

  /* --------------------------------------------------------- heatmap */
  // Weekend rows are dropped when empty -- the healthy, usual case -- so the
  // five real rows get the vertical room. When weekend work exists, it shows.
  const rowsWithWork = weekdayLabels(locale)
    .map((label, idx) => ({
      label,
      cells: pattern.cells[idx],
      any: pattern.cells[idx]?.some((c) => c.hours !== null) ?? false,
    }))
    .filter((r, idx) => idx < 5 || r.any);

  const heatCells = rowsWithWork.map((r) =>
    r.cells.map((c, hi) => ({
      value: c.hours,
      readout:
        c.hours === null
          ? ins("pattern.cellNone", { day: r.label, hour: pattern.hourLabels[hi] })
          : ins("pattern.cell", {
              day: r.label,
              hour: pattern.hourLabels[hi],
              hours: h(c.hours),
            }),
    })),
  );

  // Perceptual, not linear: tracked hours are heavily skewed to the 08:00
  // spike (site visits start on the hour), and a linear ramp paints everything
  // else near-black. sqrt keeps the midday texture readable.
  const tone = (v: number) => {
    const f = pattern.maxHours > 0 ? Math.sqrt(v / pattern.maxHours) : 0;
    return `color-mix(in srgb, var(--accent) ${Math.round(f * 100)}%, var(--surface-2))`;
  };

  /* ------------------------------------------------------ service mix */
  const serviceNames = serviceMix[0]?.segments.map((s) => s.name) ?? [];
  // The month heading is re-derived from `m.month` (the ISO "2026-08") rather
  // than taken from `m.label`, which the query module builds with a pinned
  // en-GB. Uppercased short month: "AUG" in en, "AUG." in de.
  const monthLabel = (m: ServiceMixMonth) =>
    fmtDate(new Date(`${m.month}-01T00:00:00Z`), locale, {
      month: "short",
      timeZone: "UTC",
    }).toUpperCase();

  const columns = serviceMix.map((m) => ({
    label: monthLabel(m),
    segments: m.segments.map((s, idx) => ({
      label: s.name,
      value: s.hours,
      color: SERIES[idx % SERIES.length],
    })),
    readout: ins("serviceMix.readout", {
      label: monthLabel(m),
      hours: h(m.totalHours),
      segments: m.segments
        .filter((s) => s.hours > 0)
        .map((s) =>
          ins("serviceMix.segment", {
            name: s.name,
            percent: pct(Math.round((s.hours / m.totalHours) * 100)),
          }),
        )
        .join(" · "),
    }),
  }));

  return (
    <div
      data-insight-panels="1"
      className="grid grid-cols-1 gap-[var(--card-gap)] lg:grid-cols-12"
    >
      {/* --------------------------------------- customer concentration */}
      {/*
        PHONE ONLY: collapsed. Measured at 390x844 against a production build,
        this panel is 968px -- the single tallest block on the route, and
        /time/dashboard was 4,388px = 5.2 screens against a budget of 5. It is
        over by only 168px, so collapsing this one clears it with room to spare.

        Why this panel and not the heatmap below it: a waffle chart is a
        desktop scanning tool. Its finding is one sentence ("the top customers
        hold N% of the hours"), which the summary states in full, so a phone
        reader loses nothing but the pixels. The heatmap's finding IS its shape
        and cannot be summarised, so it stays open.

        MobileDisclosure keeps `sm:block` on its content, so from sm up this is
        a bare wrapper div and the lg:grid-cols-12 layout is untouched. The
        wrapper carries the col-span the Card used to carry, or the grid would
        place the wrapper instead of the panel.
      */}
      <MobileDisclosure
        className="lg:col-span-4"
        title={ins("concentration.title")}
        summary={
          customers.length === 0
            ? ins("concentration.summaryEmpty")
            : ins("concentration.summary", {
                count: customers.length,
                percent: pct(customers.reduce((s, c) => s + c.percent, 0)),
                hours: h(totalHours),
              }) +
              (customers[0]
                ? ` ${ins("concentration.summaryBiggest", {
                    name: shown(customers[0].name),
                    percent: pct(customers[0].percent),
                  })}`
                : "")
        }
      >
        <Card className="flex h-full flex-col">
        <CardHeader
          title={ins("concentration.title")}
          qualifier={ins("concentration.qualifier", { hours: h(totalHours) })}
        />
        <div className="flex flex-1 flex-col gap-3 px-4 pb-4">
          {customers.length === 0 ? (
            <p className="font-mono text-[11px] text-[var(--text-faint)]">
              {ins("concentration.empty")}
            </p>
          ) : (
            <>
              <Waffle
                slices={waffleSlices}
                label={ins("concentration.aria", {
                  list: customers
                    .map((c) =>
                      ins("concentration.listItem", { name: shown(c.name), percent: pct(c.percent) }),
                    )
                    .join(", "),
                  hours: h(otherHours),
                })}
              />
              <div className="flex flex-col gap-1">
                {customers.map((c, i) => (
                  <LegendRow
                    key={c.name}
                    label={shown(c.name)}
                    id={`customer-${i}`}
                    onOpen={customerDrills ? () => openCustomer(c) : undefined}
                  >
                    <LegendDot color={SERIES[i % SERIES.length]}>
                      <span className="max-w-[11rem] truncate">{shown(c.name)}</span>
                    </LegendDot>
                    <span className="font-mono text-[10px] tabular-nums text-[var(--text-muted)]">
                      {ins("concentration.legendValue", {
                        percent: pct(c.percent),
                        hours: h(c.hours),
                      })}
                    </span>
                  </LegendRow>
                ))}
                {otherHours > 0 && (
                  <LegendRow
                    label={ins("concentration.everythingElse")}
                    id="customer-others"
                    onOpen={customerDrills ? openOthers : undefined}
                  >
                    <LegendDot color="var(--surface-2)">
                      {ins("concentration.everythingElse")}
                    </LegendDot>
                    <span className="font-mono text-[10px] tabular-nums text-[var(--text-muted)]">
                      {h(otherHours)}
                    </span>
                  </LegendRow>
                )}
              </div>
              {/* The waffle's reason to exist: dependency, said plainly. */}
              {customers[0] && customers[0].percent >= 25 && (
                <p className="mt-auto border-t border-[var(--border)] pt-2 text-[10px] leading-relaxed text-[var(--text-faint)]">
                  {ins("concentration.dependency", {
                    name: shown(customers[0].name),
                    percent: pct(customers[0].percent),
                  })}
                </p>
              )}
            </>
          )}
        </div>
        </Card>
      </MobileDisclosure>

      {/* ----------------------------------------------- weekday pattern */}
      {/* Stays OPEN at every width. The heatmap's finding is its shape -- where
          the week's work actually falls -- and no summary line can carry that,
          so collapsing it would cost the reader the answer rather than the
          scrolling. Collapsing the panel above already brings the route inside
          budget, so there is nothing to buy here. */}
      <Card className="flex flex-col lg:col-span-8">
        <CardHeader title={ins("pattern.title")} qualifier={ins("pattern.qualifier")} />
        <div className="px-4 pb-4">
          {pattern.maxHours === 0 ? (
            <p className="font-mono text-[11px] text-[var(--text-faint)]">
              {ins("pattern.empty")}
            </p>
          ) : (
            <>
              <HeatmapMatrix
                rowLabels={rowsWithWork.map((r) => r.label)}
                colLabels={pattern.hourLabels}
                cells={heatCells}
                tone={tone}
                label={ins("pattern.aria")}
                rowLabelWidth="3.5rem"
              />
              <p className="pt-2 text-[10px] leading-relaxed text-[var(--text-faint)]">
                {ins("pattern.note")}
              </p>
            </>
          )}
        </div>
      </Card>

      {/* -------------------------------------------------- service mix */}
      {columns.length >= 2 && (
        <Card className="flex flex-col lg:col-span-12">
          <CardHeader
            title={ins("serviceMix.title")}
            qualifier={ins("serviceMix.qualifier")}
            actions={
              <div className="flex flex-wrap items-center gap-3">
                {serviceNames.map((name, idx) => (
                  <LegendDot key={name} color={SERIES[idx % SERIES.length]}>
                    {name.toUpperCase()}
                  </LegendDot>
                ))}
              </div>
            }
          />
          <div className="flex flex-col px-4 pb-4">
            <div className="h-[190px]">
              <StackedColumns100 columns={columns} label={ins("serviceMix.aria")} />
            </div>
            <p className="pt-2 text-[10px] leading-relaxed text-[var(--text-faint)]">
              {ins("serviceMix.note")}
            </p>
          </div>
        </Card>
      )}

      {drill && <DrillDialog drill={drill} onClose={() => setDrill(null)} />}
    </div>
  );
}
