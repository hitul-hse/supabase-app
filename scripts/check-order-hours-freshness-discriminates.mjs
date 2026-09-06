/*
 * Negative control for check-order-hours-freshness.mjs, and the two-run PGlite
 * proof for 20260905130000_order_hours_carry_their_as_of.sql.
 *
 * House rule: a migration is executed in PGlite TWICE before anyone pastes it,
 * and the OUTCOME is asserted. Second house rule, from
 * check-new-gates-can-fail.mjs: a gate observed only to pass has not been shown
 * to catch anything. The live gate runs against a database it must not break,
 * so this file runs the SAME SQL and the SAME classify() (both imported from
 * scripts/lib/order-hours-freshness.mjs -- there is no second copy to drift)
 * against a seeded PGlite where every failure mode can be staged:
 *
 *   baseline    fresh, consistent, with lag that the OLD rule called understated
 *   stale       a sync finished after the refresh
 *   too old     the refresh older than MAX_AGE_HOURS (both sides of the line)
 *   drift       stored lost hours; an entry deleted after the refresh
 *   fabrication stored exceeds everything that exists
 *   never       a linked order with no as_of
 *   partial     two refresh instants
 *   null stored a row with an as_of and no figure
 *   no sync     nothing in raw.sync_run to order against
 *   nothing     zero linked orders
 *
 * The clock is a parameter throughout, so "30h old" is asserted at 29h and 31h
 * rather than by waiting.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import {
  COLUMN_EXISTS_SQL, ORDER_HOURS_SQL, LAST_SYNC_SQL, classify, MAX_AGE_HOURS, EPSILON,
} from "./lib/order-hours-freshness.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const sql = readFileSync(join(here, "..", "supabase", "migrations", "20260905130000_order_hours_carry_their_as_of.sql"), "utf8");
const db = await new PGlite();

let failures = 0;
const check = (label, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}: ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures += 1;
};

const T = "2026-09-02T08:12:00Z";      // the refresh instant
const NOW = "2026-09-02T20:00:00Z";    // the gate runs 11.8 h later
const SYNC = "2026-09-02T04:28:00Z";   // the sync the refresh followed
const plusH = (isoBase, hours) => new Date(new Date(isoBase).getTime() + hours * 3_600_000).toISOString();

// The smallest shape the SQL touches, mirroring the live columns and defaults.
await db.exec(`
  create schema time;
  create schema raw;
  create table public.projects (id text primary key, name text not null, contract_hours numeric not null, logged_hours numeric);
  create table time.project (id bigint primary key, hub_project_id text);
  create table time.entry (
    id bigint primary key, project_id bigint references time.project(id),
    started_at timestamptz not null, duration_seconds integer,
    created_at timestamptz not null default now()
  );
  create table raw.sync_run (
    id bigint generated always as identity primary key,
    source text not null, entity text not null,
    started_at timestamptz not null default now(), finished_at timestamptz,
    status text not null default 'running'
  );
  insert into public.projects values
    ('A', 'Lagging order', 2, null),
    ('B', 'Nothing logged', 5, null),
    ('C', 'Two TT projects', 10, null),
    ('U', 'Unlinked, must not appear', 1, 99);
  insert into time.project values (1, 'A'), (2, 'B'), (3, 'C'), (4, 'C'), (5, null);
  insert into time.entry values
    (100, 1, '2026-09-01T10:00Z', 3600, '2026-09-01T04:30Z'),  -- in the snapshot: 1 h
    (101, 1, '2026-09-02T06:00Z', 1800, '2026-09-02T04:28Z'),  -- in the snapshot: 0.5 h
    (102, 1, '2026-09-02T09:00Z', 7200, '2026-09-02T04:28Z'),  -- pre-logged, starts after T: lag once in range
    (103, 1, '2026-08-30T10:00Z',  900, '2026-09-02T12:00Z'),  -- back-dated, imported after T: lag (the old rule's false alarm)
    (104, 1, '2026-12-31T10:00Z', 3600, '2026-08-18T04:00Z'),  -- planned: never in range, counts only toward the fabrication ceiling
    (105, 1, '2026-09-01T12:00Z', null, '2026-09-01T04:30Z'),  -- no duration: never counted
    (106, 3, '2026-09-01T10:00Z', 3600, '2026-09-01T04:30Z'),  -- C, first linked project
    (107, 4, '2026-09-01T11:00Z', 1800, '2026-09-01T04:30Z'),  -- C, second linked project
    (108, 5, '2026-09-01T10:00Z', 36000, '2026-09-01T04:30Z'); -- unlinked TT project: invisible
  insert into raw.sync_run (source, entity, started_at, finished_at, status)
    values ('trackingtime', 'events-flat', '2026-09-02T04:27:00Z', '${SYNC}', 'ok'),
           ('trackingtime', 'events-flat', '2026-09-02T04:20:00Z', '2026-09-02T04:21:00Z', 'failed');
`);

/* ------------------------------------------------ before the migration */

const before = await db.query(COLUMN_EXISTS_SQL);
check("before the migration the precheck reports the column missing", before.rows.length === 0, `${before.rows.length} rows`);
let threw = null;
try { await db.query(ORDER_HOURS_SQL, [NOW]); } catch (e) { threw = e.message; }
check("before the migration the rule itself cannot run, which is why the live gate prechecks by name", /logged_hours_as_of/.test(threw ?? ""), threw ?? "did not throw");

/* -------------------------------------------- the migration, twice */

const describe = async () => (await db.query(`
  select c.data_type, c.is_nullable,
         (select d.description from pg_description d
            join pg_attribute a on a.attrelid = d.objoid and a.attnum = d.objsubid
           where a.attrelid = 'public.projects'::regclass and a.attname = 'logged_hours_as_of') as comment
  from information_schema.columns c
  where c.table_schema = 'public' and c.table_name = 'projects' and c.column_name = 'logged_hours_as_of'`)).rows[0];

for (const pass of [1, 2]) {
  try {
    await db.exec(sql);
    console.log(`\nrun ${pass}: executed without error`);
  } catch (e) {
    console.log(`\nrun ${pass}: THREW — ${e.message}`);
    failures += 1;
    break;
  }
  const col = await describe();
  check(`run ${pass}: the column exists as a nullable timestamptz`, col && col.data_type === "timestamp with time zone" && col.is_nullable === "YES", JSON.stringify(col));
  check(`run ${pass}: the column carries its definition as a comment`, /started_at <= this and created_at <= this/.test(col?.comment ?? ""));
  const { rows: cnt } = await db.query(`select count(*)::int as n from information_schema.columns where table_schema='public' and table_name='projects'`);
  check(`run ${pass}: exactly one column was added (5 -> 5, not 6)`, cnt[0].n === 5, `${cnt[0].n} columns`);
  const { rows: untouched } = await db.query(`select logged_hours from public.projects where id = 'U'`);
  check(`run ${pass}: existing rows are untouched and as_of defaults to null`, Number(untouched[0].logged_hours) === 99
    && (await db.query(`select count(*)::int as n from public.projects where logged_hours_as_of is not null`)).rows[0].n === 0);
}

/* -------------------------------------------- simulate one refresh at T */

// The refresh's own definition, expressed in SQL: entries started by T and
// imported by T, summed in seconds, rounded once, on EVERY linked order.
await db.query(`
  update public.projects p
     set logged_hours = s.h, logged_hours_as_of = $1::timestamptz
    from (select l.id, round(coalesce(sum(e.duration_seconds) filter (where e.started_at <= $1::timestamptz and e.created_at <= $1::timestamptz), 0) / 3600.0, 1) as h
            from (select distinct hub_project_id as id from time.project where hub_project_id is not null) l
            join time.project t on t.hub_project_id = l.id
            left join time.entry e on e.project_id = t.id and e.duration_seconds is not null
           group by l.id) s
   where s.id = p.id`, [T]);

const run = async (now = NOW, lastSync = SYNC) => {
  const { rows } = await db.query(ORDER_HOURS_SQL, [now]);
  return { rows, ...classify({ rows, now: new Date(now), lastSyncFinishedAt: lastSync }) };
};
const failing = (r) => r.checks.filter((c) => !c.ok).map((c) => c.label);
const only = (r, ...labels) => {
  const f = failing(r);
  return f.length === labels.length && labels.every((l) => f.some((x) => x.includes(l)));
};
const green = (r) => failing(r).length === 0;

/* --------------------------------------------------------- baseline */

console.log("\nbaseline: fresh, consistent, with two entries that arrived after the refresh");
let r = await run();
const by = Object.fromEntries(r.rows.map((x) => [x.id, x]));
check("only linked orders appear (A, B, C; not U)", r.rows.map((x) => x.id).join(",") === "A,B,C", r.rows.map((x) => x.id).join(","));
check("A: stored 1.5 h equals its snapshot at T (planned, undurationed and later entries excluded)", Number(by.A.stored) === 1.5 && Number(by.A.snapshot) === 1.5, `stored=${by.A.stored} snapshot=${by.A.snapshot}`);
check("A: to date 3.8 h, unbounded 4.8 h, 2 entries arrived since T", Number(by.A.actual) === 3.8 && Number(by.A.unbounded) === 4.8 && Number(by.A.arrived) === 2, `actual=${by.A.actual} unbounded=${by.A.unbounded} arrived=${by.A.arrived}`);
check("B: a linked order with no entries appears with 0 h and an as_of", Number(by.B.stored) === 0 && Number(by.B.snapshot) === 0 && by.B.as_of !== null);
check("C: two linked TT projects sum onto one order (1 h + 0.5 h)", Number(by.C.stored) === 1.5 && Number(by.C.actual) === 1.5, `stored=${by.C.stored}`);
check("baseline is green", green(r), failing(r).join(" | "));
check("baseline reports A as 2.3 h of lag rather than failing on it", r.lagging.length === 1 && r.lagging[0].id === "A" && Math.abs(r.lagHours - 2.3) < 1e-9 && r.notes.some((n) => /LAG\s+1 orders have 2\.3h/.test(n)), r.notes.find((n) => /LAG/.test(n)) ?? "no LAG note");
check("baseline names the order that crossed its contract since the refresh", r.notes.some((n) => /NOTE\s+A crossed its 2\.0h contract/.test(n)));
// The discrimination itself: the previous rule (stored vs to-date at now(),
// zero tolerance) reads this fixture as a failure.
const oldRuleUnderstated = r.rows.filter((x) => x.stored !== null && Number(x.actual) - Number(x.stored) >= EPSILON);
check("the OLD rule calls the same fixture understated (1 order) -- that is the false alarm this rule retires", oldRuleUnderstated.length === 1 && oldRuleUnderstated[0].id === "A");

/* ---------------------------------------------------------- stale */

console.log("\nstale: a sync finished after the refresh");
r = await run(NOW, "2026-09-02T10:00:00Z");
check("fails only 'ran after the last successful sync'", only(r, "after the last successful"), failing(r).join(" | "));
check("and says which predates which", r.checks.some((c) => !c.ok && /PREDATES the sync that finished 2026-09-02T10:00:00.000Z/.test(c.detail)));

console.log(`\ntoo old: the refresh is ${MAX_AGE_HOURS}h old, both sides of the line`);
r = await run(plusH(T, MAX_AGE_HOURS - 1));
check(`${MAX_AGE_HOURS - 1}h old is green`, green(r), failing(r).join(" | "));
r = await run(plusH(T, MAX_AGE_HOURS + 1));
check(`${MAX_AGE_HOURS + 1}h old fails only 'not older than'`, only(r, "not older than"), failing(r).join(" | "));
check("and blames the nightly step by file", r.checks.some((c) => !c.ok && /sync-trackingtime\.yml/.test(c.detail)));

/* ---------------------------------------------------------- drift */

console.log("\ndrift: the stored figure lost half an hour");
await db.query(`update public.projects set logged_hours = 1.0 where id = 'A'`);
r = await run();
check("fails only 'equals the entries that existed at its as_of'", only(r, "equals the entries"), failing(r).join(" | "));
check("and names A with both figures", r.checks.some((c) => !c.ok && /worst A: 1\.0h stored vs 1\.5h at as_of/.test(c.detail)), r.checks.find((c) => !c.ok)?.detail);
await db.query(`update public.projects set logged_hours = 1.5 where id = 'A'`);
check("restored", green(await run()));

console.log("\ndrift by deletion: an entry the refresh counted was deleted afterwards");
await db.query(`delete from time.entry where id = 100`);
r = await run();
check("fails 'equals the entries that existed at its as_of' (snapshot now 0.5 h against 1.5 h stored)", only(r, "equals the entries") && Number(r.rows.find((x) => x.id === "A").snapshot) === 0.5, failing(r).join(" | "));
check("and says a deletion cannot be told from a lost hour here", r.notes.some((n) => /edited or deleted/.test(n)));
await db.query(`insert into time.entry values (100, 1, '2026-09-01T10:00Z', 3600, '2026-09-01T04:30Z')`);
check("restored", green(await run()));

console.log("\nfabrication: stored exceeds everything that exists, planned work included");
await db.query(`update public.projects set logged_hours = 10 where id = 'A'`);
r = await run();
check("fails drift AND 'no order claims hours that no entry supports'", only(r, "equals the entries", "no entry supports"), failing(r).join(" | "));
await db.query(`update public.projects set logged_hours = 1.5 where id = 'A'`);
check("restored", green(await run()));

/* ------------------------------------------------- never / partial */

console.log("\nnever: a linked order with no as_of");
await db.query(`update public.projects set logged_hours_as_of = null where id = 'B'`);
r = await run();
check("fails only 'carries the instant its hours were computed at'", only(r, "carries the instant"), failing(r).join(" | "));
check("and counts it (1 of 3) with the migration named", r.checks.some((c) => !c.ok && /1 of 3 have no logged_hours_as_of/.test(c.detail) && /20260905130000/.test(c.detail)));
await db.query(`update public.projects set logged_hours_as_of = $1 where id = 'B'`, [T]);
check("restored", green(await run()));

console.log("\npartial: two refresh instants across the linked orders");
await db.query(`update public.projects set logged_hours_as_of = $1 where id = 'C'`, [plusH(T, 1)]);
r = await run();
check("fails only 'one refresh instant'", only(r, "one refresh instant"), failing(r).join(" | "));
check("and lists both instants", r.checks.some((c) => !c.ok && /2 instants \(2026-09-02T08:12:00.000Z \.\. 2026-09-02T09:12:00.000Z\)/.test(c.detail)), r.checks.find((c) => !c.ok)?.detail);
await db.query(`update public.projects set logged_hours_as_of = $1 where id = 'C'`, [T]);
check("restored", green(await run()));

console.log("\nnull stored with an as_of: a figure that was computed and then lost");
await db.query(`update public.projects set logged_hours = null where id = 'B'`);
r = await run();
check("fails only drift, reporting the null", only(r, "equals the entries") && r.checks.some((c) => !c.ok && /worst B: null stored/.test(c.detail)), failing(r).join(" | "));
await db.query(`update public.projects set logged_hours = 0 where id = 'B'`);
check("restored", green(await run()));

/* ------------------------------------------------ no sync / nothing */

console.log("\nno sync on record: nothing to order the refresh against");
r = await run(NOW, null);
check("stays green and says n/a rather than passing the ordering check", green(r) && r.notes.some((n) => /^n\/a/.test(n)) && !r.checks.some((c) => /after the last successful/.test(c.label)), failing(r).join(" | "));
const { rows: [lastSync] } = await db.query(LAST_SYNC_SQL);
check("LAST_SYNC_SQL picks the ok run, not the failed one", new Date(lastSync.finished_at).toISOString() === new Date(SYNC).toISOString(), String(lastSync.finished_at));

console.log("\nnothing: zero linked orders");
await db.query(`update time.project set hub_project_id = null`);
r = await run();
check("fails 'there are linked orders to check'", failing(r).some((l) => /linked orders to check/.test(l)), failing(r).join(" | "));
await db.query(`update time.project set hub_project_id = case id when 1 then 'A' when 2 then 'B' when 3 then 'C' when 4 then 'C' end`);
check("restored", green(await run()));

console.log(failures === 0
  ? "\nMIGRATION IS SAFE TO PASTE (idempotent across two runs), AND THE RULE FAILS ON EVERY STAGED DEFECT"
  : `\n${failures} check(s) failed — DO NOT PASTE`);
process.exit(failures === 0 ? 0 : 1);
