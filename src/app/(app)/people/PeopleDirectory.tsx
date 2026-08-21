"use client";

import { useMemo, useState, useRef } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { PageHeader } from "@/components/PageHeader";
import { EmptyState } from "@/components/EmptyState";
import { ButtonLink } from "@/components/ui/Button";
import {
  FilterChip,
  SearchInput,
  Select,
  SortHeader,
  type SortDirection,
} from "@/components/ui/Field";
import { capacityLabel, type LivePerson } from "@/lib/queries/people-live";
import { teamLabel } from "@/lib/teams";
import { Pager, usePager } from "@/components/Pager";

/**
 * The people directory, rendering the real TrackingTime roster.
 *
 * WHAT CHANGED AND WHY IT MATTERED
 * --------------------------------
 * This component used to render `public.people` — eight seeded mockup rows
 * ("Anna Brandt", "C. Haas", ...) for a company of 49. It also displayed fields
 * that exist nowhere but the mockup: an employee number, a "SINCE 03/2021"
 * start date, holiday balances, SiFa certifications, and a Factorial document
 * strip. All of it was hardcoded or seeded, and none of it was true.
 *
 * The replacement shows only what TrackingTime actually knows. Where the old
 * page had a confident figure with nothing behind it, this one has either a
 * measured number or "n/a" — never a plausible substitute.
 */
export function PeopleDirectory({
  people,
  archivedCount,
  unlinkedCount,
  mailboxCount,
  initialQuery = "",
  includeArchived = false,
}: {
  people: LivePerson[];
  archivedCount: number;
  unlinkedCount: number;
  mailboxCount: number;
  initialQuery?: string;
  /**
   * Whether the roster ALREADY contains archived members.
   *
   * Server state, not client state: getLivePeople decides what it fetches, so
   * the archived toggle is a URL round-trip (?archived=1, the same shape
   * /projects uses) rather than something this component can filter locally.
   * Filtering archived people out client-side would be a lie of a different
   * kind -- the rows were never fetched.
   */
  includeArchived?: boolean;
}) {
  // `people` can legitimately be empty: RLS scopes the underlying reads, and a
  // fresh database has no import yet. The detail pane dereferences the
  // selection unconditionally, so without this guard the page white-screened.
  const [selectedId, setSelectedId] = useState<number | null>(people[0]?.memberId ?? null);
  const [searchQuery, setSearchQuery] = useState(initialQuery);
  const [onlyLogged, setOnlyLogged] = useState(false);
  const [onlyNoAccount, setOnlyNoAccount] = useState(false);
  /**
   * "" = every team, NO_TEAM = the people with nothing recorded.
   *
   * The no-team bucket is a first-class choice, not an omission: most of the
   * live roster has no team on time.member, and "who have we not placed yet"
   * is a question someone actually asks from this page.
   */
  const [teamFilter, setTeamFilter] = useState<string>("");
  /**
   * Selected capacity bands. EMPTY MEANS EVERYONE, never nobody -- a filter
   * that empties the page on first click reads as data loss.
   */
  const [bands, setBands] = useState<CapacityBand[]>([]);
  const [sortKey, setSortKey] = useState<SortKey>("name");
  const [sortDir, setSortDir] = useState<SortDirection>("asc");

  // Counts are computed on the FULL roster, not the filtered list, so a chip
  // always shows how many rows it would bring in. A count that shrinks to
  // match the current filter tells you nothing you cannot already see.
  const loggedCount = useMemo(() => people.filter((p) => p.totalHours > 0).length, [people]);
  const noAccountCount = useMemo(() => people.filter((p) => !p.hasAccount).length, [people]);

  /**
   * Only the teams actually present, plus the no-team bucket when it is
   * occupied. The canonical four in teams.ts are what /admin can ASSIGN;
   * offering a team with zero people here would be a filter that can only
   * ever empty the list.
   */
  const teamOptions = useMemo(() => {
    const counts = new Map<string, number>();
    let noTeam = 0;
    for (const p of people) {
      if (p.team === null) noTeam += 1;
      else counts.set(p.team, (counts.get(p.team) ?? 0) + 1);
    }
    const named = [...counts.entries()]
      // teamLabel() so a legacy value stored by the mockup era still reads as
      // itself ("Safety (legacy)") instead of as a bare code.
      .map(([value, count]) => ({ value, label: teamLabel(value), count }))
      .sort((a, b) => a.label.localeCompare(b.label, "de"));
    return noTeam > 0
      ? [...named, { value: NO_TEAM, label: "No team recorded", count: noTeam }]
      : named;
  }, [people]);

  /** Counts per capacity band, over the FULL roster, same rule as the chips above. */
  const bandCounts = useMemo(() => {
    const out: Record<CapacityBand, number> = { over: 0, low: 0, ontrack: 0, unknown: 0 };
    for (const p of people) out[bandOf(p)] += 1;
    return out;
  }, [people]);

  const query = searchQuery.trim().toLowerCase();
  const filteredPeople = useMemo(() => {
    const matched = people.filter((p) => {
      const matchesSearch =
        query === "" ||
        p.name.toLowerCase().includes(query) ||
        (p.email ?? "").toLowerCase().includes(query) ||
        (p.accountRole ?? "").toLowerCase().includes(query);
      // "Has logged time" rather than a department filter: TrackingTime has no
      // department concept, and the old SAFETY/ENG/LAB tabs were mockup values.
      const matchesLogged = !onlyLogged || p.totalHours > 0;
      const matchesAccount = !onlyNoAccount || !p.hasAccount;
      // Team is real data or it is absent. An unrecorded team matches the
      // no-team bucket and nothing else -- it is never folded into a guess.
      const matchesTeam =
        teamFilter === "" ||
        (teamFilter === NO_TEAM ? p.team === null : p.team === teamFilter);
      // No selection = everyone. Including `unknown` in the band list is the
      // ONLY way null utilisation is filtered on, so "no basis to judge" is
      // never silently scored as 0%.
      const matchesBand = bands.length === 0 || bands.includes(bandOf(p));
      return matchesSearch && matchesLogged && matchesAccount && matchesTeam && matchesBand;
    });
    return sortPeople(matched, sortKey, sortDir);
  }, [people, query, onlyLogged, onlyNoAccount, teamFilter, bands, sortKey, sortDir]);

  const activeFilterCount =
    (onlyLogged ? 1 : 0) +
    (onlyNoAccount ? 1 : 0) +
    (query ? 1 : 0) +
    (teamFilter ? 1 : 0) +
    bands.length;

  /**
   * Reset everything the client owns. Deliberately does NOT drop
   * ?archived=1: that is a decision about which rows exist at all, and
   * silently re-hiding 30 people as a side effect of "clear filters" would
   * shrink the roster without being asked to.
   */
  const clearFilters = () => {
    setSearchQuery("");
    setOnlyLogged(false);
    setOnlyNoAccount(false);
    setTeamFilter("");
    setBands([]);
  };

  const toggleBand = (b: CapacityBand) =>
    setBands((cur) => (cur.includes(b) ? cur.filter((x) => x !== b) : [...cur, b]));

  /**
   * The archived toggle rewrites the URL, because the server decides the
   * roster. `scroll: false` keeps you where you were reading.
   */
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const toggleArchived = () => {
    const next = new URLSearchParams(searchParams.toString());
    if (includeArchived) next.delete("archived");
    else next.set("archived", "1");
    const qs = next.toString();
    router.push(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  };

  /**
   * Paged, not appended.
   *
   * The roster column rendered all 19 active people, which pushed the detail pane beside
   * it -- the actual content of the page -- below a list you had to scroll through. The
   * first fix here was a SHOW n MORE control, which is the shape the user then reported as
   * a problem on Projects: clicking it grows the document, so the control moves away from
   * you. This uses the shared fixed-height pager instead, so the column is the same height
   * whichever page you are on.
   *
   * Ten per page, because this column sits beside the detail pane rather than owning the
   * width: more rows than that and the pane is pushed off screen again, which was the
   * original complaint.
   *
   * The reset key is the filter state. Without it, searching while on page 2 could leave
   * you looking at an empty column when the match is on page 1.
   */
  const PAGE_SIZE = 10;
  const pager = usePager(
    filteredPeople.length,
    PAGE_SIZE,
    // Every filter belongs in the reset key: narrowing while on page 3 would
    // otherwise leave you looking at an empty column.
    `${query}|${onlyLogged}|${onlyNoAccount}|${teamFilter}|${[...bands].sort().join(",")}`,
  );
  const visiblePeople = filteredPeople.slice(pager.start, pager.end);
  const listRef = useRef<HTMLDivElement>(null);

  // Resolve by id against the live prop rather than holding a snapshot in
  // state, and prefer a selection that is actually in the filtered list.
  const selectedPerson =
    filteredPeople.find((p) => p.memberId === selectedId) ?? filteredPeople[0] ?? people[0];

  /** Re-clicking the active column reverses it; a new column starts fresh. */
  const handleSort = (key: string) => {
    const next = key as SortKey;
    if (next === sortKey) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(next);
      // Names read naturally A→Z; every numeric column is more useful
      // largest-first, which is what someone scanning for outliers wants.
      setSortDir(next === "name" ? "asc" : "desc");
    }
  };

  if (!selectedPerson) {
    return (
      <>
        <PageHeader
          category="HSE HUB / RECORDS"
          title="People & Profiles"
          meta="NO RECORDS VISIBLE"
        />
        <div className="p-6">
          <EmptyState
            title="No people are visible to you"
            description="Either the TrackingTime import has not run yet, or your role only permits access to your own record. Ask an administrator, or run the TrackingTime sync."
          />
        </div>
      </>
    );
  }

  const tone = (t: "critical" | "warning" | "good" | "neutral") =>
    t === "critical"
      ? "var(--critical)"
      : t === "warning"
        ? "var(--warning)"
        : t === "good"
          ? "var(--accent)"
          : "var(--text-muted)";

  const capacity = capacityLabel(selectedPerson.utilisationPercent);

  return (
    <>
      <PageHeader
        category="HSE HUB / RECORDS"
        title="People & Profiles"
        /*
         * A template literal is NOT JSX text: "&amp;" inside one reaches the
         * DOM as the five literal characters, which is exactly what the live
         * page showed ("8 ACTIVE CONSULTANTS &amp; STAFF"). Use the character.
         */
        meta={`${people.length} ${includeArchived ? "ACTIVE + ARCHIVED" : "ACTIVE"} · ${archivedCount} ARCHIVED${
          includeArchived ? " INCLUDED" : ""
        }${
          mailboxCount > 0 ? ` · ${mailboxCount} SHARED INBOX EXCLUDED` : ""
        } · TRACKINGTIME`}
      />

      <div className="flex min-h-[calc(100vh-130px)] flex-col border-b border-[var(--border)] lg:flex-row">
        {/* Left: roster */}
        <div className="flex w-full flex-none flex-col border-b border-[var(--border)] bg-[var(--sidebar)] lg:w-[330px] lg:border-b-0 lg:border-r">
          <div className="flex flex-col gap-2.5 border-b border-[var(--border)] p-4">
            <div className="flex items-baseline justify-between">
              <span className="text-[14px] font-semibold text-[var(--text-primary)]">People</span>
              {/* Shows what is on screen over the matching total, so a
                  truncated list cannot be mistaken for the whole roster. */}
              {/* A live region, so toggling a filter ANNOUNCES the new count.
                  Without it the only feedback for a screen-reader user is the
                  chip's own pressed state, which says nothing about whether
                  the roster still contains anybody. */}
              <span
                role="status"
                aria-live="polite"
                className="font-mono text-[10px] text-[var(--text-muted)]"
              >
                {visiblePeople.length} OF {filteredPeople.length}
                {filteredPeople.length !== people.length && ` (${people.length} TOTAL)`}
              </span>
            </div>

            <SearchInput
              label="Search people by name, email or role"
              value={searchQuery}
              onValueChange={setSearchQuery}
              placeholder="Search name, email, role…"
            />

            {/* data-people-filters marks the whole bar as one control group for
                live verification, so a check can assert the filters reached the
                DOM rather than inferring it from a class name. */}
            <div data-people-filters="1" className="flex flex-col gap-2">
              {teamOptions.length > 0 && (
                <div className="flex items-center gap-2">
                  {/* Native <select>, per Field.tsx: a handful of teams needs no
                      search box, and it is one tap on a phone. */}
                  <Select
                    label="Filter by team"
                    value={teamFilter}
                    onChange={(e) => setTeamFilter(e.target.value)}
                    className="w-full"
                  >
                    {/* The default is EVERYONE. A team filter that starts
                        pre-narrowed would misreport the roster size. */}
                    <option key="__all" value="">All teams ({people.length})</option>
                    {teamOptions.map((t) => (
                      <option key={t.value} value={t.value}>
                        {t.label} ({t.count})
                      </option>
                    ))}
                  </Select>
                </div>
              )}

            <div className="flex flex-wrap gap-1.5">
              <FilterChip
                active={onlyLogged}
                onToggle={() => setOnlyLogged((v) => !v)}
                count={loggedCount}
              >
                HAS LOGGED TIME
              </FilterChip>
              {/*
                Surfaced as a filter, not just a badge: 16 of 19 active people
                have no Hub sign-in, and "show me exactly who still needs an
                account" is the action someone actually takes from this page.
              */}
              <FilterChip
                active={onlyNoAccount}
                onToggle={() => setOnlyNoAccount((v) => !v)}
                count={noAccountCount}
              >
                NO HUB ACCOUNT
              </FilterChip>
              {/*
                Archived is a SERVER decision (getLivePeople's includeArchived),
                so this chip pushes ?archived=1 rather than filtering locally.
                Offered because 30 of the 49 members are archived and their
                hours are still in every project total -- "who logged this"
                and "who can I staff" are different questions.
              */}
              {(archivedCount > 0 || includeArchived) && (
                <FilterChip
                  active={includeArchived}
                  onToggle={toggleArchived}
                  count={archivedCount}
                >
                  INCLUDE ARCHIVED
                </FilterChip>
              )}
            </div>

            {/*
              Capacity bands, from the same capacityLabel() the detail pane
              shows, so a chip and a badge can never disagree. NO UTILISATION
              DATA is its own chip: null means "no basis to judge", and folding
              it into LOW UTILISATION would accuse people of idling when the
              truth is that they have logged nothing to measure.
            */}
            <div className="flex flex-wrap gap-1.5">
              {CAPACITY_BANDS.map((b) => (
                <FilterChip
                  key={b.band}
                  active={bands.includes(b.band)}
                  onToggle={() => toggleBand(b.band)}
                  count={bandCounts[b.band]}
                >
                  {b.label}
                </FilterChip>
              ))}
            </div>

            {/* The clear affordance lives WITH the filters, not only in the
                filtered-to-empty state: a narrowed-but-not-empty list needs a
                way out too, and you should not have to empty it to find one. */}
            {activeFilterCount > 0 && (
              <button
                type="button"
                onClick={clearFilters}
                className="self-start font-mono text-[10px] text-[var(--accent)] hover:underline"
              >
                CLEAR {activeFilterCount} FILTER{activeFilterCount === 1 ? "" : "S"}
              </button>
            )}
            </div>

            <div className="flex items-center justify-between gap-2 border-t border-[var(--divider)] pt-2">
              <SortHeader
                label="NAME"
                columnKey="name"
                activeKey={sortKey}
                direction={sortDir}
                onSort={handleSort}
              />
              <div className="flex items-center gap-3">
                <SortHeader
                  label="HOURS"
                  columnKey="hours"
                  activeKey={sortKey}
                  direction={sortDir}
                  onSort={handleSort}
                />
                <SortHeader
                  label="BILLABLE"
                  columnKey="billable"
                  activeKey={sortKey}
                  direction={sortDir}
                  onSort={handleSort}
                />
              </div>
            </div>
          </div>

          <div ref={listRef} className="flex flex-col divide-y divide-[var(--divider)] overflow-y-auto">
            {/*
              A filtered-to-empty roster is a different situation from an empty
              database, and needs a different exit: the way out is to relax the
              filter, not to run a sync.
            */}
            {filteredPeople.length === 0 && (
              <div className="flex flex-col items-start gap-2 p-4">
                <p className="text-[12px] text-[var(--text-secondary)]">
                  No one matches {query ? `“${searchQuery.trim()}”` : "these filters"}.
                </p>
                <button
                  type="button"
                  onClick={clearFilters}
                  className="font-mono text-[10px] text-[var(--accent)] hover:underline"
                >
                  CLEAR {activeFilterCount} FILTER{activeFilterCount === 1 ? "" : "S"}
                </button>
              </div>
            )}
            {visiblePeople.map((person) => {
              const isSelected = selectedPerson.memberId === person.memberId;
              return (
                <button
                  key={person.memberId}
                  onClick={() => setSelectedId(person.memberId)}
                  className={`flex items-center gap-3 p-3.5 text-left transition-colors ${
                    isSelected
                      ? "border-l-2 border-[var(--accent)] bg-[var(--surface-hover)]"
                      : "border-l-2 border-transparent hover:bg-[var(--surface)]"
                  }`}
                >
                  <span
                    aria-hidden="true"
                    className="flex h-7 w-7 flex-none items-center justify-center rounded-full bg-[var(--surface-2)] font-mono text-[10px] font-semibold text-[var(--text-secondary)]"
                  >
                    {initialsOf(person.name)}
                  </span>
                  <div className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate text-[12px] font-medium text-[var(--text-primary)]">
                      {person.name}
                    </span>
                    <span className="truncate font-mono text-[10px] text-[var(--text-muted)]">
                      {/* Absence renders as absence: a person with no team shows
                          the role alone rather than a guessed one. */}
                      {person.team !== null
                        ? `${person.accountRole ?? "—"} · ${teamLabel(person.team)}`
                        : (person.accountRole ?? "—")}
                    </span>
                  </div>
                  {/*
                    "n/a" not "0%": four active members have logged nothing at
                    all, and a green 0% reads as a measurement of idleness
                    rather than an absence of data.
                  */}
                  <span
                    className="shrink-0 font-mono text-[11px] font-medium"
                    style={{
                      color:
                        person.billablePercent === null
                          ? "var(--text-faint)"
                          : "var(--accent)",
                    }}
                  >
                    {person.billablePercent !== null ? `${person.billablePercent}%` : "n/a"}
                  </span>
                </button>
              );
            })}

          </div>

          {/* Fixed-height paging, so the roster column never pushes the detail pane
              off screen. 10 per page by default; ALL is still offered for anyone who
              wants to use the browser's own find across the whole roster. */}
          <Pager
            state={pager}
            total={filteredPeople.length}
            noun="people"
            anchorRef={listRef}
            sizes={[10, 25, 50]}
          />
        </div>

        {/* Right: selected person */}
        <div className="flex flex-1 flex-col bg-[var(--page)] p-6">
          <div className="flex flex-wrap items-start gap-4 border-b border-[var(--border)] pb-5">
            <span
              aria-hidden="true"
              className="flex h-14 w-14 flex-none items-center justify-center rounded-full bg-[var(--surface-2)] font-mono text-[16px] font-semibold text-[var(--text-secondary)]"
            >
              {initialsOf(selectedPerson.name)}
            </span>

            <div className="flex flex-col gap-1">
              <h2 className="text-[19px] font-semibold text-[var(--text-primary)]">
                {selectedPerson.name}
              </h2>
              <span className="font-mono text-[11px] text-[var(--text-muted)]">
                {selectedPerson.email ?? "no email on record"}
              </span>
              <div className="mt-1 flex flex-wrap gap-2">
                {capacity ? (
                  <span
                    className="px-2 py-0.5 font-mono text-[10px] font-medium"
                    style={{
                      color: tone(capacity.tone),
                      background: "var(--surface)",
                    }}
                  >
                    {capacity.label}
                  </span>
                ) : (
                  <span className="bg-[var(--surface)] px-2 py-0.5 font-mono text-[10px] text-[var(--text-faint)]">
                    NO UTILISATION DATA
                  </span>
                )}
                {/*
                  "NOMINAL" is load-bearing. Every member reports exactly 40
                  h/week because that is TrackingTime's account-wide default,
                  not anyone's contract — so this must not read as contractual.
                */}
                <span
                  className="bg-[var(--surface)] px-2 py-0.5 font-mono text-[10px] text-[var(--text-secondary)]"
                  title="TrackingTime account default, not a contracted figure"
                >
                  NOMINAL {selectedPerson.weeklyHours} H/WEEK
                </span>
                <span className="bg-[var(--surface)] px-2 py-0.5 font-mono text-[10px] text-[var(--text-secondary)]">
                  {selectedPerson.accountRole ?? "NO ROLE"}
                </span>
                {/* Stated either way. "NO TEAM RECORDED" is the honest reading
                    of a blank column, and it is the thing somebody would act
                    on; a missing badge just looks like the page forgot. */}
                <span
                  className="bg-[var(--surface)] px-2 py-0.5 font-mono text-[10px]"
                  style={{
                    color:
                      selectedPerson.team === null
                        ? "var(--text-faint)"
                        : "var(--text-secondary)",
                  }}
                >
                  {selectedPerson.team !== null
                    ? teamLabel(selectedPerson.team).toUpperCase()
                    : "NO TEAM RECORDED"}
                </span>
                {selectedPerson.isArchived && (
                  <span className="bg-[var(--surface)] px-2 py-0.5 font-mono text-[10px] text-[var(--warning)]">
                    ARCHIVED IN TRACKINGTIME
                  </span>
                )}
                {/*
                  Surfaced deliberately: 46 of 49 members have no Hub login, so
                  they cannot sign in and see their own hours. That is an
                  operational fact worth showing, not one to hide.
                */}
                {!selectedPerson.hasAccount && (
                  <span className="bg-[var(--surface)] px-2 py-0.5 font-mono text-[10px] text-[var(--warning)]">
                    NO HUB ACCOUNT
                  </span>
                )}
              </div>
            </div>

            <div className="ml-auto flex items-center gap-2">
              <ButtonLink
                variant="secondary"
                href={`/time/dashboard?members=${selectedPerson.memberId}`}
              >
                View in dashboard
              </ButtonLink>
            </div>
          </div>

          {/* Measured figures only */}
          <div className="my-5 grid grid-cols-1 border border-[var(--border)] bg-[var(--surface)] sm:grid-cols-2 lg:grid-cols-4">
            <Kpi
              label="HOURS LOGGED"
              value={
                selectedPerson.totalHours > 0
                  ? selectedPerson.totalHours.toLocaleString("de-DE", {
                      maximumFractionDigits: 0,
                    })
                  : null
              }
              suffix={`${selectedPerson.entryCount.toLocaleString("de-DE")} ENTRIES`}
              border="sm:border-r lg:border-b-0"
            />
            <Kpi
              label="BILLABLE SHARE"
              value={
                selectedPerson.billablePercent !== null
                  ? `${selectedPerson.billablePercent}%`
                  : null
              }
              suffix={`${selectedPerson.billableHours.toLocaleString("de-DE", {
                maximumFractionDigits: 0,
              })} H BILLABLE`}
              accent
              border="lg:border-r"
            />
            <Kpi
              label="UTILISATION"
              value={
                selectedPerson.utilisationPercent !== null
                  ? `${selectedPerson.utilisationPercent}%`
                  : null
              }
              // Not "OF CONTRACTED": the 40h basis is a TrackingTime default,
              // and calling it contracted would dress a default as a fact.
              suffix="OF NOMINAL 40 H, WEEKS ACTIVE"
              border="sm:border-r"
            />
            <Kpi
              label="WEEKS ACTIVE"
              value={selectedPerson.weeksActive > 0 ? String(selectedPerson.weeksActive) : null}
              suffix={
                selectedPerson.lastActivityAt
                  ? `LAST ${selectedPerson.lastActivityAt.slice(0, 10)}`
                  : "NO ACTIVITY"
              }
              border=""
            />
          </div>

          {/* Assignments — real projects this person logged against */}
          <div className="flex flex-col gap-3 border border-[var(--border)] bg-[var(--surface)] p-4">
            <div className="flex items-baseline gap-2.5">
              <span className="text-[12px] font-semibold text-[var(--text-primary)]">
                Projects
              </span>
              <span className="font-mono text-[10px] text-[var(--text-muted)]">
                TOP {selectedPerson.assignments.length} BY HOURS · TRACKINGTIME
              </span>
            </div>

            {selectedPerson.assignments.length === 0 ? (
              <p className="font-mono text-[11px] text-[var(--text-faint)]">
                No time logged against any project.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <div className="grid min-w-[420px] grid-cols-12 border-b border-[var(--border)] pb-2 font-mono text-[10px] tracking-[0.1em] text-[var(--text-faint)]">
                  <span className="col-span-6">PROJECT</span>
                  <span className="col-span-2 text-right">LOGGED</span>
                  <span className="col-span-2 text-right">BILLABLE</span>
                  <span className="col-span-2 text-right">SHARE</span>
                </div>

                {selectedPerson.assignments.map((asg) => (
                  <div
                    key={`${asg.projectId ?? "none"}-${asg.projectName}`}
                    className="grid min-w-[420px] grid-cols-12 items-center border-b border-[var(--divider)] py-2 text-[12px] transition-colors hover:bg-[var(--surface-hover)]"
                  >
                    {/* The unattributed row has no record to link to. */}
                    {asg.projectId !== null ? (
                      <Link
                        href={`/projects/${asg.projectId}`}
                        className="col-span-6 truncate font-medium text-[var(--text-primary)] hover:text-[var(--accent)]"
                      >
                        {asg.projectName}
                      </Link>
                    ) : (
                      <span className="col-span-6 truncate text-[var(--text-muted)]">
                        {asg.projectName}
                      </span>
                    )}
                    <span className="col-span-2 text-right font-mono text-[var(--text-secondary)]">
                      {asg.loggedHours.toLocaleString("de-DE", { maximumFractionDigits: 0 })} h
                    </span>
                    <span className="col-span-2 text-right font-mono text-[var(--text-secondary)]">
                      {asg.billableHours.toLocaleString("de-DE", { maximumFractionDigits: 0 })} h
                    </span>
                    <span className="col-span-2 text-right font-mono font-medium text-[var(--accent)]">
                      {asg.sharePercent}%
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {unlinkedCount > 0 && (
            <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border border-[var(--border)] bg-[var(--surface)] p-4">
              <span className="text-[12px] text-[var(--text-secondary)]">
                {unlinkedCount} of the {people.length} people listed have no Hub sign-in yet, so
                they cannot see their own hours.
              </span>
              <ButtonLink variant="primary" href="/admin/users" className="whitespace-nowrap">
                Manage users
              </ButtonLink>
            </div>
          )}
        </div>
      </div>
    </>
  );
}

type SortKey = "name" | "hours" | "billable";

/** Sentinel for the "nothing recorded" team, which has no value of its own. */
const NO_TEAM = "__none";

type CapacityBand = "over" | "low" | "ontrack" | "unknown";

/**
 * The band chips, in the order someone reads them: the two that need action,
 * then the healthy one, then the one that is an absence of data.
 */
const CAPACITY_BANDS: { band: CapacityBand; label: string }[] = [
  { band: "over", label: "OVER CAPACITY" },
  { band: "low", label: "LOW UTILISATION" },
  { band: "ontrack", label: "ON TRACK" },
  { band: "unknown", label: "NO UTILISATION DATA" },
];

/**
 * Which band a person falls in.
 *
 * Derived from capacityLabel() rather than re-deriving the thresholds, so the
 * chip that says OVER CAPACITY and the badge in the detail pane cannot drift
 * apart. A null utilisation is `unknown` -- its own bucket, never 0%.
 */
function bandOf(p: LivePerson): CapacityBand {
  const cap = capacityLabel(p.utilisationPercent);
  if (cap === null) return "unknown";
  if (cap.label === "OVER CAPACITY") return "over";
  if (cap.label === "LOW UTILISATION") return "low";
  return "ontrack";
}

/**
 * Order the roster.
 *
 * The trap here is `billablePercent: null`, which means "this person has logged
 * nothing at all" — four active members are in that state. Coercing null to 0
 * would sort them among the genuinely-0% people and imply a measurement that
 * was never taken, so unmeasured rows are pinned to the end in BOTH directions.
 * Reversing the sort must not promote an absence of data to the top of the list.
 */
function sortPeople(rows: LivePerson[], key: SortKey, dir: SortDirection): LivePerson[] {
  const factor = dir === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => {
    if (key === "name") {
      // localeCompare, not `<`: "Ärztin" must sort beside "Arztin", and the
      // live roster contains German names with umlauts.
      return a.name.localeCompare(b.name, "de") * factor;
    }
    const av = key === "hours" ? a.totalHours : a.billablePercent;
    const bv = key === "hours" ? b.totalHours : b.billablePercent;
    if (av === null && bv === null) return a.name.localeCompare(b.name, "de");
    if (av === null) return 1;
    if (bv === null) return -1;
    if (av === bv) return a.name.localeCompare(b.name, "de");
    return (av - bv) * factor;
  });
}

/** One measured figure. Renders "n/a" — never 0 — when there is no value. */
function Kpi({
  label,
  value,
  suffix,
  accent = false,
  border,
}: {
  label: string;
  value: string | null;
  suffix: string;
  accent?: boolean;
  border: string;
}) {
  return (
    <div className={`flex flex-col gap-1 border-b border-[var(--border)] p-3.5 ${border}`}>
      <span className="font-mono text-[10px] tracking-[0.1em] text-[var(--text-muted)]">
        {label}
      </span>
      <span
        className="font-mono text-[22px] font-semibold"
        style={{
          color:
            value === null
              ? "var(--text-faint)"
              : accent
                ? "var(--accent)"
                : "var(--text-primary)",
        }}
      >
        {value ?? "n/a"}
      </span>
      <span className="font-mono text-[10px] text-[var(--text-faint)]">{suffix}</span>
    </div>
  );
}

/**
 * "Björn Schönemann" -> "BS". Falls back to one initial for mononyms like
 * "azubuike", which is a real member name in the live account.
 */
function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}
