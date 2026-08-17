// Coverage for the bridge-portal module registry and platform_decision
// (supabase/schema.sql §3b).
//
// Two things are worth proving here, and neither is visible from reading the
// schema:
//
//  1. app_user_modules() must be driven purely by permission data. The whole
//     point of the registry is that there is no hardcoded tile list — so the
//     test that matters is not "does it return rows" but "does granting and
//     revoking a permission actually change what comes back". A version that
//     returned every live module would pass a naive existence check and leak
//     every module to every role.
//
//  2. platform_decision is the ONLY table HSE Hub may write to, so its insert
//     policy is load-bearing. It must pin decided_by to the caller (otherwise a
//     decision can be attributed to someone else) and require the matching
//     approve permission per decision kind. It must also have no update or
//     delete policy at all: an audit trail that can be edited is not one.
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

await db.exec(readFileSync("supabase/schema.sql", "utf8"));

const EXEC = "11111111-1111-1111-1111-111111111111";
const HEAD = "22222222-2222-2222-2222-222222222222";
const EMPLOYEE = "33333333-3333-3333-3333-333333333333";

await db.exec(`
  insert into auth.users (id, email) values
    ('${EXEC}','exec@x.com'), ('${HEAD}','head@x.com'), ('${EMPLOYEE}','emp@x.com');

  insert into app_user_profile (user_id, person_id, role_key, department, is_active) values
    ('${EXEC}',     null, 'exec',      null,          true),
    ('${HEAD}',     null, 'dept_head', 'Engineering', true),
    ('${EMPLOYEE}', null, 'employee',  'Engineering', true);

  grant usage on schema public to authenticated;
  grant select, insert, update, delete on all tables in schema public to authenticated;
  grant usage, select on all sequences in schema public to authenticated;
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

const modulesFor = (uid) =>
  as(uid, async () => {
    const { rows } = await db.query(`select module_key from app_user_modules()`);
    return rows.map((r) => r.module_key).sort();
  });

// --- registry shape --------------------------------------------------------

const { rows: allModules } = await db.query(
  `select module_key, is_live, href from app_module order by sort_order`,
);
check("module registry is seeded", allModules.length >= 5, `${allModules.length} modules`);

// Every permission must belong to a module that exists, or its module can never
// be surfaced. There is no FK for this (module_key is a plain text default), so
// the check has to live here.
const { rows: orphans } = await db.query(`
  select distinct p.module_key
  from app_permission p
  left join app_module m on m.module_key = p.module_key
  where m.module_key is null
`);
check(
  "every permission's module_key exists in app_module",
  orphans.length === 0,
  orphans.length ? `orphaned: ${orphans.map((o) => o.module_key).join(", ")}` : "",
);

// A live module with no href would render as a dead tile.
const { rows: deadTiles } = await db.query(
  `select module_key from app_module where is_live and (href is null or href = '')`,
);
check(
  "no live module is missing an href",
  deadTiles.length === 0,
  deadTiles.length ? `live but unrouted: ${deadTiles.map((d) => d.module_key).join(", ")}` : "",
);

// --- app_user_modules() is permission-driven -------------------------------

const execModules = await modulesFor(EXEC);
const employeeModules = await modulesFor(EMPLOYEE);

check("exec sees at least one module", execModules.length > 0, execModules.join(", "));
check(
  "exec sees every module an employee sees",
  employeeModules.every((m) => execModules.includes(m)),
  `exec: ${execModules.join(",")} | employee: ${employeeModules.join(",")}`,
);

// hr is seeded is_live=false, and employees DO hold hr:leave:write. So the only
// reason hr must not appear is the is_live flag — which makes this a direct test
// of the launch switch rather than of the permission join.
const { rows: empHasHr } = await db.query(
  `select 1 from app_role_permission where role_key='employee' and permission_key like 'hr:%' limit 1`,
);
check(
  "an employee holds an hr permission (so the next check is meaningful)",
  empHasHr.length === 1,
);
check(
  "a module with is_live=false is hidden even from someone holding its permission",
  !employeeModules.includes("hr"),
  `employee sees: ${employeeModules.join(", ")}`,
);

// The real test of "no hardcoded tile list": revoke every projects permission
// from employee and the projects tile must disappear.
const before = await modulesFor(EMPLOYEE);
await db.exec(`
  delete from app_role_permission
  where role_key = 'employee'
    and permission_key in (select permission_key from app_permission where module_key = 'projects')
`);
const after = await modulesFor(EMPLOYEE);
check(
  "revoking a module's permissions removes its tile",
  before.includes("projects") && !after.includes("projects"),
  `before: ${before.join(",")} | after: ${after.join(",")}`,
);

// And granting one back restores it, from data alone.
await db.exec(
  `insert into app_role_permission (role_key, permission_key) values ('employee','projects:read_own')`,
);
const restored = await modulesFor(EMPLOYEE);
check(
  "granting a module permission restores its tile",
  restored.includes("projects"),
  restored.join(", "),
);

// --- platform_decision write surface --------------------------------------

// dept_head holds workload:approve, so a timesheet decision must succeed.
const headWrote = await as(HEAD, async () => {
  try {
    await db.query(
      `insert into platform_decision (kind, subject_ref, outcome, decided_by)
       values ('timesheet', 'timesheet_entry:1', 'approved', $1)`,
      [HEAD],
    );
    return true;
  } catch {
    return false;
  }
});
check("dept_head with workload:approve can record a timesheet decision", headWrote);

// employee holds no approve permission, so the same insert must be refused.
const empWrote = await as(EMPLOYEE, async () => {
  try {
    await db.query(
      `insert into platform_decision (kind, subject_ref, outcome, decided_by)
       values ('timesheet', 'timesheet_entry:2', 'approved', $1)`,
      [EMPLOYEE],
    );
    return true;
  } catch {
    return false;
  }
});
check("an employee canNOT record a timesheet decision", !empWrote);

// The impersonation guard: decided_by must equal auth.uid(). Without this, a
// dept_head could file a decision under the CEO's name.
const spoofed = await as(HEAD, async () => {
  try {
    await db.query(
      `insert into platform_decision (kind, subject_ref, outcome, decided_by)
       values ('timesheet', 'timesheet_entry:3', 'approved', $1)`,
      [EXEC],
    );
    return true;
  } catch {
    return false;
  }
});
check("a decision cannot be attributed to another user", !spoofed);

// Wrong kind for the permission held: dept_head has workload:approve and
// hr:leave:approve but not projects:write, so a budget decision must fail.
const wrongKind = await as(HEAD, async () => {
  try {
    await db.query(
      `insert into platform_decision (kind, subject_ref, outcome, decided_by)
       values ('budget', 'project:P-1', 'acknowledged', $1)`,
      [HEAD],
    );
    return true;
  } catch {
    return false;
  }
});
check("decision kind must match the permission held (dept_head cannot ack a budget)", !wrongKind);

// An audit trail must not be editable or erasable.
const { rows: decisionPolicies } = await db.query(`
  select cmd, count(*)::int as n
  from pg_policies
  where schemaname = 'public' and tablename = 'platform_decision'
  group by cmd
`);
const byCmd = Object.fromEntries(decisionPolicies.map((r) => [r.cmd, r.n]));
check(
  "platform_decision has no UPDATE policy (audit trail is append-only)",
  !byCmd.UPDATE,
  byCmd.UPDATE ? `${byCmd.UPDATE} update policies exist` : "",
);
check(
  "platform_decision has no DELETE policy",
  !byCmd.DELETE,
  byCmd.DELETE ? `${byCmd.DELETE} delete policies exist` : "",
);

// --- anon must not reach the registry -------------------------------------

await db.exec("set role anon");
let anonBlocked = false;
try {
  await db.query(`select module_key from app_user_modules()`);
} catch {
  anonBlocked = true;
}
await db.exec("reset role");
check("anon cannot execute app_user_modules()", anonBlocked);

// --- negative control ------------------------------------------------------
// Prove the is_live assertion above is load-bearing rather than passing because
// hr happens to be absent for some other reason. Flip hr live and the employee
// (who holds hr:leave:write) must now see it. If this control does NOT change
// the result, the is_live check above was vacuous.
await db.exec(`update app_module set is_live = true, href = '/hr' where module_key = 'hr'`);
const withHrLive = await modulesFor(EMPLOYEE);
check(
  "control: flipping is_live DOES surface hr to a holder of hr:leave:write — so the is_live check above is load-bearing",
  withHrLive.includes("hr"),
  `employee now sees: ${withHrLive.join(", ")}`,
);

await db.close();
process.exit(failed ? 1 : 0);
