/**
 * Do the permission toggles in /admin/roles actually decide anything?
 *
 * THE BUG THIS EXISTS TO PREVENT COMING BACK
 * ------------------------------------------
 * /admin/roles renders every row of app_permission as a live toggle. Of the 29
 * keys, only 8 were read anywhere in the application. The rest — including
 * "Approve Leave", "Manage User Accounts" and "View Workload Board" — were
 * checked by NOTHING: the routes that own those features gated on hardcoded role
 * strings instead, contradicting permissions.ts:4, which states the module exists
 * so the app "never hardcodes role strings inline".
 *
 * The failure mode is the worst kind. An administrator grants Approve Leave to a
 * project manager, the toggle turns green and saves, and the target user's access
 * does not change. Nothing errors. The UI reports success for an act that had no
 * effect — so the access model on screen is fiction, and the only way to discover
 * that is to test with a second account.
 *
 * WHY A GATE AND NOT JUST THE FIX: swapping a role-string check for a permission
 * check is only safe if the permission is actually GRANTED to everyone who has
 * access today. Get that backwards and the fix silently locks people out of their
 * own pages — a worse bug than the one being fixed, and one that shows up as
 * "the portal is broken" on a Monday morning. So the grants are asserted against
 * a real Postgres running schema.sql, and the wiring is asserted against source.
 *
 * Run: node scripts/check-permission-enforcement.mjs
 */
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";

let failed = false;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}: ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failed = true;
};

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

/**
 * Every access decision being moved off a role string, with the roles that hold
 * it TODAY. Each pair must be granted in the seed, or the switch removes access
 * from someone who currently has it.
 */
const REQUIRED_GRANTS = [
  ["admin:users:read", ["exec", "dept_head"]],
  ["admin:users:write", ["exec"]],
  ["workload:read", ["exec", "dept_head"]],
  ["workload:approve", ["exec", "dept_head"]],
  ["hr:leave:approve", ["exec", "dept_head"]],
  ["people:read_own", ["exec", "dept_head", "project_manager", "employee"]],
];

console.log("\nNobody loses access: every role that can reach a page today holds its key\n");

for (const [key, roles] of REQUIRED_GRANTS) {
  const { rows } = await db.query(
    `select role_key from app_role_permission where permission_key = $1 order by role_key`,
    [key],
  );
  const got = rows.map((r) => r.role_key);
  const missing = roles.filter((r) => !got.includes(r));
  check(
    `${key} is granted to ${roles.join(", ")}`,
    missing.length === 0,
    missing.length ? `MISSING for ${missing.join(", ")}` : `granted to ${got.join(", ")}`,
  );
}

console.log("\nThe keys that gate WRITES stay narrow — a widened grant is also a bug\n");

for (const [key, notAllowed] of [
  ["admin:users:write", ["dept_head", "project_manager", "employee"]],
  ["hr:leave:approve", ["project_manager", "employee"]],
  ["workload:approve", ["project_manager", "employee"]],
]) {
  const { rows } = await db.query(
    `select role_key from app_role_permission where permission_key = $1`,
    [key],
  );
  const got = rows.map((r) => r.role_key);
  const leaked = notAllowed.filter((r) => got.includes(r));
  check(`${key} is NOT held by ${notAllowed.join(", ")}`, leaked.length === 0, leaked.join(", "));
}

console.log("\nNegative control — the harness can see a grant that is absent\n");
{
  const { rows } = await db.query(
    `select role_key from app_role_permission where permission_key = 'does:not:exist'`,
  );
  check("an unknown key returns no grants", rows.length === 0);
}

console.log("\nThe wiring: each route asks the permission layer, not a role string\n");

const ROUTES = [
  ["src/app/(app)/admin/users/page.tsx", ["ADMIN_USERS_READ", "ADMIN_USERS_WRITE"]],
  ["src/app/(app)/team-lead/page.tsx", ["WORKLOAD_READ"]],
  ["src/app/(app)/leave/page.tsx", ["HR_LEAVE_APPROVE"]],
  ["src/app/(app)/people/page.tsx", ["PEOPLE_READ_OWN"]],
];

/**
 * Comments are stripped before the role-string checks. Without this the gate
 * fails on its own fix: the code that replaced `roleKey === "exec"` documents
 * what it replaced, and a regex over raw source cannot tell an explanation from
 * an access decision. Rough-and-ready (it would also cut "//" inside a string
 * literal), which is fine here — nothing below searches for URLs.
 */
const stripComments = (s) =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

for (const [file, keys] of ROUTES) {
  const raw = readFileSync(file, "utf8");
  const src = stripComments(raw);
  const name = file.split("/").slice(-2).join("/");

  for (const k of keys) {
    check(`${name} checks PERMISSIONS.${k}`, src.includes(`PERMISSIONS.${k}`));
  }

  // The exact shape of the bug: an allowedRoles array or a roleKey comparison
  // standing in for a permission.
  const roleArray = /requireProfile\([^)]*\[\s*"(exec|dept_head|project_manager|employee)"/s.test(src);
  const roleCompare = /roleKey\s*[=!]==\s*"(exec|dept_head|project_manager|employee)"/.test(src);
  check(`${name} does not gate on a hardcoded role list`, !roleArray, roleArray ? "requireProfile(..., [roles])" : "");
  check(`${name} does not gate on a roleKey comparison`, !roleCompare, roleCompare ? 'roleKey === "…"' : "");
}

console.log("\nNegative control — the old role-string shapes WOULD be caught\n");
{
  const OLD_ARRAY = `await requireProfile("/team-lead", ["exec", "dept_head"]);`;
  const OLD_COMPARE = `const canEdit = profile.roleKey === "exec";`;
  check(
    "a requireProfile role list is detected",
    /requireProfile\([^)]*\[\s*"(exec|dept_head)"/s.test(OLD_ARRAY),
  );
  check(
    "a roleKey comparison is detected",
    /roleKey\s*[=!]==\s*"(exec|dept_head)"/.test(OLD_COMPARE),
  );
}

console.log(
  failed
    ? "\nPERMISSION ENFORCEMENT: a toggle in /admin/roles still decides nothing\n"
    : "\nPERMISSION ENFORCEMENT: the routes ask the permission layer, and nobody loses access\n",
);

process.exitCode = failed ? 1 : 0;
