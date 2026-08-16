// RLS coverage for timesheet_entries write access (Phase 3: Timesheet
// Entry). Same harness as check-task-write-rls.mjs: real Postgres via
// pglite, real `authenticated` role, real seeded rows.
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

const EMP = "11111111-1111-1111-1111-111111111111"; // owns own entries
const OTHER_EMP = "22222222-2222-2222-2222-222222222222"; // same dept, different person
const HEAD = "33333333-3333-3333-3333-333333333333"; // dept_head, same dept
const OUTSIDER_HEAD = "44444444-4444-4444-4444-444444444444"; // dept_head, different dept

await db.exec(`
  insert into auth.users (id, email) values
    ('${EMP}','emp@x.com'), ('${OTHER_EMP}','other@x.com'),
    ('${HEAD}','head@x.com'), ('${OUTSIDER_HEAD}','outsider-head@x.com');

  insert into people (id,name,role,department,since,contract_hours,employee_number,
    capacity_status,logged_this_month,total_monthly_hours,billable_share,open_tasks,
    overdue_tasks,holiday_left,total_holiday) values
    ('p-emp','Emp','Eng','Engineering','2020',40,'E1','ok',10,160,0.5,1,0,10,30),
    ('p-other','Other','Eng','Engineering','2021',40,'E2','ok',10,160,0.5,1,0,10,30);

  insert into app_user_profile (user_id,person_id,role_key,department,is_active) values
    ('${EMP}', 'p-emp',   'employee',  null,          true),
    ('${OTHER_EMP}', 'p-other', 'employee', null,      true),
    ('${HEAD}', null,     'dept_head', 'Engineering', true),
    ('${OUTSIDER_HEAD}', null, 'dept_head', 'Sales',   true);

  insert into timesheet_entries (entry_group,task_name,project_name,is_billable,day_of_week,hours,person_id)
    values (1,'Existing task','Bridge',true,0,4,'p-emp');

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

const ownInsert = await as(EMP, () =>
  db.query(
    `insert into timesheet_entries (entry_group,task_name,project_name,is_billable,day_of_week,hours,person_id)
     values (2,'New task','Bridge',true,1,3,'p-emp') returning id`,
  ),
);
check("employee can insert their own timesheet entry", ownInsert.rows.length === 1);

let impersonationRejected = false;
try {
  await as(EMP, () =>
    db.query(
      `insert into timesheet_entries (entry_group,task_name,project_name,is_billable,day_of_week,hours,person_id)
       values (3,'Fraud task','Bridge',true,1,3,'p-other') returning id`,
    ),
  );
} catch {
  impersonationRejected = true;
}
check("employee CANNOT insert a timesheet entry for someone else (WITH CHECK rejects)", impersonationRejected);

// --- UPDATE: employee editing their own draft ---

const ownEdit = await as(EMP, () =>
  db.query(`update timesheet_entries set hours=5 where entry_group=1 and person_id='p-emp' returning id`),
);
check("employee can edit their own draft entry", ownEdit.rows.length === 1);

const otherEdit = await as(OTHER_EMP, () =>
  db.query(`update timesheet_entries set hours=99 where entry_group=1 and person_id='p-emp' returning id`),
);
check("a different employee's edit to someone else's entry affects 0 rows (RLS denies)", otherEdit.rows.length === 0);

// --- Employee cannot self-approve ---

let selfApproveRejected = false;
try {
  await as(EMP, () =>
    db.query(`update timesheet_entries set status='approved' where entry_group=1 and person_id='p-emp' returning id`),
  );
} catch {
  selfApproveRejected = true;
}
check("employee CANNOT set their own entry to 'approved' (WITH CHECK rejects)", selfApproveRejected);

// --- Employee can submit (draft -> submitted) ---

const submit = await as(EMP, () =>
  db.query(`update timesheet_entries set status='submitted' where entry_group=1 and person_id='p-emp' returning id`),
);
check("employee can submit their own draft entry", submit.rows.length === 1);

// --- Employee can no longer edit once submitted ---

// Denied either way: before withdraw existed this was a silent 0-row no-op
// (RLS USING simply didn't match); now the withdraw policy's USING does match
// and a trigger raises instead, telling the person to withdraw first. The
// security property asserted here is unchanged -- a submitted week can't be
// edited in place -- so this accepts either mechanism rather than pinning the
// weaker, silent one.
let editAfterSubmitDenied = false;
try {
  const editAfterSubmit = await as(EMP, () =>
    db.query(`update timesheet_entries set hours=1 where entry_group=1 and person_id='p-emp' returning id`),
  );
  editAfterSubmitDenied = editAfterSubmit.rows.length === 0;
} catch {
  editAfterSubmitDenied = true;
}
const afterSubmitHours = await db.query(
  `select hours from timesheet_entries where entry_group=1 and person_id='p-emp'`,
);
check(
  "employee cannot edit their week after submitting it",
  editAfterSubmitDenied && Number(afterSubmitHours.rows[0].hours) !== 1,
  `hours=${afterSubmitHours.rows[0].hours}`,
);

// --- dept_head approval ---

const outsiderHeadApprove = await as(OUTSIDER_HEAD, () =>
  db.query(`update timesheet_entries set status='approved' where entry_group=1 and person_id='p-emp' returning id`),
);
check(
  "dept_head from a different department cannot approve (RLS denies)",
  outsiderHeadApprove.rows.length === 0,
);

const headApprove = await as(HEAD, () =>
  db.query(`update timesheet_entries set status='approved' where entry_group=1 and person_id='p-emp' returning id`),
);
check("dept_head in the same department can approve a submitted entry", headApprove.rows.length === 1);

// --- DELETE ---

const deleteApproved = await as(EMP, () =>
  db.query(`delete from timesheet_entries where entry_group=1 and person_id='p-emp' returning id`),
);
check(
  "employee cannot delete an already-approved entry (RLS denies)",
  deleteApproved.rows.length === 0,
);

const deleteOwnDraft = await as(EMP, () =>
  db.query(`delete from timesheet_entries where entry_group=2 and person_id='p-emp' returning id`),
);
check("employee can delete their own draft entry", deleteOwnDraft.rows.length === 1);

await db.close();
process.exit(failed ? 1 : 0);
