// Exercises the RLS policies the way the app relies on them: as the
// `authenticated` role, with auth.uid() set to a specific user, against real
// seeded rows in real Postgres. Static assertions can confirm a policy exists;
// only this can confirm it grants and denies the right rows.
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

const EXEC = "11111111-1111-1111-1111-111111111111";
const HEAD = "22222222-2222-2222-2222-222222222222";
const EMP = "33333333-3333-3333-3333-333333333333";
const GONE = "44444444-4444-4444-4444-444444444444";

// Seed as owner (RLS is bypassed for the table owner), then read as authenticated.
await db.exec(`
  insert into auth.users (id, email) values
    ('${EXEC}','exec@x.com'), ('${HEAD}','head@x.com'),
    ('${EMP}','emp@x.com'), ('${GONE}','gone@x.com');

  insert into people (id,name,role,department,since,contract_hours,employee_number,
    capacity_status,logged_this_month,total_monthly_hours,billable_share,open_tasks,
    overdue_tasks,holiday_left,total_holiday) values
    ('p-eng','Ann','Eng','Engineering','2020',40,'E1','ok',10,160,0.5,1,0,10,30),
    ('p-eng2','Bob','Eng','Engineering','2021',40,'E2','ok',10,160,0.5,1,0,10,30),
    ('p-sales','Cara','Sales','Sales','2022',40,'S1','ok',10,160,0.5,1,0,10,30);

  insert into projects (id,code,name,customer,lead,status,contract_hours,billable_hours,
    consumed_percent,due,owner_person_id,department) values
    ('prj-eng','E-1','Bridge','ACME','Ann','active',100,50,50,'Q4','p-eng','Engineering'),
    ('prj-sales','S-1','Pitch','ACME','Cara','active',100,50,50,'Q4','p-sales','Sales'),
    -- Same NAME as the engineering project but a different department/owner.
    -- Under the old project_name join this leaked to anyone assigned to "Bridge".
    ('prj-secret','X-9','Bridge','SECRET','Cara','active',100,50,50,'Q4','p-sales','Sales');

  -- Bob is assigned to the engineering "Bridge" only.
  insert into person_assignments (person_id,project_id,project_name,logged_hours,
    tasks_count,share_percent,sort_order) values
    ('p-eng2','prj-eng','Bridge',10,1,50,1);

  insert into app_user_profile (user_id,person_id,role_key,department,is_active) values
    ('${EXEC}', null,      'exec',      null,          true),
    ('${HEAD}', 'p-eng',   'dept_head', 'Engineering', true),
    ('${EMP}',  'p-eng2',  'employee',  'Engineering', true),
    -- Deactivated exec: must lose every permission.
    ('${GONE}', null,      'exec',      null,          false);

  insert into approval_decisions (id,title,subtitle,type,primary_action,status,sort_order)
    values ('a-1','T','S','leave','Approve','pending',1);

  -- Mirror Supabase's default grants: the authenticated role really does hold
  -- table-level DML on public tables there, so RLS (not a missing GRANT) must
  -- be what stops privilege escalation. Granting less here would make the
  -- denial tests pass for the wrong reason.
  grant usage on schema public to authenticated;
  grant select, insert, update, delete on all tables in schema public to authenticated;
`);

let failed = false;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}: ${name}${detail ? " — " + detail : ""}`);
  if (!ok) failed = true;
};

async function as(uid, sql) {
  await db.exec("set role authenticated");
  await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [uid]);
  const res = await db.query(sql);
  await db.exec("reset role");
  return res.rows;
}

const ids = (rows) => rows.map((r) => r.id).sort().join(",");

// Exec sees everything.
check("exec sees all 3 people", ids(await as(EXEC, "select id from people")) === "p-eng,p-eng2,p-sales");
check(
  "exec sees all 3 projects",
  ids(await as(EXEC, "select id from projects")) === "prj-eng,prj-sales,prj-secret",
);

// Dept head is scoped to their own department.
check(
  "dept_head sees only Engineering people",
  ids(await as(HEAD, "select id from people")) === "p-eng,p-eng2",
);
check(
  "dept_head sees only Engineering projects",
  ids(await as(HEAD, "select id from projects")) === "prj-eng",
);

// Employee sees themselves and the project they're assigned to.
check("employee sees only themselves", ids(await as(EMP, "select id from people")) === "p-eng2");

// The bug #6 regression test: Bob is assigned to "Bridge" (prj-eng). The
// identically-named prj-secret in another department must stay hidden.
const empProjects = ids(await as(EMP, "select id from projects"));
check(
  "employee sees assigned project but NOT the same-named secret project",
  empProjects === "prj-eng",
  `saw: ${empProjects}`,
);

// Approvals are exec/dept_head only.
check("exec sees approvals", (await as(EXEC, "select id from approval_decisions")).length === 1);
check("dept_head sees approvals", (await as(HEAD, "select id from approval_decisions")).length === 1);
check(
  "employee sees NO approvals",
  (await as(EMP, "select id from approval_decisions")).length === 0,
);

// Deactivated account must be fully cut off despite its 'exec' role_key.
check("deactivated exec sees no people", (await as(GONE, "select id from people")).length === 0);
check("deactivated exec sees no projects", (await as(GONE, "select id from projects")).length === 0);
check(
  "deactivated exec sees no approvals",
  (await as(GONE, "select id from approval_decisions")).length === 0,
);

// Bug #4: WITH CHECK must reject a status the app never offers.
await db.exec("set role authenticated");
await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [EXEC]);
let rejected = false;
try {
  await db.query(`update approval_decisions set status='pwned' where id='a-1'`);
} catch {
  rejected = true;
}
check("WITH CHECK rejects an invalid status value", rejected);

const okUpdate = await db.query(
  `update approval_decisions set status='approved' where id='a-1' returning id`,
);
check("exec can still make a legitimate approval", okUpdate.rows.length === 1);
await db.exec("reset role");

// Employees must not be able to approve at all.
await db.exec("set role authenticated");
await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [EMP]);
const empUpd = await db.query(
  `update approval_decisions set status='approved' where id='a-1' returning id`,
);
check("employee's approval updates 0 rows (RLS denies)", empUpd.rows.length === 0);
await db.exec("reset role");

// Profiles: users read their own; execs read all; employees can't escalate.
check("employee reads only their own profile", (await as(EMP, "select user_id from app_user_profile")).length === 1);
check("exec reads all 4 profiles", (await as(EXEC, "select user_id from app_user_profile")).length === 4);

await db.exec("set role authenticated");
await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [EMP]);
const escalate = await db.query(
  `update app_user_profile set role_key='exec' where user_id='${EMP}' returning user_id`,
);
check("employee cannot escalate their own role to exec", escalate.rows.length === 0);
await db.exec("reset role");

await db.close();
process.exit(failed ? 1 : 0);
