import Link from "next/link";

import { IconCheck } from "@/components/nav-icons";
import { MobileDisclosure } from "@/components/MobileDisclosure";
import { PageHeader } from "@/components/PageHeader";
import { Card, CardHeader, StatTile } from "@/components/ui/Card";
import { getDataHygiene, type HygieneFinding } from "@/lib/queries/data-hygiene";
import { requireProfile } from "@/utils/supabase/require-profile";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/*
 * Data hygiene — where the company's records disagree with themselves.
 *
 * WHY THIS PAGE EXISTS
 * --------------------
 * Asked for after a specific symptom: "we have the same customers but with
 * different customer numbers, or vice versa". Both directions turned out to be
 * real, and measuring for them turned up twelve more
 * (scripts/audit-data-inefficiencies.mjs).
 *
 * WHAT IT DELIBERATELY IS NOT
 * ---------------------------
 * It is not a fix-it console. Every finding here is fixed somewhere else — in
 * Lexware, in the source workbook, or in the customer-master review queue — and
 * the panels say so. A "resolve" button on this page would either write a value
 * the next import reverts, or silently merge two records on name similarity,
 * which is the exact error ADR-001 exists to prevent.
 *
 * EXACT vs HEURISTIC
 * ------------------
 * Two badges, because they demand different responses. An `exact` finding is two
 * rows that must be one, proven by a key — actionable as stated. A `heuristic`
 * finding is a suspicion with its reasoning shown, and the page says outright
 * that some of them will be legitimate. A page that presents guesses as facts
 * gets ignored after the first false positive.
 *
 * EMPTY PANELS
 * ------------
 * There are none. 19 probes ran; the 5 that found nothing are listed by name in
 * a "checks that passed" line instead of getting a panel each. A page of empty
 * panels trains the reader to stop reading.
 *
 * ACCESS
 * ------
 * exec only. Not because the findings are sensitive in themselves, but because
 * the probes need to see the whole order book, and a dept_head reading a
 * department-scoped slice would see a partial report that looks complete —
 * which is worse than no report. The reader gets told when that happens rather
 * than being shown zero findings.
 */

const KIND_STYLE: Record<HygieneFinding["kind"], { label: string; className: string; title: string }> = {
  exact: {
    label: "PROVEN",
    className: "border-[var(--critical)] text-[var(--critical)]",
    title: "Established by an exact key: these rows must be one and are not.",
  },
  heuristic: {
    label: "WORTH A LOOK",
    className: "border-[var(--warning)] text-[var(--warning)]",
    title: "A suspicion, not a fact. Some of these will be legitimate — check each one.",
  },
};

export default async function DataHygienePage() {
  await requireProfile("/data-hygiene", ["exec"]);

  const { createClient } = await import("@/utils/supabase/server");
  const supabase = await createClient();
  const hygiene = await getDataHygiene(supabase);

  const exactCount = hygiene.findings
    .filter((f) => f.kind === "exact")
    .reduce((sum, f) => sum + f.count, 0);
  const suspectCount = hygiene.findings
    .filter((f) => f.kind === "heuristic")
    .reduce((sum, f) => sum + f.count, 0);

  return (
    <>
      <PageHeader
        title="Data hygiene"
        meta="WHERE THE RECORDS DISAGREE WITH THEMSELVES · READ-ONLY · EXEC"
      />

      <div className="flex flex-col gap-[var(--card-gap)] px-4 py-4 sm:px-6">
        {hygiene.unavailable ? (
          <Card>
            <CardHeader title="Report unavailable" />
            <div className="px-4 pb-4 text-[13px] leading-relaxed text-[var(--text-secondary)]">
              These checks compare the whole order book against itself, so they need
              to read every order. Your session cannot, which means any report shown
              here would be a partial one that looks complete. Nothing is wrong with
              your account — ask an exec to run it.
            </div>
          </Card>
        ) : (
          <>
            {/*
              Two totals, kept apart on purpose. Summing proven and suspected
              findings into one number would let a reader treat a guess as a
              defect, and the whole point of the split is that they act differently.
            */}
            <div className="grid grid-cols-2 gap-[var(--card-gap)] sm:grid-cols-4">
              <StatTile
                label="PROVEN ISSUES"
                value={exactCount}
                hint="established by an exact key"
                tone={exactCount > 0 ? "critical" : "good"}
                data-metric="hygiene-exact"
              />
              <StatTile
                label="WORTH A LOOK"
                value={suspectCount}
                hint="suspicions, some will be fine"
                tone={suspectCount > 0 ? "warning" : "good"}
                data-metric="hygiene-heuristic"
              />
              <StatTile
                label="FINDING TYPES"
                value={hygiene.findings.length}
                hint={`of ${hygiene.findings.length + hygiene.clean.length} checks run`}
                data-metric="hygiene-types"
              />
              <StatTile
                label="CHECKS CLEAN"
                value={hygiene.clean.length}
                /* "listed below" is only true when there IS a list below. Right
                   now all 7 probes fire, so the clean panel does not render and
                   an unconditional hint would point at nothing. */
                hint={hygiene.clean.length > 0 ? "found nothing, listed below" : "every check found something"}
                tone={hygiene.clean.length > 0 ? "good" : "neutral"}
                data-metric="hygiene-clean"
              />
            </div>

            {hygiene.findings.length === 0 ? (
              <Card>
                <CardHeader title="Nothing to report" qualifier="EVERY CHECK PASSED" />
                <div className="px-4 pb-4 text-[13px] text-[var(--text-secondary)]">
                  All {hygiene.clean.length} checks found nothing.
                </div>
              </Card>
            ) : (
              hygiene.findings.map((finding, index) => {
                const style = KIND_STYLE[finding.kind];
                const shown = finding.rows.length;
                const hidden = finding.count - shown;

                const panel = (
                  <Card key={finding.key} as="section">
                    <CardHeader
                      title={finding.title}
                      qualifier={`${finding.count} ${finding.count === 1 ? "case" : "cases"}`}
                      actions={
                        <span
                          title={style.title}
                          className={`flex-none border px-1.5 py-0.5 font-mono text-[9px] font-semibold tracking-[0.08em] ${style.className}`}
                        >
                          {style.label}
                        </span>
                      }
                    />

                    {/* What to do about it, before the rows. A list of problems
                        with no stated remedy is a complaint, not a report. */}
                    <p className="px-4 pb-3 text-[12px] leading-relaxed text-[var(--text-secondary)]">
                      {finding.action}
                    </p>

                    <ul className="flex flex-col divide-y divide-[var(--divider)] border-t border-[var(--divider)]">
                      {finding.rows.map((row) => (
                        <li
                          key={row.id}
                          data-hygiene-row
                          className="flex flex-col gap-0.5 px-4 py-2 sm:flex-row sm:items-baseline sm:gap-3"
                        >
                          <span className="flex-none font-mono text-[11px] font-semibold text-[var(--text-primary)] sm:w-[13rem]">
                            {row.subject}
                          </span>
                          <span className="min-w-0 flex-1 text-[12px] leading-snug text-[var(--text-secondary)]">
                            {row.detail}
                          </span>
                          {row.href && (
                            <Link
                              href={row.href}
                              className="flex-none font-mono text-[10px] tracking-[0.06em] text-[var(--accent)]"
                            >
                              REVIEW →
                            </Link>
                          )}
                        </li>
                      ))}
                    </ul>

                    {/*
                      DESIGN.md rule 7: a capped list states its total, or it is
                      indistinguishable from a complete one.
                    */}
                    {hidden > 0 && (
                      <div className="border-t border-[var(--divider)] px-4 py-2 font-mono text-[10px] text-[var(--text-faint)]">
                        showing {shown} of {finding.count} — the rest follow the same pattern
                      </div>
                    )}
                  </Card>
                );

                /*
                 * At 390px every row stacks its subject above its detail, so the
                 * seven panels measured 5.28 screens against rule 8's four-screen
                 * mobile ceiling. Collapsing the panels below the first fixes the
                 * height without touching the desktop tree (MobileDisclosure is a
                 * plain wrapper from `sm:` up).
                 *
                 * The FIRST panel stays open: findings are sorted worst-first, and
                 * collapsing everything equally would turn the report into a menu
                 * rather than an answer. The rest state their count while shut, so
                 * a collapsed panel never reads as an absent one.
                 */
                if (index === 0) return panel;
                return (
                  <MobileDisclosure
                    key={finding.key}
                    title={finding.title}
                    summary={`${finding.count} ${finding.count === 1 ? "case" : "cases"} · ${style.label}`}
                  >
                    {panel}
                  </MobileDisclosure>
                );
              })
            )}

            {/* Naming the clean checks is what makes the report trustworthy: it
                shows what was looked for and not found, so a missing panel reads
                as "checked" rather than "forgotten". */}
            {hygiene.clean.length > 0 && (
              <Card>
                <CardHeader title="Checks that found nothing" qualifier={`${hygiene.clean.length} CLEAN`} />
                <ul className="flex flex-col gap-1 px-4 pb-4">
                  {hygiene.clean.map((title) => (
                    <li key={title} className="flex items-center gap-1.5 text-[12px] text-[var(--text-faint)]">
                      {/* IconCheck, not a tick glyph: DESIGN.md craft floor bans
                          Unicode standing in for the icon system, and
                          test:design-system enforces it. */}
                      <IconCheck className="h-3 w-3 flex-none text-[var(--good)]" />
                      {title}
                    </li>
                  ))}
                </ul>
              </Card>
            )}

            <p className="font-mono text-[10px] text-[var(--text-faint)]">
              read live at {hygiene.checkedAt.slice(0, 16).replace("T", " ")} UTC · no
              value on this page is cached, and nothing here writes to the database
            </p>
          </>
        )}
      </div>
    </>
  );
}
