// RLS coverage for task_comments (Asana-equivalent: comments on tasks).
// Same harness as check-task-write-rls.mjs.
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

const OWNER = "11111111-1111-1111-1111-111111111111"; // owns prj-eng
const ASSIGNED = "22222222-2222-2222-2222-222222222222"; // assigned to prj-eng
const OUTSIDER = "33333333-3333-3333-3333-333333333333"; // no relationship to prj-eng

await db.exec(`
  insert into auth.users (id, email) values
    ('${OWNER}','owner@x.com'), ('${ASSIGNED}','assigned@x.com'), ('${OUTSIDER}','outsider@x.com');

  insert into people (id,name,role,department,since,contract_hours,employee_number,
    capacity_status,logged_this_month,total_monthly_hours,billable_share,open_tasks,
    overdue_tasks,holiday_left,total_holiday) values
    ('p-owner','Owner','Eng','Engineering','2020',40,'E1','ok',10,160,0.5,1,0,10,30),
    ('p-assigned','Assigned','Eng','Engineering','2021',40,'E2','ok',10,160,0.5,1,0,10,30),
    ('p-outsider','Outsider','Sales','Sales','2022',40,'S1','ok',10,160,0.5,1,0,10,30);

  insert into projects (id,code,name,customer,lead,status,contract_hours,billable_hours,
    consumed_percent,due,owner_person_id,department) values
    ('prj-eng','E-1','Bridge','ACME','Owner','active',100,50,50,'Q4','p-owner','Engineering');

  insert into person_assignments (person_id,project_id,project_name,logged_hours,
    tasks_count,share_percent,sort_order) values
    ('p-assigned','prj-eng','Bridge',10,1,50,1);

  insert into project_tasks (project_id,name,estimate_hours,logged_hours,status,owner,sort_order)
    values ('prj-eng','Task A',10,0,'NOT STARTED','Owner',1);

  insert into app_user_profile (user_id,person_id,role_key,department,is_active) values
    ('${OWNER}', 'p-owner', 'project_manager', null, true),
    ('${ASSIGNED}', 'p-assigned', 'employee', null, true),
    ('${OUTSIDER}', 'p-outsider', 'employee', null, true);

  grant usage on schema public to authenticated;
  grant select, insert, update, delete on all tables in schema public to authenticated;
`);

const { rows: taskRows } = await db.query("select id from project_tasks where name = 'Task A'");
const taskId = taskRows[0].id;

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

const ownerComment = await as(OWNER, () =>
  db.query(`insert into task_comments (task_id, author_id, body) values (${taskId}, '${OWNER}', 'Owner comment') returning id`),
);
check("project owner can comment on a task they can view", ownerComment.rows.length === 1);

const assignedComment = await as(ASSIGNED, () =>
  db.query(`insert into task_comments (task_id, author_id, body) values (${taskId}, '${ASSIGNED}', 'Assigned comment') returning id`),
);
check("assigned person can comment on the task", assignedComment.rows.length === 1);

let outsiderRejected = false;
try {
  await as(OUTSIDER, () =>
    db.query(`insert into task_comments (task_id, author_id, body) values (${taskId}, '${OUTSIDER}', 'Sneaky comment') returning id`),
  );
} catch {
  outsiderRejected = true;
}
check("outsider CANNOT comment on a task they can't view (WITH CHECK rejects)", outsiderRejected);

let impersonationRejected = false;
try {
  await as(ASSIGNED, () =>
    db.query(`insert into task_comments (task_id, author_id, body) values (${taskId}, '${OWNER}', 'Impersonating owner') returning id`),
  );
} catch {
  impersonationRejected = true;
}
check("a user CANNOT post a comment as someone else (WITH CHECK rejects author_id mismatch)", impersonationRejected);

const outsiderRead = await as(OUTSIDER, () => db.query("select id from task_comments"));
check("outsider sees 0 comments on a task/project they can't view", outsiderRead.rows.length === 0);

const ownerRead = await as(OWNER, () => db.query("select id from task_comments"));
check("owner sees both real comments on their project's task", ownerRead.rows.length === 2);

const outsiderDelete = await as(OUTSIDER, () =>
  db.query(`delete from task_comments where body = 'Owner comment' returning id`),
);
check("a user cannot delete someone else's comment", outsiderDelete.rows.length === 0);

const ownDelete = await as(OWNER, () =>
  db.query(`delete from task_comments where body = 'Owner comment' returning id`),
);
check("a user can delete their own comment", ownDelete.rows.length === 1);

// Resolving *who* commented needs a name lookup that (deliberately, like
// org_chart_nodes) bypasses app_user_profile's normal self-only RLS --
// otherwise an employee could see that a comment exists but never who wrote
// it unless they happened to be exec.
const namesAsAssigned = await as(ASSIGNED, () =>
  db.query("select user_id, display_name from user_display_names where user_id in ($1, $2) order by user_id", [OWNER, ASSIGNED]),
);
check(
  "an employee can resolve another commenter's display name via user_display_names",
  namesAsAssigned.rows.length === 2 && namesAsAssigned.rows.every((r) => r.display_name),
);

await db.close();
process.exit(failed ? 1 : 0);
