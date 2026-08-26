// Why does one page say a person has 65 projects and another say 130?
//
// Both are right, and the answer generalises: the employee overview skips cover
// rows (management-employee-ownership.ts:168 skips share=0, :171 requires an open
// project), while the service grid drilldown resolves every assignment. For Rency
// that is 65 load-carrying + 65 cover = 130, all open.
//
// Kept because "these two numbers disagree" will be asked again, and the honest
// answer is a one-query check rather than a plausible guess. When I guessed the
// difference was closed work, I was wrong.
// READ-ONLY.
import { readFileSync } from "node:fs";
import pg from "pg";

const env = Object.fromEntries(
  readFileSync("C:/Supabase/.env.local", "utf8").split(/\r?\n/)
    .filter((l) => l && !l.startsWith("#") && l.includes("="))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^"|"$/g, "")]; }));

const c = new pg.Client({ connectionString: env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
await c.connect();
const q = async (label, sql) => {
  const r = await c.query(sql); console.log(`\n### ${label}`); console.table(r.rows); return r.rows;
};

await q("Rency's person_assignments rows, split by share and project status", `
  select
    case when pa.share_percent = 0 then 'cover (share 0)' else 'carries load' end as kind,
    case when pr.status is null then 'null status'
         when pr.status ilike '%abgeschlossen%' then 'closed'
         else 'open' end as project_state,
    count(*) as rows
  from public.person_assignments pa
  join public.people pe on pe.id = pa.person_id
  left join public.projects pr on pr.id = pa.project_id
  where pe.name = 'Rency Sebastian'
  group by 1, 2
  order by 1, 2`);

await q("totals", `
  select
    count(*) as all_assignment_rows,
    count(*) filter (where pa.share_percent > 0) as carries_load,
    count(*) filter (where pa.share_percent = 0) as cover_rows,
    count(*) filter (where pa.project_id is not null) as with_project
  from public.person_assignments pa
  join public.people pe on pe.id = pa.person_id
  where pe.name = 'Rency Sebastian'`);

console.log("\nThe employee overview counts only share>0 rows on OPEN projects");
console.log("(management-employee-ownership.ts:168 skips share=0, :171 requires isOpen).");
console.log("The service grid's drilldown counts every assignment it can resolve.");
console.log("Compare the two numbers above against 65 and 130 to confirm or refute.");

console.log("\nREAD-ONLY: nothing was written.");
await c.end();
