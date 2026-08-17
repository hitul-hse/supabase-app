// RLS coverage for leave_requests (FactorialHR-equivalent leave/PTO
// workflow) and the leave_balances view that derives holiday_left from it.
// Same harness as check-timesheet-write-rls.mjs.
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

const EMP = "11111111-1111-1111-1111-111111111111"; // owns own requests
const OTHER_EMP = "22222222-2222-2222-2222-222222222222"; // same dept, different person
const HEAD = "33333333-3333-3333-3333-333333333333"; // dept_head, same dept
const OUTSIDER_HEAD = "44444444-4444-4444-4444-444444444444"; // dept_head, different dept
const OUTSIDER_EMP = "55555555-5555-5555-5555-555555555555"; // different dept employee

await db.exec(`
  insert into auth.users (id, email) values
    ('${EMP}','emp@x.com'), ('${OTHER_EMP}','other@x.com'),
    ('${HEAD}','head@x.com'), ('${OUTSIDER_HEAD}','outsider-head@x.com'),
    ('${OUTSIDER_EMP}','outsider-emp@x.com');

  insert into people (id,name,role,department,since,contract_hours,employee_number,
    capacity_status,logged_this_month,total_monthly_hours,billable_share,open_tasks,
    overdue_tasks,holiday_left,total_holiday) values
    ('p-emp','Emp','Eng','Engineering','2020',40,'E1','ok',10,160,0.5,1,0,10,30),
    ('p-other','Other','Eng','Engineering','2021',40,'E2','ok',10,160,0.5,1,0,10,30),
    ('p-outsider','Outsider','Sales','Sales','2022',40,'S1','ok',10,160,0.5,1,0,10,20);

  insert into app_user_profile (user_id,person_id,role_key,department,is_active) values
    ('${EMP}', 'p-emp',   'employee',  null,          true),
    ('${OTHER_EMP}', 'p-other', 'employee', null,      true),
    ('${HEAD}', null,     'dept_head', 'Engineering', true),
    ('${OUTSIDER_HEAD}', null, 'dept_head', 'Sales',   true),
    ('${OUTSIDER_EMP}', 'p-outsider', 'employee', null, true);

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
    `insert into leave_requests (person_id,start_date,end_date,days,reason)
     values ('p-emp','2026-09-01','2026-09-03',3,'Vacation') returning id`,
  ),
);
check("employee can request their own leave", ownInsert.rows.length === 1);
const REQUEST_ID = ownInsert.rows[0].id;

let impersonationRejected = false;
try {
  await as(EMP, () =>
    db.query(
      `insert into leave_requests (person_id,start_date,end_date,days,reason)
       values ('p-other','2026-09-01','2026-09-03',3,'Fraud') returning id`,
    ),
  );
} catch {
  impersonationRejected = true;
}
check("employee CANNOT request leave for someone else (WITH CHECK rejects)", impersonationRejected);

let selfApproveOnInsertRejected = false;
try {
  await as(EMP, () =>
    db.query(
      `insert into leave_requests (person_id,start_date,end_date,days,status)
       values ('p-emp','2026-10-01','2026-10-02',2,'approved') returning id`,
    ),
  );
} catch {
  selfApproveOnInsertRejected = true;
}
check(
  "employee CANNOT create a leave request that's already approved (WITH CHECK rejects)",
  selfApproveOnInsertRejected,
);

// --- SELECT ---

const outsiderRead = await as(OUTSIDER_EMP, () => db.query(`select id from leave_requests where person_id='p-emp'`));
check("a different-department employee cannot see someone else's leave request", outsiderRead.rows.length === 0);

// --- self-approve rejected on UPDATE ---

const selfApprove = await as(EMP, () =>
  db.query(`update leave_requests set status='approved' where id=${REQUEST_ID} returning id`),
);
check("employee cannot approve their own request (RLS denies)", selfApprove.rows.length === 0);

// --- dept_head approval, scoped by department ---

const outsiderHeadApprove = await as(OUTSIDER_HEAD, () =>
  db.query(
    `update leave_requests set status='approved', decided_by='${OUTSIDER_HEAD}' where id=${REQUEST_ID} returning id`,
  ),
);
check("dept_head from a different department cannot approve (RLS denies)", outsiderHeadApprove.rows.length === 0);

const headApprove = await as(HEAD, () =>
  db.query(
    `update leave_requests set status='approved', decided_by='${HEAD}' where id=${REQUEST_ID} returning id`,
  ),
);
check("dept_head in the same department can approve a pending request", headApprove.rows.length === 1);

// --- cannot cancel once decided ---

const deleteApproved = await as(EMP, () => db.query(`delete from leave_requests where id=${REQUEST_ID} returning id`));
check("employee cannot cancel an already-approved request (RLS denies)", deleteApproved.rows.length === 0);

// --- owner can cancel their own pending request ---

const secondRequest = await as(EMP, () =>
  db.query(
    `insert into leave_requests (person_id,start_date,end_date,days)
     values ('p-emp','2026-11-01','2026-11-01',1) returning id`,
  ),
);
const SECOND_ID = secondRequest.rows[0].id;

const otherCancel = await as(OTHER_EMP, () =>
  db.query(`delete from leave_requests where id=${SECOND_ID} returning id`),
);
check("a different employee cannot cancel someone else's pending request", otherCancel.rows.length === 0);

const ownCancel = await as(EMP, () => db.query(`delete from leave_requests where id=${SECOND_ID} returning id`));
check("employee can cancel their own pending request", ownCancel.rows.length === 1);

// --- leave_balances view derives holiday_left from approved days only ---

const balance = await as(EMP, () =>
  db.query(`select total_holiday, days_taken, holiday_left from leave_balances where person_id='p-emp'`),
);
check(
  "leave_balances reflects the one approved request (3 days) against total_holiday (30)",
  balance.rows.length === 1 && Number(balance.rows[0].days_taken) === 3 && Number(balance.rows[0].holiday_left) === 27,
  JSON.stringify(balance.rows[0]),
);

const balanceOutsiderView = await as(OUTSIDER_EMP, () =>
  db.query(`select person_id from leave_balances where person_id='p-emp'`),
);
check(
  "leave_balances respects can_view_person scoping: a different-department employee sees no row for someone else",
  balanceOutsiderView.rows.length === 0,
);

await db.close();
process.exit(failed ? 1 : 0);
