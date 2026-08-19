"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { PageHeader } from "@/components/PageHeader";
import { EmptyState } from "@/components/EmptyState";
import { ButtonLink } from "@/components/ui/Button";
import { FilterChip, SearchInput, SortHeader, type SortDirection } from "@/components/ui/Field";
import { capacityLabel, type LivePerson } from "@/lib/queries/people-live";

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
}: {
  people: LivePerson[];
  archivedCount: number;
  unlinkedCount: number;
  mailboxCount: number;
  initialQuery?: string;
}) {
  // `people` can legitimately be empty: RLS scopes the underlying reads, and a
  // fresh database has no import yet. The detail pane dereferences the
  // selection unconditionally, so without this guard the page white-screened.
  const [selectedId, setSelectedId] = useState<number | null>(people[0]?.memberId ?? null);
  const [searchQuery, setSearchQuery] = useState(initialQuery);
  const [onlyLogged, setOnlyLogged] = useState(false);
  const [onlyNoAccount, setOnlyNoAccount] = useState(false);
  const [sortKey, setSortKey] = useState<SortKey>("name");
  const [sortDir, setSortDir] = useState<SortDirection>("asc");

  // Counts are computed on the FULL roster, not the filtered list, so a chip
  // always shows how many rows it would bring in. A count that shrinks to
  // match the current filter tells you nothing you cannot already see.
  const loggedCount = useMemo(() => people.filter((p) => p.totalHours > 0).length, [people]);
  const noAccountCount = useMemo(() => people.filter((p) => !p.hasAccount).length, [people]);

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
      return matchesSearch && matchesLogged && matchesAccount;
    });
    return sortPeople(matched, sortKey, sortDir);
  }, [people, query, onlyLogged, onlyNoAccount, sortKey, sortDir]);

  const activeFilterCount = (onlyLogged ? 1 : 0) + (onlyNoAccount ? 1 : 0) + (query ? 1 : 0);

  /**
   * Show ten, then let people ask for more.
   *
   * The list rendered all 19 active people at once, which meant the detail pane
   * beside it -- the actual content of this page -- was pushed below a column you
   * had to scroll through to reach anything. Reported as "I have to scroll a lot".
   *
   * A page size rather than a scroll container: the surrounding layout already
   * scrolls, so a nested scrollbar gives two competing ones and a mouse wheel that
   * does different things depending on where the pointer happens to be.
   *
   * SEARCHING RESETS THE PAGE. Without this, typing a name while expanded leaves
   * the list showing "19 of 19" over three results, and collapsing later would hide
   * a match. The reset is keyed on the filter state below.
   */
  const PAGE_SIZE = 10;
  const [showAll, setShowAll] = useState(false);
  const visiblePeople = showAll ? filteredPeople : filteredPeople.slice(0, PAGE_SIZE);
  const hiddenCount = filteredPeople.length - visiblePeople.length;

  // Derived-state reset, done by comparing the previous filter signature during
  // render rather than in an effect: an effect would paint one frame of the wrong
  // list first, and React's own docs call this out as the case for this pattern.
  const filterSignature = `${query}|${onlyLogged}|${onlyNoAccount}`;
  const [lastSignature, setLastSignature] = useState(filterSignature);
  if (filterSignature !== lastSignature) {
    setLastSignature(filterSignature);
    setShowAll(false);
  }

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
        meta={`${people.length} ACTIVE · ${archivedCount} ARCHIVED${
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
              <span className="font-mono text-[10.5px] text-[var(--text-muted)]">
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

          <div className="flex flex-col divide-y divide-[var(--divider)] overflow-y-auto">
            {/*
              A filtered-to-empty roster is a different situation from an empty
              database, and needs a different exit: the way out is to relax the
              filter, not to run a sync.
            */}
            {filteredPeople.length === 0 && (
              <div className="flex flex-col items-start gap-2 p-4">
                <p className="text-[12.5px] text-[var(--text-secondary)]">
                  No one matches {query ? `“${searchQuery.trim()}”` : "these filters"}.
                </p>
                <button
                  type="button"
                  onClick={() => {
                    setSearchQuery("");
                    setOnlyLogged(false);
                    setOnlyNoAccount(false);
                  }}
                  className="font-mono text-[10.5px] text-[var(--accent)] hover:underline"
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
                    <span className="truncate text-[12.5px] font-medium text-[var(--text-primary)]">
                      {person.name}
                    </span>
                    <span className="truncate font-mono text-[10px] text-[var(--text-muted)]">
                      {person.accountRole ?? "—"}
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

            {/*
              The way out of a truncated list, and the count that makes it
              honest. Without a visible "n more" the shortened list would look
              like the whole roster -- the same class of mistake as the mockup
              chart that showed three tidy boxes while thirty people were
              missing. Selecting somebody hidden is still possible without
              expanding, because search filters the full list.
            */}
            {hiddenCount > 0 && (
              <button
                type="button"
                onClick={() => setShowAll(true)}
                className="p-3 text-left font-mono text-[10.5px] tracking-[0.06em] text-[var(--accent)] transition-colors hover:bg-[var(--surface)]"
              >
                SHOW {hiddenCount} MORE
              </button>
            )}
            {showAll && filteredPeople.length > PAGE_SIZE && (
              <button
                type="button"
                onClick={() => setShowAll(false)}
                className="p-3 text-left font-mono text-[10.5px] tracking-[0.06em] text-[var(--text-muted)] transition-colors hover:bg-[var(--surface)] hover:text-[var(--text-primary)]"
              >
                SHOW FEWER
              </button>
            )}
          </div>
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
                    className="px-2 py-0.5 font-mono text-[10.5px] font-medium"
                    style={{
                      color: tone(capacity.tone),
                      background: "var(--surface)",
                    }}
                  >
                    {capacity.label}
                  </span>
                ) : (
                  <span className="bg-[var(--surface)] px-2 py-0.5 font-mono text-[10.5px] text-[var(--text-faint)]">
                    NO UTILISATION DATA
                  </span>
                )}
                {/*
                  "NOMINAL" is load-bearing. Every member reports exactly 40
                  h/week because that is TrackingTime's account-wide default,
                  not anyone's contract — so this must not read as contractual.
                */}
                <span
                  className="bg-[var(--surface)] px-2 py-0.5 font-mono text-[10.5px] text-[var(--text-secondary)]"
                  title="TrackingTime account default, not a contracted figure"
                >
                  NOMINAL {selectedPerson.weeklyHours} H/WEEK
                </span>
                <span className="bg-[var(--surface)] px-2 py-0.5 font-mono text-[10.5px] text-[var(--text-secondary)]">
                  {selectedPerson.accountRole ?? "NO ROLE"}
                </span>
                {/*
                  Surfaced deliberately: 46 of 49 members have no Hub login, so
                  they cannot sign in and see their own hours. That is an
                  operational fact worth showing, not one to hide.
                */}
                {!selectedPerson.hasAccount && (
                  <span className="bg-[var(--surface)] px-2 py-0.5 font-mono text-[10.5px] text-[var(--warning)]">
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
              <span className="text-[12.5px] font-semibold text-[var(--text-primary)]">
                Projects
              </span>
              <span className="font-mono text-[10.5px] text-[var(--text-muted)]">
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
                    className="grid min-w-[420px] grid-cols-12 items-center border-b border-[var(--divider)] py-2 text-[12.5px] transition-colors hover:bg-[var(--surface-hover)]"
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
              <span className="text-[12.5px] text-[var(--text-secondary)]">
                {unlinkedCount} of {people.length} people have no Hub sign-in yet, so they cannot
                see their own hours.
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
