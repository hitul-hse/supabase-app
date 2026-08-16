// RLS coverage for project_tasks write access (Phase 2: Task & Project
// Management). Mirrors check-rls-behaviour.mjs's harness: real Postgres via
// pglite, real `authenticated` role, real seeded rows — never a static
// assertion that a policy merely exists.
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
const OWNER = "33333333-3333-3333-3333-333333333333"; // owns prj-eng
const ASSIGNED = "44444444-4444-4444-4444-444444444444"; // assigned to prj-eng
const OUTSIDER = "55555555-5555-5555-5555-555555555555"; // no relationship to prj-eng

await db.exec(`
  insert into auth.users (id, email) values
    ('${EXEC}','exec@x.com'), ('${HEAD}','head@x.com'), ('${OWNER}','owner@x.com'),
    ('${ASSIGNED}','assigned@x.com'), ('${OUTSIDER}','outsider@x.com');

  insert into people (id,name,role,department,since,contract_hours,employee_number,
    capacity_status,logged_this_month,total_monthly_hours,billable_share,open_tasks,
    overdue_tasks,holiday_left,total_holiday) values
    ('p-owner','Owner','Eng','Engineering','2020',40,'E1','ok',10,160,0.5,1,0,10,30),
    ('p-assigned','Assigned','Eng','Engineering','2021',40,'E2','ok',10,160,0.5,1,0,10,30),
    ('p-outsider','Outsider','Sales','Sales','2022',40,'S1','ok',10,160,0.5,1,0,10,30);

  insert into projects (id,code,name,customer,lead,status,contract_hours,billable_hours,
    consumed_percent,due,owner_person_id,department) values
    ('prj-eng','E-1','Bridge','ACME','Owner','active',100,50,50,'Q4','p-owner','Engineering'),
    ('prj-other','S-1','Pitch','ACME','Outsider','active',100,50,50,'Q4','p-outsider','Sales');

  insert into person_assignments (person_id,project_id,project_name,logged_hours,
    tasks_count,share_percent,sort_order) values
    ('p-assigned','prj-eng','Bridge',10,1,50,1);

  insert into project_tasks (project_id,name,estimate_hours,logged_hours,status,owner,sort_order)
    values ('prj-eng','Existing task',10,0,'todo','Owner',1);

  insert into app_user_profile (user_id,person_id,role_key,department,is_active) values
    ('${EXEC}', null,          'exec',      null,          true),
    ('${HEAD}', null,          'dept_head', 'Engineering', true),
    ('${OWNER}', 'p-owner',    'project_manager', null,    true),
    ('${ASSIGNED}', 'p-assigned', 'employee', null,        true),
    ('${OUTSIDER}', 'p-outsider', 'employee', null,        true);

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

// --- INSERT ---

const execInsert = await as(EXEC, () =>
  db.query(
    `insert into project_tasks (project_id,name,estimate_hours,logged_hours,status,owner,sort_order)
     values ('prj-eng','Exec task',5,0,'todo','Exec',2) returning id`,
  ),
);
check("exec can insert a task into any project", execInsert.rows.length === 1);

const headInsert = await as(HEAD, () =>
  db.query(
    `insert into project_tasks (project_id,name,estimate_hours,logged_hours,status,owner,sort_order)
     values ('prj-eng','Head task',5,0,'todo','Head',3) returning id`,
  ),
);
check("dept_head can insert a task into their department's project", headInsert.rows.length === 1);

const ownerInsert = await as(OWNER, () =>
  db.query(
    `insert into project_tasks (project_id,name,estimate_hours,logged_hours,status,owner,sort_order)
     values ('prj-eng','Owner task',5,0,'todo','Owner',4) returning id`,
  ),
);
check("project owner can insert a task into their own project", ownerInsert.rows.length === 1);

const assignedInsert = await as(ASSIGNED, () =>
  db.query(
    `insert into project_tasks (project_id,name,estimate_hours,logged_hours,status,owner,sort_order)
     values ('prj-eng','Assigned task',5,0,'todo','Assigned',5) returning id`,
  ),
);
check("assigned person can insert a task into a project they're assigned to", assignedInsert.rows.length === 1);

let outsiderInsertRejected = false;
try {
  await as(OUTSIDER, () =>
    db.query(
      `insert into project_tasks (project_id,name,estimate_hours,logged_hours,status,owner,sort_order)
       values ('prj-eng','Outsider task',5,0,'todo','Outsider',6) returning id`,
    ),
  );
} catch {
  outsiderInsertRejected = true;
}
check("outsider CANNOT insert a task into a project they have no relationship to (WITH CHECK rejects)", outsiderInsertRejected);

// --- UPDATE ---

const ownerUpdate = await as(OWNER, () =>
  db.query(`update project_tasks set status='in_progress' where name='Existing task' returning id`),
);
check("project owner can update a task in their project", ownerUpdate.rows.length === 1);

const outsiderUpdate = await as(OUTSIDER, () =>
  db.query(`update project_tasks set status='done' where name='Existing task' returning id`),
);
check(
  "outsider's update to a task outside their reach affects 0 rows (RLS denies)",
  outsiderUpdate.rows.length === 0,
);

// --- DELETE ---

const outsiderDelete = await as(OUTSIDER, () =>
  db.query(`delete from project_tasks where name='Existing task' returning id`),
);
check(
  "outsider's delete of a task outside their reach affects 0 rows (RLS denies)",
  outsiderDelete.rows.length === 0,
);

const ownerDelete = await as(OWNER, () =>
  db.query(`delete from project_tasks where name='Existing task' returning id`),
);
check("project owner can delete a task in their project", ownerDelete.rows.length === 1);

await db.close();
process.exit(failed ? 1 : 0);
