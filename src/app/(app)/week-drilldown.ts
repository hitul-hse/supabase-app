"use server";

import { Client } from "pg";
import { createClient } from "@/utils/supabase/server";
import { PERMISSIONS } from "@/lib/permissions";
import { NO_TEAM } from "@/lib/queries/overview-live";

/**
 * The story behind one point on the Overview's billable-share chart.
 *
 * Direct Postgres over SUPABASE_DB_URL, the same pattern the identity queue
 * proved in production: one short-lived connection, three aggregations, out.
 * Everything is bounded at now() -- TrackingTime holds future-dated planned
 * entries, and a drilldown that counted them would disagree with the chart
 * it was opened from, which is the one bug this feature must never have.
 */

export type WeekDrilldownRow = { name: string; hours: number; billableHours: number };
export type WeekDrilldown = {
  weekStart: string;
  totals: { hours: number; billableHours: number; share: number | null; entries: number; people: number };
  byPerson: WeekDrilldownRow[];
  byProject: WeekDrilldownRow[];
  error?: string;
};

const r1 = (n: unknown) => Math.round(Number(n ?? 0) * 10) / 10;

export async function getWeekDrilldown(
  weekStart: string,
  team: string | null,
): Promise<WeekDrilldown> {
  const empty: WeekDrilldown = {
    weekStart,
    totals: { hours: 0, billableHours: 0, share: null, entries: 0, people: 0 },
    byPerson: [],
    byProject: [],
  };

  /*
   * A SIGNED-IN SESSION IS NOT ENOUGH, and this used to think it was.
   *
   * The night security audit of 2026-09-11 rated this the only blocking finding
   * it produced. This action reads `time.entry` and `time.member` over
   * SUPABASE_DB_URL, which connects as the owner role with row-level security
   * OFF, and it used to admit anybody `getUser()` recognised. A server action is
   * a public POST endpoint, and an OAuth sign-in with no profile row keeps its
   * session (src/app/auth/callback/route.ts) and passes
   * `enforceRoleRouteAccess` (src/utils/supabase/require-profile.ts). So exactly
   * the accounts RLS shuts out of everything else could read the top eight
   * people per team, by name, with their hours, for any week.
   *
   * The sibling action `projects/project-drilldown.ts` had always required a
   * permission before doing the same kind of read. One of the two was wrong and
   * it was not that one.
   *
   * WHY `timesheets:read_all` AND NOT ALSO `projects:read_all`. The sibling asks
   * for both. This one deliberately asks for one, and the difference is not an
   * oversight: what leaks here is named people's hours, and `timesheets:read_all`
   * is precisely the permission for reading everybody's hours. It admits exec and
   * hr, both of whom read company hours as their job. Adding `projects:read_all`
   * would protect nothing further -- byProject is the same timesheet rows grouped
   * differently -- and would take the drilldown away from hr, who should have it.
   * A permission added for symmetry rather than for a reason is a permission
   * nobody can later argue with.
   *
   * `app_user_has_permission` resolves through the caller's own profile via
   * auth.uid(), so an account without an active profile row gets false here and
   * never reaches the connection below.
   */
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ...empty, error: "Not authenticated." };

  const { data: canReadAllTime } = await supabase.rpc("app_user_has_permission", {
    p_key: PERMISSIONS.TIMESHEETS_READ_ALL,
  });
  if (canReadAllTime !== true) return { ...empty, error: "Not permitted." };

  if (!/^\d{4}-\d{2}-\d{2}$/.test(weekStart)) {
    return { ...empty, error: "Bad week key." };
  }

  const url = process.env.SUPABASE_DB_URL;
  if (!url) return { ...empty, error: "SUPABASE_DB_URL is not configured in this environment." };

  const db = new Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
  try {
    await db.connect();
    /*
     * Team semantics copied from overview-live: a team key matches m.team,
     * NO_TEAM means m.team IS NULL, null means everyone.
     */
    const teamClause =
      team === null
        ? ""
        : team === NO_TEAM
          ? "and m.team is null"
          : "and m.team = $2";
    const params: unknown[] = team !== null && team !== NO_TEAM ? [weekStart, team] : [weekStart];

    const base = `
      from time.entry e
      join time.member m on m.id = e.member_id
     where e.started_at >= $1::date
       and e.started_at < $1::date + 7
       and e.started_at <= now()
       ${teamClause}`;

    const [totals, byPerson, byProject] = await Promise.all([
      db.query(
        `select round(coalesce(sum(e.duration_seconds), 0) / 3600.0, 1)::float8 as hours,
                round(coalesce(sum(e.duration_seconds) filter (where e.is_billable), 0) / 3600.0, 1)::float8 as billable,
                count(*)::int as entries,
                count(distinct e.member_id)::int as people
         ${base}`,
        params,
      ),
      db.query(
        `select coalesce(nullif(trim(m.display_name), ''), 'Unknown') as name,
                round(sum(e.duration_seconds) / 3600.0, 1)::float8 as hours,
                round(coalesce(sum(e.duration_seconds) filter (where e.is_billable), 0) / 3600.0, 1)::float8 as billable
         ${base}
         group by 1 order by 2 desc limit 8`,
        params,
      ),
      db.query(
        `select coalesce(p.name, '(no project)') as name,
                round(sum(e.duration_seconds) / 3600.0, 1)::float8 as hours,
                round(coalesce(sum(e.duration_seconds) filter (where e.is_billable), 0) / 3600.0, 1)::float8 as billable
         ${base.replace("join time.member m", "left join time.project p on p.id = e.project_id join time.member m")}
         group by 1 order by 2 desc limit 8`,
        params,
      ),
    ]);

    const t = totals.rows[0] ?? {};
    const hours = r1(t.hours);
    const billable = r1(t.billable);
    return {
      weekStart,
      totals: {
        hours,
        billableHours: billable,
        share: hours > 0 ? Math.round((billable / hours) * 100) : null,
        entries: Number(t.entries ?? 0),
        people: Number(t.people ?? 0),
      },
      byPerson: byPerson.rows.map((row) => ({
        name: String(row.name),
        hours: r1(row.hours),
        billableHours: r1(row.billable),
      })),
      byProject: byProject.rows.map((row) => ({
        name: String(row.name),
        hours: r1(row.hours),
        billableHours: r1(row.billable),
      })),
    };
  } catch (e) {
    /*
     * The database's own message used to be returned to the browser. A Postgres
     * error names schemas, tables, columns and sometimes the failing statement,
     * which hands a caller a map of the warehouse for free -- and this endpoint
     * is reachable by anyone signed in. It is logged where the operator can read
     * it and the caller gets a sentence.
     */
    console.error("getWeekDrilldown failed", e);
    return { ...empty, error: "The week could not be read." };
  } finally {
    try { await db.end(); } catch { /* already closed */ }
  }
}
