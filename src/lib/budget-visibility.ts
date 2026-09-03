/**
 * Who may see a project budget, and what a withheld budget looks like.
 *
 * WHY THIS MODULE EXISTS
 * ----------------------
 * `projects:contracts:read` is the permission that decides whether a caller may
 * see the hours a customer agreed to pay for. Until 2026-09-03 it was held by
 * all five roles and read by NOTHING in the application -- `grep -rn
 * "contracts:read" src/` returned only its own declaration in permissions.ts.
 * Its single enforcement point was the RLS policy on
 * `time.project_contract_period`, which is the ONE budget source the app barely
 * uses; the budgets people actually look at come from
 * `time.project.estimated_hours` (SELECT policy: `true`) and
 * `public.projects.contract_hours` (SELECT policy: row-scoped by
 * `can_view_project`, which says nothing about budgets).
 *
 * So this is the chokepoint. Every server-side query that is about to put a
 * budget figure into a payload asks here first. It is server-side on purpose:
 * hiding the number in a component while the data still arrives in the props is
 * not access control, it is a CSS rule.
 *
 * WHY THE QUERY LAYER AND NOT RLS ALONE
 * -------------------------------------
 * Postgres RLS is row-level. There is no per-app-role column redaction for a
 * base table: the only database-side options are to drop the column grant and
 * serve it through an owner-rights view (which for `public.projects` would mean
 * re-implementing `can_view_project()` inside that view -- the exact
 * bypass-shaped construct two previous migrations were written to remove), or to
 * move budgets into their own table with their own policy. Both need their own
 * design. What IS done in the database today, and is real:
 *
 *   - `time.project_contract_period` -- RLS policy is the permission itself.
 *   - `time.contract_period_status`  -- security_invoker, so that policy applies.
 *   - `time.project_summary`         -- estimated_hours and burn_percent are
 *                                       redacted to NULL in the view itself.
 *
 * The residual is stated rather than papered over: a caller who talks to
 * PostgREST directly can still read the two raw base columns. See
 * supabase/migrations/20260903120000_budgets_are_commercial_not_general.sql.
 *
 * THE NULL PROBLEM, WHICH IS THE WHOLE REASON FOR `BudgetVisibility`
 * ------------------------------------------------------------------
 * A withheld budget is NULL. "Nobody set a budget" is ALSO absent -- stored as 0
 * in `time.project.estimated_hours` and as null-or-0 in
 * `public.projects.contract_hours` (DESIGN.md rule 6, and [[Number
 * definitions]]: "no budget" is a real, specific state). Those two absences look
 * identical in the data and mean opposite things: one is "there is nothing to
 * see", the other is "there is something and it is not for you".
 *
 * They are therefore never inferred from the value. The caller's permission is
 * carried alongside the data as `BudgetVisibility`, and the UI decides from THAT
 * which of the two it is rendering. A dash that silently means both is the
 * failure this type exists to make impossible.
 *
 * DERIVED COUNTS MUST BE ABSENT, NOT RECOMPUTED
 * ---------------------------------------------
 * The Overview's over-budget and no-budget tiles are counted from
 * `estimated_hours`. Fed redacted nulls they do not error -- they return
 * "0 over budget" and "everything unbudgeted", which is a plausible, confident,
 * wrong answer, and the reader has no way to tell. So a caller who cannot see
 * budgets gets `null` for the whole posture, and the tile says so.
 */
import { PERMISSIONS } from "@/lib/permissions";
import type { SupabaseTyped } from "@/lib/queries/types";

/*
 * DELIBERATELY NO IMPORT OF @/utils/supabase/server HERE.
 *
 * An earlier draft exported a convenience `currentUserCanReadBudgets()` that
 * built its own client. That pulled `next/headers` into this module, and this
 * module is imported by the query layer, which scripts/check-trackingtime-
 * report.mjs loads directly under `node --experimental-strip-types` with no
 * bundler. The gate died with ERR_MODULE_NOT_FOUND on next/headers -- a
 * green-looking change that broke an unrelated test.
 *
 * Every function here takes the caller's client instead. That is better anyway:
 * the permission is then evaluated on the SAME session as the query it guards,
 * rather than on a second client that might not be the same caller.
 */

/**
 * Whether the current caller may see project budgets.
 *
 * Carried next to the data rather than checked again at render time, so a
 * component cannot forget to ask and cannot answer differently from the query
 * that produced its props.
 */
export type BudgetVisibility = "visible" | "withheld";

/**
 * Does the caller hold `projects:contracts:read`?
 *
 * Resolved by the database (`app_user_has_permission`), never from the role
 * string: the RPC walks app_user_profile -> app_role_permission and returns
 * false for a deactivated account, which a role string in a session cookie
 * would not. Takes the client the caller already has so the check runs on the
 * same session as the query it guards.
 */
export async function canReadBudgets(supabase: SupabaseTyped): Promise<boolean> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data } = await (supabase as any).rpc("app_user_has_permission", {
      p_key: PERMISSIONS.PROJECTS_CONTRACTS_READ,
    });
    return data === true;
  } catch {
    // Fail CLOSED. An unreachable permission check is not permission.
    return false;
  }
}

export const visibilityOf = (canRead: boolean): BudgetVisibility =>
  canRead ? "visible" : "withheld";

/**
 * A budget figure as it may leave the server.
 *
 * `null` when withheld -- the number does not travel. Use with the
 * `BudgetVisibility` alongside it to render "withheld" rather than "not set".
 */
export function budgetOrWithheld(
  value: number | null | undefined,
  canRead: boolean,
): number | null {
  if (!canRead) return null;
  return value === null || value === undefined ? null : Number(value);
}

/**
 * Strip every budget-bearing field from a row when the caller may not see them.
 *
 * Takes the field names explicitly rather than guessing from a pattern: a
 * heuristic over key names would silently miss a renamed field, and silently
 * blanking a field that is NOT a budget is its own bug.
 */
export function redactBudgetFields<T extends object, K extends keyof T>(
  row: T,
  fields: readonly K[],
  canRead: boolean,
): T {
  if (canRead) return row;
  const out = { ...row };
  for (const f of fields) (out as Record<string, unknown>)[f as string] = null;
  return out;
}

/**
 * The column names that carry a project budget, on either projects table.
 *
 * `public.people.contract_hours` is NOT here and must never be: that is a
 * person's contracted WEEKLY hours -- employment data governed by
 * hr:contract:read -- and it only shares a name with the commercial figure.
 * Confusing the two would blank HR's own data over a projects permission.
 */
export const BUDGET_COLUMNS = [
  "contract_hours",
  "estimated_hours",
  "budget_hours",
  "consumed_percent",
  "remaining_hours",
  "forecast_overrun",
  "budget_fee_eur",
] as const;

/**
 * Remove the budget columns from a PostgREST select list when the caller may
 * not see them.
 *
 * WHY OMIT RATHER THAN BLANK AFTERWARDS. A column that is not requested is
 * never serialised, never crosses the wire and never lands in a React prop, so
 * there is no copy of it to leak through a component that forgot to check, a
 * CSV writer, or a future refactor. Nulling the field after the fetch leaves
 * the real number in the server's memory and one careless spread away from the
 * client.
 *
 * The omitted field then reads as `undefined` downstream. Every consumer here
 * already coerces an absent budget to null or 0 -- which is exactly why the
 * calling page must ALSO carry a "withheld" flag and say so: a 0 that came from
 * a missing column is indistinguishable from the 0 that means "nobody set a
 * budget", and that is the substitution DESIGN.md rule 6 forbids.
 */
export function budgetAwareColumns(columns: string, canRead: boolean): string {
  /*
   * Flat column lists only.
   *
   * A PostgREST embed -- `customer:customer_id ( name )` -- contains no comma
   * today, but `( name, id )` does, and splitting on commas would tear it in
   * half and produce a select list that fails at runtime with an unhelpful
   * parser error. Callers that need an embed build it around this call
   * (projects-live.ts does exactly that) rather than through it. Thrown rather
   * than tolerated: a silently mangled select is the kind of failure that shows
   * up as an empty page in production and as nothing at all in review.
   */
  if (columns.includes("(")) {
    throw new Error(
      "budgetAwareColumns() takes a flat column list; build embeds around it, not through it",
    );
  }
  if (canRead) return columns;
  return columns
    .split(",")
    .map((c) => c.trim())
    .filter((c) => c.length > 0 && !(BUDGET_COLUMNS as readonly string[]).includes(c))
    .join(", ");
}
