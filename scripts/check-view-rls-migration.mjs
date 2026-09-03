/*
 * House rule: a migration is executed in PGlite TWICE before anyone pastes it
 * into production, and the OUTCOME is asserted, not just "it did not throw".
 *
 * 20260903090000_contract_status_view_must_not_bypass_rls.sql puts
 * time.contract_period_status onto security_invoker, so the caller's own read
 * policy on time.project_contract_period decides which contract periods come
 * back instead of the view's postgres owner deciding for everyone.
 *
 * WHAT "SHOULD NOT SEE" MEANS HERE, precisely, because getting this wrong would
 * make the test a lie. The read policy on time.project_contract_period is
 * `app_user_has_permission('projects:contracts:read')`. It is NOT project- or
 * department-scoped: there is no per-project column in it, and inventing one in
 * the test would assert a boundary the database does not have. So the two
 * subjects below are the two the policy really distinguishes:
 *
 *   - a user whose ROLE holds the permission          -> must still see periods
 *   - a user whose role does not, and a DEACTIVATED   -> must see none
 *     user whose role does
 *
 * The deactivated case is the one that was live: app_user_role() filters on
 * is_active, so a deactivated account resolves to no role and no permission,
 * and on production a caller with no active profile still read all four
 * contract periods through this view while reading zero from the table.
 *
 * NEGATIVE CONTROL. Before the migration the view is put back into the state
 * measured on production today -- `reloptions = null`, via `reset
 * (security_invoker)` -- and the leak has to reproduce. If it does not, this
 * file is proving the absence of data rather than the presence of a fix, and it
 * fails.
 *
 * Also asserted, because it is how the August fix to budget_alert_feed could
 * have been undone: `create or replace view` with no WITH clause RESETS
 * reloptions to null. add_contract_periods.sql now carries the clause inline,
 * so replaying it must leave the view fixed.
 *
 * Run: npm run check:view-rls-migration
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, "..");
const read = (...p) => readFileSync(join(repo, ...p), "utf8");

const schema = read("supabase", "schema.sql");
const overbooking = read("supabase", "migrations", "add_overbooking_alerts.sql");
const contractPeriods = read("supabase", "migrations", "add_contract_periods.sql");
const alertVisibility = read("supabase", "migrations", "add_budget_alert_visibility.sql");
const migration = read("supabase", "migrations", "20260903090000_contract_status_view_must_not_bypass_rls.sql");

let failures = 0;
const check = (label, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}: ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures += 1;
};

const preamble = `
  create schema if not exists auth;
  create table auth.users (id uuid primary key, email text);
  do $$ begin
    if not exists (select 1 from pg_roles where rolname='anon') then create role anon nologin; end if;
    if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin; end if;
    if not exists (select 1 from pg_roles where rolname='service_role') then create role service_role nologin bypassrls; end if;
  end $$;
  create or replace function auth.uid() returns uuid
    language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
`;

const EXEC_ACTIVE = "11111111-1111-1111-1111-111111111111";   // role holds the permission
const EMP_ACTIVE = "22222222-2222-2222-2222-222222222222";    // role does not
const EXEC_OFF = "33333333-3333-3333-3333-333333333333";      // same role, deactivated

const seed = `
  insert into auth.users (id, email) values
    ('${EXEC_ACTIVE}', 'exec@example.test'),
    ('${EMP_ACTIVE}',  'employee@example.test'),
    ('${EXEC_OFF}',    'former.exec@example.test');

  insert into app_user_profile (user_id, role_key, is_active) values
    ('${EXEC_ACTIVE}', 'exec',     true),
    ('${EMP_ACTIVE}',  'employee', true),
    ('${EXEC_OFF}',    'exec',     false);

  -- The role that must NOT see contract periods. Every role holds
  -- projects:contracts:read on production today, which is exactly why the
  -- bypass was invisible there; revoking it from one role here is what makes
  -- the boundary observable at all.
  delete from app_role_permission
   where role_key = 'employee' and permission_key = 'projects:contracts:read';

  insert into time.customer (id, name) overriding system value values (1, 'ACME GmbH');
  insert into time.project (id, source_id, customer_id, name, estimated_hours)
    overriding system value values (1, 'tt-1', 1, '10303_ACME / 25/26 GU', 5);
  insert into time.project_contract_period
    (project_id, period_no, budget_hours, starts_on, ends_on, warn_at_percent, contract_reference)
  values (1, 1, 5,  '2025-07-01', '2026-06-30', 80, 'ACME-2025-GU'),
         (1, 2, 12, '2026-07-01', '2027-06-30', 80, 'ACME-2026-GU');
`;

const fresh = async () => {
  const db = await new PGlite();
  await db.exec(preamble);
  await db.exec(schema);
  // The same order the production database was built in: the alert table, the
  // contract periods it later references, then the alert feed view. All three
  // are needed because the migration re-asserts budget_alert_feed as well.
  await db.exec(overbooking);
  await db.exec(contractPeriods);
  await db.exec(alertVisibility);
  await db.exec(seed);
  return db;
};

/** Run one statement as `authenticated` with a JWT subject, the way PostgREST does. */
const asUser = async (db, sub, sql) => {
  await db.exec(`select set_config('request.jwt.claim.sub', '${sub}', false); set role authenticated;`);
  try {
    return { rows: (await db.query(sql)).rows, error: null };
  } catch (e) {
    return { rows: null, error: e.message };
  } finally {
    await db.exec("reset role;");
  }
};
const countAsUser = async (db, sub, rel) => {
  const r = await asUser(db, sub, `select count(*)::int as n from ${rel}`);
  return r.error ? `ERR ${r.error}` : r.rows[0].n;
};
const reloptions = async (db, schemaName, name) => (await db.query(
  `select coalesce(array_to_string(c.reloptions, ','), '(none)') as o
     from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = $1 and c.relname = $2`, [schemaName, name],
)).rows[0].o;
const columnsOf = async (db) => (await db.query(
  `select column_name from information_schema.columns
    where table_schema = 'time' and table_name = 'contract_period_status'
    order by ordinal_position`,
)).rows.map((r) => r.column_name).join(",");

/* ------------------------------------------------- 0. the shipped source file */

const shipped = await fresh();
check(
  "add_contract_periods.sql now creates the view WITH security_invoker inline",
  (await reloptions(shipped, "time", "contract_period_status")) === "security_invoker=true",
  `reloptions=${await reloptions(shipped, "time", "contract_period_status")}`,
);
const columnsBefore = await columnsOf(shipped);

/* --------------------------------------- 1. NEGATIVE CONTROL: reproduce the leak */

// Exactly the state measured on production: reloptions = null.
await shipped.exec("alter view time.contract_period_status reset (security_invoker);");
check(
  "negative control: the view is back in production's measured state (reloptions = null)",
  (await reloptions(shipped, "time", "contract_period_status")) === "(none)",
);

const leakTable = {
  "exec (active)": {
    view: await countAsUser(shipped, EXEC_ACTIVE, "time.contract_period_status"),
    table: await countAsUser(shipped, EXEC_ACTIVE, "time.project_contract_period"),
  },
  "employee (no permission)": {
    view: await countAsUser(shipped, EMP_ACTIVE, "time.contract_period_status"),
    table: await countAsUser(shipped, EMP_ACTIVE, "time.project_contract_period"),
  },
  "exec (deactivated)": {
    view: await countAsUser(shipped, EXEC_OFF, "time.contract_period_status"),
    table: await countAsUser(shipped, EXEC_OFF, "time.project_contract_period"),
  },
};
console.log("\nBEFORE the migration (view runs as its postgres owner):");
console.table(leakTable);

check(
  "negative control: a user with NO permission reads every contract period through the view",
  leakTable["employee (no permission)"].view === 2 && leakTable["employee (no permission)"].table === 0,
  `view=${leakTable["employee (no permission)"].view} table=${leakTable["employee (no permission)"].table}`,
);
check(
  "negative control: a DEACTIVATED account reads every contract period through the view",
  leakTable["exec (deactivated)"].view === 2 && leakTable["exec (deactivated)"].table === 0,
  `view=${leakTable["exec (deactivated)"].view} table=${leakTable["exec (deactivated)"].table}`,
);
check(
  "negative control: the TABLE was never leaking — RLS on it was always right",
  leakTable["exec (active)"].table === 2,
);

/* ------------------------------------------------ 2. run the migration, TWICE */

for (const pass of [1, 2]) {
  try {
    await shipped.exec(migration);
    console.log(`\nrun ${pass}: executed without error`);
  } catch (e) {
    check(`run ${pass}: the migration executes`, false, String(e.message).split("\n")[0]);
    break;
  }

  check(
    `run ${pass}: the view is security_invoker`,
    (await reloptions(shipped, "time", "contract_period_status")) === "security_invoker=true",
    `reloptions=${await reloptions(shipped, "time", "contract_period_status")}`,
  );

  const after = {
    "exec (active)": await countAsUser(shipped, EXEC_ACTIVE, "time.contract_period_status"),
    "employee (no permission)": await countAsUser(shipped, EMP_ACTIVE, "time.contract_period_status"),
    "exec (deactivated)": await countAsUser(shipped, EXEC_OFF, "time.contract_period_status"),
  };
  console.log(`run ${pass}: rows visible through the view now:`, after);

  check(
    `run ${pass}: a user whose role holds projects:contracts:read STILL sees the periods`,
    after["exec (active)"] === 2,
    `saw ${after["exec (active)"]} of 2 — a fix that breaks the Contracts panel is not a fix`,
  );
  check(
    `run ${pass}: a user whose role does not hold it sees none`,
    after["employee (no permission)"] === 0,
    `saw ${after["employee (no permission)"]}`,
  );
  check(
    `run ${pass}: a DEACTIVATED account sees none — is_active really removes the permission`,
    after["exec (deactivated)"] === 0,
    `saw ${after["exec (deactivated)"]}`,
  );

  // The silent-failure shape: RLS filtering everything is an empty set, not an
  // error. Assert the refused caller gets 0 rows AND no exception, because that
  // is what the app will see and it must not be mistaken for "no contracts".
  const refused = await asUser(shipped, EMP_ACTIVE, "select * from time.contract_period_status");
  check(
    `run ${pass}: the refused caller gets an empty set, not an error (the silent shape)`,
    refused.error === null && refused.rows.length === 0,
    refused.error ?? `${refused.rows.length} rows`,
  );

  // The permitted caller must still get real values, not nulls.
  const permitted = await asUser(shipped, EXEC_ACTIVE,
    "select period_no, budget_hours, contract_reference from time.contract_period_status order by period_no");
  check(
    `run ${pass}: the permitted caller still reads budgets and references`,
    permitted.error === null
      && Number(permitted.rows[0].budget_hours) === 5
      && permitted.rows[0].contract_reference === "ACME-2025-GU",
    permitted.error ?? JSON.stringify(permitted.rows[0]),
  );

  check(
    `run ${pass}: the view's column list is unchanged (the UI selects by name)`,
    (await columnsOf(shipped)) === columnsBefore,
  );

  const grant = await shipped.query(
    `select count(*)::int as n from information_schema.role_table_grants
      where table_schema = 'time' and table_name = 'contract_period_status'
        and grantee = 'authenticated' and privilege_type = 'SELECT'`);
  check(`run ${pass}: authenticated keeps its SELECT grant`, grant.rows[0].n === 1);

  const anonGrant = await shipped.query(
    `select count(*)::int as n from information_schema.role_table_grants
      where table_schema = 'time' and table_name = 'contract_period_status' and grantee = 'anon'`);
  check(`run ${pass}: anon holds nothing on the view`, anonGrant.rows[0].n === 0);

  const feed = await reloptions(shipped, "public", "budget_alert_feed");
  check(
    `run ${pass}: budget_alert_feed is (re-)asserted as security_invoker`,
    feed === "security_invoker=true",
    `reloptions=${feed}`,
  );
}

/* ------------------------- 3. replaying the source file must not un-fix it */

await shipped.exec(contractPeriods);
check(
  "replaying add_contract_periods.sql leaves security_invoker ON",
  (await reloptions(shipped, "time", "contract_period_status")) === "security_invoker=true",
  "`create or replace view` with no WITH clause resets reloptions to null — that is why the clause is inline",
);
// Checked with the DEACTIVATED account, not the permission-less employee:
// replaying that migration re-seeds projects:contracts:read onto every role,
// including the one this test had revoked it from, so the employee legitimately
// regains access. is_active is not something the migration can hand back.
check(
  "and the replay does not resurrect the leak",
  (await countAsUser(shipped, EXEC_OFF, "time.contract_period_status")) === 0,
);

await shipped.close();

console.log(failures === 0
  ? "\nMIGRATION IS SAFE TO PASTE (idempotent across two runs, and the leak is closed)"
  : `\n${failures} check(s) failed — DO NOT PASTE`);
process.exit(failures === 0 ? 0 : 1);
