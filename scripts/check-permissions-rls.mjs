// Coverage for the fine-grained RBAC permission system (supabase/schema.sql §3b).
//
// It lived in supabase/migrations/add_permission_system.sql until that turned
// out to be the cause of the outage described below — a separate file can be
// skipped, and was. schema.sql is now the only place these objects are defined.
//
// Why this file exists: the permission layer was the ONE feature shipped
// without a test gate, and it was also the one feature never applied to the
// live database — /admin/roles silently redirected every user home because
// app_user_has_permission() did not exist. A gate here means the next person
// finds that out from a red build instead of from a confused exec.
//
// Two properties are worth proving, and neither is obvious from reading the
// migration:
//
//  1. app_user_has_permission() must respect is_active. The migration's own
//     header comment claims it does, but the function body never mentions
//     is_active — it only calls app_user_role(). That is in fact safe, because
//     app_user_role() filters on is_active itself, so the protection is
//     inherited. This test pins that inheritance down, because it is the kind
//     of thing a later "simplification" of the helper would quietly break.
//
//  2. The seeded grants must match the privilege ladder the roles imply:
//     exec strictly dominates dept_head, and only exec may edit permissions.
//     A stray row in the seed could hand admin:roles:write to a dept_head.
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";

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

// One file, exactly as the Supabase SQL Editor would run it. Loading the old
// migration as well would now fail on duplicate policies, which is itself proof
// the two are no longer independent.
await db.exec(readFileSync("supabase/schema.sql", "utf8"));

const EXEC = "11111111-1111-1111-1111-111111111111";
const HEAD = "22222222-2222-2222-2222-222222222222";
const EMPLOYEE = "33333333-3333-3333-3333-333333333333";
const GONE = "44444444-4444-4444-4444-444444444444"; // deactivated exec

await db.exec(`
  insert into auth.users (id, email) values
    ('${EXEC}','exec@x.com'), ('${HEAD}','head@x.com'),
    ('${EMPLOYEE}','emp@x.com'), ('${GONE}','gone@x.com');

  insert into app_user_profile (user_id, person_id, role_key, department, is_active) values
    ('${EXEC}',     null, 'exec',      null,          true),
    ('${HEAD}',     null, 'dept_head', 'Engineering', true),
    ('${EMPLOYEE}', null, 'employee',  'Engineering', true),
    ('${GONE}',     null, 'exec',      null,          false);

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

const can = (uid, key) =>
  as(uid, async () => {
    const { rows } = await db.query(`select app_user_has_permission($1) as ok`, [key]);
    return rows[0].ok === true;
  });

// --- the function exists and is callable at all -----------------------------
// This is the check that would have caught the un-applied migration.

check("app_user_has_permission() exists and is callable", await can(EXEC, "overview:read"));

// --- the privilege ladder ---------------------------------------------------

check("exec can read the role matrix", await can(EXEC, "admin:roles:read"));
check("exec can WRITE the role matrix", await can(EXEC, "admin:roles:write"));
check("dept_head can read the role matrix", await can(HEAD, "admin:roles:read"));
check(
  "dept_head canNOT write the role matrix",
  (await can(HEAD, "admin:roles:write")) === false,
);
check(
  "an employee cannot read the role matrix",
  (await can(EMPLOYEE, "admin:roles:read")) === false,
);
check(
  "an employee cannot read all timesheets",
  (await can(EMPLOYEE, "timesheets:read_all")) === false,
);
check("an employee can submit their own timesheet", await can(EMPLOYEE, "timesheets:write"));

// --- exec strictly dominates dept_head -------------------------------------
// Every permission a dept_head holds, an exec must also hold. Otherwise a
// stray seed row has given a lower role something the top role lacks.

const { rows: dominance } = await db.query(`
  select rp.permission_key
  from app_role_permission rp
  where rp.role_key = 'dept_head'
    and not exists (
      select 1 from app_role_permission e
      where e.role_key = 'exec' and e.permission_key = rp.permission_key
    )
`);
check(
  "exec holds every permission dept_head holds",
  dominance.length === 0,
  dominance.length ? `dept_head-only: ${dominance.map((r) => r.permission_key).join(", ")}` : "",
);

// --- deactivation actually revokes ------------------------------------------
// The migration's header claims the helper "respects is_active". Its body does
// not mention is_active at all — the protection is inherited from
// app_user_role(). Pin that down.

check(
  "a DEACTIVATED exec has no permissions",
  (await can(GONE, "admin:roles:write")) === false,
);
check(
  "a DEACTIVATED exec cannot even read the overview",
  (await can(GONE, "overview:read")) === false,
);

// --- negative control ------------------------------------------------------
// Prove the is_active check above can actually fail. Strip is_active from
// app_user_role() and the deactivated exec should come back to life; if it
// does not, the test was never testing anything.

await db.exec(`
  create or replace function app_user_role() returns text
  language sql stable security definer set search_path = public as $$
    select role_key from app_user_profile where user_id = auth.uid();
  $$;
`);
check(
  "control: dropping is_active from app_user_role() DOES revive the deactivated exec",
  (await can(GONE, "admin:roles:write")) === true,
  "so the is_active assertions above are load-bearing, not vacuous",
);

// restore, so anything added after this point sees the real helper
await db.exec(`
  create or replace function app_user_role() returns text
  language sql stable security definer set search_path = public as $$
    select role_key from app_user_profile where user_id = auth.uid() and is_active;
  $$;
`);

// --- catalogue integrity ---------------------------------------------------
// Every granted permission must exist in the catalogue. The FK enforces this
// in Postgres, but the app also ships a TypeScript PERMISSIONS map, and the
// two drift silently — so assert the counts the app expects.

// Derived from the code, not a literal. This assertion used to hardcode 22, so
// adding a permission failed the gate for the wrong reason ("expected 22") and
// the fix was to bump a magic number — which trains you to edit the test rather
// than think about it. Counting the code's own keys means the only way to fail
// is a genuine mismatch between code and database, which is what the next two
// checks then name precisely.
//
// The module segment allows an underscore. It did not, and `my_work:read_own`
// was therefore invisible to this regex: the gate counted 36 keys where the
// file declares 37, then reported the database as holding one the code "does
// not know about" -- a real permission, granted to all four roles, hidden by
// the gate's own pattern. A scanner that silently skips what it cannot parse
// states a falsehood confidently, which is worse than failing.
const codeKeys = new Set(
  [...readFileSync("src/lib/permissions.ts", "utf8").matchAll(/"([a-z_]+:[a-z_:]+)"/g)].map(
    (m) => m[1],
  ),
);

const { rows: cat } = await db.query(`select count(*)::int as n from app_permission`);
check(
  "permission catalogue is seeded to match the code",
  cat[0].n === codeKeys.size,
  `DB has ${cat[0].n}, src/lib/permissions.ts declares ${codeKeys.size}`,
);
const { rows: dbKeys } = await db.query(`select permission_key from app_permission`);
const dbSet = new Set(dbKeys.map((r) => r.permission_key));
const missingInDb = [...codeKeys].filter((k) => !dbSet.has(k));
const missingInCode = [...dbSet].filter((k) => !codeKeys.has(k));
check(
  "every PERMISSIONS key in src/lib/permissions.ts exists in the DB catalogue",
  missingInDb.length === 0,
  missingInDb.length ? `absent from DB: ${missingInDb.join(", ")}` : "",
);
check(
  "the DB catalogue has no permission the app code does not know about",
  missingInCode.length === 0,
  missingInCode.length ? `absent from code: ${missingInCode.join(", ")}` : "",
);

// --- anon must not be able to probe permissions ----------------------------

await db.exec("set role anon");
let anonBlocked = false;
try {
  await db.query(`select app_user_has_permission('admin:roles:write')`);
} catch {
  anonBlocked = true;
}
await db.exec("reset role");
check("anon cannot execute app_user_has_permission()", anonBlocked);

await db.close();
process.exit(failed ? 1 : 0);
