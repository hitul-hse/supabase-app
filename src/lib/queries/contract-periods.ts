/**
 * Contract periods: the read side.
 *
 * A "contract period" is one term of an agreement with a customer -- the hours
 * sales agreed, the dates they cover, and the point at which we want warning
 * that they are running out. Renewals add a period rather than editing one, so
 * this module reads a HISTORY, not a single current value, and every query is
 * written to keep the old periods visible alongside the new one.
 *
 * WHY NOT READ time.project.estimated_hours. That column is upserted from
 * TrackingTime on every sync (import-trackingtime.mjs:448), so it cannot hold a
 * number a human agreed -- the next sync would overwrite it silently. It stays
 * a fallback for projects with no contract recorded, and is labelled as such
 * wherever it surfaces.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";

type SupabaseTyped = SupabaseClient<Database>;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const timeSchema = (s: SupabaseTyped) => (s as any).schema("time");

/** PostgREST's page size on this project, measured rather than assumed. */
const PAGE = 1000;

export type ContractPeriodRow = {
  id: number;
  projectId: number;
  projectName: string;
  periodNo: number;
  budgetHours: number;
  startsOn: string;
  endsOn: string;
  warnAtPercent: number;
  contractReference: string | null;
  renewedFromId: number | null;
  confirmedAt: string | null;
  notes: string | null;

  /** Hours logged inside THIS period's window. */
  loggedHours: number;
  burnPercent: number | null;
  /** Hours left in this period; can be negative when it overran. */
  remainingHours: number;
  isCurrent: boolean;
  isExpired: boolean;
  /** Days until ends_on; negative once it has passed. */
  daysRemaining: number;
};

/**
 * How urgently a contract needs a human. Ordered worst-first, because that is
 * the order the portfolio view should show them in.
 */
export type ContractAttentionKind =
  /** Hours booked beyond the agreed budget. */
  | "over_budget"
  /** At or past the period's own warning threshold. */
  | "approaching_budget"
  /** The contract has ended and nothing has replaced it. */
  | "lapsed"
  /** Ending soon, so a renewal conversation needs to start. */
  | "expiring";

export type ContractAttentionRow = ContractPeriodRow & {
  kind: ContractAttentionKind;
  /** Plain-language reason, so the UI does not re-derive the wording. */
  headline: string;
};

/** How far ahead an ending contract starts asking for attention. */
export const EXPIRY_HORIZON_DAYS = 60;

function num(v: unknown): number {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}

function mapRow(r: Record<string, unknown>): ContractPeriodRow {
  const budget = num(r.budget_hours);
  const logged = num(r.logged_hours);
  return {
    id: num(r.id),
    projectId: num(r.project_id),
    projectName: String(r.project_name ?? ""),
    periodNo: num(r.period_no),
    budgetHours: budget,
    startsOn: String(r.starts_on ?? ""),
    endsOn: String(r.ends_on ?? ""),
    warnAtPercent: num(r.warn_at_percent) || 80,
    contractReference: (r.contract_reference as string | null) ?? null,
    renewedFromId: r.renewed_from_id === null ? null : num(r.renewed_from_id),
    confirmedAt: (r.confirmed_at as string | null) ?? null,
    notes: (r.notes as string | null) ?? null,
    loggedHours: logged,
    // The view computes this too, but recomputing keeps the number consistent
    // when a caller supplies rows from the base table instead.
    burnPercent: budget > 0 ? Math.round((logged / budget) * 1000) / 10 : null,
    remainingHours: Math.round((budget - logged) * 100) / 100,
    isCurrent: Boolean(r.is_current),
    isExpired: Boolean(r.is_expired),
    daysRemaining: num(r.days_remaining),
  };
}

/**
 * Every contract period for one project, newest first.
 *
 * Newest first because the current term is what somebody opening a project
 * wants, while the history below it is what makes a renewal auditable. The row
 * count is one per contract term, so this is deliberately unpaged.
 */
export async function getProjectContractPeriods(
  supabase: SupabaseTyped,
  projectId: number,
): Promise<ContractPeriodRow[]> {
  const { data, error } = await timeSchema(supabase)
    .from("contract_period_status")
    .select("*")
    .eq("project_id", projectId)
    .order("period_no", { ascending: false });

  // A missing table means the migration has not been applied yet. Returning
  // empty rather than throwing keeps every project page working in that window,
  // and the UI says "no contract recorded" which is then literally true.
  if (error) return [];
  return (data ?? []).map(mapRow);
}

/** The period covering a date, or null. At most one can match. */
export async function getActiveContractPeriod(
  supabase: SupabaseTyped,
  projectId: number,
  onDate?: string,
): Promise<ContractPeriodRow | null> {
  const day = (onDate ?? new Date().toISOString()).slice(0, 10);
  const periods = await getProjectContractPeriods(supabase, projectId);
  return periods.find((p) => p.startsOn <= day && day <= p.endsOn) ?? null;
}

/**
 * Contracts that need a human: over budget, approaching it, lapsed, or ending
 * soon.
 *
 * WHY THIS IS ONE QUERY AND NOT FOUR. The four states are mutually exclusive
 * per period and share every input, so splitting them would mean four scans of
 * the same rows and four chances for them to disagree about a boundary.
 *
 * Paged and ORDERED. The table is small today, but an unordered .range() read
 * in PostgREST has no stable row order, which silently repeats and skips rows
 * as a table grows -- a bug that cost a day on this codebase already.
 */
export async function getContractsNeedingAttention(
  supabase: SupabaseTyped,
): Promise<ContractAttentionRow[]> {
  const rows: Record<string, unknown>[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await timeSchema(supabase)
      .from("contract_period_status")
      .select("*")
      .order("id", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) return [];
    if (!data?.length) break;
    rows.push(...data);
    if (data.length < PAGE) break;
  }

  const periods = rows.map(mapRow);

  /*
   * "Lapsed" needs to know whether a LATER period exists, so it is computed
   * per project rather than per row: a period that ended last year is only a
   * problem if nothing replaced it.
   */
  const latestByProject = new Map<number, number>();
  for (const p of periods) {
    const seen = latestByProject.get(p.projectId) ?? -Infinity;
    if (p.periodNo > seen) latestByProject.set(p.projectId, p.periodNo);
  }

  const out: ContractAttentionRow[] = [];
  for (const p of periods) {
    const isLatest = latestByProject.get(p.projectId) === p.periodNo;
    const burn = p.burnPercent ?? 0;

    if (p.loggedHours > p.budgetHours) {
      out.push({
        ...p,
        kind: "over_budget",
        headline:
          `${p.loggedHours.toFixed(1)}h booked against a ${p.budgetHours}h contract ` +
          `(${burn.toFixed(0)}%). Raise the budget or re-scope the work.`,
      });
      continue;
    }

    if (burn >= p.warnAtPercent) {
      out.push({
        ...p,
        kind: "approaching_budget",
        headline:
          `${burn.toFixed(0)}% of the ${p.budgetHours}h contract used, ` +
          `${p.remainingHours.toFixed(1)}h left.`,
      });
      continue;
    }

    // Only the newest period can be "lapsed": an older one ending is just
    // history, and flagging it would bury the real cases in noise.
    if (p.isExpired && isLatest) {
      out.push({
        ...p,
        kind: "lapsed",
        headline:
          `The contract ended on ${p.endsOn} and has not been renewed. ` +
          `Hours logged after that date sit outside any contract period.`,
      });
      continue;
    }

    if (p.isCurrent && p.daysRemaining <= EXPIRY_HORIZON_DAYS) {
      out.push({
        ...p,
        kind: "expiring",
        headline:
          `Ends ${p.endsOn} (${p.daysRemaining} days). ` +
          `Confirm the renewal with sales to avoid a gap.`,
      });
    }
  }

  // Worst first: an overrun is money already spent, an expiry is a diary note.
  const rank: Record<ContractAttentionKind, number> = {
    over_budget: 0,
    approaching_budget: 1,
    lapsed: 2,
    expiring: 3,
  };
  return out.sort(
    (a, b) => rank[a.kind] - rank[b.kind] || (b.burnPercent ?? 0) - (a.burnPercent ?? 0),
  );
}
