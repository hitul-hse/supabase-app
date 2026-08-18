/**
 * The organisation chart, built from recorded reporting lines.
 *
 * WHAT THIS REPLACES. `getOrgChart` read `org_chart_nodes`, a view over the eight
 * seeded mockup people whose `manager_id` was hand-written fiction. The People tab
 * now shows the real 49-member TrackingTime roster, and TrackingTime carries no
 * hierarchy: its API exposes `supervisor`, `is_supervisor` and `user_group_id`,
 * but asked against the live account all three are empty for all 49 users. So the
 * structure is recorded in the Hub (see the add_member_hierarchy_and_team
 * migration) and read here.
 *
 * THREE THINGS THIS DELIBERATELY DOES NOT DO.
 *
 * It does not invent a root. If nobody has a supervisor, the result is a flat list
 * of unplaced people, not a guess that the ADMIN with the most hours is the boss.
 * A chart that looks plausible and is wrong is the exact failure being undone.
 *
 * It does not hide unplaced people. Anyone without a reporting line appears in
 * `unplaced`, so the gap is visible and fillable rather than silently omitted --
 * which would make a half-recorded chart look complete.
 *
 * It does not loop forever on a cycle. The database prevents self-reference but
 * not A->B->A, because enforcing that needs a recursive trigger on every write for
 * a hand-edited table of 49 rows. So cycles are detected HERE and reported in
 * `cycles`, and their members are treated as unplaced. Rendering an infinite tree
 * or blowing the stack would be a worse answer than naming the mistake.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { isSharedMailbox } from "./people-live";

type SupabaseTyped = SupabaseClient<Database>;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const timeSchema = (s: SupabaseTyped) => (s as any).schema("time");

/** One person in the chart. */
export type OrgMember = {
  memberId: number;
  name: string;
  email: string | null;
  /** TrackingTime access level: ADMIN, MANAGER, PROJECT_MANAGER, CO_WORKER. */
  accountRole: string | null;
  /** What they actually do, if anyone has recorded it. Null is honest. */
  jobTitle: string | null;
  team: string | null;
  supervisorMemberId: number | null;
  /** 'manual' when a person recorded it, 'trackingtime' when imported. */
  supervisorSource: string | null;
  isArchived: boolean;
  /** True when this member has a Hub sign-in. */
  hasAccount: boolean;
};

/** A node in the rendered tree. */
export type OrgNode = OrgMember & {
  reports: OrgNode[];
  /** How many people sit beneath them, at any depth. */
  totalReports: number;
  depth: number;
};

export type OrgChartData = {
  /** People with no supervisor, each the top of a tree. */
  roots: OrgNode[];
  /**
   * People with no reporting line recorded, and no reports of their own. Shown so
   * an incomplete chart reads as incomplete.
   */
  unplaced: OrgMember[];
  /** Distinct team labels actually in use, in roster order. */
  teams: string[];
  /**
   * Reporting loops, as member-id chains. Non-empty means somebody recorded a
   * contradiction; the UI must surface it rather than silently dropping people.
   */
  cycles: number[][];
  /** Active, non-inbox members in the roster. */
  totalPeople: number;
  /** How many of them have a supervisor recorded — the chart's completeness. */
  placedCount: number;
};

/**
 * Build the tree.
 *
 * Iterative, not recursive, for the depth walk: a hand-edited hierarchy is exactly
 * the kind of data that contains a surprise, and a stack overflow is a worse
 * failure mode than a reported cycle.
 */
export async function getOrgChart(supabase: SupabaseTyped): Promise<OrgChartData> {
  const { data, error } = await timeSchema(supabase)
    .from("member")
    .select(
      "id, display_name, email, role, job_title, team, supervisor_member_id, supervisor_source, is_archived, user_id",
    )
    .order("display_name");

  if (error || !data) {
    return { roots: [], unplaced: [], teams: [], cycles: [], totalPeople: 0, placedCount: 0 };
  }

  type Row = {
    id: number; display_name: string | null; email: string | null; role: string | null;
    job_title: string | null; team: string | null; supervisor_member_id: number | null;
    supervisor_source: string | null; is_archived: boolean | null; user_id: string | null;
  };

  // Archived members and shared inboxes are excluded: an org chart is a picture of
  // the working organisation, and info@ is not a colleague. Their hours still
  // count elsewhere -- this is a directory filter, not an attribution filter.
  const members: OrgMember[] = (data as Row[])
    .filter((r) => !r.is_archived && !isSharedMailbox(r.email))
    .map((r) => ({
      memberId: Number(r.id),
      name: r.display_name ?? `Member ${r.id}`,
      email: r.email,
      accountRole: r.role,
      jobTitle: r.job_title,
      team: r.team,
      supervisorMemberId: r.supervisor_member_id === null ? null : Number(r.supervisor_member_id),
      supervisorSource: r.supervisor_source,
      isArchived: Boolean(r.is_archived),
      hasAccount: r.user_id !== null,
    }));

  const byId = new Map(members.map((m) => [m.memberId, m]));

  // A supervisor who is archived or excluded is not in `byId`, so the link cannot
  // be followed. Treating that as "no supervisor" is right: the alternative is a
  // node parented to somebody the chart does not show.
  const supervisorOf = (m: OrgMember): number | null =>
    m.supervisorMemberId !== null && byId.has(m.supervisorMemberId) ? m.supervisorMemberId : null;

  // ── Cycle detection, before any tree building ────────────────────────────
  // Walk each member's chain to a root. If a chain revisits a node it has already
  // seen on THIS walk, that is a loop.
  const cycles: number[][] = [];
  const inCycle = new Set<number>();
  for (const m of members) {
    if (inCycle.has(m.memberId)) continue;
    const path: number[] = [];
    const onPath = new Set<number>();
    let cursor: number | null = m.memberId;
    while (cursor !== null) {
      if (onPath.has(cursor)) {
        // Record from the first repeat, so the reported chain is the loop itself
        // rather than the tail that led into it.
        const loop = path.slice(path.indexOf(cursor));
        cycles.push(loop);
        for (const id of loop) inCycle.add(id);
        break;
      }
      onPath.add(cursor);
      path.push(cursor);
      const next: OrgMember | undefined = byId.get(cursor);
      cursor = next ? supervisorOf(next) : null;
    }
  }

  // ── Build the tree from everyone not caught in a loop ───────────────────
  const nodes = new Map<number, OrgNode>();
  for (const m of members) {
    if (inCycle.has(m.memberId)) continue;
    nodes.set(m.memberId, { ...m, reports: [], totalReports: 0, depth: 0 });
  }

  const roots: OrgNode[] = [];
  for (const node of nodes.values()) {
    const sup = supervisorOf(node);
    const parent = sup === null ? undefined : nodes.get(sup);
    if (parent) parent.reports.push(node);
    else if (node.supervisorMemberId === null) roots.push(node);
    // A member whose supervisor exists but is in a cycle falls through: neither
    // attached nor a root. They surface in `unplaced` below, which is honest --
    // their stated manager is part of a contradiction.
  }

  // ── Depth and subtree sizes, iteratively ───────────────────────────────
  for (const root of roots) {
    const stack: OrgNode[] = [root];
    while (stack.length) {
      const node = stack.pop()!;
      for (const child of node.reports) {
        child.depth = node.depth + 1;
        stack.push(child);
      }
    }
  }
  // Sizes bottom-up: process deepest first so a parent's children are already
  // counted. Sorting by depth descending gives that ordering without recursion.
  const allNodes = [...nodes.values()].sort((a, b) => b.depth - a.depth);
  for (const node of allNodes) {
    node.totalReports = node.reports.reduce((sum, c) => sum + 1 + c.totalReports, 0);
  }

  // Biggest teams first at every level: a chart is read top-down for scale.
  const sortReports = (list: OrgNode[]) => {
    list.sort((a, b) => b.totalReports - a.totalReports || a.name.localeCompare(b.name));
    for (const n of list) sortReports(n.reports);
  };
  sortReports(roots);

  // ── Who is not on the chart at all ─────────────────────────────────────
  const placedIds = new Set<number>();
  for (const root of roots) {
    const stack = [root];
    while (stack.length) {
      const n = stack.pop()!;
      placedIds.add(n.memberId);
      stack.push(...n.reports);
    }
  }
  // A root with no reports is not really "placed": nobody has recorded anything
  // about them. Listing them as a one-person tree would make an empty chart look
  // populated, so they count as unplaced until a relationship exists.
  const unplaced = members.filter((m) => {
    const node = nodes.get(m.memberId);
    if (!node) return true; // caught in a cycle
    if (!placedIds.has(m.memberId)) return true;
    return node.supervisorMemberId === null && node.reports.length === 0;
  });
  const unplacedIds = new Set(unplaced.map((m) => m.memberId));

  const teams = [...new Set(members.map((m) => m.team).filter((t): t is string => Boolean(t)))].sort();

  return {
    roots: roots.filter((r) => !unplacedIds.has(r.memberId)),
    unplaced,
    teams,
    cycles,
    totalPeople: members.length,
    placedCount: members.length - unplaced.length,
  };
}
