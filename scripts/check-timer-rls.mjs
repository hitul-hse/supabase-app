// Coverage for the live timer (TrackingTime/Toggl-equivalent start/stop).
//
// A running timer is a timesheet_entries row with started_at set and
// stopped_at still null. The rule that actually matters is "one running
// timer per person" -- without it a double-clicked start button silently
// creates two concurrent timers and every hour after that is double-counted.
// That invariant is enforced by a partial unique index, not by app code,
// so it's tested here against real Postgres.
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";

const db = await new PGlite();

await db.exec(`
  create schema if not exists auth;
  create table auth.users (id uuid primary key, email text);
  do $$ begin
    if not exists (select 1 from pg_roles where rolname='anon') then create role anon nologin; end if;
    if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin; end if;
    if not exists (select 1 from pg_roles where rolname='service_role') then create role service_role nologin bypassrls; end if;
  end $$;
  create or replace function auth.uid() returns uuid
    language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
`);

await db.exec(readFileSync("supabase/schema.sql", "utf8"));

const EMP = "11111111-1111-1111-1111-111111111111";
const OTHER = "22222222-2222-2222-2222-222222222222";

await db.exec(`
  insert into auth.users (id, email) values ('${EMP}','emp@x.com'), ('${OTHER}','other@x.com');

  insert into people (id,name,role,department,since,contract_hours,employee_number,
    capacity_status,logged_this_month,total_monthly_hours,billable_share,open_tasks,
    overdue_tasks,holiday_left,total_holiday) values
    ('p-emp','Emp','Eng','Engineering','2020',40,'E1','ok',10,160,0.5,1,0,10,30),
    ('p-other','Other','Eng','Engineering','2021',40,'E2','ok',10,160,0.5,1,0,10,30);

  insert into app_user_profile (user_id,person_id,role_key,department,is_active) values
    ('${EMP}', 'p-emp',   'employee', null, true),
    ('${OTHER}', 'p-other', 'employee', null, true);

  grant usage on schema public to authenticated;
  grant select, insert, update, delete on all tables in schema public to authenticated;
`);

let failed = false;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}: ${name}${detail ? " — " + detail : ""}`);
  if (!ok) failed = true;
};

async function as(uid, fn) {
  await db.exec("set role authenticated");
  await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [uid]);
  try {
    return await fn();
  } finally {
    await db.exec("reset role");
  }
}

const startTimer = (personId, group, task) =>
  db.query(
    `insert into timesheet_entries
       (entry_group,task_name,project_name,is_billable,day_of_week,hours,person_id,started_at)
     values (${group},'${task}','Bridge',true,0,0,'${personId}',now()) returning id`,
  );

// --- starting ---

const first = await as(EMP, () => startTimer("p-emp", 1, "Timer A"));
check("employee can start a timer (started_at set, stopped_at null)", first.rows.length === 1);
const FIRST_ID = first.rows[0].id;

let secondRejected = false;
try {
  await as(EMP, () => startTimer("p-emp", 2, "Timer B"));
} catch {
  secondRejected = true;
}
check("a second concurrent timer for the same person is rejected (partial unique index)", secondRejected);

// A different person running their own timer at the same time is fine --
// the constraint is per person, not global.
const otherPersonTimer = await as(OTHER, () => startTimer("p-other", 1, "Timer C"));
check("a different person can run their own timer concurrently", otherPersonTimer.rows.length === 1);

let impersonationRejected = false;
try {
  await as(EMP, () => startTimer("p-other", 9, "Fraud timer"));
} catch {
  impersonationRejected = true;
}
check("employee CANNOT start a timer for someone else (RLS WITH CHECK rejects)", impersonationRejected);

// --- stopping ---

const otherStop = await as(OTHER, () =>
  db.query(`update timesheet_entries set stopped_at=now(), hours=1 where id=${FIRST_ID} returning id`),
);
check("a different employee cannot stop someone else's timer (RLS denies)", otherStop.rows.length === 0);

const stop = await as(EMP, () =>
  db.query(
    `update timesheet_entries set stopped_at = started_at + interval '90 minutes',
       hours = 1.5 where id=${FIRST_ID} returning id, hours`,
  ),
);
check("owner can stop their own running timer", stop.rows.length === 1);

// --- after stopping, the slot frees up ---

const afterStop = await as(EMP, () => startTimer("p-emp", 3, "Timer D"));
check("once the previous timer is stopped a new one can start", afterStop.rows.length === 1);

const running = await as(EMP, () =>
  db.query(`select id from timesheet_entries where person_id='p-emp' and started_at is not null and stopped_at is null`),
);
check("exactly one timer is running for the person at any time", running.rows.length === 1);

// A plain manual grid entry has no started_at at all, so any number of them
// coexist -- the index must not accidentally constrain normal timesheet rows.
const manualA = await as(EMP, () =>
  db.query(
    `insert into timesheet_entries (entry_group,task_name,project_name,is_billable,day_of_week,hours,person_id)
     values (10,'Manual A','Bridge',true,1,4,'p-emp') returning id`,
  ),
);
const manualB = await as(EMP, () =>
  db.query(
    `insert into timesheet_entries (entry_group,task_name,project_name,is_billable,day_of_week,hours,person_id)
     values (11,'Manual B','Bridge',true,2,4,'p-emp') returning id`,
  ),
);
check(
  "manual (non-timer) entries are unaffected by the one-running-timer rule",
  manualA.rows.length === 1 && manualB.rows.length === 1,
);

await db.close();
process.exit(failed ? 1 : 0);
