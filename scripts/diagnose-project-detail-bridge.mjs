// The architectural question that decides this whole feature.
//
// There are TWO project worlds:
//   time.project    bigint id, TrackingTime's view, drives /projects and
//                   /projects/[id] (the detail page validates /^\d+$/)
//   public.projects text id like 10110_00358_104_01, the MASTERDATA order book,
//                   carries owner_person_id, contract_hours, the customer entity
//
// The user wants to click a project and see its services AND who is responsible
// AND reassign that person. Services live in time.*, responsibility lives in
// public.*. So the question is: can every project the user would click reach
// both sides? Anywhere the bridge is missing is a page that cannot be built.
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
  try { const r = await c.query(sql); console.log(`\n### ${label}`); console.table(r.rows); return r.rows; }
  catch (e) { console.log(`\n### ${label} FAILED: ${e.message}`); return null; }
};

await q("the two worlds, and how well they bridge", `
  select
    (select count(*) from time.project) as time_projects,
    (select count(*) from public.projects) as masterdata_orders,
    (select count(*) from time.project where hub_project_id is not null) as time_linked_to_masterdata,
    (select count(*) from public.projects p
      where exists (select 1 from time.project t where t.hub_project_id = p.id)) as masterdata_reachable_from_time`);

// The detail page is /projects/<bigint>. For each such project, can we resolve
// the responsible person? That is the join the new UI depends on.
await q("from a time.project id, can we reach a responsible person?", `
  select
    count(*) as time_projects,
    count(*) filter (where p.id is not null) as reach_masterdata,
    count(*) filter (where p.owner_person_id is not null) as reach_a_responsible_person,
    count(*) filter (where p.id is not null and p.owner_person_id is null) as linked_but_no_owner
  from time.project t
  left join public.projects p on p.id = t.hub_project_id`);

// And the reverse: masterdata orders with an owner that are NOT clickable from
// /projects, because no time.project points at them. Those are invisible today.
await q("masterdata orders with an owner but NO clickable detail page", `
  select count(*) as orphaned_orders,
         count(*) filter (where p.owner_person_id is not null) as with_a_responsible_person,
         round(coalesce(sum(p.contract_hours),0)::numeric,1) as contract_hours_affected
  from public.projects p
  where not exists (select 1 from time.project t where t.hub_project_id = p.id)`);

console.log("\n=== How does /my-work actually decide what to show? ===");

// my-work.ts reads project_responsibility, projects.owner_person_id and
// person_assignments. Confirm each rung's live size so a reassignment's effect
// is predictable.
await q("the four rungs my-work reads", `
  select
    (select count(*) from public.project_responsibility where role = 'responsible') as responsibility_responsible,
    (select count(*) from public.project_responsibility where role = 'replacement') as responsibility_replacement,
    (select count(*) from public.projects where owner_person_id is not null) as projects_with_owner,
    (select count(*) from public.person_assignments) as assignments`);

// THE key question for step 3 of the user's chain: when decide_project_responsible_change
// runs, it updates projects.owner_person_id and person_assignments, but does it
// touch project_responsibility? my-work's `responsible` rung reads THAT table.
console.log("\n=== Does the approval RPC update project_responsibility? ===");
const fnSrc = await c.query(`
  select prosrc from pg_proc where proname = 'decide_project_responsible_change'`);
const src = fnSrc.rows[0]?.prosrc ?? "";
const touches = {
  "projects.owner_person_id": /update public\.projects/.test(src),
  "person_assignments": /person_assignments/.test(src),
  "project_responsibility": /project_responsibility/.test(src),
};
for (const [k, v] of Object.entries(touches)) console.log(`  ${v ? "YES" : "NO "}  ${k}`);
if (!touches["project_responsibility"]) {
  console.log("\n  => GAP: the approved change never writes project_responsibility.");
  console.log("     my-work.ts labels the `responsible` rung from THAT table, so a");
  console.log("     reassigned person would appear as `owner`/`assigned` but never");
  console.log("     as RESPONSIBLE, and the old responsible would keep the badge.");
}

console.log("\nREAD-ONLY: nothing was written.");
await c.end();
