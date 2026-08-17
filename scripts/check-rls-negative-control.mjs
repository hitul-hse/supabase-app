// Negative control for check-rls-behaviour.mjs. Rebuilds the schema with the
// PRE-FIX definitions of the three security-relevant policies/functions and
// asserts the behavioural suite would have caught each one. If any of these
// "old" versions passes, the corresponding test is not actually load-bearing.
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";

const EXEC = "11111111-1111-1111-1111-111111111111";
const EMP = "33333333-3333-3333-3333-333333333333";
const GONE = "44444444-4444-4444-4444-444444444444";

async function build(regressions) {
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
  await db.exec(`
    insert into auth.users (id,email) values
      ('${EXEC}','e@x.com'), ('${EMP}','m@x.com'), ('${GONE}','g@x.com');
    insert into people (id,name,role,department,since,contract_hours,employee_number,
      capacity_status,logged_this_month,total_monthly_hours,billable_share,open_tasks,
      overdue_tasks,holiday_left,total_holiday) values
      ('p-eng2','Bob','Eng','Engineering','2021',40,'E2','ok',10,160,0.5,1,0,10,30),
      ('p-sales','Cara','Sales','Sales','2022',40,'S1','ok',10,160,0.5,1,0,10,30);
    insert into projects (id,code,name,customer,lead,status,contract_hours,billable_hours,
      consumed_percent,due,owner_person_id,department) values
      ('prj-eng','E-1','Bridge','ACME','Ann','active',100,50,50,'Q4',null,'Engineering'),
      ('prj-secret','X-9','Bridge','SECRET','Cara','active',100,50,50,'Q4','p-sales','Sales');
    insert into person_assignments (person_id,project_id,project_name,logged_hours,
      tasks_count,share_percent,sort_order) values ('p-eng2','prj-eng','Bridge',10,1,50,1);
    insert into app_user_profile (user_id,person_id,role_key,department,is_active) values
      ('${EXEC}', null,     'exec',     null,          true),
      ('${EMP}',  'p-eng2', 'employee', 'Engineering', true),
      ('${GONE}', null,     'exec',     null,          false);
    insert into approval_decisions (id,title,subtitle,type,primary_action,status,sort_order)
      values ('a-1','T','S','leave','Approve','pending',1);
    grant usage on schema public to authenticated;
    grant select, insert, update, delete on all tables in schema public to authenticated;
  `);
  if (regressions) await db.exec(regressions);
  return db;
}

async function as(db, uid, sql) {
  await db.exec("set role authenticated");
  await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [uid]);
  let rows, error = null;
  try {
    rows = (await db.query(sql)).rows;
  } catch (e) {
    error = e.message;
    rows = [];
  }
  await db.exec("reset role");
  return { rows, error };
}

let failed = false;
const expectCaught = (name, caught, detail) => {
  console.log(`${caught ? "PASS" : "FAIL"}: ${name}${detail ? " — " + detail : ""}`);
  if (!caught) failed = true;
};

// --- Regression 1: revert can_view_project to the project_name join. ---
{
  const db = await build(`
    create or replace function can_view_project(target_project_id text)
    returns boolean language sql stable security definer set search_path = public as $$
      select app_user_role() = 'exec'
        or exists (select 1 from projects pr where pr.id = target_project_id and (
          (app_user_role() = 'dept_head' and pr.department = app_user_department())
          or pr.owner_person_id = app_user_person_id()
          or exists (select 1 from person_assignments pa
                     where pa.project_name = pr.name and pa.person_id = app_user_person_id())));
    $$;
  `);
  const { rows } = await as(db, EMP, "select id from projects order by id");
  const seen = rows.map((r) => r.id).join(",");
  expectCaught(
    "old project_name join leaks the same-named secret project (test would catch it)",
    seen.includes("prj-secret"),
    `employee saw: ${seen}`,
  );
  await db.close();
}

// --- Regression 2: revert the role helpers to ignoring is_active. ---
{
  const db = await build(`
    create or replace function app_user_role() returns text
    language sql stable security definer set search_path = public as $$
      select role_key from app_user_profile where user_id = auth.uid();
    $$;
  `);
  const { rows } = await as(db, GONE, "select id from people");
  expectCaught(
    "old helpers let a DEACTIVATED exec read people (test would catch it)",
    rows.length > 0,
    `deactivated exec saw ${rows.length} people`,
  );
  await db.close();
}

// --- Regression 3: revert the approvals UPDATE policy to USING-only. ---
{
  const db = await build(`
    drop policy "exec and dept_head can update approval_decisions" on approval_decisions;
    create policy "exec and dept_head can update approval_decisions"
      on approval_decisions for update to authenticated
      using (app_user_role() in ('exec','dept_head'));
  `);
  const { rows, error } = await as(
    db,
    EXEC,
    "update approval_decisions set status='pwned' where id='a-1' returning id",
  );
  expectCaught(
    "USING-only policy accepts an invalid status (test would catch it)",
    rows.length > 0 && !error,
    error ? `unexpectedly rejected: ${error}` : "status='pwned' was written",
  );
  await db.close();
}

// --- Regression 4: drop the profile write policies. ---
{
  const db = await build(`
    drop policy "exec can insert profiles" on app_user_profile;
    drop policy "exec can update profiles" on app_user_profile;
    drop policy "exec can delete profiles" on app_user_profile;
  `);
  const { rows } = await as(
    db,
    EXEC,
    `update app_user_profile set is_active = false where user_id='${EMP}' returning user_id`,
  );
  expectCaught(
    "without write policies an exec cannot deactivate an account (the inert ACTIVE column)",
    rows.length === 0,
    `rows updated: ${rows.length}`,
  );
  await db.close();
}

console.log(
  failed
    ? "\nAt least one behavioural test is NOT load-bearing."
    : "\nAll four regressions were detected: the behavioural suite is load-bearing.",
);
process.exit(failed ? 1 : 0);
