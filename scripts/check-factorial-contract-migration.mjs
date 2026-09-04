/*
 * Runs 20260903150000_factorial_contract_version.sql in PGlite TWICE (house
 * rule) and then attacks it — mirrors check-factorial-identity-migration.mjs
 * for the sibling migration.
 *
 * "It executed without error" is not evidence the RLS policy actually
 * discriminates. This repo just measured a live case (the budget-visibility
 * hole, PR #30) where a migration's own gates only ever exercised the views
 * that were correctly redacted and never touched the base table, so the gate
 * stayed green while a real leak sat open. The assertions below therefore
 * test BOTH directions of the exec-only policy under `set role authenticated`
 * with `public.app_user_role()` actually varying, not a function hardcoded to
 * return 'exec' — a hardcoded-exec stub would prove the policy exists without
 * ever proving it excludes anyone.
 *
 * Run: node scripts/check-factorial-contract-migration.mjs
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";

const REPO = fileURLToPath(new URL("..", import.meta.url));
const sql = readFileSync(
  join(REPO, "supabase/migrations/20260903150000_factorial_contract_version.sql"),
  "utf8",
);

const db = await new PGlite();

let failures = 0;
const check = (l, ok, d = "") => { console.log(`${ok ? "PASS" : "FAIL"}: ${l}${d ? ` — ${d}` : ""}`); if (!ok) failures += 1; };

/* ------------------------------------------- the minimum live-shaped schema */

await db.exec(`
  create schema crm;
  do $$
  begin
    if not exists (select 1 from pg_roles where rolname = 'anon') then
      create role anon nologin;
    end if;
    if not exists (select 1 from pg_roles where rolname = 'authenticated') then
      create role authenticated nologin;
    end if;
    if not exists (select 1 from pg_roles where rolname = 'service_role') then
      create role service_role nologin bypassrls;
    end if;
  end $$;
  grant usage on schema crm to authenticated, service_role;

  -- The sibling migration this one alters — a miniature, not the full thing.
  create table crm.factorial_identity_review (
    id uuid primary key default gen_random_uuid(),
    factorial_employee_id text not null,
    factorial_company_id  text not null,
    factorial_active      boolean,
    status                text not null,
    status_reason         text not null,
    unique (factorial_company_id, factorial_employee_id)
  );
  insert into crm.factorial_identity_review
    (factorial_employee_id, factorial_company_id, status, status_reason, factorial_active)
  values ('probe-emp', 'c1', 'resolved_auto', 'seeded for the migration test', true);

  -- A REAL app_user_role(), not a stub hardcoded to 'exec': it reads a session
  -- GUC so the test below can flip roles and prove the policy discriminates,
  -- not merely that it exists.
  create function public.app_user_role() returns text language sql stable as $$
    select nullif(current_setting('app.test_role', true), '')
  $$;
`);

/* ---------------------------------------------------------- run it, twice */

for (const pass of [1, 2]) {
  try { await db.exec(sql); console.log(`\nrun ${pass}: executed`); }
  catch (e) {
    check(`run ${pass} executes`, false, e.message.split("\n")[0]);
    console.log("\nAborting: nothing below can be judged if the migration did not run.");
    process.exit(1);
  }
}

/* ------------------------------------------------------- shape assertions */

const cols = async (schema, table) => (await db.query(
  `select column_name, data_type, udt_name from information_schema.columns
    where table_schema=$1 and table_name=$2`, [schema, table])).rows;

const cv = Object.fromEntries((await cols("crm", "factorial_contract_version")).map((r) => [r.column_name, r]));
console.log("");
check("factorial_employee_id column exists", "factorial_employee_id" in cv);
check("working_hours_centihours is integer (not the vendor's misleading working_hours name)",
  cv.working_hours_centihours?.data_type === "integer");
check("working_time_percentage_in_cents column exists (the cross-check field)",
  "working_time_percentage_in_cents" in cv);
check("maximum_weekly_hours_centihours is named for its unit, not maximum_weekly_hours",
  "maximum_weekly_hours_centihours" in cv && !("maximum_weekly_hours" in cv));
check("salary_amount / salary_frequency were never added to this table",
  !("salary_amount" in cv) && !("salary_frequency" in cv));
check("working_week_days is an array (a day count must not be a string compare)",
  cv.working_week_days?.data_type === "ARRAY");

const uniq = (await db.query(`
  select conname from pg_constraint
   where conrelid = 'crm.factorial_contract_version'::regclass and contype = 'u'`)).rows;
check("factorial_employee_id is UNIQUE (one row per employee, upsert target)", uniq.length >= 1);

const idx = (await db.query(
  `select indexname from pg_indexes where schemaname='crm' and tablename='factorial_contract_version'`)).rows;
check("the employee index exists",
  idx.some((i) => i.indexname === "factorial_contract_version_employee_idx"),
  JSON.stringify(idx.map((i) => i.indexname)));

const rir = Object.fromEntries((await cols("crm", "factorial_identity_review")).map((r) => [r.column_name, r]));
check("terminated_on was added to the identity review row", rir.terminated_on?.data_type === "date");

const rls = (await db.query(
  `select relrowsecurity from pg_class where oid='crm.factorial_contract_version'::regclass`)).rows[0];
check("RLS is enabled on the contract table", rls.relrowsecurity === true,
  "it holds a person's contracted weekly hours");

const pol = (await db.query(
  `select policyname from pg_policies where schemaname='crm' and tablename='factorial_contract_version'`)).rows;
check("exactly one exec-only policy exists (idempotent across two runs, not doubled)",
  pol.length === 1, JSON.stringify(pol.map((p) => p.policyname)));

/* ================= the policy must actually discriminate, both directions ================= */

console.log("\n--- the exec-only policy must actually refuse a non-exec, not merely exist");

await db.exec(`
  grant select, insert, update, delete on crm.factorial_contract_version to authenticated, service_role;
  insert into crm.factorial_contract_version
    (factorial_employee_id, working_hours_centihours, working_hours_frequency)
  values ('probe-emp', 4000, 'week');
`);

const asRole = async (role, testRole, sql) => {
  await db.exec(`set role ${role};`);
  if (testRole !== undefined) await db.exec(`set app.test_role = '${testRole}';`);
  try {
    const r = await db.query(sql);
    return { ok: true, rows: r.rows };
  } catch (e) {
    return { ok: false, error: e.message.split("\n")[0] };
  } finally {
    await db.exec("reset role; reset app.test_role;");
  }
};

const asExec = await asRole("authenticated", "exec", "select * from crm.factorial_contract_version");
check("exec CAN read the contract table", asExec.ok && asExec.rows.length === 1,
  asExec.ok ? `rows: ${asExec.rows.length}` : asExec.error);

const asEmployee = await asRole("authenticated", "employee", "select * from crm.factorial_contract_version");
check("a plain employee reads ZERO rows — the policy excludes them, not merely permits exec",
  asEmployee.ok && asEmployee.rows.length === 0,
  asEmployee.ok ? `rows: ${asEmployee.rows.length} — LEAK if > 0` : asEmployee.error);

const asNull = await asRole("authenticated", undefined, "select * from crm.factorial_contract_version");
check("an authenticated session with NO resolved role reads ZERO rows (fails closed)",
  asNull.ok && asNull.rows.length === 0,
  asNull.ok ? `rows: ${asNull.rows.length} — LEAK if > 0` : asNull.error);

const writeAsEmployee = await asRole("authenticated", "employee", `
  insert into crm.factorial_contract_version (factorial_employee_id, working_hours_centihours)
  values ('probe-employee-write', 4000)
`);
check("a plain employee CANNOT insert a contract row",
  !writeAsEmployee.ok, writeAsEmployee.ok ? "INSERT SUCCEEDED — the with-check clause is missing or too loose" : writeAsEmployee.error);

/* ================================================ upsert / idempotency shape ================================================ */

console.log("\n--- upsert target must be usable exactly as the sync script will use it");

await db.exec(`set role service_role;`);
await db.exec(`
  insert into crm.factorial_contract_version
    (factorial_employee_id, working_hours_centihours, working_hours_frequency, working_time_percentage_in_cents)
  values ('probe-emp', 2000, 'week', 5000)
  on conflict (factorial_employee_id) do update
    set working_hours_centihours = excluded.working_hours_centihours,
        working_hours_frequency  = excluded.working_hours_frequency,
        last_seen_at             = now()
`);
const after = (await db.query(
  `select working_hours_centihours, working_hours_frequency from crm.factorial_contract_version where factorial_employee_id = 'probe-emp'`,
)).rows[0];
check("on conflict (factorial_employee_id) do update actually updates in place, not a duplicate row",
  after?.working_hours_centihours === 2000 && after?.working_hours_frequency === "week",
  JSON.stringify(after));
const rowCount = (await db.query(
  `select count(*)::int as n from crm.factorial_contract_version where factorial_employee_id = 'probe-emp'`,
)).rows[0].n;
check("still exactly one row for that employee after the upsert", rowCount === 1, `rows: ${rowCount}`);
await db.exec("reset role;");

console.log(failures === 0
  ? "\nMIGRATION IS SAFE TO PASTE: idempotent, and the exec-only policy actually discriminates"
  : `\n${failures} check(s) failed — DO NOT PASTE`);
process.exit(failures === 0 ? 0 : 1);
