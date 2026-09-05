"use client";

/**
 * Customer portfolio: who our biggest customers are, and where capacity is
 * tight. Replaces the customer rank-by-month bump chart, which only showed
 * ORDER (ENERCON was #1 every month, so the lanes barely moved). The questions
 * that actually matter for a consultancy are concentration and capacity, and
 * this answers both from the same project ledger the page already has.
 *
 *   LEFT  — a donut of delivered-hours SHARE: the biggest customers at a glance,
 *           with the top-5 concentration called out (a dependency risk number).
 *   RIGHT — a capacity bar per customer: delivered against committed budget, so
 *           an OVERRUN (delivered past scope, no headroom left) reads
 *           differently from a customer with budget still to burn.
 *
 * Client component only because Donut carries hover state; every number is
 * computed server-side in projects-live.ts (customerPortfolio) and passed down.
 */

import Link from "next/link";
import { useTranslations } from "next-intl";
import { Card, CardHeader, ChartNote } from "@/components/ui/Card";
import { Donut, LegendDot } from "@/components/ui/Charts";
// Fed a re-derived view: the Projects explorer recomputes this on every filter
// change from rows already in the browser (project-insights.ts), so the charts
// react to the shared filter bar rather than showing a fixed server snapshot.
import { NO_CUSTOMER, type CustomerPortfolioView } from "./project-insights";
import { fmtHours, fmtInt, fmtNum, fmtPct } from "@/lib/locale-format";

/** Distinct hues for the donut's top slices; the tail folds into one grey. */
const SLICE_COLORS = [
  "var(--accent)",
  "var(--good)",
  "var(--warning)",
  "var(--critical)",
  "var(--chart-hue)",
  "var(--text-secondary)",
];

export function CustomerPortfolioCharts({
  data,
  onCustomer,
  activeCustomers,
  locale,
}: {
  data: CustomerPortfolioView;
  /** When given, the donut cross-filters: clicking a slice or legend row toggles
   * that customer in the page filter, the way a mark click filters in Tableau. */
  onCustomer?: (name: string) => void;
  activeCustomers?: Set<string>;
  /** The request locale, handed down by the explorer. Absent means en-GB. */
  locale?: string;
}) {
  const t = useTranslations("projects");
  const tDrill = useTranslations("drill");
  const { rows, totalHours, customerCount, top5SharePercent } = data;
  const active = activeCustomers ?? new Set<string>();
  /*
   * The customer name is the FILTER KEY (project-insights.NO_CUSTOMER), so the
   * "no customer" bucket keeps its English key and only its rendering follows
   * the locale -- exactly as the explorer's filter does.
   */
  const noCustomerLabel = tDrill("noCustomer");
  const display = (name: string) => (name === NO_CUSTOMER ? noCustomerLabel : name);

  if (rows.length === 0) {
    return (
      <Card className="flex flex-col">
        <CardHeader title={t("customerCharts.title")} qualifier={t("customerCharts.qualifier")} />
        <p className="px-4 pb-5 text-[12px] text-[var(--text-faint)]">
          {t("customerCharts.empty")}
        </p>
      </Card>
    );
  }

  const TOP = 6;
  const top = rows.slice(0, TOP);
  const tailHours = rows.slice(TOP).reduce((s, r) => s + r.hours, 0);

  const slices = top.map((r, i) => ({
    label: display(r.name),
    value: r.hours,
    color: SLICE_COLORS[i % SLICE_COLORS.length],
  }));
  const moreLabel = t("customerCharts.more", { count: fmtInt(customerCount - TOP, locale) });
  if (tailHours > 0) {
    slices.push({ label: moreLabel, value: tailHours, color: "var(--border-strong)" });
  }

  // The capacity view lists customers that HAVE a budget to judge against,
  // worst headroom first — the overruns are the ones needing a conversation.
  const budgeted = rows
    .filter((r) => r.committedHours !== null && r.headroomHours !== null)
    .sort((a, b) => (a.headroomHours ?? 0) - (b.headroomHours ?? 0))
    .slice(0, 8);

  // A shared scale so bars are comparable: the largest of committed or delivered
  // across the shown customers is the full width.
  const capMax = Math.max(
    1,
    ...budgeted.map((r) => Math.max(r.committedHours ?? 0, r.hours)),
  );

  return (
    <div className="grid grid-cols-1 gap-[var(--card-gap)] lg:grid-cols-12">
      {/* ---------------------------------------- biggest customers (share) */}
      <Card className="flex flex-col lg:col-span-5">
        <CardHeader
          title={t("customerCharts.biggest.title")}
          qualifier={t("customerCharts.biggest.qualifier", {
            share: fmtPct(top5SharePercent, locale),
            hours: fmtNum(totalHours, locale, 1),
          })}
        />
        <div className="flex flex-1 flex-col items-center gap-4 px-4 pb-5 sm:flex-row sm:items-center">
          <Donut
            slices={slices}
            centre={fmtPct(top[0].sharePercent, locale, 1)}
            centreLabel={display(top[0].name).split(" ")[0]}
            label={t("customerCharts.biggest.chartLabel", {
              list: top
                .map((r) => `${display(r.name)} ${fmtPct(r.sharePercent, locale, 1)}`)
                .join(", "),
            })}
            size={168}
            thickness={16}
            onSelect={onCustomer ? (name) => onCustomer(name) : undefined}
            activeLabel={active.size === 1 ? [...active][0] : null}
          />
          <div className="flex w-full flex-col gap-1.5">
            {top.map((r, i) => {
              const isActive = active.has(r.name);
              const row = (
                <>
                  <LegendDot color={SLICE_COLORS[i % SLICE_COLORS.length]}>
                    <span className="max-w-[12rem] truncate">{display(r.name)}</span>
                  </LegendDot>
                  <span className="font-mono text-[10px] tabular-nums text-[var(--text-muted)]">
                    {fmtPct(r.sharePercent, locale, 1)} · {fmtHours(r.hours, locale, 1)}
                  </span>
                </>
              );
              return onCustomer ? (
                <button
                  key={r.name}
                  type="button"
                  onClick={() => onCustomer(r.name)}
                  aria-pressed={isActive}
                  className={`flex items-baseline justify-between gap-2 rounded-[var(--radius-sm)] px-1 py-0.5 text-left transition-colors hover:bg-[var(--surface-hover)] ${
                    isActive ? "bg-[var(--surface-hover)]" : ""
                  }`}
                >
                  {row}
                </button>
              ) : (
                <div key={r.name} className="flex items-baseline justify-between gap-2">
                  {row}
                </div>
              );
            })}
            {tailHours > 0 && (
              <div className="flex items-baseline justify-between gap-2">
                <LegendDot color="var(--border-strong)">{moreLabel}</LegendDot>
                <span className="font-mono text-[10px] tabular-nums text-[var(--text-muted)]">
                  {fmtHours(tailHours, locale, 1)}
                </span>
              </div>
            )}
          </div>
        </div>
        {top[0].sharePercent >= 25 && (
          <p className="border-t border-[var(--border)] px-4 py-2.5 text-[10px] leading-relaxed text-[var(--text-faint)]">
            {t("customerCharts.concentration", {
              name: display(top[0].name),
              share: fmtPct(top[0].sharePercent, locale, 1),
              top5: fmtPct(top5SharePercent, locale),
            })}
          </p>
        )}
        {/*
          Share of hours delivered, which is not share of revenue: a customer on
          a low rate can dominate this ring while contributing far less. Saying
          so prevents the most natural misreading of a customer donut.
        */}
        <ChartNote>{t("customerCharts.note")}</ChartNote>
      </Card>

      {/* --------------------------------------------- capacity vs commitment */}
      <Card className="flex flex-col lg:col-span-7">
        <CardHeader
          title={t("customerCharts.capacity.title")}
          qualifier={t("customerCharts.capacity.qualifier")}
          actions={
            <div className="flex items-center gap-3">
              <LegendDot color="var(--accent)">{t("customerCharts.capacity.delivered")}</LegendDot>
              <LegendDot color="var(--critical)">
                {t("customerCharts.capacity.overBudget")}
              </LegendDot>
            </div>
          }
        />
        <div className="flex flex-col gap-2.5 px-4 pb-4">
          {budgeted.length === 0 ? (
            <p className="py-4 font-mono text-[11px] text-[var(--text-faint)]">
              {t("customerCharts.capacity.empty")}
            </p>
          ) : (
            budgeted.map((r) => {
              const committed = r.committedHours ?? 0;
              const over = (r.headroomHours ?? 0) < 0;
              const deliveredPct = (r.hours / capMax) * 100;
              const committedPct = (committed / capMax) * 100;
              return (
                <div key={r.name} className="flex flex-col gap-1">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="max-w-[60%] truncate text-[12px] text-[var(--text-primary)]">
                      {display(r.name)}
                    </span>
                    <span
                      className={`font-mono text-[10px] tabular-nums ${
                        over ? "text-[var(--critical)]" : "text-[var(--text-muted)]"
                      }`}
                    >
                      {fmtHours(r.hours, locale, 1)} / {fmtHours(committed, locale, 1)} ·{" "}
                      {over
                        ? t("customerCharts.capacity.over", {
                            hours: fmtHours(Math.abs(r.headroomHours ?? 0), locale, 1),
                          })
                        : t("customerCharts.capacity.left", {
                            hours: fmtHours(r.headroomHours ?? 0, locale, 1),
                          })}
                    </span>
                  </div>
                  {/* The track is the committed budget; the fill is delivered.
                      When delivered exceeds committed the fill runs past the
                      track marker and turns critical -- an overrun you can see. */}
                  <div className="relative h-3 w-full rounded-[var(--radius-sm)] bg-[var(--surface-2)]">
                    {/* committed marker */}
                    <span
                      className="absolute top-0 h-full border-r border-[var(--border-strong)]"
                      style={{ width: `${Math.min(100, committedPct)}%` }}
                    />
                    <span
                      className="absolute left-0 top-0 h-full rounded-[var(--radius-sm)] transition-colors"
                      style={{
                        width: `${Math.min(100, deliveredPct)}%`,
                        background: over ? "var(--critical)" : "var(--accent)",
                        opacity: 0.9,
                      }}
                    />
                  </div>
                </div>
              );
            })
          )}
          <Link
            href="/projects?sort=burn"
            scroll={false}
            className="mt-1 self-start text-[11px] text-[var(--accent)] underline-offset-2 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)]"
          >
            {t("customerCharts.capacity.link")}
          </Link>
        </div>
      </Card>
    </div>
  );
}
