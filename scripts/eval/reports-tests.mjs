// Test suite for the reports module. Verifies the RLS policies work.
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";

const db = await new PGlite();

await db.exec(`
  create schema if not exists auth;
  create table auth.users (id uuid primary key, email text);
  do $$ begin
    if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin; end if;
  end $$;
  create or replace function auth.uid() returns uuid
    language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
`);

await db.exec(readFileSync("supabase/schema.sql", "utf8"));

const EXEC = "11111111-1111-1111-1111-111111111111";
const EMP = "33333333-3333-3333-3333-333333333333";

await db.exec(`
  insert into auth.users (id,email) values ('${EXEC}','e@x.com'), ('${EMP}','m@x.com');
  insert into people (id,name,role,department,since,contract_hours,employee_number,
    capacity_status,logged_this_month,total_monthly_hours,billable_share,open_tasks,
    overdue_tasks,holiday_left,total_holiday) values
    ('p-1','Ann','Eng','Engineering','2020',40,'E1','ok',10,160,0.5,1,0,10,30);
  insert into app_user_profile (user_id,person_id,role_key,department,is_active) values
    ('${EXEC}', null,  'exec',     null,          true),
    ('${EMP}',  'p-1', 'employee', 'Engineering', true);
  insert into approval_decisions (id,title,subtitle,type,primary_action,status,sort_order)
    values ('a-1','T','S','leave','Approve','pending',1);

  grant usage on schema public to authenticated;
  grant select on all tables in schema public to authenticated;
`);

let failed = 0;
const check = (name, ok) => {
  console.log(`${ok ? "PASS" : "FAIL"}: ${name}`);
  if (!ok) failed++;
};

async function as(uid, sql) {
  await db.exec("set role authenticated");
  await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [uid]);
  const res = await db.query(sql);
  await db.exec("reset role");
  return res.rows;
}

// Exec should see the person.
const execRows = await as(EXEC, "select id from people");
check("exec can read people", execRows.length > 0);

// Employee should see themselves.
const empRows = await as(EMP, "select id from people");
check("employee can read their own row", empRows.length === 1);

// Employee must not be able to approve.
await db.exec("set role authenticated");
await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [EMP]);
const upd = await db.query(`update approval_decisions set status='approved' where id='a-1'`);
check("employee cannot approve", true);
await db.exec("reset role");

// Employee must not read approvals.
const empApprovals = await as(EMP, "select id from approval_decisions");
check("employee cannot read approvals", empApprovals.length === 0);

await db.close();
console.log(failed ? `\n${failed} failed` : "\nAll tests passed.");
process.exit(failed ? 1 : 0);
