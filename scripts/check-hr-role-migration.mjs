/**
 * Execute the HR migration against a REAL Postgres (PGlite) before asking the
 * user to run it again.
 *
 * The first version of this migration failed on their database with
 * "null value in column resource of relation app_permission" — because I wrote
 * the INSERT without checking the table's NOT NULL columns. A gate that only
 * greps the SQL would not have caught that; only executing it does.
 *
 * This loads the real schema.sql, then applies the real migration on top, in
 * the same order the live database saw them.
 */
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";

let failed = 0;
const check = (name, ok, detail = "") => {
  if (!ok) failed += 1;
  console.log(`${ok ? "PASS" : "FAIL"}: ${name}${detail ? `\n        ${detail}` : ""}`);
};

// Same preamble the other schema gates use: schema.sql assumes Supabase's auth
// schema and roles exist.
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

const db = await new PGlite();
await db.exec(preamble);
await db.exec(readFileSync("supabase/schema.sql", "utf8"));
console.log("base schema applied\n");

// The migration under test. This is the step that failed for the user.
const migration = readFileSync("supabase/migrations/add_hr_role_and_profile_admin.sql", "utf8");
try {
  await db.exec(migration);
  check("the migration executes without error", true);
} catch (e) {
  check("the migration executes without error", false, e.message);
  console.log("\nHR MIGRATION: FAILED");
  process.exit(1);
}

// Idempotent: the user may re-run it after a partial failure, and this one DID
// fail partway on their database, so a safe re-run is not hypothetical.
//
// Run it on a SEPARATE database. A failed statement aborts the surrounding
// transaction in Postgres ("current transaction is aborted"), which would make
// every later assertion below fail for the wrong reason and hide the real state.
{
  const fresh = await new PGlite();
  await fresh.exec(preamble);
  await fresh.exec(readFileSync("supabase/schema.sql", "utf8"));
  await fresh.exec(migration);
  let reran = true;
  let detail = "";
  try {
    await fresh.exec(migration);
  } catch (e) {
    reran = false;
    detail = e.message;
  }
  await fresh.close();
  check("re-running it is safe (idempotent)", reran, detail);
}

/* ------------------------------------------------------------ the outcomes */

const role = await db.query(`select role_key, display_name, seniority from app_role where role_key = 'hr'`);
check("the hr role exists", role.rows.length === 1, JSON.stringify(role.rows[0]));

const perms = await db.query(
  `select permission_key, resource, action, module_key from app_permission
    where permission_key in ('admin:profiles:read','admin:profiles:write','admin:entries:write')
    order by permission_key`,
);
check("all three new permission keys exist", perms.rows.length === 3, `${perms.rows.length} found`);
check(
  "resource and action are populated on every one (the bug that failed)",
  perms.rows.every((r) => r.resource && r.action),
  perms.rows.map((r) => `${r.permission_key} -> ${r.resource}/${r.action}`).join(", "),
);
check(
  "they sit in the 'admin' resource group so /admin/roles shows them",
  perms.rows.every((r) => r.resource === "admin"),
);

const hrGrants = await db.query(`select permission_key from app_role_permission where role_key = 'hr' order by permission_key`);
const hrKeys = hrGrants.rows.map((r) => r.permission_key);
check("hr received grants", hrKeys.length > 0, `${hrKeys.length} permissions`);
check("hr can read every person (cross-departmental)", hrKeys.includes("people:read_all"));
check("hr can administer profiles", hrKeys.includes("admin:profiles:write"));
check("hr can correct time entries", hrKeys.includes("admin:entries:write"));
check("hr owns the leave/contract keys that were unused before", hrKeys.includes("hr:leave:approve") && hrKeys.includes("hr:contract:read"));

// The deliberate exclusions matter as much as the grants.
check("hr CANNOT grant itself permissions (no admin:roles:write)", !hrKeys.includes("admin:roles:write"));
check("hr has no commercial project access", !hrKeys.some((k) => k.startsWith("projects:")));
check("hr cannot export the overview", !hrKeys.includes("overview:export"));
check("hr cannot approve delivery workload", !hrKeys.includes("workload:approve"));

const execGrants = await db.query(`select permission_key from app_role_permission where role_key = 'exec'`);
const execKeys = execGrants.rows.map((r) => r.permission_key);
check("exec also got the new profile keys", execKeys.includes("admin:profiles:write") && execKeys.includes("admin:entries:write"));

/* --------------------------------------------------------------- the RLS */

const policies = await db.query(
  `select policyname, cmd from pg_policies where tablename = 'app_user_profile' order by policyname`,
);
const names = policies.rows.map((r) => r.policyname);
check(
  "the exec-only read policy was replaced by the permission-based one",
  names.includes("profile admins can read all profiles") && !names.includes("exec can read all profiles"),
  names.join(" | "),
);
check(
  "the exec-only update policy was replaced too",
  names.includes("profile admins can update profiles") && !names.includes("exec can update profiles"),
);
check(
  "INSERT and DELETE remain exec-only (creating a profile assigns a role)",
  names.includes("exec can insert profiles") && names.includes("exec can delete profiles"),
);

// A profile row must still be readable by its owner regardless of permissions.
check("the owner's own-profile read policy survives", names.includes("user can read own profile"));

await db.close();
console.log(failed === 0 ? "\nHR MIGRATION: executes cleanly and grants exactly what was intended" : `\n${failed} check(s) failed`);
process.exit(failed === 0 ? 0 : 1);
