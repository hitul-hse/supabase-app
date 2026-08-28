import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";

type SupabaseTyped = SupabaseClient<Database>;

/**
 * Projects whose named cover cannot actually cover.
 *
 * WHY THIS EXISTS
 * ---------------
 * A project can display a named replacement and still have nobody available.
 * Two ways, both present in this data:
 *
 *   SELF        the replacement IS the responsible person. 62 projects, all
 *               Rency Sebastian, caused by the source workbook repeating the
 *               responsible name in the Vertretung column. A person cannot
 *               cover their own absence, so the cover is decorative.
 *
 *   MUTUAL      two people are each other's cover. 8 projects across Thorsten
 *               and Stephan. Fine in principle, and dangerous in practice: when
 *               both are away at once the pair fails together, and both are
 *               currently on approved sick leave.
 *
 * The important property is that this is DERIVED, not a list of names. If Björn
 * reassigns one of the eight, it leaves this view on its own; if a new mutual
 * pair appears in next month's workbook import, it arrives here without anyone
 * remembering to update a constant.
 *
 * ABSENCE IS NOT ASSUMED
 * ----------------------
 * This does not claim who is off today. The Hub has no absence feed yet, and
 * Factorial leave is read but not synced. Reporting "8 projects are uncovered
 * right now" would be a guess dressed as a fact. What it reports is structural:
 * these arrangements cannot survive the absence they exist for. That is true
 * regardless of who is off, and it is actionable today.
 */
export type BrokenCoverKind = "self" | "mutual";

export type BrokenCoverProject = {
  projectId: string;
  orderNo: string | null;
  responsiblePersonId: string;
  responsibleName: string;
  replacementPersonId: string;
  replacementName: string;
  kind: BrokenCoverKind;
  /** For a mutual pair, the count of projects that fail together with this one. */
  pairSize: number;
};

export type BrokenCoverSummary = {
  projects: BrokenCoverProject[];
  selfCoverCount: number;
  mutualCoverCount: number;
  /** Distinct people who would need to step in. Null when nobody is affected. */
  peopleAffected: string[];
};

type ResponsibilityRow = {
  project_id: string;
  person_id: string;
  role: string;
  order_no: string | null;
};

export async function getBrokenCover(supabase: SupabaseTyped): Promise<BrokenCoverSummary> {
  // Separate reads rather than a self-join: the responsibility table is small,
  // and a join here would fan out silently if a project ever carried two rows
  // of the same role.
  // project_responsibility is not in the generated types yet (same situation as
  // reassignment-candidates.ts); the row shape is asserted right below.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: rows } = await (supabase as any)
    .from("project_responsibility")
    .select("project_id, person_id, role, order_no");

  const { data: people } = await supabase.from("people").select("id, name");

  const nameOf = new Map((people ?? []).map((p: { id: string; name: string }) => [p.id, p.name]));

  const responsible = new Map<string, ResponsibilityRow>();
  const replacement = new Map<string, ResponsibilityRow>();
  for (const r of ((rows ?? []) as unknown) as ResponsibilityRow[]) {
    if (r.role === "responsible") responsible.set(r.project_id, r);
    else if (r.role === "replacement") replacement.set(r.project_id, r);
  }

  // First pass: classify every project that has both roles.
  const found: Omit<BrokenCoverProject, "pairSize">[] = [];
  for (const [projectId, resp] of responsible) {
    const rep = replacement.get(projectId);
    if (!rep) continue; // No cover named at all — a different finding, not this one.

    const self = rep.person_id === resp.person_id;
    const mutual =
      !self
      && responsible.get(findProjectWhere(responsible, rep.person_id) ?? "")?.person_id === rep.person_id
      && isMutual(responsible, replacement, resp.person_id, rep.person_id);

    if (!self && !mutual) continue;

    found.push({
      projectId,
      orderNo: resp.order_no,
      responsiblePersonId: resp.person_id,
      responsibleName: nameOf.get(resp.person_id) ?? resp.person_id,
      replacementPersonId: rep.person_id,
      replacementName: nameOf.get(rep.person_id) ?? rep.person_id,
      kind: self ? "self" : "mutual",
    });
  }

  // Second pass: how many projects fail together for each mutual pair? A lead
  // deciding where to start needs the blast radius, not just the count.
  const pairKey = (a: string, b: string) => [a, b].sort().join("|");
  const pairCounts = new Map<string, number>();
  for (const f of found) {
    if (f.kind !== "mutual") continue;
    const k = pairKey(f.responsiblePersonId, f.replacementPersonId);
    pairCounts.set(k, (pairCounts.get(k) ?? 0) + 1);
  }

  const projects: BrokenCoverProject[] = found.map((f) => ({
    ...f,
    pairSize: f.kind === "mutual"
      ? pairCounts.get(pairKey(f.responsiblePersonId, f.replacementPersonId)) ?? 1
      : 1,
  }));

  // Worst first: mutual pairs that take out the most projects, then self-cover.
  projects.sort((a, b) =>
    (b.kind === "mutual" ? b.pairSize : 0) - (a.kind === "mutual" ? a.pairSize : 0)
    || a.responsibleName.localeCompare(b.responsibleName, "de")
    || a.projectId.localeCompare(b.projectId));

  const affected = new Set<string>();
  for (const p of projects) {
    affected.add(p.responsibleName);
    if (p.kind === "mutual") affected.add(p.replacementName);
  }

  return {
    projects,
    selfCoverCount: projects.filter((p) => p.kind === "self").length,
    mutualCoverCount: projects.filter((p) => p.kind === "mutual").length,
    peopleAffected: [...affected].sort((a, b) => a.localeCompare(b, "de")),
  };
}

/** Any project this person is responsible for, or null. */
function findProjectWhere(responsible: Map<string, ResponsibilityRow>, personId: string): string | null {
  for (const [projectId, r] of responsible) if (r.person_id === personId) return projectId;
  return null;
}

/**
 * True when B covers A somewhere AND A covers B somewhere. Checked across the
 * whole table rather than within one project, because the reciprocity that
 * makes a pair fragile lives in the pair, not in a single row.
 */
function isMutual(
  responsible: Map<string, ResponsibilityRow>,
  replacement: Map<string, ResponsibilityRow>,
  personA: string,
  personB: string,
): boolean {
  let bCoversA = false;
  let aCoversB = false;
  for (const [projectId, resp] of responsible) {
    const rep = replacement.get(projectId);
    if (!rep) continue;
    if (resp.person_id === personA && rep.person_id === personB) bCoversA = true;
    if (resp.person_id === personB && rep.person_id === personA) aCoversB = true;
  }
  return bCoversA && aCoversB;
}
