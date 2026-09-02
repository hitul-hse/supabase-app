"use server";

import { Client } from "pg";
import { getTranslations } from "next-intl/server";
import { createClient } from "@/utils/supabase/server";
import { PERMISSIONS } from "@/lib/permissions";

/**
 * Who logged a project's hours, and on what -- the story behind one LOGGED
 * figure in the projects ledger.
 *
 * The ledger ships one aggregate per project, not the entries, so this is the
 * one drill-down on the page that cannot be a re-projection of data in hand.
 * Direct Postgres over SUPABASE_DB_URL, the pattern the identity queue and the
 * Overview's week drilldown proved: one short-lived connection, three
 * aggregations, out.
 *
 * BOUNDED EXACTLY AS THE LEDGER IS. getProjectList() folds fetchAllEntries()
 * under allTimeFilters(): duration not null (no running timers), started_at
 * from 2000-01-01 up to but excluding tomorrow 00:00 UTC, calendar time
 * INCLUDED. The same three bounds are written below, so a future-dated entry
 * is excluded here for the same reason it is excluded from the row, and an
 * entry dated later today is counted in neither (bounded at now(), like the Overview). Everything stays in seconds;
 * the client rounds once, per row, so the rows add up.
 *
 * TWO PERMISSIONS, not one. The page itself needs only projects:read_all, and
 * RLS then scopes the entries a read_own reader folds into "their" ledger
 * figure. This query runs as the database owner and sees everyone's entries,
 * so it additionally demands timesheets:read_all -- the permission that means
 * "may see other people's time". Without it the answer is an honest refusal,
 * not a partial list.
 *
 * The refusals are resolved here, in the caller's locale (the same cookie the
 * page reads), the way management/actions.ts does it: the dialog renders the
 * sentence it is handed, so a German reader must be handed German.
 */

export type ProjectHoursRow = {
  /** null = unattributed (no task, or a member with no display name). */
  name: string | null;
  seconds: number;
  billableSeconds: number;
  entries: number;
};

export type ProjectHoursRest = { seconds: number; count: number };

export type ProjectHoursDrilldown = {
  projectId: number;
  totals: { seconds: number; billableSeconds: number; entries: number; people: number; tasks: number };
  /** Top 8 by hours; what they do not cover is in `byPersonRest`. */
  byPerson: ProjectHoursRow[];
  byPersonRest: ProjectHoursRest;
  byTask: ProjectHoursRow[];
  byTaskRest: ProjectHoursRest;
  error?: string;
};

const TOP = 8;
const int = (v: unknown) => Math.round(Number(v ?? 0));

export async function getProjectHoursDrilldown(projectId: number): Promise<ProjectHoursDrilldown> {
  const empty: ProjectHoursDrilldown = {
    projectId,
    totals: { seconds: 0, billableSeconds: 0, entries: 0, people: 0, tasks: 0 },
    byPerson: [],
    byPersonRest: { seconds: 0, count: 0 },
    byTask: [],
    byTaskRest: { seconds: 0, count: 0 },
  };

  const t = await getTranslations("drill.projects.ledger");
  if (!Number.isInteger(projectId) || projectId <= 0) {
    return { ...empty, error: t("badProject") };
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ...empty, error: t("notAuthenticated") };

  const [{ data: canReadProjects }, { data: canReadAllTime }] = await Promise.all([
    supabase.rpc("app_user_has_permission", { p_key: PERMISSIONS.PROJECTS_READ_ALL }),
    supabase.rpc("app_user_has_permission", { p_key: PERMISSIONS.TIMESHEETS_READ_ALL }),
  ]);
  if (canReadProjects !== true) return { ...empty, error: t("notPermitted") };
  if (canReadAllTime !== true) return { ...empty, error: t("needsPermission") };

  const url = process.env.SUPABASE_DB_URL;
  if (!url) return { ...empty, error: "SUPABASE_DB_URL is not configured in this environment." };

  const db = new Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
  try {
    await db.connect();

    const base = `
      from time.entry e
     where e.project_id = $1
       and e.duration_seconds is not null
       and e.started_at >= '2000-01-01T00:00:00Z'::timestamptz
       and e.started_at <= now()`;

    const [totals, byPerson, byTask] = await Promise.all([
      db.query(
        `select coalesce(sum(e.duration_seconds), 0)::bigint as seconds,
                coalesce(sum(e.duration_seconds) filter (where e.is_billable), 0)::bigint as billable,
                count(*)::int as entries,
                count(distinct e.member_id)::int as people,
                count(distinct coalesce(tk.name, ''))::int as tasks
           ${base.replace("from time.entry e", "from time.entry e left join time.task tk on tk.id = e.task_id")}`,
        [projectId],
      ),
      db.query(
        `select nullif(trim(m.display_name), '') as name,
                sum(e.duration_seconds)::bigint as seconds,
                coalesce(sum(e.duration_seconds) filter (where e.is_billable), 0)::bigint as billable,
                count(*)::int as entries
           ${base.replace("from time.entry e", "from time.entry e left join time.member m on m.id = e.member_id")}
         group by e.member_id, m.display_name
         order by 2 desc, 1
         limit ${TOP}`,
        [projectId],
      ),
      db.query(
        `select tk.name as name,
                sum(e.duration_seconds)::bigint as seconds,
                coalesce(sum(e.duration_seconds) filter (where e.is_billable), 0)::bigint as billable,
                count(*)::int as entries
           ${base.replace("from time.entry e", "from time.entry e left join time.task tk on tk.id = e.task_id")}
         group by tk.name
         order by 2 desc, 1
         limit ${TOP}`,
        [projectId],
      ),
    ]);

    const t = totals.rows[0] ?? {};
    const seconds = int(t.seconds);
    const row = (r: Record<string, unknown>): ProjectHoursRow => ({
      name: r.name === null || r.name === undefined ? null : String(r.name),
      seconds: int(r.seconds),
      billableSeconds: int(r.billable),
      entries: int(r.entries),
    });
    const persons = byPerson.rows.map(row);
    const tasks = byTask.rows.map(row);
    const covered = (rows: ProjectHoursRow[]) => rows.reduce((s, r) => s + r.seconds, 0);

    return {
      projectId,
      totals: {
        seconds,
        billableSeconds: int(t.billable),
        entries: int(t.entries),
        people: int(t.people),
        tasks: int(t.tasks),
      },
      byPerson: persons,
      // The remainder is what makes the popup add up: total minus the top
      // rows, stated as its own row rather than left as a silent gap.
      byPersonRest: { seconds: seconds - covered(persons), count: int(t.people) - persons.length },
      byTask: tasks,
      byTaskRest: { seconds: seconds - covered(tasks), count: int(t.tasks) - tasks.length },
    };
  } catch (e) {
    const m = e && typeof e === "object" && "message" in e ? (e as { message: string }).message : String(e);
    return { ...empty, error: m };
  } finally {
    try { await db.end(); } catch { /* already closed */ }
  }
}
