// Coverage for closing the timesheet approval loop: withdrawing a submitted
// week, and rejection carrying a reason.
//
// Clockify documents both: a pending request can be withdrawn by its owner,
// and rejecting "requires a note to send to the user". A rejection with no
// stated reason just produces a second round of guessing.
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

const EMP = "11111111-1111-1111-1111-111111111111";
const OTHER = "22222222-2222-2222-2222-222222222222";
const HEAD = "33333333-3333-3333-3333-333333333333";

await db.exec(`
  insert into auth.users (id, email) values
    ('${EMP}','emp@x.com'), ('${OTHER}','other@x.com'), ('${HEAD}','head@x.com');

  insert into people (id,name,role,department,since,contract_hours,employee_number,
    capacity_status,logged_this_month,total_monthly_hours,billable_share,open_tasks,
    overdue_tasks,holiday_left,total_holiday) values
    ('p-emp','Emp','Eng','Engineering','2020',40,'E1','ok',10,160,0.5,1,0,10,30),
    ('p-other','Other','Eng','Engineering','2021',40,'E2','ok',10,160,0.5,1,0,10,30);

  insert into app_user_profile (user_id,person_id,role_key,department,is_active) values
    ('${EMP}', 'p-emp',  'employee',  null,          true),
    ('${OTHER}', 'p-other','employee', null,         true),
    ('${HEAD}', null,    'dept_head', 'Engineering', true);

  insert into timesheet_entries
    (entry_group,task_name,project_name,is_billable,day_of_week,hours,person_id,status) values
    (1,'Week work','Bridge',true,0,8,'p-emp','submitted');

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

// --- withdraw ---

const otherWithdraw = await as(OTHER, () =>
  db.query(`update timesheet_entries set status='draft' where person_id='p-emp' returning id`),
);
check("a different employee cannot withdraw someone else's submitted week", otherWithdraw.rows.length === 0);

const withdraw = await as(EMP, () =>
  db.query(`update timesheet_entries set status='draft' where person_id='p-emp' returning id, status`),
);
check("owner can withdraw their own submitted week back to draft", withdraw.rows.length === 1);

// Withdrawing must not become a back door to self-approval.
await as(EMP, () => db.query(`update timesheet_entries set status='submitted' where person_id='p-emp'`));
let selfApprove = false;
try {
  await as(EMP, () =>
    db.query(`update timesheet_entries set status='approved' where person_id='p-emp'`),
  );
} catch {
  selfApprove = true;
}
const stillSubmitted = await db.query(
  `select status from timesheet_entries where person_id='p-emp'`,
);
check(
  "withdrawing does not open a path to self-approval",
  selfApprove || stillSubmitted.rows[0].status !== "approved",
  `status=${stillSubmitted.rows[0].status}`,
);

// Regression guard. Adding the withdraw policy briefly opened a hole that
// neither policy granted alone: permissive policies OR their USING and their
// WITH CHECK independently, so withdraw's USING (accepts a submitted row) and
// edit's WITH CHECK (accepts a submitted result) combined to allow editing a
// submitted week in place. Pinned here because it is invisible in either
// policy read on its own.
// The row is already submitted from the self-approval check above.
let editSubmittedBlocked = false;
try {
  const edited = await as(EMP, () =>
    db.query(`update timesheet_entries set hours=99 where person_id='p-emp' returning id`),
  );
  editSubmittedBlocked = edited.rows.length === 0;
} catch {
  editSubmittedBlocked = true;
}
const hoursNow = await db.query(`select hours from timesheet_entries where person_id='p-emp'`);
check(
  "a submitted week cannot be edited in place; it must be withdrawn first",
  editSubmittedBlocked && Number(hoursNow.rows[0].hours) !== 99,
  `hours=${hoursNow.rows[0].hours}`,
);

// --- rejection carries a reason ---

const reject = await as(HEAD, () =>
  db.query(
    `update timesheet_entries set status='rejected', rejection_note='Thursday looks like a duplicate'
     where person_id='p-emp' returning id, rejection_note`,
  ),
);
check(
  "a lead can reject with a note explaining why",
  reject.rows.length === 1 && reject.rows[0].rejection_note === "Thursday looks like a duplicate",
  JSON.stringify(reject.rows[0]),
);

// A rejected week must be editable again -- otherwise the employee is told to
// fix something they cannot touch.
const fixAfterReject = await as(EMP, () =>
  db.query(`update timesheet_entries set hours=7 where person_id='p-emp' returning id`),
);
check("a rejected week is editable again so it can be corrected", fixAfterReject.rows.length === 1);

const resubmit = await as(EMP, () =>
  db.query(`update timesheet_entries set status='submitted' where person_id='p-emp' returning id`),
);
check("a corrected week can be resubmitted", resubmit.rows.length === 1);

const noteCleared = await db.query(
  `select rejection_note from timesheet_entries where person_id='p-emp'`,
);
check(
  "resubmitting clears the stale rejection note",
  noteCleared.rows[0].rejection_note === null,
  `note=${noteCleared.rows[0].rejection_note}`,
);

await db.close();
process.exit(failed ? 1 : 0);
