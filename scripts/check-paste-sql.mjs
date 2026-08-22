/**
 * Prove the combined paste file executes as ONE script against real Postgres,
 * because that is exactly what the user is about to do in the SQL editor.
 *
 * Testing the two migrations separately was not sufficient: concatenating them
 * introduces its own failure modes (ordering, a stray statement outside a
 * transaction, a dollar-quoted body broken by the join). Run it as one blob,
 * twice, then assert the same properties the separate gates assert.
 */
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";

let failed = 0;
const check = (name, ok, detail = "") => {
  if (!ok) failed += 1;
  console.log(`${ok ? "PASS" : "FAIL"}: ${name}${detail ? ` — ${detail}` : ""}`);
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

const schema = readFileSync("supabase/schema.sql", "utf8");
const overbooking = readFileSync("supabase/migrations/add_overbooking_alerts.sql", "utf8");
const paste = readFileSync("supabase/APPLY-IN-SQL-EDITOR.sql", "utf8");

const fresh = async () => {
  const db = await new PGlite();
  await db.exec(preamble);
  await db.exec(schema);
  await db.exec(overbooking);
  return db;
};

const db = await fresh();
console.log("base schema + prerequisite applied\n");

// THE TEST: one paste, as the user will do it.
try {
  await db.exec(paste);
  check("the combined file executes as ONE paste", true);
} catch (e) {
  check("the combined file executes as ONE paste", false, String(e.message).split("\n")[0]);
  console.log("\nPASTE FILE: FAILED — do not hand this to the user");
  process.exit(1);
}

// And again, because a user who is unsure will run it twice.
{
  const d2 = await fresh();
  await d2.exec(paste);
  let ok = true;
  let detail = "";
  try {
    await d2.exec(paste);
  } catch (e) {
    ok = false;
    detail = String(e.message).split("\n")[0];
  }
  await d2.close();
  check("running the whole paste TWICE is safe", ok, detail);
}

const one = async (sql) => (await db.query(sql)).rows[0];
const all = async (sql) => (await db.query(sql)).rows;

/* --------------------------- the things the user's step 2 depends on */

check(
  "the contract period table exists",
  (await one(`select count(*)::int n from information_schema.tables
              where table_schema='time' and table_name='project_contract_period'`)).n === 1,
);
check(
  "the contract status view exists",
  (await one(`select count(*)::int n from information_schema.views
              where table_schema='time' and table_name='contract_period_status'`)).n === 1,
);
check(
  "the alert feed view exists",
  (await one(`select count(*)::int n from information_schema.views
              where table_schema='public' and table_name='budget_alert_feed'`)).n === 1,
);

const perms = await all(`
  select permission_key from public.app_permission
  where permission_key in ('projects:contracts:read','projects:contracts:write',
                           'projects:alerts:read','projects:alerts:acknowledge')
  order by permission_key
`);
check(
  "all FOUR permission keys the user was missing now exist",
  perms.length === 4,
  perms.map((p) => p.permission_key).join(", "),
);

/*
 * THE USER'S ACTUAL COMPLAINT, as a test. An exec was refused because
 * projects:alerts:read did not exist. Assert exec holds it after this paste.
 */
const execAlerts = await all(`
  select permission_key from public.app_role_permission
  where role_key = 'exec'
    and permission_key in ('projects:alerts:read','projects:contracts:write')
  order by permission_key
`);
check(
  "exec now holds alerts:read AND contracts:write (the refusal the user hit)",
  execAlerts.length === 2,
  execAlerts.map((p) => p.permission_key).join(", "),
);

check(
  "the anti-spam alert index exists",
  (await one(`select count(*)::int n from pg_indexes
              where tablename='overbooking_alert' and indexname='overbooking_alert_open_unique'`)).n === 1,
);
check(
  "the no-overlap trigger is installed",
  (await one(`select count(*)::int n from pg_trigger
              where tgname='contract_period_no_overlap' and not tgisinternal`)).n === 1,
);
check(
  "the renewal function exists",
  (await one(`select count(*)::int n from pg_proc p join pg_namespace ns on ns.oid=p.pronamespace
              where ns.nspname='time' and p.proname='renew_contract_period'`)).n === 1,
);

// Nothing the vendor sync owns was touched.
const est = await one(`select count(*)::int n from information_schema.columns
                       where table_schema='time' and table_name='project' and column_name='estimated_hours'`);
check("time.project.estimated_hours still exists untouched", est.n === 1);

await db.close();
console.log(
  failed === 0
    ? "\nPASTE FILE: executes as one paste, twice, and delivers everything step 2 needs"
    : `\n${failed} check(s) failed`,
);
process.exit(failed === 0 ? 0 : 1);
