/**
 * Budget and contract alerts: the read side.
 *
 * WHY THIS EXISTS AT ALL. The overbooking guard already recorded alerts
 * correctly, but its only OUTPUT was email, and email needs RESEND_API_KEY. A
 * user hit a refusal, the row was written with notified=null ("never
 * attempted"), and they experienced silence. Reading the alerts in the app
 * removes the dependency on a transport that may not be configured.
 *
 * The honesty rule that shapes the types below: `emailState` is a three-valued
 * fact, not a boolean. not_attempted / failed / sent are genuinely different,
 * and collapsing them is how an interface ends up claiming it sent something it
 * did not.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";

type SupabaseTyped = SupabaseClient<Database>;

const PAGE = 1000;

/** What happened. The first three allowed the booking; the last two refused it. */
export type BudgetAlertKind =
  | "approaching"
  | "outside_contract"
  | "contract_expiring"
  | "over"
  | "already_over";

export type EmailState = "not_attempted" | "failed" | "sent";

export type BudgetAlertRow = {
  id: string;
  createdAt: string;
  kind: BudgetAlertKind;
  projectId: number | null;
  projectName: string;
  actorName: string;
  actorUserId: string | null;

  budgetHours: number;
  loggedHours: number;
  requestedHours: number;
  projectedHours: number;
  overByHours: number;
  thresholdPercent: number | null;
  contractPeriodId: number | null;

  /** The message the user actually saw, verbatim. */
  reason: string;
  source: string;

  isOpen: boolean;
  /** Whether the booking was refused, as opposed to allowed with a warning. */
  blockedTheBooking: boolean;
  acknowledgedAt: string | null;
  acknowledgedNote: string | null;

  emailState: EmailState;
  deliveryError: string | null;
  recipients: string[];
};

function num(v: unknown): number {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}

function mapAlert(r: Record<string, unknown>): BudgetAlertRow {
  return {
    id: String(r.id),
    createdAt: String(r.created_at ?? ""),
    kind: (String(r.kind ?? "over") as BudgetAlertKind),
    projectId: r.project_id === null ? null : num(r.project_id),
    projectName: String(r.project_name ?? ""),
    actorName: String(r.actor_name ?? ""),
    actorUserId: (r.actor_user_id as string | null) ?? null,
    budgetHours: num(r.budget_hours),
    loggedHours: num(r.logged_hours),
    requestedHours: num(r.requested_hours),
    projectedHours: num(r.projected_hours),
    overByHours: num(r.over_by_hours),
    thresholdPercent: r.threshold_percent === null ? null : num(r.threshold_percent),
    contractPeriodId: r.contract_period_id === null ? null : num(r.contract_period_id),
    reason: String(r.reason ?? ""),
    source: String(r.source ?? ""),
    isOpen: Boolean(r.is_open),
    blockedTheBooking: Boolean(r.blocked_the_booking),
    acknowledgedAt: (r.acknowledged_at as string | null) ?? null,
    acknowledgedNote: (r.acknowledged_note as string | null) ?? null,
    emailState: (String(r.email_state ?? "not_attempted") as EmailState),
    deliveryError: (r.delivery_error as string | null) ?? null,
    recipients: Array.isArray(r.notify_recipients)
      ? (r.notify_recipients as string[])
      : [],
  };
}

/**
 * Alerts, newest first.
 *
 * Paged and ORDERED. An unordered .range() read in PostgREST has no stable row
 * order, so paging silently repeats and skips rows -- a bug that already cost a
 * day on this codebase. created_at descending with id as a tiebreak, because
 * two alerts can share a timestamp.
 */
export async function getBudgetAlerts(
  supabase: SupabaseTyped,
  { openOnly = true, limit = 200 }: { openOnly?: boolean; limit?: number } = {},
): Promise<BudgetAlertRow[]> {
  const rows: Record<string, unknown>[] = [];
  for (let from = 0; from < limit; from += PAGE) {
    // Cast at the point of use: budget_alert_feed is created by
    // add_budget_alert_visibility.sql, so the checked-in generated Database type
    // does not list it until it is regenerated. The mapping below stays typed.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let q = (supabase as any)
      .from("budget_alert_feed")
      .select("*")
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .range(from, Math.min(from + PAGE, limit) - 1);
    if (openOnly) q = q.eq("is_open", true);

    const { data, error } = await q;
    // A missing view means the migration is not applied yet. Empty rather than
    // an error keeps the page working in that window.
    if (error) return [];
    if (!data?.length) break;
    rows.push(...(data as Record<string, unknown>[]));
    if (data.length < PAGE) break;
  }
  return rows.map(mapAlert);
}

/** Counts for a nav badge: how many alerts are open, and how many blocked work. */
export async function getOpenAlertCounts(
  supabase: SupabaseTyped,
): Promise<{ open: number; blocking: number }> {
  const alerts = await getBudgetAlerts(supabase, { openOnly: true, limit: PAGE });
  return {
    open: alerts.length,
    blocking: alerts.filter((a) => a.blockedTheBooking).length,
  };
}

/** Human label for a kind. Kept here so every surface words it identically. */
export function alertKindLabel(kind: BudgetAlertKind): string {
  switch (kind) {
    case "approaching":
      return "Approaching budget";
    case "over":
      return "Booking refused: over budget";
    case "already_over":
      return "Booking refused: already over";
    case "outside_contract":
      return "Logged outside any contract period";
    case "contract_expiring":
      return "Contract expiring";
  }
}

/**
 * What the delivery state MEANS, in words a reader can act on.
 *
 * Deliberately explicit that "not attempted" is a configuration fact and not a
 * failure of the alert: the record exists either way, which is the entire point
 * of writing it before trying to send.
 */
export function emailStateLabel(state: EmailState): string {
  switch (state) {
    case "not_attempted":
      return "No email sent (no mail transport configured)";
    case "failed":
      return "Email failed to send";
    case "sent":
      return "Email sent";
  }
}
