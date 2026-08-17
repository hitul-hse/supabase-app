// Coverage for the `time` module schema (supabase/schema.sql §8).
//
// This is the first typed module schema, so it is also the first test of the
// platform's central security claim: a module schema isolates data, and Hub's
// role model still governs who sees what inside it.
//
// Four claims here are load-bearing and none is obvious from reading the DDL:
//
//   1. An entry cannot be filed under a colleague. The insert policy pins
//      member_id to time.current_member_id() in WITH CHECK, so a crafted
//      request naming someone else's member_id must be rejected -- not silently
//      rewritten, rejected.
//
//   2. dept_head sees their department's TIME but NOT their department's RATES.
//      hourly_cost is what a colleague costs the company. A single blanket
//      "dept_head can read their department" policy would leak salary-adjacent
//      data to every team lead, and would still look correct in a smoke test
//      because the time rows would be right.
//
//   3. An invoiced entry (is_billed) is not editable or deletable by its owner.
//      That is the entire point of the flag; without it, billing can be
//      retroactively altered by the person being billed for.
//
//   4. At most one running timer per member, enforced by a partial unique index
//      rather than application code -- application checks lose the race.
//
// Run: node scripts/check-time-rls.mjs
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
const EMP = "33333333-3333-3333-3333-333333333333";
const OTHER = "44444444-4444-4444-4444-444444444444";

let failed = false;
const check = (label, ok, detail = "") => {
  if (!ok) failed = true;
  console.log(`${ok ? "PASS" : "FAIL"} | ${label}${!ok && detail ? `\n       ${detail}` : ""}`);
};

/** Run as a signed-in user, exactly as PostgREST would. */
async function asUser(uid, sql) {
  await db.exec("begin");
  try {
    await db.exec(`set local role authenticated`);
    await db.exec(`select set_config('request.jwt.claim.sub', '${uid}', true)`);
    const res = await db.query(sql);
    await db.exec("commit");
    return { rows: res.rows, error: null };
  } catch (e) {
    await db.exec("rollback");
    return { rows: [], error: e.message };
  }
}

// --- seed as the service role ----------------------------------------------
await db.exec(`
  insert into auth.users (id, email) values
    ('${EXEC}','exec@x.com'), ('${HEAD}','head@x.com'),
    ('${EMP}','emp@x.com'),   ('${OTHER}','other@x.com');

  insert into people (id, name, department, role)
    values ('p-emp','Emp Person','SAFETY','Consultant'),
           ('p-other','Other Person','ENG','Engineer'),
           ('p-head','Head Person','SAFETY','Lead');

  insert into app_user_profile (user_id, person_id, role_key, department, is_active) values
    ('${EXEC}',  null,      'exec',      null,     true),
    ('${HEAD}',  'p-head',  'dept_head', 'SAFETY', true),
    ('${EMP}',   'p-emp',   'employee',  'SAFETY', true),
    ('${OTHER}', 'p-other', 'employee',  'ENG',    true);

  insert into time.customer (id, name) overriding system value values (1,'Acme GmbH');
  insert into time.project (id, customer_id, name) overriding system value values (1, 1, 'Site audit');
  insert into time.task (id, project_id, name, task_type) overriding system value
    values (1, 1, 'Walkthrough', 'PERSONAL');

  insert into time.member (id, email, display_name, hub_person_id, user_id, weekly_hours)
    overriding system value values
    (1, 'emp@x.com',   'Emp Person',   'p-emp',   '${EMP}',   40),
    (2, 'other@x.com', 'Other Person', 'p-other', '${OTHER}', 40),
    (3, 'head@x.com',  'Head Person',  'p-head',  '${HEAD}',  40);

  insert into time.member_rate (member_id, hourly_rate, hourly_cost) values
    (1, 120, 55), (2, 140, 60), (3, 160, 70);

  insert into time.entry
    (id, member_id, task_id, project_id, customer_id, started_at, ended_at,
     duration_seconds, is_billable, is_billed, source_system)
    overriding system value values
    (1, 1, 1, 1, 1, '2026-08-10 09:00+00', '2026-08-10 10:00+00', 3600, true,  false, 'manual'),
    (2, 1, 1, 1, 1, '2026-08-11 09:00+00', '2026-08-11 10:30+00', 5400, true,  true,  'manual'),
    (3, 2, 1, 1, 1, '2026-08-10 09:00+00', '2026-08-10 11:00+00', 7200, true,  false, 'manual');

  -- A GHOST/calendar entry with no project or customer: the structural case
  -- proved during discovery (all 1,427 untagged live events were GHOST).
  insert into time.entry
    (id, member_id, task_id, project_id, customer_id, started_at, ended_at,
     duration_seconds, is_billable, source_system, is_calendar)
    overriding system value values
    (4, 1, null, null, null, '2026-08-12 09:00+00', '2026-08-12 09:30+00', 1800, false, 'calendar', true);

  grant usage on schema public to authenticated;
  grant select, insert, update, delete on all tables in schema public to authenticated;
  grant usage, select on all sequences in schema public to authenticated;
`);

// `overriding system value` does NOT advance an identity sequence, so the next
// generated id would collide with the explicit ids seeded above. Postgres
// reports that as a plain unique violation, which is easy to misread as an RLS
// rejection. The real backfill hits the same trap -- it inserts with explicit
// ids from the vendor -- so this is a genuine hazard, not just a test artefact.
for (const t of ["customer", "project", "task", "member", "entry"]) {
  await db.exec(
    `select setval(pg_get_serial_sequence('time.${t}','id'),
       coalesce((select max(id) from time.${t}), 1))`
  );
}

console.log("\n--- entry visibility -------------------------------------------------");

{
  const r = await asUser(EXEC, "select count(*)::int as n from time.entry");
  check("exec sees every entry (4)", r.rows[0]?.n === 4, `got ${r.rows[0]?.n} err=${r.error}`);
}
{
  const r = await asUser(EMP, "select count(*)::int as n from time.entry");
  check("employee sees only their own 3 entries", r.rows[0]?.n === 3, `got ${r.rows[0]?.n} err=${r.error}`);
}
{
  // The negative half: employee must NOT see the other member's entry.
  const r = await asUser(EMP, "select count(*)::int as n from time.entry where member_id = 2");
  check("employee CANNOT see a colleague's entry", r.rows[0]?.n === 0, `got ${r.rows[0]?.n}`);
}
{
  // dept_head sees SAFETY (Emp) but not ENG (Other) -- via can_view_person.
  const r = await asUser(HEAD, "select distinct member_id from time.entry order by member_id");
  const ids = r.rows.map((x) => Number(x.member_id));
  check(
    "dept_head sees own department's time, not another department's",
    ids.includes(1) && !ids.includes(2),
    `saw member_ids ${JSON.stringify(ids)} err=${r.error}`
  );
}
{
  const r = await asUser(OTHER, "select count(*)::int as n from time.entry");
  check("other-department employee sees only their own 1", r.rows[0]?.n === 1, `got ${r.rows[0]?.n}`);
}

console.log("\n--- an entry cannot be filed under a colleague ------------------------");

{
  const r = await asUser(
    EMP,
    `insert into time.entry (member_id, started_at, ended_at, duration_seconds)
     values (2, '2026-08-13 09:00+00', '2026-08-13 10:00+00', 3600)`
  );
  check(
    "employee CANNOT insert an entry under another member_id",
    r.error !== null && /row-level security/i.test(r.error),
    `expected RLS rejection, got err=${r.error}`
  );
}
{
  const r = await asUser(
    EMP,
    `insert into time.entry (member_id, started_at, ended_at, duration_seconds)
     values (1, '2026-08-13 09:00+00', '2026-08-13 10:00+00', 3600) returning id`
  );
  check("employee CAN insert their own entry", r.error === null && r.rows.length === 1, `err=${r.error}`);
}
{
  // Employee lacks 'workload:approve' but must still hold 'timesheets:write';
  // strip it and the insert must fail. Proves the permission half of the policy
  // is doing work, not just the member_id half.
  await db.exec(`delete from app_role_permission where role_key='employee' and permission_key='timesheets:write'`);
  const r = await asUser(
    EMP,
    `insert into time.entry (member_id, started_at, ended_at, duration_seconds)
     values (1, '2026-08-14 09:00+00', '2026-08-14 10:00+00', 3600)`
  );
  check(
    "revoking timesheets:write blocks the insert",
    r.error !== null,
    `expected rejection after revoke, got err=${r.error}`
  );
  await db.exec(
    `insert into app_role_permission (role_key, permission_key) values ('employee','timesheets:write')
     on conflict do nothing`
  );
}

console.log("\n--- billed entries are locked ----------------------------------------");

{
  const r = await asUser(EMP, "update time.entry set notes='edited' where id = 2 returning id");
  check("owner CANNOT edit a billed entry", r.rows.length === 0, `updated ${r.rows.length} rows err=${r.error}`);
}
{
  const r = await asUser(EMP, "update time.entry set notes='edited' where id = 1 returning id");
  check("owner CAN edit an unbilled entry", r.rows.length === 1, `updated ${r.rows.length} err=${r.error}`);
}
{
  const r = await asUser(EMP, "delete from time.entry where id = 2 returning id");
  check("owner CANNOT delete a billed entry", r.rows.length === 0, `deleted ${r.rows.length}`);
}
{
  const r = await asUser(EXEC, "delete from time.entry where id = 2 returning id");
  check("exec CAN delete a billed entry (correction path)", r.rows.length === 1, `deleted ${r.rows.length} err=${r.error}`);
  await db.exec(`insert into time.entry (id, member_id, started_at, ended_at, duration_seconds, is_billed)
                 overriding system value
                 values (2, 1, '2026-08-11 09:00+00','2026-08-11 10:30+00', 5400, true)`);
  await db.exec(
    `select setval(pg_get_serial_sequence('time.entry','id'), (select max(id) from time.entry))`
  );
}

console.log("\n--- rates are NOT visible to dept_head -------------------------------");

{
  const r = await asUser(EXEC, "select count(*)::int as n from time.member_rate");
  check("exec sees all 3 rates", r.rows[0]?.n === 3, `got ${r.rows[0]?.n} err=${r.error}`);
}
{
  const r = await asUser(EMP, "select member_id from time.member_rate");
  const ids = r.rows.map((x) => Number(x.member_id));
  check("employee sees ONLY their own rate", ids.length === 1 && ids[0] === 1, `saw ${JSON.stringify(ids)}`);
}
{
  // The distinction that matters: dept_head CAN see member 1's time (asserted
  // above) but must NOT see member 1's cost.
  const r = await asUser(HEAD, "select member_id from time.member_rate order by member_id");
  const ids = r.rows.map((x) => Number(x.member_id));
  check(
    "dept_head sees their OWN rate only, not their department's",
    ids.length === 1 && ids[0] === 3,
    `saw ${JSON.stringify(ids)} -- a department-wide rate read is a salary leak`
  );
}

console.log("\n--- one running timer per member -------------------------------------");

{
  const a = await asUser(
    EMP,
    `insert into time.entry (member_id, started_at) values (1, '2026-08-15 09:00+00') returning id`
  );
  check("a running entry (no ended_at) is allowed", a.error === null, `err=${a.error}`);
  const b = await asUser(
    EMP,
    `insert into time.entry (member_id, started_at) values (1, '2026-08-15 10:00+00') returning id`
  );
  check(
    "a SECOND running timer for the same member is rejected",
    b.error !== null && /unique|duplicate/i.test(b.error),
    `expected unique violation, got err=${b.error}`
  );
  await db.exec("delete from time.entry where ended_at is null");
}

console.log("\n--- constraints hold the data honest ---------------------------------");

{
  const r = await asUser(
    EMP,
    `insert into time.entry (member_id, started_at, ended_at, duration_seconds)
     values (1, '2026-08-16 10:00+00', '2026-08-16 09:00+00', 3600)`
  );
  check("an entry ending before it starts is rejected", r.error !== null, `err=${r.error}`);
}
{
  const r = await asUser(
    EMP,
    `insert into time.entry (member_id, started_at, ended_at) values (1, '2026-08-16 09:00+00', '2026-08-16 10:00+00')`
  );
  check("a finished entry with no duration is rejected", r.error !== null, `err=${r.error}`);
}
{
  const r = await db
    .query(`insert into time.service (name, is_travel, is_paid_travel) values ('bad', false, true)`)
    .then(() => null)
    .catch((e) => e.message);
  check("paid travel that is not travel is rejected", r !== null, `err=${r}`);
}

console.log("\n--- the structural GHOST case ----------------------------------------");

{
  // Discovery proved every untagged live event is GHOST, so an entry with no
  // project must be storable without inventing a placeholder customer.
  const r = await asUser(
    EMP,
    "select count(*)::int as n from time.entry where project_id is null and customer_id is null"
  );
  check("an entry with no project and no customer is valid", r.rows[0]?.n >= 1, `got ${r.rows[0]?.n}`);
}
{
  const r = await asUser(EMP, "select count(*)::int as n from time.entry where is_calendar");
  check("calendar-sourced time is distinguishable", r.rows[0]?.n === 1, `got ${r.rows[0]?.n}`);
}

console.log("\n--- the week_summary view respects RLS -------------------------------");

{
  // security_invoker: without it the view is a hole straight through the entry
  // policies, and this assertion is the only thing that would notice.
  const r = await asUser(EMP, "select distinct member_id from time.week_summary");
  const ids = r.rows.map((x) => Number(x.member_id));
  check(
    "week_summary shows only rows the caller may see",
    ids.length === 1 && ids[0] === 1,
    `saw ${JSON.stringify(ids)} err=${r.error} -- a view without security_invoker leaks every member`
  );
}
{
  const r = await asUser(EXEC, "select count(distinct member_id)::int as n from time.week_summary");
  check("exec sees both members in week_summary", r.rows[0]?.n === 2, `got ${r.rows[0]?.n} err=${r.error}`);
}

console.log("\n--- anon reaches nothing ---------------------------------------------");

for (const t of ["entry", "member", "member_rate", "customer", "project"]) {
  await db.exec("begin");
  let denied = false;
  try {
    await db.exec("set local role anon");
    await db.query(`select 1 from time.${t} limit 1`);
  } catch {
    denied = true;
  }
  await db.exec("rollback");
  check(`anon is denied on time.${t}`, denied);
}

console.log("\n--- negative control -------------------------------------------------");

{
  // If the deny assertions above were vacuous -- if PGlite were not enforcing
  // RLS at all -- granting anon a policy would change nothing. It must.
  await db.exec(`
    grant usage on schema time to anon;
    grant select on time.entry to anon;
    create policy "TEMP anon read" on time.entry for select to anon using (true);
  `);
  await db.exec("begin");
  let n = -1;
  try {
    await db.exec("set local role anon");
    const res = await db.query("select count(*)::int as n from time.entry");
    n = res.rows[0].n;
  } catch {
    n = -1;
  }
  await db.exec("rollback");
  check(
    "control: adding an anon policy DOES expose rows (so the denials are real)",
    n > 0,
    `anon still saw ${n} rows -- the deny assertions above prove nothing`
  );
  await db.exec(`drop policy "TEMP anon read" on time.entry; revoke select on time.entry from anon;`);
}

console.log(
  failed ? "\nTIME RLS: FAILURES ABOVE\n" : "\nTIME RLS: all checks passed\n"
);
process.exit(failed ? 1 : 0);
