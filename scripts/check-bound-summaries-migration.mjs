/*
 * House rule: a migration is executed in PGlite TWICE before anyone pastes it
 * into production, and the OUTCOME is asserted, not just "it did not throw".
 *
 * 20260902170000_bound_summaries_at_now.sql re-creates time.project_summary
 * and time.customer_summary so that entries dated after now() no longer count
 * as logged hours (decision 2026-09-02: planned time is not logged time).
 *
 * Seeds one project with a past entry, a future entry and a null-duration
 * entry, and checks that only the past entry is summed, that burn_percent and
 * over-budget follow, that a project with no entries still appears with
 * zeroes, and that the column list did not change (the pages select by name).
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";

const here = dirname(fileURLToPath(import.meta.url));
const sql = readFileSync(join(here, "..", "supabase", "migrations", "20260902170000_bound_summaries_at_now.sql"), "utf8");
const db = await new PGlite();

let failures = 0;
const check = (label, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}: ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures += 1;
};

// The smallest shape the views touch, mirroring the live columns.
await db.exec(`
  create schema time;
  create table time.customer (id integer primary key, name text not null, is_archived boolean not null default false);
  create table time.project (
    id integer primary key, name text not null, customer_id integer references time.customer(id),
    is_billable boolean not null default true, is_archived boolean not null default false,
    estimated_hours numeric not null default 0
  );
  create table time.entry (
    id integer primary key, project_id integer references time.project(id), customer_id integer references time.customer(id),
    member_id integer, duration_seconds integer, is_billable boolean not null default true,
    is_calendar boolean not null default false, started_at timestamptz not null
  );
  insert into time.customer values (1, 'ACME', false), (2, 'Idle Co', false);
  insert into time.project values (10, 'Budgeted', 1, true, false, 2), (11, 'No entries', 2, true, false, 5), (12, 'No budget', 2, true, false, 0);
  insert into time.entry values
    (100, 10, 1, 7, 3600,  true,  false, now() - interval '1 day'),   -- worked: 1 h
    (101, 10, 1, 7, 7200,  true,  false, now() + interval '30 day'),  -- planned: must NOT count
    (102, 10, 1, 8, null,  true,  false, now() - interval '2 day'),   -- no duration: never counted
    (103, 10, 1, 8, 1800,  false, true,  now() - interval '3 day');   -- worked, calendar, non-billable: 0.5 h
`);

// The old, unbounded definitions first, so the migration has something to replace.
await db.exec(`
  create view time.project_summary with (security_invoker = true) as
  select p.id as project_id, p.name as project_name, p.is_billable, p.is_archived, c.id as customer_id, c.name as customer_name,
         p.estimated_hours, coalesce(sum(e.duration_seconds), 0) as total_seconds,
         coalesce(sum(e.duration_seconds) filter (where e.is_billable), 0) as billable_seconds,
         coalesce(sum(e.duration_seconds) filter (where e.is_calendar), 0) as calendar_seconds,
         count(e.id) as entry_count, count(distinct e.member_id) as member_count, max(e.started_at) as last_activity_at,
         case when coalesce(p.estimated_hours, 0) > 0 then round((coalesce(sum(e.duration_seconds), 0) / 3600.0) / nullif(p.estimated_hours, 0) * 100, 1) end as burn_percent
  from time.project p left join time.customer c on c.id = p.customer_id
  left join time.entry e on e.project_id = p.id and e.duration_seconds is not null
  group by p.id, p.name, p.is_billable, p.is_archived, c.id, c.name, p.estimated_hours;
  create view time.customer_summary with (security_invoker = true) as
  select c.id as customer_id, c.name as customer_name, c.is_archived, coalesce(sum(e.duration_seconds), 0) as total_seconds,
         coalesce(sum(e.duration_seconds) filter (where e.is_billable), 0) as billable_seconds,
         (select count(*) from time.project p where p.customer_id = c.id) as project_count,
         count(e.id) as entry_count, max(e.started_at) as last_activity_at
  from time.customer c left join time.entry e on e.customer_id = c.id and e.duration_seconds is not null
  group by c.id, c.name, c.is_archived;
`);

const columnsOf = async (view) => (await db.query(
  `select column_name from information_schema.columns where table_schema='time' and table_name=$1 order by ordinal_position`, [view]
)).rows.map((r) => r.column_name).join(",");
const before = { project: await columnsOf("project_summary"), customer: await columnsOf("customer_summary") };

const { rows: unbounded } = await db.query(`select total_seconds from time.project_summary where project_id = 10`);
check("before the migration the view counts the planned entry (the bug being fixed)", Number(unbounded[0].total_seconds) === 12600, `total_seconds=${unbounded[0].total_seconds}`);

for (const pass of [1, 2]) {
  try {
    await db.exec(sql);
    console.log(`\nrun ${pass}: executed without error`);
  } catch (e) {
    console.log(`\nrun ${pass}: THREW — ${e.message}`);
    failures += 1;
    break;
  }

  const { rows } = await db.query(`select * from time.project_summary order by project_id`);
  const by = Object.fromEntries(rows.map((r) => [r.project_id, r]));

  // PGlite returns numeric as a STRING; compare through Number().
  check(`run ${pass}: only entries dated <= now() are summed`, Number(by[10].total_seconds) === 5400, `total_seconds=${by[10].total_seconds} (1 h worked + 0.5 h calendar, 2 h planned excluded)`);
  check(`run ${pass}: billable and calendar splits follow the same bound`, Number(by[10].billable_seconds) === 3600 && Number(by[10].calendar_seconds) === 1800);
  check(`run ${pass}: entry_count and member_count exclude the planned entry`, Number(by[10].entry_count) === 2 && Number(by[10].member_count) === 2, `entry_count=${by[10].entry_count} member_count=${by[10].member_count}`);
  check(`run ${pass}: last_activity_at is not in the future`, new Date(by[10].last_activity_at) <= new Date());
  check(`run ${pass}: burn_percent uses worked hours only (1.5 h of 2 h = 75%)`, Number(by[10].burn_percent) === 75, `burn_percent=${by[10].burn_percent}`);
  check(`run ${pass}: a budgeted project with no entries still appears, with zeroes and 0% burn`, by[11] && Number(by[11].total_seconds) === 0 && Number(by[11].entry_count) === 0 && Number(by[11].burn_percent) === 0, JSON.stringify(by[11]));
  check(`run ${pass}: a project with no budget reads null burn, not 0%`, by[12] && by[12].burn_percent === null, `burn_percent=${by[12]?.burn_percent}`);

  const { rows: cust } = await db.query(`select * from time.customer_summary order by customer_id`);
  const cby = Object.fromEntries(cust.map((r) => [r.customer_id, r]));
  check(`run ${pass}: customer_summary applies the same bound`, Number(cby[1].total_seconds) === 5400 && Number(cby[1].entry_count) === 2, `total_seconds=${cby[1].total_seconds}`);
  check(`run ${pass}: customer_summary project_count is unaffected`, Number(cby[1].project_count) === 1 && Number(cby[2].project_count) === 2);

  check(`run ${pass}: project_summary column list unchanged`, (await columnsOf("project_summary")) === before.project);
  check(`run ${pass}: customer_summary column list unchanged`, (await columnsOf("customer_summary")) === before.customer);
}

console.log(failures === 0
  ? "\nMIGRATION IS SAFE TO PASTE (idempotent across two runs)"
  : `\n${failures} check(s) failed — DO NOT PASTE`);
process.exit(failures === 0 ? 0 : 1);
