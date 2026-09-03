import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import {
  fetchFactorialPeople,
  fetchFactorialPresence,
  fetchFactorialTeams,
  FactorialUnavailableError,
} from "@/lib/factorial/client";
import { readFactorialIdentityMap } from "@/lib/queries/factorial-identity-map";

type SupabaseTyped = SupabaseClient<Database>;

/**
 * Factorial presence vs TrackingTime hours, per person.
 *
 * WHAT THE TWO SOURCES MEAN — the user's own definition
 * -----------------------------------------------------
 * "Factorial is our HR tool so we use it to just track our regular working
 * hours, and TrackingTime we use it for tracking billable or non-billable hours
 * in clients projects."
 *
 * So PRESENT is contracted working time (clock in/out) and LOGGED/BILLABLE are
 * project work. They are related but NOT the same quantity, and this module is
 * built around three measured facts (docs/factorial-hours-comparison-findings.md):
 *
 *  1. LOGGED as SUM(duration) double-counts. 308.6h over 90 days across 12
 *     people, +29.8% for one person, because entries overlap — mostly calendar
 *     placeholders sitting on real work (263.0h of 308.6h). So logged hours here
 *     EXCLUDE calendar entries, matching the TrackingTime dashboard's own
 *     default, and the residual overlap (45.6h, mostly two real timers at once)
 *     is why no figure derived by SUBTRACTION is exported at all.
 *
 *  2. Not everyone clocks and not everyone logs. Björn logged 276h with zero
 *     attendance; four colleagues clock daily but have no TrackingTime account.
 *     A number that is not measured is null, never 0 — a 0 would read as
 *     "did nothing", about a named colleague.
 *
 *  3. Identity is exact-key only (ADR-001), and the key is the FACTORIAL
 *     EMPLOYEE ID, resolved through the recorded decisions in
 *     crm.factorial_person_reference -> public.people -> time.member.hub_person_id.
 *     No email comparison here at all, and above all no name comparison: see
 *     src/lib/queries/factorial-identity-map.ts for what this module used to do
 *     and why one lucky name hit is not the same thing as a correct join.
 *     Unmatched people from EITHER side stay in the result, labelled, and a
 *     person the chain cannot resolve is labelled UNRESOLVED rather than being
 *     reported as somebody with no TrackingTime account.
 */

export type PersonComparison = {
  /** Identity: whichever side(s) know this person. */
  name: string;
  factorialId: string | null;
  memberId: number | null;
  hubPersonId: string | null;
  factorialTeams: string[];
  memberTeam: string | null;

  /** Presence (HR side). null = no attendance rows, NOT zero hours. */
  presentHours: number | null;
  daysClocked: number | null;

  /** Project work (TrackingTime side). null = no TT account. */
  loggedHours: number | null;
  billableHours: number | null;
  nonBillableHours: number | null;
  /** 0-100, of non-calendar logged time. null when loggedHours is null or 0. */
  billableShare: number | null;

  /**
   * Exactly one of:
   *   matched          — the identity chain resolved to a time.member.
   *   factorial_only   — the chain resolved to a hub person who has no
   *                      time.member row. A real claim: no TrackingTime account.
   *   trackingtime_only— a time.member no resolved Factorial employee claims.
   *   unresolved       — the chain did NOT resolve. This claims NOTHING about
   *                      whether the person logs time; it says we may not guess.
   *                      Before 2026-09-03 these people were either matched by
   *                      display_name (ADR-001 violation) or folded into
   *                      factorial_only, which asserted "no TT account" without
   *                      having earned it.
   */
  matchState: "matched" | "factorial_only" | "trackingtime_only" | "unresolved";
};

export type FactorialHoursReport = {
  windowFrom: string;
  windowTo: string;
  windowDays: number;
  people: PersonComparison[];
  /**
   * Teams as Factorial defines them, for the team rollup.
   *
   * Members are carried as Factorial EMPLOYEE IDS, not names. The panel used to
   * re-find each member with `people.filter(p => team.memberNames.includes(p.name))`,
   * which is a name lookup used as an identity decision inside the UI — the same
   * ADR-001 mistake as the join it sat next to, and it would have put two
   * same-named colleagues in each other's teams.
   */
  teams: { name: string; memberFactorialIds: string[] }[];
  totals: {
    /** Sum over people WITH a measurement; the count says over how many. */
    presentHours: number;
    presentCount: number;
    loggedHours: number;
    loggedCount: number;
    billableHours: number;
  };
  /** Set when Factorial cannot be reached; people then carries TT data only. */
  factorialError: string | null;
  /**
   * The state of the ADR-001 identity chain itself. `available: false` means
   * crm.factorial_person_reference could not be read at all, so EVERY Factorial
   * employee is unresolved — the page must say that rather than render a table
   * that looks like nobody logs time.
   */
  identity: {
    available: boolean;
    fault: string | null;
    /** Active Factorial employees the chain resolved to a hub person. */
    resolved: number;
    /** Active Factorial employees it did not. */
    unresolved: number;
  };
  checkedAt: string;
};

const r1 = (n: number) => Math.round(n * 10) / 10;

export async function getFactorialHoursReport(
  supabase: SupabaseTyped,
  windowDays = 90,
): Promise<FactorialHoursReport> {
  const to = new Date();
  const from = new Date(Date.now() - windowDays * 86400000);
  const iso = (d: Date) => d.toISOString().slice(0, 10);

  /* ---------------------------------------------------- TrackingTime side -- */
  /*
   * Aggregate in SQL via the RPC-free path: page time.entry once per member is
   * O(n) requests, so instead read members and entries' aggregates through a
   * PostgREST-friendly shape. `.order()` before `.range()` per house rule; the
   * member list is 49 rows so one page suffices, but assert rather than assume.
   */
  const timeDb = supabase.schema("time" as never) as unknown as SupabaseTyped;
  const { data: members, error: mErr } = await (timeDb as SupabaseTyped)
    .from("member" as never)
    .select("id, display_name, email, hub_person_id, team, is_archived" as never)
    .order("id" as never)
    .range(0, 199) as unknown as {
      data: { id: number; display_name: string; email: string | null; hub_person_id: string | null; team: string | null; is_archived: boolean }[] | null;
      error: { message: string } | null;
    };
  if (mErr || !members) throw new Error(`time.member read failed: ${mErr?.message ?? "no data"}`);
  if (members.length >= 200) throw new Error("time.member exceeded one page — paging needed");

  /*
   * Entries for the window. 90 days is ~2,600 rows; page at 1000 (PostgREST's
   * cap — .limit() beyond it silently truncates, which this repo has been bitten
   * by twice).
   */
  type Entry = { member_id: number; duration_seconds: number | null; is_billable: boolean; is_calendar: boolean };
  const entries: Entry[] = [];
  for (let page = 0; page < 40; page++) {
    const fromRow = page * 1000;
    const { data, error } = await (timeDb as SupabaseTyped)
      .from("entry" as never)
      .select("member_id, duration_seconds, is_billable, is_calendar" as never)
      .gte("started_at" as never, from.toISOString())
      .lt("started_at" as never, to.toISOString())
      .order("id" as never)
      .range(fromRow, fromRow + 999) as unknown as { data: Entry[] | null; error: { message: string } | null };
    if (error) throw new Error(`time.entry read failed: ${error.message}`);
    entries.push(...(data ?? []));
    if (!data || data.length < 1000) break;
    if (page === 39) throw new Error("time.entry exceeded 40 pages — refusing a truncated read");
  }

  const tt = new Map<number, { logged: number; billable: number; nonBillable: number }>();
  for (const e of entries) {
    const sec = Number(e.duration_seconds ?? 0);
    if (!Number.isFinite(sec) || sec <= 0) continue;
    const cur = tt.get(e.member_id) ?? { logged: 0, billable: 0, nonBillable: 0 };
    // Calendar entries are excluded from LOGGED entirely: they are placeholders
    // over real work and are 85% of the double-counting (finding §7).
    if (!e.is_calendar) {
      cur.logged += sec;
      if (e.is_billable) cur.billable += sec;
      else cur.nonBillable += sec;
    }
    tt.set(e.member_id, cur);
  }

  /* ------------------------------------------------------- Factorial side -- */
  let factorialError: string | null = null;
  let fPeople: Awaited<ReturnType<typeof fetchFactorialPeople>> = [];
  let fTeams: Awaited<ReturnType<typeof fetchFactorialTeams>> = [];
  let fPresence: Awaited<ReturnType<typeof fetchFactorialPresence>> = [];
  try {
    [fPeople, fTeams, fPresence] = await Promise.all([
      fetchFactorialPeople(),
      fetchFactorialTeams(),
      fetchFactorialPresence(iso(from), iso(to)),
    ]);
  } catch (e) {
    // The page must say Factorial is unreachable, not render everyone as
    // "not clocked" — an error state that looks like data is the worst outcome.
    factorialError = e instanceof FactorialUnavailableError ? e.message : "Factorial request failed";
  }

  const presenceById = new Map(fPresence.map((p) => [p.factorialId, p]));
  const teamsById = new Map<string, string[]>();
  for (const t of fTeams) {
    for (const id of t.employeeIds) {
      const cur = teamsById.get(id) ?? [];
      cur.push(t.name);
      teamsById.set(id, cur);
    }
  }

  /* ----------------------------------------------------------- the join ---- */
  /*
   * ADR-001, exact keys only. The chain is
   *
   *   f.factorialId -> crm.factorial_person_reference -> public.people.id
   *                 -> time.member.hub_person_id
   *
   * and there is no second attempt. No email fallback (the reference table is
   * where the email decision was already recorded, once, by the sync) and no
   * name fallback at all. The name-normalising helper this file used to carry
   * is deleted rather than left unused: an idle `norm()` beside a member list is
   * an invitation to write the bug again.
   */
  const identityMap = await readFactorialIdentityMap();
  const memberByPerson = new Map(
    members.filter((m) => m.hub_person_id).map((m) => [m.hub_person_id as string, m]),
  );
  const claimedMembers = new Set<number>();
  const people: PersonComparison[] = [];
  let resolvedCount = 0;
  let unresolvedCount = 0;

  for (const f of fPeople) {
    if (!f.active) continue;
    const personId = identityMap.personByEmployeeId.get(f.factorialId) ?? null;
    const m = personId ? memberByPerson.get(personId) : undefined;
    if (personId) resolvedCount += 1;
    else unresolvedCount += 1;
    if (m) claimedMembers.add(m.id);
    const agg = m ? tt.get(m.id) : undefined;
    const pres = presenceById.get(f.factorialId);
    const logged = m ? r1((agg?.logged ?? 0) / 3600) : null;
    const billable = m ? r1((agg?.billable ?? 0) / 3600) : null;
    people.push({
      name: f.fullName,
      factorialId: f.factorialId,
      memberId: m?.id ?? null,
      // The hub person is known as soon as the reference resolves, whether or
      // not that person ever opened TrackingTime.
      hubPersonId: m?.hub_person_id ?? personId,
      factorialTeams: teamsById.get(f.factorialId) ?? [],
      memberTeam: m?.team ?? null,
      // Presence is keyed on the Factorial employee id and needs no identity
      // hop, so it stays measured even for an unresolved person.
      presentHours: factorialError ? null : pres ? r1(pres.presentMinutes / 60) : null,
      daysClocked: factorialError ? null : pres ? pres.daysClocked : null,
      loggedHours: logged,
      billableHours: billable,
      nonBillableHours: m ? r1((agg?.nonBillable ?? 0) / 3600) : null,
      billableShare: logged && logged > 0 && billable !== null ? Math.round((billable / logged) * 100) : null,
      matchState: m ? "matched" : personId ? "factorial_only" : "unresolved",
    });
  }

  // TrackingTime members Factorial does not know (contractors, archived TT
  // remnants that still logged in-window). They exist; hiding them would make
  // the TT totals disagree with the TrackingTime dashboard one tab over.
  for (const m of members) {
    if (m.is_archived || claimedMembers.has(m.id)) continue;
    const agg = tt.get(m.id);
    if (!agg && m.is_archived) continue;
    const logged = r1((agg?.logged ?? 0) / 3600);
    const billable = r1((agg?.billable ?? 0) / 3600);
    people.push({
      name: m.display_name,
      factorialId: null,
      memberId: m.id,
      hubPersonId: m.hub_person_id,
      factorialTeams: [],
      memberTeam: m.team,
      presentHours: null,
      daysClocked: null,
      loggedHours: logged,
      billableHours: billable,
      nonBillableHours: r1((agg?.nonBillable ?? 0) / 3600),
      billableShare: logged > 0 ? Math.round((billable / logged) * 100) : null,
      matchState: "trackingtime_only",
    });
  }

  people.sort((a, b) => (b.loggedHours ?? -1) - (a.loggedHours ?? -1) || a.name.localeCompare(b.name));

  /*
   * Totals count only measured values and SAY over how many people, because a
   * total over 12 of 20 presented as "the team" is the selection-bias trap the
   * adversarial review flagged.
   */
  const withPresent = people.filter((p) => p.presentHours !== null);
  const withLogged = people.filter((p) => p.loggedHours !== null);
  return {
    windowFrom: iso(from),
    windowTo: iso(to),
    windowDays,
    people,
    teams: fTeams.map((t) => ({
      name: t.name,
      // Only ids that are actually on this report — an inactive employee is not
      // rendered, so counting them in a team total would inflate the
      // denominator the panel prints beside every team figure.
      memberFactorialIds: t.employeeIds.filter((id) => people.some((p) => p.factorialId === id)),
    })),
    totals: {
      presentHours: r1(withPresent.reduce((s, p) => s + (p.presentHours ?? 0), 0)),
      presentCount: withPresent.length,
      loggedHours: r1(withLogged.reduce((s, p) => s + (p.loggedHours ?? 0), 0)),
      loggedCount: withLogged.length,
      billableHours: r1(withLogged.reduce((s, p) => s + (p.billableHours ?? 0), 0)),
    },
    factorialError,
    identity: {
      available: identityMap.available,
      fault: identityMap.fault,
      resolved: resolvedCount,
      unresolved: unresolvedCount,
    },
    checkedAt: new Date().toISOString(),
  };
}
