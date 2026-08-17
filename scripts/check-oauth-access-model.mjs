/**
 * Enabling Google/Microsoft must NOT widen who can see HSE data.
 *
 * This is the question that matters about this feature. Google will happily
 * authenticate any gmail.com address on earth. If signing in were sufficient to
 * read data, adding that button would turn an admin-provisioned internal tool
 * into a public one.
 *
 * The claimed protection is that authentication and authorisation are separate:
 * OAuth creates an auth.users row, but every RLS policy resolves permissions
 * through app_user_profile, which only an administrator writes. An authenticated
 * stranger should therefore see exactly nothing.
 *
 * That is asserted in comments all over this repo. Here it is executed: a real
 * Postgres with the real schema, a session for a user who authenticated
 * successfully but has no profile, reading every sensitive table.
 */
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";

let failed = false;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}: ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failed = true;
};

const preamble = `
  create schema if not exists auth;
  create table auth.users (id uuid primary key, email text);
  do $$ begin
    if not exists (select 1 from pg_roles where rolname='anon') then create role anon nologin; end if;
    if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin; end if;
    -- Supabase provisions service_role; PGlite does not. schema.sql grants to it,
    -- so without this the whole file fails with 42704 before any policy exists.
    if not exists (select 1 from pg_roles where rolname='service_role') then create role service_role nologin bypassrls; end if;
  end $$;
  create or replace function auth.uid() returns uuid
    language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
`;

const db = await new PGlite();
await db.exec(preamble);
await db.exec(readFileSync("supabase/schema.sql", "utf8"));

// Mirror Supabase's default grants. This matters for the honesty of the test:
// without them every read fails with "permission denied for table", which looks
// like a pass ("the stranger saw nothing!") while actually proving nothing about
// RLS — the provisioned user is blocked identically. On a real Supabase project
// `authenticated` holds table privileges and RLS is the only thing deciding
// which ROWS come back, which is precisely the mechanism under test here.
await db.exec(`
  grant usage on schema public to authenticated;
  grant select, insert, update, delete on all tables in schema public to authenticated;
`);

// Two users. Both authenticated — as far as Supabase Auth is concerned they are
// identical. Only one has been provisioned by an admin.
const STRANGER = "99999999-9999-9999-9999-999999999999";
const STAFF = "11111111-1111-1111-1111-111111111111";

await db.exec(`
  insert into auth.users (id, email) values
    ('${STRANGER}', 'random.person@gmail.com'),
    ('${STAFF}',    'anna@hs-experts.com');

  insert into people (id, name, department, is_active)
    values ('p-anna', 'Anna Beck', 'HSE', true);

  -- Only the staff member gets a profile. This is the single act that grants
  -- access, and it is exactly what OAuth does NOT do.
  insert into app_user_profile (user_id, role_key, department, person_id, is_active)
    values ('${STAFF}', 'exec', 'HSE', 'p-anna', true);

  -- Some data worth protecting.
  insert into projects (id, code, name, customer, lead, status, due,
                        contract_hours, billable_hours, consumed_percent)
    values ('prj-1', 'P-1', 'Confidential Audit', 'Muster GmbH', 'Anna Beck', 'active',
            '2026-12-01', 100, 40, 40);
`);

/** Run a query as a given authenticated user, under RLS. */
async function asUser(userId, sql) {
  await db.exec("begin");
  await db.exec(`set local role authenticated`);
  await db.exec(`select set_config('request.jwt.claim.sub', '${userId}', true)`);
  let rows = [];
  let error = null;
  try {
    const res = await db.query(sql);
    rows = res.rows;
  } catch (e) {
    error = e.message;
  }
  await db.exec("rollback");
  return { rows, error };
}

console.log("A stranger who authenticated via Google but has no admin-provisioned profile:\n");

// ── The helper functions every policy depends on ───────────────────────────
const role = await asUser(STRANGER, "select app_user_role() as r");
check(
  "app_user_role() is null for an unprovisioned user",
  role.rows[0]?.r === null,
  `got ${JSON.stringify(role.rows[0]?.r)}`,
);

const personId = await asUser(STRANGER, "select app_user_person_id() as p");
check(
  "app_user_person_id() is null",
  personId.rows[0]?.p === null,
  `got ${JSON.stringify(personId.rows[0]?.p)}`,
);

const perm = await asUser(
  STRANGER,
  "select app_user_has_permission('timesheets:read_all') as ok",
);
check(
  "holds no permissions",
  perm.rows[0]?.ok === false,
  `got ${JSON.stringify(perm.rows[0]?.ok)}`,
);

// ── The data itself ────────────────────────────────────────────────────────
for (const table of [
  "people",
  "projects",
  "timesheet_entries",
  "app_user_profile",
  "leave_requests",
  "project_tasks",
]) {
  const res = await asUser(STRANGER, `select * from ${table}`);
  check(
    `reads 0 rows from ${table}`,
    res.error === null && res.rows.length === 0,
    res.error ? `error: ${res.error}` : `${res.rows.length} rows`,
  );
}

// A stranger must not be able to grant themselves a profile either. That would
// turn "sign in with Google" into "become an exec".
const escalate = await asUser(
  STRANGER,
  `insert into app_user_profile (user_id, role_key, is_active)
     values ('${STRANGER}', 'exec', true) returning user_id`,
);
check(
  "cannot self-provision a profile (no privilege escalation)",
  escalate.error !== null || escalate.rows.length === 0,
  escalate.error ? "blocked by RLS" : `INSERTED ${escalate.rows.length} row(s)`,
);

// And cannot promote themselves by updating an existing one.
const promote = await asUser(
  STRANGER,
  `update app_user_profile set user_id = '${STRANGER}' where role_key = 'exec' returning user_id`,
);
check(
  "cannot hijack an existing profile",
  promote.error !== null || promote.rows.length === 0,
  promote.error ? "blocked by RLS" : `UPDATED ${promote.rows.length} row(s)`,
);

// ── The positive control ───────────────────────────────────────────────────
// If the provisioned user ALSO saw nothing, the checks above would pass for the
// wrong reason: a schema that denies everybody proves nothing about OAuth.
console.log("\nThe same queries as an admin-provisioned staff member:\n");

const staffRole = await asUser(STAFF, "select app_user_role() as r");
check("positive control: provisioned user resolves to exec", staffRole.rows[0]?.r === "exec");

const staffProjects = await asUser(STAFF, "select * from projects");
check(
  "positive control: provisioned user DOES see projects",
  staffProjects.rows.length > 0,
  `${staffProjects.rows.length} rows`,
);

const staffPeople = await asUser(STAFF, "select * from people");
check(
  "positive control: provisioned user DOES see people",
  staffPeople.rows.length > 0,
  `${staffPeople.rows.length} rows`,
);

await db.close();

console.log(
  failed
    ? "\nOAUTH ACCESS MODEL: authenticating is NOT safely separated from authorisation"
    : "\nOAUTH ACCESS MODEL: signing in proves identity and grants nothing — safe to enable a public IdP",
);
process.exit(failed ? 1 : 0);
