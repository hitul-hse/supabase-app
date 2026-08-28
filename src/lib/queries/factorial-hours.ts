import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import {
  fetchFactorialPeople,
  fetchFactorialPresence,
  fetchFactorialTeams,
  FactorialUnavailableError,
} from "@/lib/factorial/client";

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
 *  3. Identity is exact-key only (ADR-001): normalised work email, with
 *     display_name as fallback for the one member whose TT email differs
 *     (measured: 15 by email + 1 by name = 16 of 20). No similarity scoring.
 *     Unmatched people from EITHER side stay in the result, labelled.
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

  /** Exactly one of: matched | factorial_only | trackingtime_only */
  matchState: "matched" | "factorial_only" | "trackingtime_only";
};

export type FactorialHoursReport = {
  windowFrom: string;
  windowTo: string;
  windowDays: number;
  people: PersonComparison[];
  /** Teams as Factorial defines them, for the team rollup. */
  teams: { name: string; memberNames: string[] }[];
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
  checkedAt: string;
};

const norm = (s: unknown) => String(s ?? "").toLowerCase().replace(/\s+/g, " ").trim();
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
  const memberByEmail = new Map(members.filter((m) => m.email).map((m) => [norm(m.email), m]));
  const memberByName = new Map(members.map((m) => [norm(m.display_name), m]));
  const claimedMembers = new Set<number>();
  const people: PersonComparison[] = [];

  for (const f of fPeople) {
    if (!f.active) continue;
    const m = (f.email ? memberByEmail.get(f.email) : undefined) ?? memberByName.get(norm(f.fullName));
    if (m) claimedMembers.add(m.id);
    const agg = m ? tt.get(m.id) : undefined;
    const pres = presenceById.get(f.factorialId);
    const logged = m ? r1((agg?.logged ?? 0) / 3600) : null;
    const billable = m ? r1((agg?.billable ?? 0) / 3600) : null;
    people.push({
      name: f.fullName,
      factorialId: f.factorialId,
      memberId: m?.id ?? null,
      hubPersonId: m?.hub_person_id ?? null,
      factorialTeams: teamsById.get(f.factorialId) ?? [],
      memberTeam: m?.team ?? null,
      presentHours: factorialError ? null : pres ? r1(pres.presentMinutes / 60) : null,
      daysClocked: factorialError ? null : pres ? pres.daysClocked : null,
      loggedHours: logged,
      billableHours: billable,
      nonBillableHours: m ? r1((agg?.nonBillable ?? 0) / 3600) : null,
      billableShare: logged && logged > 0 && billable !== null ? Math.round((billable / logged) * 100) : null,
      matchState: m ? "matched" : "factorial_only",
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
      memberNames: t.employeeIds
        .map((id) => people.find((p) => p.factorialId === id)?.name)
        .filter((n): n is string => Boolean(n)),
    })),
    totals: {
      presentHours: r1(withPresent.reduce((s, p) => s + (p.presentHours ?? 0), 0)),
      presentCount: withPresent.length,
      loggedHours: r1(withLogged.reduce((s, p) => s + (p.loggedHours ?? 0), 0)),
      loggedCount: withLogged.length,
      billableHours: r1(withLogged.reduce((s, p) => s + (p.billableHours ?? 0), 0)),
    },
    factorialError,
    checkedAt: new Date().toISOString(),
  };
}
