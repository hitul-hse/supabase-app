// Falsify check-responsibility-encodings-agree properly.
//
// I had only ever tested its TOLERANCE (lowering KNOWN_GAP), which proves the
// arithmetic works but not that the three hard assertions can fire. Those are
// the ones that protect correctness:
//   1. the role table must never claim cover person_assignments contradicts
//   2. where both name a cover, it must be the same person
//   3. every gap project must be absent from the role table entirely
//
// All three currently read 0, so they pass trivially and have never been seen to
// fail. This runs each assertion's query against DELIBERATELY BROKEN input in a
// transaction that is always rolled back, to prove the SQL discriminates.
//
// Writes inside a transaction, then ROLLS BACK. Nothing is persisted.
import { readFileSync } from "node:fs";
import pg from "pg";

const env = Object.fromEntries(
  readFileSync("C:/Supabase/.env.local", "utf8").split(/\r?\n/)
    .filter((l) => l && !l.startsWith("#") && l.includes("="))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^"|"$/g, "")]; }));

const c = new pg.Client({ connectionString: env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
await c.connect();

let failures = 0;
const expect = (label, actual, shouldBeNonZero) => {
  const ok = shouldBeNonZero ? Number(actual) > 0 : Number(actual) === 0;
  console.log(`${ok ? "  ok  " : " FAIL "} ${label} — got ${actual}`);
  if (!ok) failures += 1;
};

// The three queries, copied from the gate so this tests the same SQL.
const Q_CONTRADICTS = `
  with pa as (
    select distinct project_id from public.person_assignments
    where share_percent = 0 and sort_order = 1 and project_id is not null),
  pr as (
    select distinct project_id from public.project_responsibility where role = 'replacement')
  select count(*) as n from pr left join pa using (project_id) where pa.project_id is null`;

const Q_DISAGREE = `
  with pa as (
    select project_id, person_id from public.person_assignments
    where share_percent = 0 and sort_order = 1 and project_id is not null),
  pr as (
    select project_id, person_id from public.project_responsibility where role = 'replacement')
  select count(*) as n from pa join pr using (project_id) where pa.person_id <> pr.person_id`;

const Q_PARTIAL_ROLE = `
  with pa as (
    select distinct pa.project_id from public.person_assignments pa
    where pa.share_percent = 0 and pa.sort_order = 1 and pa.project_id is not null),
  pr as (
    select distinct project_id from public.project_responsibility where role = 'replacement')
  select count(*) filter (where exists (
    select 1 from public.project_responsibility r where r.project_id = pa.project_id)) as n
  from pa left join pr using (project_id) where pr.project_id is null`;

console.log("Baseline on real data (all three must be 0):\n");
expect("role table claims cover person_assignments denies", (await c.query(Q_CONTRADICTS)).rows[0].n, false);
expect("both tables name a DIFFERENT person", (await c.query(Q_DISAGREE)).rows[0].n, false);
expect("a gap project has a partial role row", (await c.query(Q_PARTIAL_ROLE)).rows[0].n, false);

// Pick a real project and person to build the broken cases from.
const { rows: [seed] } = await c.query(`
  select pa.project_id, pa.person_id
  from public.person_assignments pa
  where pa.share_percent = 0 and pa.sort_order = 1 and pa.project_id is not null
  limit 1`);
const { rows: [other] } = await c.query(
  `select id from public.people where id <> $1 limit 1`, [seed.person_id]);
const { rows: [orphan] } = await c.query(`
  select pr.id from public.projects pr
  where not exists (select 1 from public.person_assignments pa
                     where pa.project_id = pr.id and pa.share_percent = 0)
    and not exists (select 1 from public.project_responsibility r where r.project_id = pr.id)
  limit 1`);

console.log("\nNow inject each violation and confirm the SAME query catches it:\n");

// 1. A replacement role row on a project person_assignments does not cover.
await c.query("begin");
await c.query(
  `insert into public.project_responsibility (project_id, person_id, role) values ($1, $2, 'replacement')`,
  [orphan.id, seed.person_id]);
expect("INJECTED: role table claims cover -> query must now be > 0", (await c.query(Q_CONTRADICTS)).rows[0].n, true);
await c.query("rollback");

// 2. Both tables name a cover for the same project, but a different person.
await c.query("begin");
await c.query(`delete from public.project_responsibility where project_id = $1 and role = 'replacement'`, [seed.project_id]);
await c.query(
  `insert into public.project_responsibility (project_id, person_id, role) values ($1, $2, 'replacement')`,
  [seed.project_id, other.id]);
expect("INJECTED: tables disagree on who -> query must now be > 0", (await c.query(Q_DISAGREE)).rows[0].n, true);
await c.query("rollback");

// 3. A gap project acquires a NON-replacement role row, which would invalidate
//    the gate's "incomplete, not filtered" diagnosis.
const { rows: [gapProject] } = await c.query(`
  with pa as (
    select distinct pa.project_id from public.person_assignments pa
    where pa.share_percent = 0 and pa.sort_order = 1 and pa.project_id is not null),
  pr as (
    select distinct project_id from public.project_responsibility where role = 'replacement')
  select pa.project_id from pa left join pr using (project_id) where pr.project_id is null limit 1`);
await c.query("begin");
await c.query(
  `insert into public.project_responsibility (project_id, person_id, role) values ($1, $2, 'responsible')`,
  [gapProject.project_id, seed.person_id]);
expect("INJECTED: gap project gains a partial role row -> query must now be > 0", (await c.query(Q_PARTIAL_ROLE)).rows[0].n, true);
await c.query("rollback");

// Prove nothing leaked out of the rolled-back transactions.
console.log("\nConfirm the database is unchanged:\n");
expect("role table claims cover (back to 0)", (await c.query(Q_CONTRADICTS)).rows[0].n, false);
expect("tables disagree (back to 0)", (await c.query(Q_DISAGREE)).rows[0].n, false);
expect("partial role row (back to 0)", (await c.query(Q_PARTIAL_ROLE)).rows[0].n, false);

console.log(`\n${failures === 0 ? "PASS — all three assertions discriminate" : `FAIL (${failures})`}`);
await c.end();
process.exit(failures ? 1 : 0);
