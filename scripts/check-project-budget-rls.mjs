// Coverage for project budgets, cost rates and the derived margin view
// (TrackingTime/Clockify-equivalent). Same pglite harness as the others.
//
// The load-bearing question here is money: revenue counts only *billable*
// approved hours, cost counts *every* approved hour (Clockify: cost rates
// "are always applied, whether entry is billable or not"), and margin is the
// difference. Getting the billable filter on the wrong side of that would
// silently overstate profit on every project in the company.
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
const OUTSIDER = "33333333-3333-3333-3333-333333333333";

await db.exec(`
  insert into auth.users (id, email) values
    ('${EXEC}','exec@x.com'), ('${HEAD}','head@x.com'), ('${OUTSIDER}','out@x.com');

  insert into people (id,name,role,department,since,contract_hours,employee_number,
    capacity_status,logged_this_month,total_monthly_hours,billable_share,open_tasks,
    overdue_tasks,holiday_left,total_holiday,billable_rate_eur,cost_rate_eur) values
    ('p-emp','Emp','Eng','Engineering','2020',40,'E1','ok',10,160,0.5,1,0,10,30,100,60),
    ('p-out','Out','Sales','Sales','2022',40,'S1','ok',10,160,0.5,1,0,10,20,null,null);

  insert into projects (id,code,name,customer,lead,status,contract_hours,billable_hours,
    consumed_percent,due,owner_person_id,department,budget_hours,budget_alert_percent) values
    ('prj-a','A-1','Bridge','ACME','Emp','active',100,50,50,'Q4','p-emp','Engineering',100,80),
    -- Deliberately the SAME name, owned by someone in another department.
    ('prj-secret','S-1','Bridge','OTHER','Out','active',100,50,50,'Q4','p-out','Sales',100,80);

  insert into app_user_profile (user_id,person_id,role_key,department,is_active) values
    ('${EXEC}', null,   'exec',      null,          true),
    ('${HEAD}', 'p-emp','dept_head', 'Engineering', true),
    ('${OUTSIDER}', 'p-out','employee', null,       true);

  -- 10 billable + 5 non-billable approved hours on prj-a.
  insert into timesheet_entries
    (entry_group,task_name,project_name,project_id,is_billable,day_of_week,hours,person_id,status) values
    (1,'Billable','Bridge','prj-a',true,0,10,'p-emp','approved'),
    (2,'Internal','Bridge','prj-a',false,1,5,'p-emp','approved'),
    (3,'Not approved yet','Bridge','prj-a',true,2,7,'p-emp','submitted');

  -- Same-named project, hours that must never leak into prj-a's totals.
  insert into timesheet_entries
    (entry_group,task_name,project_name,project_id,is_billable,day_of_week,hours,person_id,status) values
    (4,'Secret work','Bridge','prj-secret',true,0,99,'p-out','approved');

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

// --- write access to budgets and rates ---

const headSetsBudget = await as(HEAD, () =>
  db.query(`update projects set budget_hours=999 where id='prj-a' returning id`),
);
check("dept_head CANNOT change a project budget (RLS denies)", headSetsBudget.rows.length === 0);

const execSetsBudget = await as(EXEC, () =>
  db.query(`update projects set budget_hours=100, budget_fee_eur=10000 where id='prj-a' returning id`),
);
check("exec can set a project budget", execSetsBudget.rows.length === 1);

const headSetsCost = await as(HEAD, () =>
  db.query(`update people set cost_rate_eur=1 where id='p-emp' returning id`),
);
check("dept_head CANNOT change a cost rate (RLS denies)", headSetsCost.rows.length === 0);

// --- derived money ---

const row = await as(EXEC, () =>
  db.query(
    `select hours_logged, billable_hours_logged, revenue_eur, cost_eur, margin_eur,
            hours_consumed_percent, is_over_budget, is_past_alert_threshold
     from project_budget_status where project_id='prj-a'`,
  ),
);
const r = row.rows[0] ?? {};

check(
  "hours_logged counts every approved hour (10 billable + 5 non-billable = 15), excluding unapproved",
  Number(r.hours_logged) === 15,
  JSON.stringify(r.hours_logged),
);

check(
  "billable_hours_logged counts only the approved billable hours (10)",
  Number(r.billable_hours_logged) === 10,
  JSON.stringify(r.billable_hours_logged),
);

// Revenue: 10 billable hours x 100 = 1000. The 5 non-billable hours earn nothing.
check(
  "revenue counts only billable approved hours at the bill rate (10 x 100 = 1000)",
  Number(r.revenue_eur) === 1000,
  JSON.stringify(r.revenue_eur),
);

// Cost: ALL 15 approved hours x 60 = 900, because people are paid for
// non-billable time too. This is the asymmetry that makes margin meaningful.
check(
  "cost counts every approved hour at the cost rate, billable or not (15 x 60 = 900)",
  Number(r.cost_eur) === 900,
  JSON.stringify(r.cost_eur),
);

check("margin is revenue minus cost (1000 - 900 = 100)", Number(r.margin_eur) === 100, JSON.stringify(r.margin_eur));

check(
  "hours_consumed_percent is logged over budget (15 of 100 = 15%)",
  Number(r.hours_consumed_percent) === 15,
  JSON.stringify(r.hours_consumed_percent),
);

check("a project inside its budget is not flagged over budget", r.is_over_budget === false);
check("15% consumed is below the 80% alert threshold", r.is_past_alert_threshold === false);

// --- the same-name trap ---

check(
  "hours from a DIFFERENT project that happens to share a name are not counted",
  Number(r.hours_logged) === 15,
  "prj-secret's 99h must not leak in",
);

// --- thresholds ---

await as(EXEC, () => db.query(`update projects set budget_hours=16 where id='prj-a'`));
const nearLimit = await as(EXEC, () =>
  db.query(
    `select hours_consumed_percent, is_over_budget, is_past_alert_threshold
     from project_budget_status where project_id='prj-a'`,
  ),
);
check(
  "crossing the alert threshold is flagged before the budget is blown (15 of 16 = 93.75%)",
  nearLimit.rows[0].is_past_alert_threshold === true && nearLimit.rows[0].is_over_budget === false,
  JSON.stringify(nearLimit.rows[0]),
);

await as(EXEC, () => db.query(`update projects set budget_hours=10 where id='prj-a'`));
const over = await as(EXEC, () =>
  db.query(`select is_over_budget from project_budget_status where project_id='prj-a'`),
);
check("exceeding the budget is flagged over budget", over.rows[0].is_over_budget === true);

// A project with no budget set must not divide by zero or report a false overrun.
await as(EXEC, () => db.query(`update projects set budget_hours=null where id='prj-a'`));
const noBudget = await as(EXEC, () =>
  db.query(
    `select hours_consumed_percent, is_over_budget from project_budget_status where project_id='prj-a'`,
  ),
);
check(
  "a project with no budget reports no percentage and is not flagged over budget",
  noBudget.rows[0].hours_consumed_percent === null && noBudget.rows[0].is_over_budget === false,
  JSON.stringify(noBudget.rows[0]),
);

// --- visibility ---

const outsiderView = await as(OUTSIDER, () =>
  db.query(`select project_id from project_budget_status where project_id='prj-a'`),
);
check(
  "project_budget_status respects can_view_project: an outsider sees no row",
  outsiderView.rows.length === 0,
);

await db.close();
process.exit(failed ? 1 : 0);
