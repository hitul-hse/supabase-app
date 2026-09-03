"use client";

/**
 * Operations Analytics — Factorial presence vs TrackingTime logged hours.
 *
 * DESIGN NOTES (why this looks the way it does)
 * ---------------------------------------------
 * First version of this panel shipped in light-theme Tailwind grays
 * (bg-gray-50, text-gray-600) on the hub's near-black teal surface — unreadable
 * and off-brand. This rewrite uses only house vocabulary:
 *
 *  - StatTile for the four headline figures, each with the basis stated in its
 *    hint (DESIGN.md: a derived figure states its own denominator).
 *  - DataTable for the roster: sortable with nulls-last in both directions,
 *    paged at 25, in-table search, CSV export, sticky header. The roster is an
 *    unbounded query result, so DESIGN.md rule 1 requires DataTable.
 *  - A missing measurement renders as "—", never 0 (rule 6). Björn logged 276h
 *    with zero Factorial clock-ins; four colleagues clock daily but have no
 *    TrackingTime account. Rendering either as 0 would accuse a named colleague
 *    of doing nothing.
 *  - Present and Logged are DIFFERENT quantities (contracted working time vs
 *    project work), so no column derives one from the other by subtraction —
 *    the residual overlap in TT entries makes that arithmetic dishonest.
 */
import { Card, CardHeader, ChartNote, StatTile } from "@/components/ui/Card";
import { cmpNum, DataTable, type Column } from "@/components/data-table/DataTable";
import type { FactorialHoursReport, PersonComparison } from "@/lib/queries/factorial-hours";

function h(v: number | null): string {
  return v === null ? "—" : `${v.toLocaleString("en-GB", { maximumFractionDigits: 1 })}h`;
}

const MATCH_LABEL: Record<PersonComparison["matchState"], string> = {
  matched: "Both",
  factorial_only: "HR only",
  trackingtime_only: "TT only",
  unresolved: "Unresolved",
};

const MATCH_TITLE: Record<PersonComparison["matchState"], string> = {
  matched:
    "Matched on the exact Factorial employee id, through crm.factorial_person_reference to a hub person "
    + "and on to their TrackingTime member. Never on a name.",
  factorial_only:
    "The identity chain resolved to a hub person, and that person has no TrackingTime member. "
    + "A measured fact: no TrackingTime account.",
  trackingtime_only:
    "Logs project time in TrackingTime; no active Factorial employee resolves to this member.",
  unresolved:
    "The identity chain does not resolve this Factorial employee to a hub person, so their project "
    + "hours are UNKNOWN, not zero and not absent. Decide it in the Factorial identity queue "
    + "(/admin/factorial-identity); a machine may not guess by name.",
};

/*
 * Match-state chip. Muted by design: "Both" is the normal case and should not
 * shout; the partial states are the interesting ones and get the teal tint.
 *
 * "Unresolved" is louder than the other two on purpose. It is not a property of
 * the colleague — it is an unanswered question about our own data, and it sits
 * on a row whose hours columns all read "—". Left in the same muted teal as
 * "HR only" it would read as another ordinary category rather than as work
 * waiting in the identity queue.
 */
function MatchChip({ state }: { state: PersonComparison["matchState"] }) {
  const unresolved = state === "unresolved";
  const partial = state !== "matched";
  return (
    <span
      className={
        "inline-block rounded-full border px-2 py-0.5 font-mono text-[10px] tracking-[0.04em] "
        + (unresolved
          ? "border-[var(--warning)] text-[var(--warning)]"
          : partial
            ? "border-[var(--border-strong)] bg-[var(--accent-wash)] text-[var(--text-secondary)]"
            : "border-[var(--border)] text-[var(--text-faint)]")
      }
      title={MATCH_TITLE[state]}
    >
      {MATCH_LABEL[state]}
    </span>
  );
}

/*
 * The presence/logged pair as a two-lane inline bar, scaled against the page
 * max so lanes compare across rows. A lane with no measurement draws nothing —
 * an empty track, not a zero-width bar, would still imply "measured: none",
 * so the missing lane is omitted entirely and the cell says "—".
 */
function PairBar({
  present,
  logged,
  max,
}: {
  present: number | null;
  logged: number | null;
  max: number;
}) {
  if (max <= 0) return null;
  return (
    <div className="flex w-full min-w-[96px] flex-col gap-[3px]" aria-hidden>
      <div className="h-[5px] overflow-hidden rounded-full bg-[var(--border)]">
        {present !== null && (
          <div
            className="h-full rounded-full bg-[var(--accent)] opacity-90"
            style={{ width: `${Math.min(100, (present / max) * 100)}%` }}
          />
        )}
      </div>
      <div className="h-[5px] overflow-hidden rounded-full bg-[var(--border)]">
        {logged !== null && (
          <div
            className="h-full rounded-full bg-[var(--chart-hue)] opacity-75"
            style={{ width: `${Math.min(100, (logged / max) * 100)}%` }}
          />
        )}
      </div>
    </div>
  );
}

export function FactorialHoursPanel({ report }: { report: FactorialHoursReport }) {
  const { people, totals, factorialError, identity, windowDays, windowFrom, windowTo } = report;

  const maxHours = Math.max(
    ...people.map((p) => Math.max(p.presentHours ?? 0, p.loggedHours ?? 0)),
    1,
  );

  const matched = people.filter((p) => p.matchState === "matched").length;
  const unresolved = people.filter((p) => p.matchState === "unresolved").length;
  const billableShare =
    totals.loggedHours > 0 ? Math.round((totals.billableHours / totals.loggedHours) * 100) : null;

  const columns: Column<PersonComparison>[] = [
    {
      key: "name",
      header: "Person",
      align: "left",
      className: "w-[13rem]",
      compare: (a, b) => a.name.localeCompare(b.name),
      cell: (p) => (
        <div className="flex min-w-0 flex-col">
          <span className="truncate text-[13px] text-[var(--text-primary)]">{p.name}</span>
          {p.factorialTeams.length > 0 && (
            <span className="truncate font-mono text-[10px] text-[var(--text-faint)]">
              {p.factorialTeams.join(" · ")}
            </span>
          )}
        </div>
      ),
      csv: (p) => p.name,
      search: (p) => `${p.name} ${p.factorialTeams.join(" ")}`,
    },
    {
      key: "bars",
      header: "Present / Logged",
      align: "left",
      className: "w-[8rem]",
      cell: (p) => <PairBar present={p.presentHours} logged={p.loggedHours} max={maxHours} />,
      title: "Top lane (teal): Factorial presence. Bottom lane (green): TrackingTime logged. Shared scale across all rows.",
    },
    {
      key: "present",
      header: "Present",
      align: "right",
      compare: (a, b) => cmpNum(a.presentHours, b.presentHours),
      descFirst: true,
      cell: (p) => <span className="font-mono text-[12px]">{h(p.presentHours)}</span>,
      csv: (p) => p.presentHours ?? "",
      title: "Clocked attendance in Factorial. — means no clock-ins, not zero hours.",
    },
    {
      key: "days",
      header: "Days",
      align: "right",
      compare: (a, b) => cmpNum(a.daysClocked, b.daysClocked),
      descFirst: true,
      cell: (p) => (
        <span className="font-mono text-[12px] text-[var(--text-muted)]">
          {p.daysClocked === null ? "—" : p.daysClocked}
        </span>
      ),
      csv: (p) => p.daysClocked ?? "",
      title: "Distinct days with at least one Factorial clock-in.",
    },
    {
      key: "logged",
      header: "Logged",
      align: "right",
      compare: (a, b) => cmpNum(a.loggedHours, b.loggedHours),
      descFirst: true,
      cell: (p) => <span className="font-mono text-[12px]">{h(p.loggedHours)}</span>,
      csv: (p) => p.loggedHours ?? "",
      title: "TrackingTime hours excluding calendar placeholders. — means no TT account.",
    },
    {
      key: "billable",
      header: "Billable",
      align: "right",
      compare: (a, b) => cmpNum(a.billableHours, b.billableHours),
      descFirst: true,
      cell: (p) => <span className="font-mono text-[12px]">{h(p.billableHours)}</span>,
      csv: (p) => p.billableHours ?? "",
    },
    {
      key: "share",
      header: "% Bill",
      align: "right",
      compare: (a, b) => cmpNum(a.billableShare, b.billableShare),
      descFirst: true,
      cell: (p) => (
        <span
          className="font-mono text-[12px]"
          style={{
            color:
              p.billableShare === null
                ? "var(--text-faint)"
                : p.billableShare >= 70
                  ? "var(--good)"
                  : p.billableShare >= 40
                    ? "var(--text-primary)"
                    : "var(--warning)",
          }}
        >
          {p.billableShare === null ? "—" : `${p.billableShare}%`}
        </span>
      ),
      csv: (p) => p.billableShare ?? "",
      title: "Billable share of non-calendar logged time. Needs logged hours to exist.",
    },
    {
      key: "match",
      header: "Systems",
      align: "left",
      className: "w-[6rem]",
      compare: (a, b) => a.matchState.localeCompare(b.matchState),
      cell: (p) => <MatchChip state={p.matchState} />,
      csv: (p) => MATCH_LABEL[p.matchState],
      search: (p) => MATCH_LABEL[p.matchState],
    },
  ];

  return (
    <div className="flex flex-col gap-4">
      {factorialError && (
        <Card className="px-4 py-3">
          <div className="flex items-baseline gap-2.5">
            <span className="font-mono text-[10px] tracking-[0.1em] text-[var(--critical)]">
              FACTORIAL UNAVAILABLE
            </span>
            <span className="text-[12px] text-[var(--text-secondary)]">{factorialError}</span>
          </div>
          <p className="mt-1 text-[11px] leading-relaxed text-[var(--text-faint)]">
            The table below still shows TrackingTime data; every Present figure shows n/a in the
            tiles and — in the table until Factorial answers again.
          </p>
        </Card>
      )}

      {/*
        The identity chain is a source like any other, so when it is DOWN the
        page says so in the same shape as an unreachable Factorial. Without this
        banner an unreadable crm.factorial_person_reference renders as a table
        where nobody logs any hours, which reads as an answer.
      */}
      {!identity.available && (
        <Card className="px-4 py-3">
          <div className="flex items-baseline gap-2.5">
            <span className="font-mono text-[10px] tracking-[0.1em] text-[var(--critical)]">
              IDENTITY CHAIN UNAVAILABLE
            </span>
            <span className="text-[12px] text-[var(--text-secondary)]">{identity.fault}</span>
          </div>
          <p className="mt-1 text-[11px] leading-relaxed text-[var(--text-faint)]">
            Every Factorial employee below is shown as Unresolved and their TrackingTime hours as —.
            That is the honest state: without crm.factorial_person_reference there is no lawful way to
            say whose hours are whose, and this page will not fall back to matching names.
          </p>
        </Card>
      )}

      {identity.available && unresolved > 0 && (
        <Card className="px-4 py-3">
          <div className="flex items-baseline gap-2.5">
            <span className="font-mono text-[10px] tracking-[0.1em] text-[var(--warning)]">
              {unresolved} UNRESOLVED {unresolved === 1 ? "IDENTITY" : "IDENTITIES"}
            </span>
            <span className="text-[12px] text-[var(--text-secondary)]">
              {identity.resolved} of {identity.resolved + identity.unresolved} active Factorial
              employees resolve to a hub person.
            </span>
          </div>
          <p className="mt-1 text-[11px] leading-relaxed text-[var(--text-faint)]">
            Their Logged, Billable and % Bill columns read — because we do not know which
            TrackingTime member they are, not because they logged nothing. Resolve them in the
            Factorial identity queue at /admin/factorial-identity and they appear here with hours;
            ADR-001 forbids this page from guessing by name.
          </p>
        </Card>
      )}

      {/*
        Four headline figures. Each hint states the denominator, because the
        totals deliberately cover DIFFERENT people counts: presence sums over
        those who clock, logged sums over those with a TT account, and the two
        sets overlap but are not equal.
      */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile
          label="PRESENT · FACTORIAL"
          value={factorialError ? null : totals.presentHours.toLocaleString("en-GB")}
          unit="h"
          hint={factorialError ? "not measured — Factorial unreachable" : `clocked by ${totals.presentCount} people`}
          data-metric="factorial-present-total"
        />
        <StatTile
          label="LOGGED · TRACKINGTIME"
          value={totals.loggedHours.toLocaleString("en-GB")}
          unit="h"
          hint={`logged by ${totals.loggedCount} people, calendar excluded`}
          data-metric="factorial-logged-total"
        />
        <StatTile
          label="BILLABLE"
          value={totals.billableHours.toLocaleString("en-GB")}
          unit="h"
          hint={
            billableShare === null
              ? "no logged hours in window"
              : `${billableShare}% of logged time`
          }
          tone={billableShare !== null && billableShare >= 60 ? "good" : "neutral"}
          data-metric="factorial-billable-total"
        />
        <StatTile
          label="MATCHED IDENTITIES"
          value={`${matched} / ${people.length}`}
          hint={
            unresolved > 0
              ? `${unresolved} unresolved — exact Factorial employee id only, never a name`
              : "exact Factorial employee id only, never a name"
          }
          tone={unresolved > 0 ? "warning" : "neutral"}
          data-metric="factorial-matched-count"
        />
      </div>

      {/*
        The roster. One table, not per-team cards: with 12 Factorial teams and
        overlapping membership, team cards repeated people and buried the
        comparison. The team is a searchable qualifier under each name instead —
        type "Safety" in the table search to scope to a team.
      */}
      <DataTable<PersonComparison>
        rows={people}
        columns={columns}
        rowKey={(p) => p.memberId ?? `f-${p.factorialId}`}
        title="Presence vs project hours, per person"
        hint={`${windowFrom} → ${windowTo} · ${windowDays} days`}
        freezeFirstColumn
        initialSort="logged"
        initialDesc
        exportName="operations-analytics"
        searchPlaceholder="Search name, team, or system…"
        emptyText="No people found in either system."
        footnote={
          <>
            Present is contracted working time clocked in Factorial; Logged is project work
            tracked in TrackingTime with calendar placeholders excluded. The two measure
            different things and overlap imperfectly, so no column subtracts one from the
            other. — always means unmeasured, never zero. Identity is resolved on the exact
            Factorial employee id through the recorded decisions in the identity queue; a row
            marked Unresolved has no lawful link to a TrackingTime member, so its project
            columns are unmeasured rather than empty.
          </>
        }
      />

      {/*
        Team rollup AFTER the roster: it answers a narrower question ("how does
        Safety compare to Admin?") and derives from the same rows. Bounded list
        (12 Factorial teams), so a hand-rolled layout is within the rules.
      */}
      <Card as="section">
        <CardHeader
          title="By Factorial team"
          qualifier={`${report.teams.length} TEAMS · MEMBERS MAY APPEAR IN SEVERAL`}
        />
        <div className="grid grid-cols-1 gap-px bg-[var(--divider)] sm:grid-cols-2 lg:grid-cols-3">
          {report.teams
            .filter((t) => t.memberFactorialIds.length > 0)
            .map((team) => {
              // Exact id membership. Matching on p.name here would be the same
              // ADR-001 violation the join below the fold was fixed for.
              const ids = new Set(team.memberFactorialIds);
              const members = people.filter((p) => p.factorialId !== null && ids.has(p.factorialId));
              const withPresent = members.filter((p) => p.presentHours !== null);
              const withLogged = members.filter((p) => p.loggedHours !== null);
              const present = withPresent.reduce((s, p) => s + (p.presentHours ?? 0), 0);
              const logged = withLogged.reduce((s, p) => s + (p.loggedHours ?? 0), 0);
              return (
                <div key={team.name} className="flex flex-col gap-2 bg-[var(--surface)] p-4">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="truncate text-[13px] font-semibold text-[var(--text-primary)]">
                      {team.name}
                    </span>
                    <span className="font-mono text-[10px] text-[var(--text-faint)]">
                      {members.length} people
                    </span>
                  </div>
                  <div className="flex items-baseline gap-4">
                    <div className="flex flex-col">
                      <span className="font-mono text-[10px] tracking-[0.08em] text-[var(--text-faint)]">
                        PRESENT
                      </span>
                      <span className="font-mono text-[15px] font-semibold text-[var(--text-primary)]">
                        {withPresent.length === 0 ? "—" : `${Math.round(present).toLocaleString("en-GB")}h`}
                      </span>
                      <span className="font-mono text-[10px] text-[var(--text-faint)]">
                        {withPresent.length === 0
                          ? "nobody clocks"
                          : `${withPresent.length} of ${members.length} measured`}
                      </span>
                    </div>
                    <div className="flex flex-col">
                      <span className="font-mono text-[10px] tracking-[0.08em] text-[var(--text-faint)]">
                        LOGGED
                      </span>
                      <span className="font-mono text-[15px] font-semibold text-[var(--text-primary)]">
                        {withLogged.length === 0 ? "—" : `${Math.round(logged).toLocaleString("en-GB")}h`}
                      </span>
                      <span className="font-mono text-[10px] text-[var(--text-faint)]">
                        {withLogged.length === 0
                          ? "no TT accounts"
                          : `${withLogged.length} of ${members.length} measured`}
                      </span>
                    </div>
                  </div>
                </div>
              );
            })}
        </div>
        <ChartNote>
          Team totals sum only measured members and say how many that is — a team where two
          of six people clock shows the two, not an average pretending to cover six.
        </ChartNote>
      </Card>
    </div>
  );
}
