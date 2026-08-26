// Is the "replacement / Vertretung" second responsible person actually reachable?
//
// import-masterdata-projects.mjs:292-303 writes the replacement as a
// person_assignments row with share_percent = 0 and sort_order = 1, distinct
// from the owner's share_percent = 100 / sort_order = 0. So the data SHOULD be
// in the DB. This asks two questions the import cannot answer:
//   1. Did those rows survive? (count them, compare to the workbook's 146)
//   2. Can a user ever SEE them, or does every read path filter them out /
//      collapse them into the owner?
//
// READ-ONLY. Nothing is written.
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
  catch (e) { console.log(`\n### ${label} FAILED: ${e.message}`); return []; }
};

console.log("=".repeat(78));
console.log("Q1  Do replacement rows exist in person_assignments?");
console.log("=".repeat(78));

await q("share_percent distribution", `
  select share_percent, sort_order, count(*) as rows
  from public.person_assignments
  group by share_percent, sort_order
  order by share_percent desc, sort_order`);

await q("projects carrying a second (replacement) assignee", `
  select count(distinct project_id) as projects_with_replacement
  from public.person_assignments
  where share_percent = 0 and sort_order = 1 and project_id is not null`);

await q("projects carrying BOTH an owner and a replacement", `
  with owner as (
    select distinct project_id from public.person_assignments
    where share_percent = 100 and project_id is not null),
  repl as (
    select distinct project_id from public.person_assignments
    where share_percent = 0 and sort_order = 1 and project_id is not null)
  select
    (select count(*) from owner) as with_owner,
    (select count(*) from repl) as with_replacement,
    (select count(*) from owner o join repl r using (project_id)) as with_both`);

console.log("\n" + "=".repeat(78));
console.log("Q2  Is the replacement distinguishable from the owner in the row itself?");
console.log("=".repeat(78));

await q("person_assignments columns", `
  select column_name, data_type, is_nullable
  from information_schema.columns
  where table_schema = 'public' and table_name = 'person_assignments'
  order by ordinal_position`);

await q("sample project with owner+replacement, as stored", `
  with picked as (
    select pa.project_id
    from public.person_assignments pa
    where pa.share_percent = 0 and pa.sort_order = 1 and pa.project_id is not null
    limit 3)
  select pa.project_id, pa.person_id, pe.name, pa.share_percent, pa.sort_order, pa.logged_hours
  from public.person_assignments pa
  join picked b on b.project_id = pa.project_id
  left join public.people pe on pe.id = pa.person_id
  order by pa.project_id, pa.sort_order`);

console.log("\n" + "=".repeat(78));
console.log("Q3  Does the replacement's 0h logged_hours misrepresent reality?");
console.log("=".repeat(78));

// The owner row carries the PROJECT total in logged_hours (import line 287),
// while the replacement is hardcoded to 0 (line 299). If any UI sums
// logged_hours per person, the replacement contributes an honest-looking 0 that
// is actually "not measured for this person".
await q("replacement rows with a hardcoded 0 against a real project total", `
  select count(*) as replacement_rows_reading_zero,
         count(*) filter (where pr.logged_hours > 0) as where_project_has_real_hours,
         round(sum(pr.logged_hours) filter (where pr.logged_hours > 0)::numeric, 1) as project_hours_they_read_as_zero
  from public.person_assignments pa
  join public.projects pr on pr.id = pa.project_id
  where pa.share_percent = 0 and pa.sort_order = 1`);

await q("worst offenders", `
  select pa.project_id, pe.name as replacement, pr.logged_hours as project_logged, pa.logged_hours as row_says
  from public.person_assignments pa
  join public.projects pr on pr.id = pa.project_id
  left join public.people pe on pe.id = pa.person_id
  where pa.share_percent = 0 and pa.sort_order = 1 and pr.logged_hours > 0
  order by pr.logged_hours desc
  limit 8`);

console.log("\n" + "=".repeat(78));
console.log("Q4  Does management-contract-hours.ts silently drop every replacement?");
console.log("=".repeat(78));

// management-contract-hours.ts:159 computes allocatedHours = contract * share / 100.
// share_percent = 0 for every replacement, so the allocation is always exactly 0
// and the replacement contributes nothing to the service grid or to the
// utilisation outlook. The row is read, multiplied by zero, and discarded.
await q("contract hours invisible because the replacement's share is 0", `
  select
    count(*) as replacement_rows_read_then_zeroed,
    round(sum(pr.contract_hours)::numeric, 1) as contract_hours_allocated_as_zero,
    count(distinct pa.person_id) as people_affected
  from public.person_assignments pa
  join public.projects pr on pr.id = pa.project_id
  where pa.share_percent = 0 and pa.sort_order = 1`);

await q("per-person cover load that never appears in utilisation", `
  select pe.name as person,
         count(*) as projects_they_cover,
         round(sum(pr.contract_hours)::numeric, 1) as cover_contract_hours
  from public.person_assignments pa
  join public.projects pr on pr.id = pa.project_id
  left join public.people pe on pe.id = pa.person_id
  where pa.share_percent = 0 and pa.sort_order = 1
  group by pe.name
  order by cover_contract_hours desc nulls last`);

console.log("\nREAD-ONLY: nothing was written.");
await c.end();
