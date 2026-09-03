/**
 * Does 20260903120000_budgets_are_commercial_not_general.sql actually move who
 * can see a project budget -- and does it still do it on the second run?
 *
 * WHAT THIS GATE IS FOR
 * ---------------------
 * hitul's decision on 2026-09-03: project budgets are for Executive, Department
 * Head and a new Sales role. Employee, Project Manager and HR lose them.
 *
 * Asserting that the migration "removes three rows from app_role_permission"
 * would be worthless. `projects:contracts:read` had exactly one enforcement
 * point in the database and the budgets people actually look at do not come
 * from the table it guards, so a green row-count test would have passed over a
 * system that still showed every budget to everybody. This gate therefore
 * asserts the OUTCOME, per role, by setting request.jwt.claim.sub to a real
 * profile and reading as `authenticated` through the objects the application
 * reads: time.project_contract_period, time.contract_period_status and
 * time.project_summary.
 *
 * THE NEGATIVE CONTROL, AND WHY IT IS THE IMPORTANT HALF
 * -----------------------------------------------------
 * A test that only runs after the fix cannot tell "the fix works" apart from
 * "there was no data to leak" -- and this schema is full of ways to read zero
 * rows for the wrong reason. So the run below builds the PRE-migration world
 * first (contracts:read back on employee/project_manager/hr, project_summary
 * un-redacted, contract_period_status on owner rights, exactly as production
 * stood this morning), and REQUIRES the leak to be present. If an employee
 * cannot read a budget before the migration, this script fails and says the
 * test proved nothing -- because at that point it is testing an empty database,
 * not a permission.
 *
 * TWICE, because a migration that is not idempotent is a migration that cannot
 * be re-pasted, and the house flow is that a human pastes it by hand. The
 * second run must be a no-op, not an error and not a different outcome.
 *
 * Run: node scripts/check-budget-visibility-migration.mjs
 */
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";

let failed = false;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}: ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failed = true;
};

const MIGRATION = "supabase/migrations/20260903120000_budgets_are_commercial_not_general.sql";

const db = await new PGlite();

await db.exec(`
  create schema if not exists auth;
  create table auth.users (id uuid primary key, email text);
  do $$ begin
    if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
    if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
    if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin bypassrls; end if;
  end $$;
  create or replace function auth.uid() returns uuid
    language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
`);

await db.exec(readFileSync("supabase/schema.sql", "utf8"));
// time.project_contract_period and time.contract_period_status live here, not
// in schema.sql -- the same drift the schema file documents at its permission
// catalogue. The migration's `alter view` targets the view, so it has to exist.
await db.exec(readFileSync("supabase/migrations/add_contract_periods.sql", "utf8"));
console.log("loaded: schema.sql + add_contract_periods.sql\n");

/* ------------------------------------------------------------------ fixtures */

const USERS = {
  exec: "10000000-0000-0000-0000-000000000001",
  dept_head: "10000000-0000-0000-0000-000000000002",
  project_manager: "10000000-0000-0000-0000-000000000003",
  employee: "10000000-0000-0000-0000-000000000004",
  hr: "10000000-0000-0000-0000-000000000005",
  sales: "10000000-0000-0000-0000-000000000006",
  // Holds the sales role but is DEACTIVATED. app_user_role() filters on
  // is_active, so this account must read nothing -- the property every helper
  // in this schema depends on, asserted here rather than assumed.
  sales_inactive: "10000000-0000-0000-0000-000000000007",
};

await db.exec(`
  insert into auth.users (id, email) values
    ${Object.entries(USERS).map(([r, id]) => `('${id}', '${r}@example.test')`).join(",\n    ")};

  insert into people (id, name, department, is_active) values
    ('p-exec', 'Exec Person', 'ORGA', true),
    ('p-head', 'Head Person', 'SAFETY', true),
    ('p-pm',   'PM Person',   'SAFETY', true),
    ('p-emp',  'Emp Person',  'SAFETY', true),
    ('p-hr',   'HR Person',   'ORGA', true),
    ('p-sales','Sales Person','ORGA', true);

  -- A project with a real, non-zero budget on every surface that carries one.
  insert into projects
    (id, code, name, customer, lead, status, contract_hours, billable_hours,
     consumed_percent, due, logged_hours, owner_person_id, department, budget_hours)
    values ('prj-budget', 'B-1', 'Budgeted project', 'A customer', 'Head Person',
            'active', 400, 120, 30, '2026-12-31', 120, 'p-emp', 'SAFETY', 400);

  -- "overriding system value" is required: these ids are GENERATED ALWAYS
  -- identities, and the fixture needs stable ids to join on.
  insert into time.customer (id, name) overriding system value values (900, 'A customer');
  insert into time.project (id, name, customer_id, estimated_hours, is_billable, is_archived, hub_project_id)
    overriding system value
    values (900, 'Budgeted project', 900, 400, true, false, 'prj-budget');
  insert into time.project_contract_period
    (project_id, period_no, budget_hours, starts_on, ends_on, contract_reference)
    values (900, 1, 400, current_date - 30, current_date + 30, 'CT-900');
`);

const PERSON_OF = { exec: "p-exec", dept_head: "p-head", project_manager: "p-pm", employee: "p-emp", hr: "p-hr", sales: "p-sales" };

/*
 * The five roles that exist BEFORE the migration. `sales` is deliberately not
 * among them: app_user_profile.role_key is a real foreign key into app_role, so
 * a sales profile cannot exist until the migration creates the role -- which is
 * itself worth proving, and would be papered over by seeding the role up front.
 */
const profileRows = ["exec", "dept_head", "project_manager", "employee", "hr"]
  .map((role) => `('${USERS[role]}', '${role}', '${PERSON_OF[role]}', true)`)
  .join(",\n    ");

/* ------------------------------------------- the world BEFORE the migration */

await db.exec(`
  -- The two roles schema.sql does not seed but production carries.
  insert into app_role (role_key, display_name, seniority)
    values ('hr', 'HR', 3) on conflict (role_key) do nothing;

  insert into app_user_profile (user_id, role_key, person_id, is_active) values
    ${profileRows};

  -- Reverse this migration, so the assertions below run against the system as
  -- it stood on 2026-09-03 rather than against the fix asserting itself. The
  -- role goes too: it did not exist this morning.
  delete from app_role_permission where role_key = 'sales';
  delete from app_role where role_key = 'sales';
  insert into app_role_permission (role_key, permission_key) values
    ('employee', 'projects:contracts:read'),
    ('project_manager', 'projects:contracts:read'),
    ('hr', 'projects:contracts:read'),
    -- hr:contract:read is EMPLOYMENT contracts and production grants it to hr.
    -- Seeded here because schema.sql seeds no hr grants at all, and without it
    -- the "hr keeps its employment-contract key" assertion below would be
    -- asserting against an absence rather than against the migration.
    ('hr', 'hr:contract:read')
  on conflict do nothing;
`);

// The un-redacted view, verbatim in shape from production before the change.
await db.exec(`
  create or replace view time.project_summary
  with (security_invoker = true) as
  select p.id as project_id, p.name as project_name, p.is_billable, p.is_archived,
         c.id as customer_id, c.name as customer_name,
         p.estimated_hours::numeric(10,2) as estimated_hours,
         coalesce(sum(e.duration_seconds), 0) as total_seconds,
         coalesce(sum(e.duration_seconds) filter (where e.is_billable), 0) as billable_seconds,
         coalesce(sum(e.duration_seconds) filter (where e.is_calendar), 0) as calendar_seconds,
         count(e.id) as entry_count, count(distinct e.member_id) as member_count,
         max(e.started_at) as last_activity_at,
         case when coalesce(p.estimated_hours, 0) > 0
              then round((coalesce(sum(e.duration_seconds), 0) / 3600.0)
                         / nullif(p.estimated_hours, 0) * 100, 1) end as burn_percent
    from time.project p
    left join time.customer c on c.id = p.customer_id
    left join time.entry e on e.project_id = p.id and e.duration_seconds is not null and e.started_at <= now()
   group by p.id, p.name, p.is_billable, p.is_archived, c.id, c.name, p.estimated_hours;
  grant select on time.project_summary to authenticated;

  -- Owner rights, exactly as production still has it: the merged-but-unpasted
  -- 20260903090000 is what this reproduces.
  alter view time.contract_period_status set (security_invoker = false);
`);

/* ----------------------------------------------------------------- probing */

/** Read every budget surface as one user, through `authenticated`. */
async function readAs(userId) {
  await db.exec("begin");
  await db.query(`select set_config('request.jwt.claim.sub', $1, true)`, [userId]);
  await db.exec("set local role authenticated");
  const out = {};
  for (const [key, sql] of [
    ["contractPeriods", `select count(*)::int n from "time".project_contract_period where budget_hours > 0`],
    ["periodStatus", `select count(*)::int n from "time".contract_period_status where budget_hours > 0`],
    ["summaryBudgets", `select count(*)::int n from "time".project_summary where estimated_hours > 0`],
    ["summaryBurn", `select count(*)::int n from "time".project_summary where burn_percent is not null`],
  ]) {
    try {
      out[key] = (await db.query(sql)).rows[0].n;
    } catch (e) {
      out[key] = `ERR(${String(e.message).slice(0, 40)})`;
    }
  }
  await db.exec("rollback");
  return out;
}

const total = (r) => (typeof r.contractPeriods === "number" ? r.contractPeriods : 0) + (typeof r.periodStatus === "number" ? r.periodStatus : 0) + (typeof r.summaryBudgets === "number" ? r.summaryBudgets : 0);

/* --------------------------------------------------- NEGATIVE CONTROL first */

console.log("NEGATIVE CONTROL — the leak must be present BEFORE the migration\n");

const PRE_ROLES = ["exec", "dept_head", "project_manager", "employee", "hr"];
const before = {};
for (const role of PRE_ROLES) before[role] = await readAs(USERS[role]);
console.table(before);

for (const role of ["employee", "project_manager", "hr"]) {
  check(
    `[control] ${role} CAN read budgets before the migration`,
    total(before[role]) > 0,
    `contract periods ${before[role].contractPeriods}, view ${before[role].periodStatus}, summary ${before[role].summaryBudgets}`,
  );
}
check(
  "[control] the un-redacted project_summary leaks a budget to employee",
  before.employee.summaryBudgets > 0,
  `summaryBudgets=${before.employee.summaryBudgets}`,
);
// A uuid with no profile row at all: app_user_role() returns NULL for it, so
// every policy refuses it. The owner-rights view answered anyway.
const NO_PROFILE = "10000000-0000-0000-0000-0000000000ff";
const stranger = await readAs(NO_PROFILE);
check(
  "[control] the owner-rights contract_period_status leaks to a caller with NO profile",
  stranger.periodStatus > 0 && stranger.contractPeriods === 0,
  `view returned ${stranger.periodStatus} where the table returned ${stranger.contractPeriods}`,
);
check(
  "[control] the un-redacted project_summary leaks to a caller with NO profile",
  stranger.summaryBudgets > 0,
  `summaryBudgets=${stranger.summaryBudgets}`,
);
check(
  "[control] sales cannot exist before the migration",
  (await db.query(`select count(*)::int n from app_role where role_key = 'sales'`)).rows[0].n === 0,
);

/* ------------------------------------------------------- apply it. Twice. */

const migrationSql = readFileSync(MIGRATION, "utf8");

for (const pass of [1, 2]) {
  try {
    await db.exec(migrationSql);
    console.log(`\nmigration pass ${pass}: executed with no errors`);
  } catch (e) {
    check(`migration pass ${pass} executes`, false, e.message);
    break;
  }

  if (pass === 1) {
    check(
      "the migration created the sales role",
      (await db.query(`select count(*)::int n from app_role where role_key = 'sales'`)).rows[0].n === 1,
    );
    // Only assignable now that the role exists -- which is the point of doing
    // it here rather than with the rest of the fixture.
    await db.exec(`
      insert into app_user_profile (user_id, role_key, person_id, is_active) values
        ('${USERS.sales}', 'sales', 'p-sales', true),
        ('${USERS.sales_inactive}', 'sales', 'p-sales', false);
    `);
  }

  // The profiles are re-seeded on pass 2 only if the migration removed them,
  // which it must not. Asserting the role assignments survive a re-run is part
  // of "idempotent", not a separate concern.
  const after = {};
  for (const role of Object.keys(USERS)) after[role] = await readAs(USERS[role]);
  console.log(`\nAFTER PASS ${pass} — budget rows visible per role`);
  console.table(after);

  for (const role of ["exec", "dept_head", "sales"]) {
    check(
      `pass ${pass}: ${role} still reads budgets`,
      after[role].contractPeriods > 0 && after[role].periodStatus > 0 && after[role].summaryBudgets > 0,
      `periods ${after[role].contractPeriods}, view ${after[role].periodStatus}, summary ${after[role].summaryBudgets}, burn ${after[role].summaryBurn}`,
    );
  }

  for (const role of ["employee", "project_manager", "hr"]) {
    check(
      `pass ${pass}: ${role} reads NO budget on any surface`,
      total(after[role]) === 0 && after[role].summaryBurn === 0,
      `periods ${after[role].contractPeriods}, view ${after[role].periodStatus}, summary ${after[role].summaryBudgets}, burn ${after[role].summaryBurn}`,
    );
  }

  check(
    `pass ${pass}: a DEACTIVATED sales account reads no budget`,
    total(after.sales_inactive) === 0,
    `periods ${after.sales_inactive.contractPeriods}, view ${after.sales_inactive.periodStatus}, summary ${after.sales_inactive.summaryBudgets}`,
  );

  // The non-budget half of project_summary must survive for everyone: a person
  // who may not see the budget may still see the project and its logged hours.
  await db.exec("begin");
  await db.query(`select set_config('request.jwt.claim.sub', $1, true)`, [USERS.employee]);
  await db.exec("set local role authenticated");
  const rows = await db.query(`select project_name, total_seconds, estimated_hours, burn_percent from "time".project_summary`);
  await db.exec("rollback");
  check(
    `pass ${pass}: employee still sees the project itself, only the budget is gone`,
    rows.rows.length === 1 &&
      rows.rows[0].project_name === "Budgeted project" &&
      rows.rows[0].estimated_hours === null &&
      rows.rows[0].burn_percent === null,
    JSON.stringify(rows.rows[0] ?? null),
  );

  const { rows: grants } = await db.query(
    `select role_key from app_role_permission where permission_key = 'projects:contracts:read' order by role_key`,
  );
  check(
    `pass ${pass}: projects:contracts:read is held by exactly dept_head, exec, sales`,
    grants.map((g) => g.role_key).join(",") === "dept_head,exec,sales",
    grants.map((g) => g.role_key).join(",") || "(none)",
  );

  const { rows: write } = await db.query(
    `select role_key from app_role_permission where permission_key = 'projects:contracts:write' order by role_key`,
  );
  check(
    `pass ${pass}: projects:contracts:write is UNCHANGED (dept_head, exec)`,
    write.map((g) => g.role_key).join(",") === "dept_head,exec",
    write.map((g) => g.role_key).join(",") || "(none)",
  );

  // hr:contract:read is EMPLOYMENT contracts. Different data, different
  // decision, explicitly out of scope -- asserted so a later edit cannot
  // quietly fold it in.
  const { rows: hrc } = await db.query(
    `select role_key from app_role_permission where permission_key = 'hr:contract:read' order by role_key`,
  );
  check(
    `pass ${pass}: hr:contract:read is UNTOUCHED (exec, hr)`,
    hrc.map((g) => g.role_key).join(",") === "exec,hr",
    hrc.map((g) => g.role_key).join(",") || "(none)",
  );

  const { rows: salesPerms } = await db.query(
    `select permission_key from app_role_permission where role_key = 'sales' order by permission_key`,
  );
  const salesKeys = salesPerms.map((p) => p.permission_key);
  check(
    `pass ${pass}: sales holds 9 keys and no write permission over projects`,
    salesKeys.length === 9 &&
      salesKeys.includes("projects:contracts:read") &&
      !salesKeys.some((k) => k === "projects:contracts:write" || k === "projects:write"),
    salesKeys.join(", "),
  );

  const { rows: opts } = await db.query(
    `select reloptions from pg_class where relname = 'contract_period_status'`,
  );
  check(
    `pass ${pass}: contract_period_status is security_invoker`,
    (opts[0]?.reloptions ?? []).includes("security_invoker=true"),
    JSON.stringify(opts[0]?.reloptions ?? null),
  );
}

console.log(failed ? "\nFAILED" : "\nAll budget-visibility migration checks passed");
process.exit(failed ? 1 : 0);
