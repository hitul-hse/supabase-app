"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { Card, CardDivider, CardHeader, ChartNote, StatTile } from "@/components/ui/Card";
import { Donut, LegendDot, StackedHBar } from "@/components/ui/Charts";
import { DrillTrigger } from "@/components/DrillDialog";
import { CrossIcon, FIGURE_TRIGGER, KICKER, Reason, TickIcon, SECTION_STYLE, CARD_WITH_DRILL } from "./bits";
import { fmtInt } from "./format";
import type { SecurityView } from "./view";

/**
 * Security posture: RLS coverage as a donut, profiles by role as stacked
 * bars, users without a role as a tile that LEADS to /admin/users (an
 * existing page, so a link and never a second popup), env presence as a
 * checklist and the response-header self-check as pass/fail chips.
 */
export function SecurityPanel({ view }: { view: SecurityView }) {
  const t = useTranslations("systemHealth");
  const { rls, profiles, usersWithoutRole, env, headers } = view;

  return (
    <section data-section="security" style={SECTION_STYLE} className="grid grid-cols-1 gap-[var(--card-gap)] lg:grid-cols-2">
      <Card as="div" className={CARD_WITH_DRILL}>
        <CardHeader title={t("security.title")} qualifier={t("security.qualifier")} />
        <div className="grid grid-cols-1 gap-4 px-4 pb-4 sm:grid-cols-[11rem_minmax(0,1fr)] sm:gap-6">
          {/* RLS coverage */}
          <div data-metric="rls-coverage" data-stat-tile className="flex flex-col items-center gap-2">
            {rls.ok ? (
              <>
                <DrillTrigger drill={rls.drill} id="security-rls" className={`${FIGURE_TRIGGER} flex justify-center py-1 sm:w-auto`}>
                  <Donut
                    size={132}
                    thickness={11}
                    centre={`${rls.coveragePct}%`}
                    centreLabel={t("security.rlsCentre")}
                    label={t("security.rlsLabel", { enabled: rls.enabled, total: rls.total })}
                    slices={[
                      { label: t("security.rlsEnabled"), value: rls.enabled - rls.locked, color: "var(--good)" },
                      { label: t("security.rlsOff"), value: rls.off, color: "var(--critical)" },
                      { label: t("security.rlsLocked"), value: rls.locked, color: "var(--text-faint)" },
                    ]}
                  />
                </DrillTrigger>
                <div className="flex flex-col items-start gap-1">
                  <LegendDot color="var(--good)">{t("security.rlsEnabled")} <span className="tabular-nums text-[var(--text-primary)]">{rls.enabled - rls.locked}</span></LegendDot>
                  <LegendDot color="var(--critical)">{t("security.rlsOff")} <span className="tabular-nums text-[var(--text-primary)]">{rls.off}</span></LegendDot>
                  <LegendDot color="var(--text-faint)">{t("security.rlsLocked")} <span className="tabular-nums text-[var(--text-primary)]">{rls.locked}</span></LegendDot>
                </div>
              </>
            ) : (
              <div className="flex flex-col gap-1">
                <span className={KICKER}>{t("security.rlsCentre")}</span>
                <Reason reason={rls.reason} />
              </div>
            )}
          </div>

          <div className="flex flex-col gap-3">
            {/* Users without a role: a link to the page that fixes it. */}
            {usersWithoutRole.ok ? (
              <Link href="/admin/users" className="card-elev block rounded-[var(--radius-card)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)]" aria-label={t("security.usersAria")}>
                <StatTile
                  data-metric="users-without-role"
                  label={t("security.usersLabel")}
                  value={usersWithoutRole.count}
                  hint={t("security.usersHint")}
                  tone={usersWithoutRole.tone}
                />
              </Link>
            ) : (
              <StatTile data-metric="users-without-role" label={t("security.usersLabel")} value={null} hint={usersWithoutRole.reason} />
            )}

            {/* Env presence */}
            <div className="flex flex-col gap-1">
              <span className={KICKER}>{t("security.envKicker")}</span>
              <ul className="flex flex-col divide-y divide-[var(--divider)]">
                {env.map((f) => (
                  <li key={f.name} className="flex items-center justify-between gap-3 py-1">
                    <span className="truncate font-mono text-[11px] text-[var(--text-primary)]">{f.name}</span>
                    <span className="flex flex-none items-center gap-1 font-mono text-[10px] tracking-[0.08em]" style={{ color: f.set ? "var(--good)" : "var(--critical)" }}>
                      {f.set ? <TickIcon /> : <CrossIcon />}
                      {f.set ? t("security.envSet") : t("security.envMissing")}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
        <ChartNote>{t("security.rlsNote")}</ChartNote>
      </Card>

      <Card as="div" className={CARD_WITH_DRILL}>
        <CardHeader title={t("security.profilesTitle")} qualifier={profiles.ok ? t("security.profilesQualifier", { count: fmtInt(profiles.total) }) : t("security.profilesQualifierNa")} />
        <div className="px-3 pb-3">
          {profiles.ok ? (
            <DrillTrigger drill={profiles.drill} id="security-profiles" className={`${FIGURE_TRIGGER} px-1 py-1`}>
              <StackedHBar label={t("security.profilesLabel")} rows={profiles.rows} valueFormat={fmtInt} thickness={10} />
            </DrillTrigger>
          ) : (
            <p className="px-1"><Reason reason={profiles.reason} /></p>
          )}
        </div>

        <CardDivider />
        <div className="flex flex-col gap-2 px-4 py-3">
          <div className="flex flex-wrap items-baseline gap-x-2">
            <span className={KICKER}>{t("security.headersKicker")}</span>
            {headers.ok && (
              <span className="font-mono text-[10px] text-[var(--text-faint)]">{t("security.headersQualifier", { url: headers.url, status: headers.status })}</span>
            )}
          </div>
          {headers.ok ? (
            <ul className="flex flex-wrap gap-1.5">
              {headers.checks.map((c) => (
                <li
                  key={c.name}
                  className="flex max-w-full items-center gap-1.5 rounded-[var(--radius-sm)] border px-2 py-1 font-mono text-[10px]"
                  style={{ borderColor: c.pass ? "var(--good)" : "var(--critical)", color: c.pass ? "var(--good)" : "var(--critical)" }}
                  title={c.expected ? t("security.headerExpected", { value: c.expected }) : t("security.headerPresence")}
                >
                  {c.pass ? <TickIcon /> : <CrossIcon />}
                  <span className="text-[var(--text-primary)]">{c.name}</span>
                  <span className="truncate text-[var(--text-muted)]">{c.observed ?? t("security.headerMissing")}</span>
                </li>
              ))}
            </ul>
          ) : (
            <Reason reason={headers.reason} />
          )}
        </div>
      </Card>
    </section>
  );
}
