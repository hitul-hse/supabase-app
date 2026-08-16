// RLS coverage for people.billable_rate_eur (TrackingTime-equivalent
// billable rate) and the billable_value_by_person view that derives a
// person's billed value from real approved timesheet hours. Same harness
// as check-leave-requests-rls.mjs.
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

const EMP = "11111111-1111-1111-1111-111111111111"; // p-emp, tries to set their own rate
const HEAD = "22222222-2222-2222-2222-222222222222"; // dept_head, same dept as p-emp
const EXEC = "33333333-3333-3333-3333-333333333333";
const OUTSIDER_EMP = "44444444-4444-4444-4444-444444444444"; // different dept employee

await db.exec(`
  insert into auth.users (id, email) values
    ('${EMP}','emp@x.com'), ('${HEAD}','head@x.com'), ('${EXEC}','exec@x.com'),
    ('${OUTSIDER_EMP}','outsider-emp@x.com');

  insert into people (id,name,role,department,since,contract_hours,employee_number,
    capacity_status,logged_this_month,total_monthly_hours,billable_share,open_tasks,
    overdue_tasks,holiday_left,total_holiday) values
    ('p-emp','Emp','Eng','Engineering','2020',40,'E1','ok',10,160,0.5,1,0,10,30),
    ('p-outsider','Outsider','Sales','Sales','2022',40,'S1','ok',10,160,0.5,1,0,10,20);

  insert into app_user_profile (user_id,person_id,role_key,department,is_active) values
    ('${EMP}', 'p-emp',   'employee',  null,          true),
    ('${HEAD}', null,     'dept_head', 'Engineering', true),
    ('${EXEC}', null,     'exec',      null,          true),
    ('${OUTSIDER_EMP}', 'p-outsider', 'employee', null, true);

  insert into timesheet_entries (entry_group,task_name,project_name,is_billable,day_of_week,hours,person_id,status) values
    (1,'Billable task','Bridge',true,0,10,'p-emp','approved'),
    (2,'Non-billable task','Internal',false,1,4,'p-emp','approved'),
    (3,'Not yet approved','Bridge',true,2,6,'p-emp','submitted');

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

// --- write access ---

const empSetOwnRate = await as(EMP, () =>
  db.query(`update people set billable_rate_eur=100 where id='p-emp' returning id`),
);
check("employee CANNOT set their own billable rate (RLS denies)", empSetOwnRate.rows.length === 0);

const headSetRate = await as(HEAD, () =>
  db.query(`update people set billable_rate_eur=100 where id='p-emp' returning id`),
);
check("dept_head CANNOT set a billable rate (RLS denies)", headSetRate.rows.length === 0);

const execSetRate = await as(EXEC, () =>
  db.query(`update people set billable_rate_eur=80 where id='p-emp' returning id`),
);
check("exec can set a person's billable rate", execSetRate.rows.length === 1);

// --- billable_value_by_person derives rate x approved-billable hours only ---

const value = await as(EXEC, () =>
  db.query(`select billable_hours_logged, billable_value_eur from billable_value_by_person where person_id='p-emp'`),
);
check(
  "billable_value_by_person counts only approved+billable hours (10, not 10+4+6) at the exec-set rate (80)",
  value.rows.length === 1 &&
    Number(value.rows[0].billable_hours_logged) === 10 &&
    Number(value.rows[0].billable_value_eur) === 800,
  JSON.stringify(value.rows[0]),
);

const outsiderView = await as(OUTSIDER_EMP, () =>
  db.query(`select person_id from billable_value_by_person where person_id='p-emp'`),
);
check(
  "billable_value_by_person respects can_view_person scoping: a different-department employee sees no row",
  outsiderView.rows.length === 0,
);

await db.close();
process.exit(failed ? 1 : 0);
