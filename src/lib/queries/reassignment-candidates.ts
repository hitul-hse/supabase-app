import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { canReadBudgets, budgetAwareColumns } from "@/lib/budget-visibility";

/**
 * Who could take over a project, and how loaded are they already?
 *
 * OPTION C: the lead chooses, the system informs
 * ---------------------------------------------
 * `public.leave_requests` is EMPTY (0 rows), so "who is on sick leave" cannot be
 * answered from data. Rather than invent an absence signal, this surfaces the
 * load information that IS real and lets the lead — who knows who is off — make
 * the call. The `absence` field is deliberately shaped for the Factorial
 * time-off feed to fill in later (docs/factorial-api-integration.md §5), so the
 * UI does not have to change when it arrives.
 *
 * WHAT COUNTS AS CAPACITY HERE
 * ----------------------------
 * `time.member.weekly_hours` is 40.00 for all 49 members, which is a
 * TrackingTime default rather than contract truth, so it is NOT used as a
 * denominator. Real contract hours from Factorial are the fix, and until then a
 * percentage against a fabricated 40h week would be a confident lie.
 *
 * So the signal is absolute, not a ratio: how many projects a person is
 * responsible for, how many contract hours those carry, how much they already
 * cover as a named replacement, and how much time they have actually logged this
 * month. A lead can compare people against each other from that without the
 * system pretending to know their contracted availability.
 *
 * DO NOT JOIN THESE TABLES IN ONE QUERY
 * ------------------------------------
 * Joining `project_responsibility` to `person_assignments` fans out: it turned a
 * real 62 into 8,060 while looking entirely plausible, and my first draft of this
 * query reported 85,593 contract hours for one person. Every aggregate below is
 * computed from its own filtered read and combined in JS.
 */

type SupabaseTyped = SupabaseClient<Database>;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const timeSchema = (s: SupabaseTyped) => (s as any).schema("time");

const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

export type CandidateLoad = {
  personId: string;
  personName: string;

  /** Projects where this person is the responsible, from the canonical role table. */
  responsibleFor: number;
  /** Projects where they are the named cover. Real work if the other person goes off. */
  coversAsReplacement: number;
  /**
   * Contract hours across the projects they are responsible for. Null when every
   * one of those projects is unmeasured, which is an honest unknown rather than 0.
   */
  contractHours: number | null;
  /** Hours they actually logged in the last 30 days, bounded at today. */
  loggedLast30Days: number;

  /**
   * Absence, once a source exists. Null means UNKNOWN, not "available" — the UI
   * must say so rather than implying the person is free.
   */
  absence: null | { from: string; to: string; kind: string };

  /** True when this person already holds a role on the project being reassigned. */
  alreadyOnProject: boolean;

  /**
   * External contractor rather than an employee.
   *
   * Worth surfacing rather than hiding. Stefan Goelzner was hired partly TO
   * cover for Thorsten, so he must be offerable; but a lead choosing cover
   * should know they are committing external capacity, which is bought per
   * engagement rather than simply reallocated. It also explains why his
   * contract hours are null: an external on call-off work has no weekly
   * contract, so there is no honest utilisation denominator.
   */
  isExternal: boolean;
};

export async function getReassignmentCandidates(
  supabase: SupabaseTyped,
  projectId: string,
): Promise<CandidateLoad[]> {
  // Only active people can be assigned; request_project_responsible_change
  // rejects an inactive person, so offering one would be a dead end.
  const { data: people } = await supabase
    .from("people")
    .select("id, name, source")
    .eq("is_active", true)
    .order("name", { ascending: true });

  if (!people?.length) return [];
  const ids = (people as { id: string; name: string; source: string | null }[]).map((p) => p.id);

  // Separate reads, never a join. See the fan-out note above.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: roleRows } = await (supabase as any)
    .from("project_responsibility")
    .select("project_id, person_id, role")
    .in("person_id", ids);

  /*
   * The budget column is omitted for a caller without projects:contracts:read.
   * This read needs no separate "withheld" flag, unusually: the sum below
   * already tracks `sawNumber` separately from the total (added by
   * 20260826120000 so an unmeasured order reads n/a rather than 0), and an
   * absent column leaves sawNumber false. A withheld portfolio therefore
   * renders "n/a" through the path that already existed for "nobody measured
   * this", which is the honest answer in both cases: no figure is being
   * claimed.
   */
  const canSeeBudgets = await canReadBudgets(supabase);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: ownedProjects } = await (supabase as any)
    .from("projects")
    .select(budgetAwareColumns("id, owner_person_id, contract_hours", canSeeBudgets))
    .in("owner_person_id", ids);

  const responsibleCount = new Map<string, number>();
  const coverCount = new Map<string, number>();
  const onThisProject = new Set<string>();

  for (const r of (roleRows ?? []) as { project_id: string; person_id: string; role: string }[]) {
    if (r.project_id === projectId) onThisProject.add(r.person_id);
    const target = r.role === "responsible" ? responsibleCount : r.role === "replacement" ? coverCount : null;
    if (target) target.set(r.person_id, (target.get(r.person_id) ?? 0) + 1);
  }

  /*
   * Contract hours summed per owner, tracking separately whether ANY of their
   * projects carried a figure. After 20260826120000 an unmeasured order stores
   * null, so a person whose whole portfolio is unmeasured must read n/a rather
   * than 0 — that null is the whole point of the migration.
   */
  const hoursByPerson = new Map<string, { sum: number; sawNumber: boolean }>();
  for (const p of (ownedProjects ?? []) as { owner_person_id: string; contract_hours?: number | null }[]) {
    const cur = hoursByPerson.get(p.owner_person_id) ?? { sum: 0, sawNumber: false };
    if (p.contract_hours !== null && p.contract_hours !== undefined) {
      cur.sum += num(p.contract_hours);
      cur.sawNumber = true;
    }
    hoursByPerson.set(p.owner_person_id, cur);
  }

  /*
   * Recent logged time, as a rough "are they busy right now" signal. Read through
   * time.member because time.entry has no person_id; hub_person_id is the bridge
   * and is null for most members, so this is best-effort and absent rather than
   * wrong when the link is missing.
   */
  const loggedByPerson = new Map<string, number>();
  const { data: members } = await timeSchema(supabase)
    .from("member")
    .select("id, hub_person_id")
    .not("hub_person_id", "is", null);

  const memberToPerson = new Map<number, string>();
  for (const m of (members ?? []) as { id: number; hub_person_id: string }[]) {
    memberToPerson.set(Number(m.id), m.hub_person_id);
  }

  if (memberToPerson.size) {
    const since = new Date(Date.now() - 30 * 86400_000).toISOString();
    const nowIso = new Date().toISOString();
    for (let from = 0; ; from += 1000) {
      const { data } = await timeSchema(supabase)
        .from("entry")
        .select("id, member_id, duration_seconds")
        .gte("started_at", since)
        // Bounded at today: time.entry holds planned work out to 2026-12-31, and
        // counting it would report future hours as current busyness.
        .lte("started_at", nowIso)
        .order("id", { ascending: true })
        .range(from, from + 999);
      if (!data?.length) break;
      for (const e of data as { member_id: number; duration_seconds: number | null }[]) {
        const personId = memberToPerson.get(Number(e.member_id));
        if (!personId) continue;
        loggedByPerson.set(personId, (loggedByPerson.get(personId) ?? 0) + num(e.duration_seconds) / 3600);
      }
      if (data.length < 1000) break;
    }
  }

  return (people as { id: string; name: string; source: string | null }[]).map((p) => {
    const hours = hoursByPerson.get(p.id);
    return {
      personId: p.id,
      personName: p.name,
      responsibleFor: responsibleCount.get(p.id) ?? 0,
      coversAsReplacement: coverCount.get(p.id) ?? 0,
      contractHours: hours?.sawNumber ? Math.round(hours.sum * 10) / 10 : null,
      loggedLast30Days: Math.round((loggedByPerson.get(p.id) ?? 0) * 10) / 10,
      // No source yet. Null is UNKNOWN, and the UI must not read it as "free".
      absence: null,
      alreadyOnProject: onThisProject.has(p.id),
      isExternal: p.source === "external",
    };
  });
}
