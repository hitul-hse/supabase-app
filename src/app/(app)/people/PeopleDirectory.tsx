"use client";

import { useMemo, useState, useRef } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
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
import { fmtNum, fmtPct } from "@/lib/locale-format";
import { teamLabel } from "@/lib/teams";
import { Pager, usePager } from "@/components/Pager";
import { Card, StatTile } from "@/components/ui/Card";

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
 *
 * TWO SOURCES SINCE 2026-09-02
 * ----------------------------
 * The roster also lists Hub people with no TrackingTime member (three current
 * Factorial employees). They carry `source: "hub"`, a visible HUB marker, and
 * null for every measured field -- which StatTile and the row render as "n/a"
 * with the reason NO TRACKINGTIME ACCOUNT. The header states both numbers so
 * "20 people" can never be read as "20 people with tracked time".
 *
 * LANGUAGE. Every user-visible string here now comes from the `people`
 * namespace, and every figure is formatted for the request locale through
 * @/lib/locale-format. Two figures used to be printed with a hard-coded
 * "de-DE" -- German digits under English words -- so the English page now
 * reads "5,638" and "1,234 ENTRIES" where it read "5.638" and "1.234 ENTRIES"
 * before. That is the correction, not a regression: the separator follows the
 * reader's language like everything else.
 */
export function PeopleDirectory({
  people,
  trackedCount,
  hubOnlyCount,
  archivedCount,
  unlinkedCount,
  mailboxCount,
  initialQuery = "",
  includeArchived = false,
  locale,
}: {
  people: LivePerson[];
  /** Rows with a TrackingTime account -- the roster this page has always counted. */
  trackedCount: number;
  /** Rows that exist only in the Hub; every time-derived figure is null for them. */
  hubOnlyCount: number;
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
  /**
   * The reader's locale, for every figure on this page.
   *
   * A prop rather than useLocale(), because check-people-module.mjs renders
   * this component directly against a next-intl stub that exports
   * useTranslations alone. Undefined there, which locale-format reads as
   * en-GB -- the rendering that gate asserts on.
   */
  locale?: string;
}) {
  // `people` can legitimately be empty: RLS scopes the underlying reads, and a
  // fresh database has no import yet. The detail pane dereferences the
  // selection unconditionally, so without this guard the page white-screened.
  const t = useTranslations("people");
  // "n/a" is one wording for the whole app, so it comes from `common` rather
  // than being said a second time here.
  const common = useTranslations("common");
  // Keyed by LivePerson.key, not memberId: Hub-only people have no member id.
  const [selectedKey, setSelectedKey] = useState<string | null>(people[0]?.key ?? null);
  const [searchQuery, setSearchQuery] = useState(initialQuery);
  const [onlyLogged, setOnlyLogged] = useState(false);
  const [onlyNoAccount, setOnlyNoAccount] = useState(false);
  /** "Show me who is in the Hub but not in TrackingTime" -- the gap someone acts on. */
  const [onlyHub, setOnlyHub] = useState(false);
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
  const loggedCount = useMemo(
    () => people.filter((p) => p.totalHours !== null && p.totalHours > 0).length,
    [people],
  );
  // `=== false`: a Hub-only person's sign-in is null (unknown, recorded on
  // time.member), and "unknown" must not be counted as "missing".
  const noAccountCount = useMemo(
    () => people.filter((p) => p.hasAccount === false).length,
    [people],
  );

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
      ? [...named, { value: NO_TEAM, label: t("filters.noTeam"), count: noTeam }]
      : named;
  }, [people, t]);

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
      const matchesLogged = !onlyLogged || (p.totalHours !== null && p.totalHours > 0);
      const matchesAccount = !onlyNoAccount || p.hasAccount === false;
      const matchesHub = !onlyHub || p.source === "hub";
      // Team is real data or it is absent. An unrecorded team matches the
      // no-team bucket and nothing else -- it is never folded into a guess.
      const matchesTeam =
        teamFilter === "" ||
        (teamFilter === NO_TEAM ? p.team === null : p.team === teamFilter);
      // No selection = everyone. Including `unknown` in the band list is the
      // ONLY way null utilisation is filtered on, so "no basis to judge" is
      // never silently scored as 0%.
      const matchesBand = bands.length === 0 || bands.includes(bandOf(p));
      return (
        matchesSearch && matchesLogged && matchesAccount && matchesHub && matchesTeam && matchesBand
      );
    });
    return sortPeople(matched, sortKey, sortDir);
  }, [people, query, onlyLogged, onlyNoAccount, onlyHub, teamFilter, bands, sortKey, sortDir]);

  const activeFilterCount =
    (onlyLogged ? 1 : 0) +
    (onlyNoAccount ? 1 : 0) +
    (onlyHub ? 1 : 0) +
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
    setOnlyHub(false);
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
    `${query}|${onlyLogged}|${onlyNoAccount}|${onlyHub}|${teamFilter}|${[...bands].sort().join(",")}`,
  );
  const visiblePeople = filteredPeople.slice(pager.start, pager.end);
  const listRef = useRef<HTMLDivElement>(null);

  // Resolve by id against the live prop rather than holding a snapshot in
  // state, and prefer a selection that is actually in the filtered list.
  const selectedPerson =
    filteredPeople.find((p) => p.key === selectedKey) ?? filteredPeople[0] ?? people[0];

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
          category={t("category")}
          title={t("title")}
          meta={t("empty.meta")}
        />
        <div className="p-6">
          <EmptyState
            title={t("empty.title")}
            description={t("empty.description")}
          />
        </div>
      </>
    );
  }

  const tone = (kind: "critical" | "warning" | "good" | "neutral") =>
    kind === "critical"
      ? "var(--critical)"
      : kind === "warning"
        ? "var(--warning)"
        : kind === "good"
          ? "var(--accent)"
          : "var(--text-muted)";

  const capacity = capacityLabel(selectedPerson.utilisationPercent);
  const isHubOnly = selectedPerson.source === "hub";

  /*
   * The count sentence. Both numbers, always: "20 PEOPLE" alone would read as
   * twenty people with tracked time, and 17 is the figure every other page
   * (Overview headcount, the team board) has always meant by the roster.
   *
   *   20 PEOPLE · 17 ON TRACKINGTIME · 3 HUB-ONLY · 30 ARCHIVED
   *   · 2 SHARED INBOX EXCLUDED · TRACKINGTIME + HUB
   *
   * Joined with the character, not "&amp;" -- see the note that used to sit on
   * the old template literal: an entity inside a string reaches the DOM as
   * literal text, which the live page showed for months.
   */
  const headerMeta = [
    t("header.total", { count: people.length }),
    includeArchived
      ? t("header.trackedWithArchived", { count: trackedCount, archived: archivedCount })
      : t("header.tracked", { count: trackedCount }),
    t("header.hubOnly", { count: hubOnlyCount }),
    includeArchived ? null : t("header.archivedHidden", { count: archivedCount }),
    mailboxCount > 0 ? t("header.mailboxes", { count: mailboxCount }) : null,
    t("header.sources"),
  ]
    .filter((part): part is string => part !== null)
    .join(" · ");

  return (
    <>
      <PageHeader category={t("category")} title={t("title")} meta={headerMeta} />

      <div className="flex min-h-[calc(100vh-130px)] flex-col border-b border-[var(--border)] lg:flex-row">
        {/* Left: roster */}
        <div className="flex w-full flex-none flex-col border-b border-[var(--border)] bg-[var(--sidebar)] lg:w-[330px] lg:border-b-0 lg:border-r">
          <div className="flex flex-col gap-2.5 border-b border-[var(--border)] p-4">
            <div className="flex items-baseline justify-between">
              <span className="text-[14px] font-semibold text-[var(--text-primary)]">
                {t("roster.heading")}
              </span>
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
                {t("roster.count", {
                  shown: visiblePeople.length,
                  matching: filteredPeople.length,
                })}
                {filteredPeople.length !== people.length &&
                  ` ${t("roster.totalSuffix", { total: people.length })}`}
              </span>
            </div>

            <SearchInput
              label={t("search.label")}
              value={searchQuery}
              onValueChange={setSearchQuery}
              placeholder={t("search.placeholder")}
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
                    label={t("filters.team")}
                    value={teamFilter}
                    onChange={(e) => setTeamFilter(e.target.value)}
                    className="w-full"
                  >
                    {/* The default is EVERYONE. A team filter that starts
                        pre-narrowed would misreport the roster size. */}
                    <option key="__all" value="">
                      {t("filters.allTeams", { count: people.length })}
                    </option>
                    {teamOptions.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label} ({opt.count})
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
                {t("chips.hasLoggedTime")}
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
                {t("chips.noHubAccount")}
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
                  {t("chips.includeArchived")}
                </FilterChip>
              )}
              {/*
                The Hub-only rows are a real bucket with a real action behind
                it (get them a TrackingTime account, or record why not), so
                they are filterable, not just marked. Offered only when the
                bucket is occupied: a chip that can only ever empty the list
                reads as data loss.
              */}
              {hubOnlyCount > 0 && (
                <FilterChip
                  active={onlyHub}
                  onToggle={() => setOnlyHub((v) => !v)}
                  count={hubOnlyCount}
                >
                  {t("filters.hubOnly")}
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
              {CAPACITY_BANDS.map((band) => (
                <FilterChip
                  key={band}
                  active={bands.includes(band)}
                  onToggle={() => toggleBand(band)}
                  count={bandCounts[band]}
                >
                  {bandLabel(t, band)}
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
                /* The control's English handle, identical in both languages, so
                   a gate or Playwright script that looks for the clear
                   affordance still finds it on the German page -- the device
                   ReportPanels uses for data-tile. The words a person reads are
                   the catalogue's. */
                data-clear="CLEAR {activeFilterCount}"
                className="self-start font-mono text-[10px] text-[var(--accent)] hover:underline"
              >
                {t("filters.clear", { count: activeFilterCount })}
              </button>
            )}
            </div>

            <div className="flex items-center justify-between gap-2 border-t border-[var(--divider)] pt-2">
              <SortHeader
                label={t("columns.name")}
                columnKey="name"
                activeKey={sortKey}
                direction={sortDir}
                onSort={handleSort}
              />
              <div className="flex items-center gap-3">
                <SortHeader
                  label={t("columns.hours")}
                  columnKey="hours"
                  activeKey={sortKey}
                  direction={sortDir}
                  onSort={handleSort}
                />
                <SortHeader
                  label={t("columns.billable")}
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
                  {query
                    ? t("filters.noMatchQuery", { query: searchQuery.trim() })
                    : t("filters.noMatchFilters")}
                </p>
                <button
                  type="button"
                  onClick={clearFilters}
                  data-clear="CLEAR {activeFilterCount}"
                  className="font-mono text-[10px] text-[var(--accent)] hover:underline"
                >
                  {t("filters.clear", { count: activeFilterCount })}
                </button>
              </div>
            )}
            {visiblePeople.map((person) => {
              const isSelected = selectedPerson.key === person.key;
              return (
                <button
                  key={person.key}
                  data-person-source={person.source}
                  onClick={() => setSelectedKey(person.key)}
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
                    <span className="flex min-w-0 items-center gap-1.5">
                      <span className="truncate text-[12px] font-medium text-[var(--text-primary)]">
                        {person.name}
                      </span>
                      {/*
                        The marker. Small, mono, in the label tokens, on the
                        strong border: visible when you look for it, silent
                        when you do not. Colour is not used, because colour
                        on this page means severity and this is not one.
                      */}
                      {person.source === "hub" && (
                        <span className="flex-none border border-[var(--border-strong)] px-1 font-mono text-[9px] tracking-[0.08em] text-[var(--text-faint)]">
                          {t("row.hubMarker")}
                        </span>
                      )}
                    </span>
                    <span className="truncate font-mono text-[10px] text-[var(--text-muted)]">
                      {/* Absence renders as absence: a person with no team shows
                          the role alone rather than a guessed one; a Hub-only
                          person says why nothing else is here. */}
                      {person.source === "hub"
                        ? person.team !== null
                          ? `${t("row.hubOnly")} · ${teamLabel(person.team)}`
                          : t("row.hubOnly")
                        : person.team !== null
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
                    {person.billablePercent !== null
                      ? fmtPct(person.billablePercent, locale)
                      : common("notAvailable")}
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
            noun={t("roster.pagerNoun")}
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
                {selectedPerson.email ?? t("detail.noEmail")}
              </span>
              <div className="mt-1 flex flex-wrap gap-2">
                {/*
                  Hub-only comes FIRST and replaces the TrackingTime badges
                  (nominal week, account role, sign-in): each of those is a
                  fact about a member record that does not exist. Saying
                  "NOMINAL 40 H/WEEK" here would be the mockup's habit back.
                */}
                {isHubOnly && (
                  <span
                    className="bg-[var(--surface)] px-2 py-0.5 font-mono text-[10px] text-[var(--text-secondary)]"
                    title={t("detail.hubOnlyTitle")}
                  >
                    {t("detail.hubOnlyBadge")}
                  </span>
                )}
                {capacity ? (
                  <span
                    className="px-2 py-0.5 font-mono text-[10px] font-medium"
                    style={{
                      color: tone(capacity.tone),
                      background: "var(--surface)",
                    }}
                  >
                    {bandLabel(t, bandOf(selectedPerson))}
                  </span>
                ) : (
                  <span className="bg-[var(--surface)] px-2 py-0.5 font-mono text-[10px] text-[var(--text-faint)]">
                    {t("chips.noUtilisationData")}
                  </span>
                )}
                {/*
                  "NOMINAL" is load-bearing. Every member reports exactly 40
                  h/week because that is TrackingTime's account-wide default,
                  not anyone's contract — so this must not read as contractual.
                */}
                {selectedPerson.weeklyHours !== null && (
                  <span
                    className="bg-[var(--surface)] px-2 py-0.5 font-mono text-[10px] text-[var(--text-secondary)]"
                    /* The basis stays NOMINAL in every language, and the handle
                       says so where a script can read it: check-people-module
                       asserts this page never calls the 40h week contracted. */
                    data-basis="NOMINAL"
                    title={t("detail.nominalTitle")}
                  >
                    {t("detail.nominal", { hours: selectedPerson.weeklyHours })}
                  </span>
                )}
                {!isHubOnly && (
                  <span className="bg-[var(--surface)] px-2 py-0.5 font-mono text-[10px] text-[var(--text-secondary)]">
                    {selectedPerson.accountRole ?? t("detail.noRole")}
                  </span>
                )}
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
                    : t("detail.noTeam")}
                </span>
                {selectedPerson.isArchived && (
                  <span className="bg-[var(--surface)] px-2 py-0.5 font-mono text-[10px] text-[var(--warning)]">
                    {t("detail.archived")}
                  </span>
                )}
                {/*
                  Surfaced deliberately: 46 of 49 members have no Hub login, so
                  they cannot sign in and see their own hours. That is an
                  operational fact worth showing, not one to hide.
                */}
                {/* `=== false`, not `!`: null is "not knowable from here", and a
                    warning badge on an unknown would be an accusation. */}
                {selectedPerson.hasAccount === false && (
                  <span className="bg-[var(--surface)] px-2 py-0.5 font-mono text-[10px] text-[var(--warning)]">
                    {t("chips.noHubAccount")}
                  </span>
                )}
              </div>
            </div>

            {/* No member id, no dashboard: the link would filter on "null". */}
            {selectedPerson.memberId !== null && (
              <div className="ml-auto flex items-center gap-2">
                <ButtonLink
                  variant="secondary"
                  href={`/time/dashboard?members=${selectedPerson.memberId}`}
                >
                  {t("detail.viewInDashboard")}
                </ButtonLink>
              </div>
            )}
          </div>

          {/*
            Measured figures only. StatTile renders a null value as "n/a"; for
            a Hub-only person every value IS null and every hint says why, so
            the four tiles read "n/a -- NO TRACKINGTIME ACCOUNT" rather than
            "0 h -- 0 ENTRIES", which would be a claim about someone's work.
          */}
          <div className="my-5 grid grid-cols-1 gap-[var(--card-gap)] sm:grid-cols-2 lg:grid-cols-4">
            <StatTile
              label={t("tiles.hoursLogged")}
              value={
                selectedPerson.totalHours !== null && selectedPerson.totalHours > 0
                  ? fmtNum(selectedPerson.totalHours, locale, 0)
                  : null
              }
              unit="h"
              hint={
                selectedPerson.entryCount === null
                  ? t("detail.noTrackingTime")
                  : t("tiles.entries", { count: selectedPerson.entryCount })
              }
            />
            <StatTile
              label={t("tiles.billableShare")}
              value={selectedPerson.billablePercent}
              unit="%"
              hint={
                selectedPerson.billableHours === null
                  ? t("detail.noTrackingTime")
                  : t("tiles.billableHours", {
                      hours: fmtNum(selectedPerson.billableHours, locale, 0),
                    })
              }
            />
            <StatTile
              label={t("tiles.utilisation")}
              value={selectedPerson.utilisationPercent}
              unit="%"
              // Not "OF CONTRACTED": the 40h basis is a TrackingTime default,
              // and calling it contracted would dress a default as a fact.
              hint={isHubOnly ? t("detail.noTrackingTime") : t("tiles.utilisationHint")}
            />
            <StatTile
              label={t("tiles.weeksActive")}
              value={
                selectedPerson.weeksActive !== null && selectedPerson.weeksActive > 0
                  ? selectedPerson.weeksActive
                  : null
              }
              hint={
                isHubOnly
                  ? t("detail.noTrackingTime")
                  : selectedPerson.lastActivityAt
                    ? // The ISO day, deliberately not localised: it is a
                      // machine-readable stamp, and the same eight characters
                      // in both languages.
                      t("tiles.lastActivity", { date: selectedPerson.lastActivityAt.slice(0, 10) })
                    : t("tiles.noActivity")
              }
            />
          </div>

          {/* Assignments — real projects this person logged against */}
          <Card className="flex flex-col gap-3 p-4">
            <div className="flex items-baseline gap-2.5">
              <span className="text-[12px] font-semibold text-[var(--text-primary)]">
                {t("projects.heading")}
              </span>
              <span className="font-mono text-[10px] text-[var(--text-muted)]">
                {t("projects.meta", { count: selectedPerson.assignments.length })}
              </span>
            </div>

            {selectedPerson.assignments.length === 0 ? (
              <p className="font-mono text-[11px] text-[var(--text-faint)]">
                {/* Two different absences: "logged nothing" is a fact about a
                    member; "has no member" is the reason there is no fact. */}
                {isHubOnly ? t("detail.noTrackingTimeAccount") : t("projects.none")}
              </p>
            ) : (
              <div className="overflow-x-auto">
                <div className="grid min-w-[420px] grid-cols-12 border-b border-[var(--border)] pb-2 font-mono text-[10px] tracking-[0.1em] text-[var(--text-faint)]">
                  <span className="col-span-6">{t("projects.project")}</span>
                  <span className="col-span-2 text-right">{t("projects.logged")}</span>
                  <span className="col-span-2 text-right">{t("columns.billable")}</span>
                  <span className="col-span-2 text-right">{t("projects.share")}</span>
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
                      {t("projects.hours", { hours: fmtNum(asg.loggedHours, locale, 0) })}
                    </span>
                    <span className="col-span-2 text-right font-mono text-[var(--text-secondary)]">
                      {t("projects.hours", { hours: fmtNum(asg.billableHours, locale, 0) })}
                    </span>
                    <span className="col-span-2 text-right font-mono font-medium text-[var(--accent)]">
                      {fmtPct(asg.sharePercent, locale)}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </Card>

          {unlinkedCount > 0 && (
            <Card className="mt-5 flex flex-wrap items-center justify-between gap-3 p-4">
              {/* Over the TRACKED count, not the whole list: the Hub-only rows'
                  sign-in state is unknown here, so they are neither in the
                  numerator nor the denominator. */}
              <span className="text-[12px] text-[var(--text-secondary)]">
                {t("unlinkedNote", { unlinked: unlinkedCount, tracked: trackedCount })}
              </span>
              <ButtonLink variant="primary" href="/admin/users" className="whitespace-nowrap">
                {t("detail.manageUsers")}
              </ButtonLink>
            </Card>
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
const CAPACITY_BANDS: CapacityBand[] = ["over", "low", "ontrack", "unknown"];

/**
 * One band, in the reader's language.
 *
 * A switch rather than a computed key, so every key is a literal the i18n gate
 * can resolve against both catalogues. The chip and the detail badge both call
 * it, which is what stops them wording the same band two ways.
 */
function bandLabel(t: (key: string) => string, band: CapacityBand): string {
  switch (band) {
    case "over":
      return t("chips.overCapacity");
    case "low":
      return t("chips.lowUtilisation");
    case "ontrack":
      return t("chips.onTrack");
    default:
      return t("chips.noUtilisationData");
  }
}

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
 * `totalHours` is null too for a Hub-only person, and takes the same path.
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

/*
 * The local `Kpi` used to live here. It reimplemented StatTile -- including
 * StatTile's own "n/a, never 0" rule -- and took a `border` prop carrying
 * strings like "sm:border-r lg:border-b-0", which is the fused grid's separator
 * arithmetic hoisted into a component API: four call sites each hand-deriving
 * which edges they own at which breakpoint. Deleted rather than restyled,
 * because a second figure vocabulary is what let the two drift apart.
 */

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
