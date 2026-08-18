"use client";

import { useState } from "react";
import Link from "next/link";
import { PageHeader } from "@/components/PageHeader";
import { EmptyState } from "@/components/EmptyState";
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
}: {
  people: LivePerson[];
  archivedCount: number;
  unlinkedCount: number;
  mailboxCount: number;
}) {
  // `people` can legitimately be empty: RLS scopes the underlying reads, and a
  // fresh database has no import yet. The detail pane dereferences the
  // selection unconditionally, so without this guard the page white-screened.
  const [selectedId, setSelectedId] = useState<number | null>(people[0]?.memberId ?? null);
  const [searchQuery, setSearchQuery] = useState("");
  const [onlyLogged, setOnlyLogged] = useState(false);

  const query = searchQuery.trim().toLowerCase();
  const filteredPeople = people.filter((p) => {
    const matchesSearch =
      query === "" ||
      p.name.toLowerCase().includes(query) ||
      (p.email ?? "").toLowerCase().includes(query) ||
      (p.accountRole ?? "").toLowerCase().includes(query);
    // "Has logged time" rather than a department filter: TrackingTime has no
    // department concept, and the old SAFETY/ENG/LAB tabs were mockup values.
    const matchesLogged = !onlyLogged || p.totalHours > 0;
    return matchesSearch && matchesLogged;
  });

  // Resolve by id against the live prop rather than holding a snapshot in
  // state, and prefer a selection that is actually in the filtered list.
  const selectedPerson =
    filteredPeople.find((p) => p.memberId === selectedId) ?? filteredPeople[0] ?? people[0];

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
              <span className="font-mono text-[10.5px] text-[var(--text-muted)]">
                {filteredPeople.length} OF {people.length}
              </span>
            </div>

            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search name, email, role…"
              className="border border-[var(--border-strong)] bg-[var(--surface)] px-2.5 py-1.5 text-[12px] text-[var(--text-primary)] placeholder-[var(--text-faint)] focus:border-[var(--accent)] focus:outline-none"
            />

            <label className="flex cursor-pointer items-center gap-2 font-mono text-[10.5px] text-[var(--text-secondary)]">
              <input
                type="checkbox"
                checked={onlyLogged}
                onChange={(e) => setOnlyLogged(e.target.checked)}
                className="accent-[var(--accent)]"
              />
              ONLY PEOPLE WITH LOGGED TIME
            </label>
          </div>

          <div className="flex flex-col divide-y divide-[#3a414c] overflow-y-auto">
            {filteredPeople.map((person) => {
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
              <Link
                href={`/time/dashboard?members=${selectedPerson.memberId}`}
                className="border border-[var(--border-strong)] px-3 py-1.5 text-[11.5px] font-medium text-[var(--text-primary)] hover:bg-[var(--surface-hover)]"
              >
                View in dashboard
              </Link>
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
                    className="grid min-w-[420px] grid-cols-12 items-center border-b border-[#3a414c] py-2 text-[12.5px]"
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
              <Link
                href="/admin/users"
                className="whitespace-nowrap bg-[var(--accent)] px-3 py-1.5 text-[11.5px] font-medium text-[var(--accent-contrast)] hover:bg-[var(--accent-hover)]"
              >
                Manage users →
              </Link>
            </div>
          )}
        </div>
      </div>
    </>
  );
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
