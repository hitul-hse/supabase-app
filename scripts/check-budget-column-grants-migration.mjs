/**
 * Does 20260903230000 actually close the base-table budget leak, and can it be
 * pasted twice?
 *
 * WHY THIS EXISTS SEPARATELY FROM check-budget-permission-enforced.mjs
 * -------------------------------------------------------------------
 * That gate asks whether the APP gates its reads. This one asks whether the
 * DATABASE would still hand the column over to somebody who went around the
 * app entirely -- which is what actually happened: `time` is in
 * pgrst.db_schemas, so `supabase.schema('time').from('project')
 * .select('estimated_hours')` was a routable call for any signed-in user.
 *
 * TWO POSTGRES FACTS THIS GATE PINS DOWN, because both were nearly shipped wrong
 * ----------------------------------------------------------------------------
 * 1. `revoke select (col) on t from role` is a NO-OP against a table-level
 *    `grant select on t to role`. The negative control below proves the gate
 *    can tell the difference, so a future migration cannot "fix" this leak with
 *    the form that does nothing.
 * 2. Every logged-in Supabase user is the same `authenticated` role, so
 *    narrowing the grant narrows it for exec too. The privileged path therefore
 *    has to come back through a definer -- asserted here by reading the view as
 *    an exec and getting a real number.
 *
 * Run: node scripts/check-budget-column-grants-migration.mjs
 */
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";

let failed = false;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}: ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failed = true;
};

const MIGRATION = "supabase/migrations/20260903230000_budgets_are_not_readable_by_default.sql";

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

const EXEC = "30000000-0000-0000-0000-000000000001";
const EMP = "30000000-0000-0000-0000-000000000002";

await db.exec(`
  insert into auth.users (id, email) values
    ('${EXEC}', 'exec@example.test'), ('${EMP}', 'emp@example.test');
  insert into people (id, name, department, is_active) values
    ('p-x', 'Ex', 'ORGA', true), ('p-e', 'Emp', 'SAFETY', true);
  insert into app_user_profile (user_id, role_key, person_id, is_active) values
    ('${EXEC}', 'exec', 'p-x', true), ('${EMP}', 'employee', 'p-e', true);
  insert into time.customer (id, name) overriding system value values (801, 'C');
  insert into time.project (id, name, customer_id, estimated_hours, is_billable, is_archived)
    overriding system value values (801, 'P', 801, 400, true, false);
`);

/** Read something as a real signed-in user, always rolled back. */
async function asUser(userId, sql) {
  await db.exec("begin");
  await db.query(`select set_config('request.jwt.claim.sub', $1, true)`, [userId]);
  await db.exec("set local role authenticated");
  let out;
  try {
    out = { rows: (await db.query(sql)).rows, error: null };
  } catch (e) {
    out = { rows: null, error: e.message };
  }
  await db.exec("rollback");
  return out;
}

const BASE_READ = `select estimated_hours from "time".project where id = 801`;

/* ------------------------------------------------- before: the leak is real */

const before = await asUser(EMP, BASE_READ);
check(
  "[baseline] BEFORE the migration an employee reads the raw budget column",
  before.error === null && Number(before.rows?.[0]?.estimated_hours) === 400,
  before.error ? `unexpected error: ${before.error}` : `estimated_hours=${before.rows?.[0]?.estimated_hours}`,
);

/*
 * NEGATIVE CONTROL for the shape of the fix. The obvious migration --
 * `revoke select (estimated_hours) ...` on its own -- does NOTHING, because a
 * table-level grant already covers every column. If this assertion ever starts
 * failing, Postgres changed and the migration can be simplified; until then it
 * is the reason the real migration drops and re-grants instead.
 */
await db.exec(`revoke select (estimated_hours) on time.project from authenticated;`);
const naive = await asUser(EMP, BASE_READ);
check(
  "[control] a bare column REVOKE is a no-op against a table grant",
  naive.error === null && Number(naive.rows?.[0]?.estimated_hours) === 400,
  naive.error ? `blocked: ${naive.error.slice(0, 60)}` : "still readable, as expected — so that form is not a fix",
);

/* --------------------------------------------------- apply it, twice */

const sql = readFileSync(MIGRATION, "utf8");
let firstError = null;
let secondError = null;
try { await db.exec(sql); } catch (e) { firstError = e.message; }
check("the migration applies cleanly", firstError === null, firstError ?? "");
try { await db.exec(sql); } catch (e) { secondError = e.message; }
check(
  "the migration is idempotent — a second paste is harmless",
  secondError === null,
  secondError ?? "applied twice, no error",
);

/* --------------------------------------------------------- after: it is shut */

const afterEmp = await asUser(EMP, BASE_READ);
check(
  "an employee can no longer read time.project.estimated_hours at all",
  afterEmp.error !== null && /permission denied/i.test(afterEmp.error),
  afterEmp.error ? afterEmp.error.slice(0, 70) : `STILL READABLE: ${afterEmp.rows?.[0]?.estimated_hours}`,
);

const afterExec = await asUser(EXEC, BASE_READ);
check(
  "and neither can exec — the grant is role-wide, which is why the definer exists",
  afterExec.error !== null,
  afterExec.error ? afterExec.error.slice(0, 70) : "exec still reads the base column",
);

// The non-budget columns must survive, or every project list in the app breaks.
const cols = await asUser(EMP, `select id, name, is_billable from "time".project where id = 801`);
check(
  "the rest of the row is untouched — the project still lists",
  cols.error === null && cols.rows?.[0]?.name === "P",
  cols.error ? cols.error.slice(0, 70) : "id, name, is_billable all readable",
);

/* ------------------------------------- the view still serves the right thing */

const VIEW_READ = `select estimated_hours, burn_percent, project_name
                     from "time".project_summary where project_id = 801`;

const viewExec = await asUser(EXEC, VIEW_READ);
check(
  "exec reads the budget back through the view (the definer serves it)",
  viewExec.error === null && Number(viewExec.rows?.[0]?.estimated_hours) === 400,
  viewExec.error ? viewExec.error.slice(0, 70) : `estimated_hours=${viewExec.rows?.[0]?.estimated_hours}`,
);

const viewEmp = await asUser(EMP, VIEW_READ);
check(
  "an employee reads the project through the view but gets NO budget",
  viewEmp.error === null &&
    viewEmp.rows?.[0]?.estimated_hours === null &&
    viewEmp.rows?.[0]?.burn_percent === null &&
    viewEmp.rows?.[0]?.project_name === "P",
  viewEmp.error
    ? viewEmp.error.slice(0, 70)
    : `estimated=${viewEmp.rows?.[0]?.estimated_hours} burn=${viewEmp.rows?.[0]?.burn_percent} name=${viewEmp.rows?.[0]?.project_name}`,
);

// The view must STAY security_invoker. It joins time.entry, whose read policy is
// genuinely caller-scoped; making it owner-rights to solve the budget problem
// would leak every member's logged hours instead.
const { rows: opts } = await db.query(
  `select reloptions from pg_class where relname = 'project_summary'`,
);
check(
  "time.project_summary is still security_invoker",
  (opts[0]?.reloptions ?? []).includes("security_invoker=true"),
  JSON.stringify(opts[0]?.reloptions ?? null),
);

console.log(failed ? "\nFAILED" : "\nBase-table budget columns are closed, and the view still serves the permitted reader");
process.exit(failed ? 1 : 0);
