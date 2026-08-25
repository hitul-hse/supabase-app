// The two views are unreachable from the app today, so nothing is showing a
// wrong number. But leaving them is still a live hazard: they are valid SQL
// against a real table, they return a confident 0 rather than NULL, and their
// accessors sit ready in hse.ts. The next person to build a budget widget will
// find getProjectBudgetStatus(), call it, and ship silent zeros.
//
// Before deciding what to do, establish exactly what would need to change for
// them to be CORRECT - i.e. what the same numbers look like from time.entry.
import { readFileSync } from "node:fs";
import pg from "pg";

const env = Object.fromEntries(
  readFileSync("C:/Supabase/.env.local", "utf8").split(/\r?\n/)
    .filter((l) => l && !l.startsWith("#") && l.includes("="))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^"|"$/g, "")]; }));

const c = new pg.Client({ connectionString: env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
await c.connect();
const q = async (l, s) => { try { const r = await c.query(s); console.log(`\n### ${l}`); console.table(r.rows.slice(0, 12)); return r.rows; } catch (e) { console.log(`\n### ${l} FAILED: ${e.message.slice(0,130)}`); return []; } };

// Could the same question be answered from the real data? The bridge is
// time.project.hub_project_id -> public.projects.id, which we know is partial.
await q("bridge coverage: can time.entry hours reach a hub project?", `
  select
    count(*)::int entries,
    count(*) filter (where p.hub_project_id is not null)::int reach_hub_project,
    round(sum(e.duration_seconds)/3600.0,1) total_hours,
    round(sum(e.duration_seconds) filter (where p.hub_project_id is not null)/3600.0,1) hours_reaching_hub
  from time.entry e
  left join time.project p on p.id = e.project_id`);

await q("what a real budget view would produce (top 8 by logged hours)", `
  select hp.id project_id, hp.name, hp.budget_hours,
         round(sum(e.duration_seconds)/3600.0,1) hours_logged,
         round(sum(e.duration_seconds) filter (where e.is_billable)/3600.0,1) billable_hours
  from time.entry e
  join time.project tp on tp.id = e.project_id
  join public.projects hp on hp.id = tp.hub_project_id
  group by 1,2,3
  order by 4 desc nulls last
  limit 8`);

await q("people with a billable rate set (needed for value)", `
  select
    count(*)::int people,
    count(billable_rate_eur)::int with_rate,
    count(cost_rate_eur)::int with_cost
  from public.people where is_active`);

await c.end();
