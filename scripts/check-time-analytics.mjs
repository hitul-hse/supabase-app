// Coverage for the `time` analytics views and the economics RPC
// (supabase/schema.sql §8b) — the layer /time/dashboard reads.
//
// A dashboard fails differently from a form. A broken form throws; a broken
// dashboard renders a confident, wrong number that somebody then makes a
// decision on. Every assertion below therefore checks an EXACT arithmetic
// value against a fixture computed by hand, not "greater than zero".
//
// Five claims are load-bearing and none is visible by reading the DDL:
//
//   1. NO FAN-OUT. Joining a customer to both its projects and its entries
//      multiplies rows: 2 projects x 4 entries = 8, and every sum() doubles.
//      This actually happened here. It hid because count(distinct project) was
//      still right, so the one column a reviewer sanity-checks looked correct
//      while the hours were exactly 2x. Hence an exact total, not a range.
//
//   2. RATES ARE EFFECTIVE-DATED. An entry from March must cost at March's
//      rate, not today's. Re-costing history at the current rate produces a
//      plausible wrong margin, which is the worst kind.
//
//   3. MONEY FAILS CLOSED, NOT PARTIAL. Measured: a security_invoker view that
//      joins member_rate gives a dept_head a REAL-LOOKING total built from only
//      the rate rows RLS let them see (90.00 where the truth was 300.00).
//      project_economics() is security definer + permission-gated so a
//      non-exec gets zero rows instead.
//
//   4. A MEMBER WITH NO RATE STILL CONTRIBUTES HOURS. An inner join to
//      member_rate would silently drop their time and understate the project.
//
//   5. UNITS. duration_seconds is SECONDS, project.estimated_hours is HOURS.
//      Burn percent crosses that boundary, so it is asserted exactly.
//
// Run: node scripts/check-time-analytics.mjs
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";

const db = await new PGlite();

await db.exec(`
  create schema if not exists auth;
  create table auth.users (id uuid primary key, email text);
  do $$ begin
    if not exists (select 1 from pg_roles where rolname='anon') then create role anon nologin; end if;
    if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin; end if;
  end $$;
  create or replace function auth.uid() returns uuid
    language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
`);

await db.exec(readFileSync("supabase/schema.sql", "utf8"));

const EXEC = "11111111-1111-1111-1111-111111111111";
const HEAD = "22222222-2222-2222-2222-222222222222";

let failed = false;
const check = (label, ok, detail = "") => {
  if (!ok) failed = true;
  console.log(`${ok ? "PASS" : "FAIL"} | ${label}${!ok && detail ? `\n       ${detail}` : ""}`);
};
const eq = (label, actual, expected) =>
  check(`${label} = ${expected}`, Number(actual) === Number(expected), `got ${actual}`);

/** Run a query as a signed-in user, then roll back so fixtures stay pristine. */
async function as(uid, sql) {
  await db.exec("begin");
  await db.exec(`set local role authenticated; set local request.jwt.claim.sub = '${uid}';`);
  try {
    const r = await db.query(sql);
    await db.exec("rollback");
    return r.rows;
  } catch (e) {
    await db.exec("rollback");
    return { error: e.message };
  }
}

// ---------------------------------------------------------------- fixture --
//
// Hand-computable on purpose. Every expected value below is derived from these
// four entries with arithmetic a reader can redo in their head.
//
//   member 1 (Exec)   rate 100/50 until 2025-06-01, then 200/100
//   member 2 (Head)   rate  90/45 throughout
//   member 3 (NoRate) NO rate row at all
//
//   e1  m1  1h  2025-03-03  billable            -> revenue 100, cost  50
//   e2  m1  1h  2025-07-07  billable            -> revenue 200, cost 100   (rate changed)
//   e3  m3  2h  2025-07-07  billable, no rate   -> revenue   0, cost   0   (hours still count)
//   e4  m2  1h  2025-07-08  NON-billable, CALENDAR -> revenue 0, cost 45
//   e5  m1  1.5h 2025-07-09 billable            -> revenue 300, cost 150
//
// e5 is doing two jobs, and both were added after the gate failed to catch a
// regression it was supposed to catch:
//
//   * It gives member 1 a SECOND entry in week 2, so that week has 4 entries
//     from 3 distinct members. With 3 entries from 3 members,
//     `count(distinct member_id)` was numerically identical to
//     `count(member_id)` and the assertion passed either way.
//
//   * It is 90 MINUTES, not 60, so the project total (23400s = 6.5h) does not
//     divide evenly by 3600. With a whole number of hours, `secs / 3600` and
//     `secs / 3600.0` agree and the integer-division bug is invisible. At 6.5h
//     they differ: 65.0% correct versus 60.0% truncated.
//
// Both were verified by injecting the regression and confirming this file now
// exits non-zero.
//
//   Proj A total 6.5h = 23400s · billable 5.5h = 19800s · calendar 1h = 3600s
//   revenue 600.00 · cost 345.00 · margin 255.00 · margin% 42.5
//   budget 10h -> burn 65.0%
await db.exec(`
  insert into auth.users (id, email) values ('${EXEC}','e@x.com'), ('${HEAD}','h@x.com');
  insert into people (id, name, department, role) values
    ('p-exec','Exec','ENG','Chief'), ('p-head','Head','ENG','Lead');
  insert into app_user_profile (user_id, person_id, role_key, department, is_active) values
    ('${EXEC}','p-exec','exec','ENG',true), ('${HEAD}','p-head','dept_head','ENG',true);

  insert into time.member (id, display_name, user_id, weekly_hours) overriding system value values
    (1,'Exec','${EXEC}',40), (2,'Head','${HEAD}',40), (3,'NoRate',null,40);
  -- Explicit ids do not advance the identity sequence; without this the next
  -- app insert collides on id=1.
  select setval(pg_get_serial_sequence('time.member','id'), 3);

  insert into time.member_rate (member_id, hourly_rate, hourly_cost, valid_from, valid_to) values
    (1, 100,  50, '2020-01-01', '2025-06-01'),
    (1, 200, 100, '2025-06-01', null),
    (2,  90,  45, '2020-01-01', null);

  insert into time.customer (id, name) overriding system value values (1,'Acme');
  select setval(pg_get_serial_sequence('time.customer','id'), 1);

  insert into time.project (id, name, customer_id, estimated_hours) overriding system value values
    (1,'Proj A',1,10), (2,'Proj NoTime',1,5);
  select setval(pg_get_serial_sequence('time.project','id'), 2);

  insert into time.entry
    (member_id, project_id, customer_id, started_at, ended_at, duration_seconds, is_billable, is_calendar)
  values
    (1,1,1,'2025-03-03T09:00:00Z','2025-03-03T10:00:00Z',3600,true,false),
    (1,1,1,'2025-07-07T09:00:00Z','2025-07-07T10:00:00Z',3600,true,false),
    (3,1,1,'2025-07-07T09:00:00Z','2025-07-07T11:00:00Z',7200,true,false),
    (2,1,1,'2025-07-08T09:00:00Z','2025-07-08T10:00:00Z',3600,false,true),
    (1,1,1,'2025-07-09T09:00:00Z','2025-07-09T10:30:00Z',5400,true,false);
`);

console.log("--- org_week ---------------------------------------------------------");

{
  const rows = await as(EXEC, "select * from time.org_week order by week_start");
  check("org_week returns one row per ISO week", Array.isArray(rows) && rows.length === 2,
    JSON.stringify(rows));

  if (Array.isArray(rows) && rows.length === 2) {
    const [w1, w2] = rows;
    eq("week 1 total_seconds", w1.total_seconds, 3600);
    eq("week 2 total_seconds (3600+7200+3600+5400)", w2.total_seconds, 19800);
    eq("week 2 billable_seconds (calendar entry is not billable)", w2.billable_seconds, 16200);
    eq("week 2 calendar_seconds", w2.calendar_seconds, 3600);
    // tracked = total - calendar. The dashboard divides billable by THIS, not
    // by total: a third of live data is calendar noise and dividing by it would
    // depress the billable ratio by a constant unrelated to performance.
    eq("week 2 tracked_seconds (total - calendar)", w2.tracked_seconds, 16200);
    // 4 entries from 3 DISTINCT members. The two numbers differ on purpose, so
    // swapping count(distinct member_id) for count(member_id) fails here.
    eq("week 2 active_members is DISTINCT members (4 entries, 3 people)",
      w2.active_members, 3);
    eq("week 2 entry_count", w2.entry_count, 4);
  }
}

console.log("\n--- project_summary --------------------------------------------------");

{
  const rows = await as(EXEC,
    "select * from time.project_summary order by project_id");
  const a = Array.isArray(rows) ? rows.find((r) => Number(r.project_id) === 1) : null;
  const none = Array.isArray(rows) ? rows.find((r) => Number(r.project_id) === 2) : null;

  check("project_summary includes a project with NO time (LEFT JOIN)", Boolean(none),
    "a project with no entries must still appear, or the ones worth asking about vanish");

  if (a) {
    eq("Proj A total_seconds", a.total_seconds, 23400);
    eq("Proj A billable_seconds", a.billable_seconds, 19800);
    eq("Proj A calendar_seconds", a.calendar_seconds, 3600);
    eq("Proj A entry_count", a.entry_count, 5);
    // 5 entries, 3 people. Differs from entry_count on purpose.
    eq("Proj A member_count (distinct)", a.member_count, 3);
    // 23400s is 6.5h against a 10h budget. Deliberately NOT a whole number of
    // hours: `/ 3600` (integer) truncates to 6h and yields 60.0%, while
    // `/ 3600.0` gives the correct 65.0%. A whole-hour fixture cannot tell
    // those apart.
    eq("Proj A burn_percent (6.5h of 10h — catches integer division)",
      a.burn_percent, 65.0);
  }
  if (none) {
    // count(e.id) not count(*): the LEFT JOIN emits one all-null row, and
    // count(*) would report that phantom as a real entry.
    eq("Proj NoTime entry_count is 0 not 1", none.entry_count, 0);
    eq("Proj NoTime total_seconds", none.total_seconds, 0);
    eq("Proj NoTime member_count", none.member_count, 0);
  }
}

console.log("\n--- customer_summary (fan-out regression) ----------------------------");

{
  const rows = await as(EXEC, "select * from time.customer_summary");
  const c = Array.isArray(rows) ? rows[0] : null;
  check("customer_summary returns one row per customer", Array.isArray(rows) && rows.length === 1,
    JSON.stringify(rows));

  if (c) {
    // THE regression. Acme has 2 projects and 4 entries. Joining customer to
    // both fans out to 8 rows and doubles every sum. 36000 here means the
    // second join branch is back.
    eq("Acme total_seconds is NOT doubled by the project join", c.total_seconds, 23400);
    eq("Acme entry_count is NOT multiplied by project count", c.entry_count, 5);
    eq("Acme billable_seconds", c.billable_seconds, 19800);
    eq("Acme project_count (scalar subquery)", c.project_count, 2);
  }
}

console.log("\n--- member_utilisation -----------------------------------------------");

{
  const rows = await as(EXEC, "select * from time.member_utilisation order by member_id");
  const byId = Array.isArray(rows)
    ? Object.fromEntries(rows.map((r) => [Number(r.member_id), r]))
    : {};

  check("every member appears, including one with no entries",
    Array.isArray(rows) && rows.length === 3, JSON.stringify(rows));

  if (byId[1]) {
    eq("member 1 total_seconds", byId[1].total_seconds, 12600);
    // Three entries across two ISO weeks -- weeks_active must count weeks, not
    // entries, or utilisation's denominator is wrong.
    eq("member 1 weeks_active (3 entries, 2 distinct weeks)", byId[1].weeks_active, 2);
  }
  if (byId[2]) {
    // The whole point of separating calendar from tracked: this person logged
    // an hour, but none of it was deliberate work.
    eq("member 2 total_seconds", byId[2].total_seconds, 3600);
    eq("member 2 tracked_seconds is 0 (their only entry is calendar)", byId[2].tracked_seconds, 0);
    eq("member 2 calendar_seconds", byId[2].calendar_seconds, 3600);
  }
}

console.log("\n--- service_summary --------------------------------------------------");

{
  const rows = await as(EXEC, "select * from time.service_summary");
  check("service_summary lists the seeded catalogue", Array.isArray(rows) && rows.length >= 10,
    `got ${Array.isArray(rows) ? rows.length : "error"}`);
  // No entry in the fixture has a service, so every row must be zero rather
  // than null. A null would render as "—" and read as missing data.
  const anyNull = Array.isArray(rows) && rows.some((r) => r.total_seconds === null);
  check("services with no time report 0, not null", !anyNull,
    "coalesce is missing, so the UI would show em-dashes for real zeroes");
}

console.log("\n--- project_economics: the numbers -----------------------------------");

{
  const rows = await as(EXEC, "select * from time.project_economics()");
  const a = Array.isArray(rows) ? rows[0] : null;
  check("exec can read project_economics", Array.isArray(rows) && rows.length === 1,
    JSON.stringify(rows));

  if (a) {
    // 1h@100 (March, old rate) + 1h@200 + 1.5h@200 (July, new rate) + 2h@0.
    // If the rate join were NOT effective-dated, every billable hour would cost
    // at one rate and this would be 700 (all-current) rather than 600.
    eq("revenue uses the rate in force ON THE ENTRY DATE", a.revenue, 600.0);
    // 1h@50 + 1h@100 + 1.5h@100 + 2h@0 + 1h@45 (the calendar entry still costs).
    eq("cost", a.cost, 345.0);
    eq("margin", a.margin, 255.0);
    eq("margin_percent", a.margin_percent, 42.5);
    // Claim 4: member 3 has no rate row. Their 2h must still be counted.
    eq("hours include a member with NO rate row (left join, not inner)",
      a.total_seconds, 23400);
  }
}

console.log("\n--- project_economics: confidentiality --------------------------------");

{
  const head = await as(HEAD, "select * from time.project_economics()");
  check("dept_head gets ZERO rows, not a partial total",
    Array.isArray(head) && head.length === 0,
    `dept_head saw ${JSON.stringify(head)} -- a partial money figure is worse than none`);

  // And the raw table is still theirs-only, which is what makes the partial
  // aggregate possible in the first place.
  const rates = await as(HEAD, "select member_id from time.member_rate order by member_id");
  check("dept_head still sees only their OWN rate row",
    Array.isArray(rates) && rates.length === 1 && Number(rates[0].member_id) === 2,
    JSON.stringify(rates));
}

console.log("\n--- anon is denied on every analytics object --------------------------");

for (const obj of [
  "org_week",
  "project_summary",
  "customer_summary",
  "service_summary",
  "member_utilisation",
]) {
  await db.exec("begin");
  let denied = false;
  try {
    await db.exec("set local role anon");
    await db.query(`select 1 from time.${obj} limit 1`);
  } catch {
    denied = true;
  }
  await db.exec("rollback");
  check(`anon is denied on time.${obj}`, denied);
}

{
  await db.exec("begin");
  let denied = false;
  try {
    await db.exec("set local role anon");
    await db.query("select * from time.project_economics()");
  } catch {
    denied = true;
  }
  await db.exec("rollback");
  check("anon cannot execute time.project_economics()", denied);
}

console.log("\n--- negative control -------------------------------------------------");

{
  // If the fan-out assertion were vacuous -- if the fixture could not actually
  // produce a doubled total -- it would prove nothing. Re-create the broken
  // shape and confirm it really does double, so the real view's 18000 is
  // meaningful rather than accidental.
  await db.exec(`
    create or replace view time.fanout_control as
    select c.id, coalesce(sum(e.duration_seconds),0) as total_seconds, count(e.id) as entry_count
    from time.customer c
    left join time.project p on p.customer_id = c.id
    left join time.entry e   on e.customer_id = c.id and e.duration_seconds is not null
    group by c.id;
  `);
  const r = await db.query("select * from time.fanout_control");
  const t = Number(r.rows[0].total_seconds);
  check(
    "control: the two-branch join DOES double the total (so 23400 above is a real fix)",
    t === 46800,
    `broken shape gave ${t}, expected 46800 -- the fan-out assertion proves nothing`
  );
  await db.exec("drop view time.fanout_control;");
}

console.log(
  failed ? "\nTIME ANALYTICS: FAILURES ABOVE\n" : "\nTIME ANALYTICS: all checks passed\n"
);
process.exit(failed ? 1 : 0);
