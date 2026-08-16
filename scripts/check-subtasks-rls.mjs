// RLS coverage for project_tasks.parent_task_id (subtasks, Asana-equivalent).
// Subtasks are just project_tasks rows with parent_task_id set, so they
// inherit the existing role-scoped read/write policies for free -- the only
// new thing to prove is that a subtask can't be attached to a parent task
// that lives in a *different* project than the subtask claims to be in
// (that would let someone smuggle a task into a project they can't see by
// nesting it under a task in a project they can).
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

const OWNER = "33333333-3333-3333-3333-333333333333"; // owns prj-eng
const OUTSIDER = "55555555-5555-5555-5555-555555555555"; // no relationship to prj-eng

await db.exec(`
  insert into auth.users (id, email) values ('${OWNER}','owner@x.com'), ('${OUTSIDER}','outsider@x.com');

  insert into people (id,name,role,department,since,contract_hours,employee_number,
    capacity_status,logged_this_month,total_monthly_hours,billable_share,open_tasks,
    overdue_tasks,holiday_left,total_holiday) values
    ('p-owner','Owner','Eng','Engineering','2020',40,'E1','ok',10,160,0.5,1,0,10,30),
    ('p-outsider','Outsider','Sales','Sales','2022',40,'S1','ok',10,160,0.5,1,0,10,30);

  insert into projects (id,code,name,customer,lead,status,contract_hours,billable_hours,
    consumed_percent,due,owner_person_id,department) values
    ('prj-eng','E-1','Bridge','ACME','Owner','active',100,50,50,'Q4','p-owner','Engineering'),
    ('prj-other','S-1','Pitch','ACME','Outsider','active',100,50,50,'Q4','p-outsider','Sales');

  insert into app_user_profile (user_id,person_id,role_key,department,is_active) values
    ('${OWNER}', 'p-owner',    'project_manager', null, true),
    ('${OUTSIDER}', 'p-outsider', 'employee',      null, true);

  grant usage on schema public to authenticated;
  grant select, insert, update, delete on all tables in schema public to authenticated;
`);

const parentTask = await db.query(
  `insert into project_tasks (project_id,name,estimate_hours,logged_hours,status,owner,sort_order)
   values ('prj-eng','Parent task',10,0,'todo','Owner',1) returning id`,
);
const PARENT_ID = parentTask.rows[0].id;

const otherProjectTask = await db.query(
  `insert into project_tasks (project_id,name,estimate_hours,logged_hours,status,owner,sort_order)
   values ('prj-other','Other project task',10,0,'todo','Outsider',1) returning id`,
);
const OTHER_PROJECT_TASK_ID = otherProjectTask.rows[0].id;

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

// --- INSERT: subtask under a parent in the same project ---

const goodSubtask = await as(OWNER, () =>
  db.query(
    `insert into project_tasks (project_id,name,estimate_hours,logged_hours,status,owner,sort_order,parent_task_id)
     values ('prj-eng','Subtask A',2,0,'todo','',2,${PARENT_ID}) returning id`,
  ),
);
check("owner can insert a subtask under a parent task in the same project", goodSubtask.rows.length === 1);

// --- INSERT: subtask claiming a project_id that doesn't match its parent's project ---

let crossProjectRejected = false;
try {
  await as(OWNER, () =>
    db.query(
      `insert into project_tasks (project_id,name,estimate_hours,logged_hours,status,owner,sort_order,parent_task_id)
       values ('prj-other','Sneaky subtask',2,0,'todo','',3,${PARENT_ID}) returning id`,
    ),
  );
} catch {
  crossProjectRejected = true;
}
check(
  "subtask CANNOT claim a project_id different from its parent task's project (WITH CHECK rejects)",
  crossProjectRejected,
);

// --- UPDATE: reparenting a task across projects is rejected the same way ---

let reparentRejected = false;
try {
  await as(OWNER, () =>
    db.query(
      `update project_tasks set parent_task_id = ${OTHER_PROJECT_TASK_ID}
       where id = ${PARENT_ID} and project_id = 'prj-eng'`,
    ),
  );
} catch {
  reparentRejected = true;
}
check(
  "reparenting a task under a parent in a different project is rejected (WITH CHECK)",
  reparentRejected,
);

// --- SELECT: subtasks are visible/invisible exactly like any other task row ---

const outsiderRead = await as(OUTSIDER, () =>
  db.query(`select id from project_tasks where parent_task_id = ${PARENT_ID}`),
);
check("outsider cannot see subtasks of a project they can't view", outsiderRead.rows.length === 0);

const ownerRead = await as(OWNER, () =>
  db.query(`select id from project_tasks where parent_task_id = ${PARENT_ID}`),
);
check("owner sees the subtask under their own project's task", ownerRead.rows.length === 1);

// --- DELETE cascade: removing the parent removes its subtasks ---

await as(OWNER, () => db.query(`delete from project_tasks where id = ${PARENT_ID}`));
const afterCascade = await db.query(`select id from project_tasks where id = ${goodSubtask.rows[0].id}`);
check("deleting a parent task cascades to delete its subtasks", afterCascade.rows.length === 0);

await db.close();
process.exit(failed ? 1 : 0);
