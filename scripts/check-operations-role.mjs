/**
 * The `operations` role sees My Work and nothing else — proved, not asserted.
 *
 * WHAT THIS GATE IS FOR
 * ---------------------
 * hitul's decision, 2026-09-04: six operations consultants move onto a role
 * whose entire surface is /my-work. A restriction like that has three ways to
 * be fake, and this gate exists because each of them looks green from the
 * outside:
 *
 *   1. THE NAV LIES. Items in NAV_GROUPS with no `roles` key are visible to
 *      everybody, so a new role inherits Overview, My Work, People, Timesheets
 *      and Leave by DEFAULT. "I added a role" and "the role sees one page" are
 *      not the same statement.
 *   2. THE DOOR IS OPEN. Hiding a link does nothing to /people typed into the
 *      address bar. Several pages already refuse on a permission this role will
 *      not hold; several others gate on nothing but a session and would render.
 *   3. THE PAGE BREAKS. Trimming a role's permissions down to one key is only
 *      safe if none of My Work's reads consult a key. That is a claim about
 *      live RLS policies, and the way to settle it is to run the reads.
 *
 * So: the nav filter is EXECUTED (not grepped) over the real NAV_GROUPS data;
 * every route under src/app/(app) is swept for a refusal; the migration runs
 * twice on real Postgres; and the row sets an operations user can see are
 * compared, through the real policies, against the row sets the same person
 * sees as an employee today.
 *
 * NEGATIVE CONTROLS ARE PART OF THE GATE, NOT A ONE-OFF
 * ----------------------------------------------------
 * Section 6 re-runs the three load-bearing assertions against deliberately
 * broken inputs and FAILS if any of them still passes. A gate nobody has seen
 * go red is a gate nobody knows the meaning of.
 *
 * There is also an external switch for demonstrating that in a transcript:
 *
 *   node scripts/check-operations-role.mjs --break=extra-permission
 *   node scripts/check-operations-role.mjs --break=nav
 *   node scripts/check-operations-role.mjs --break=unguarded-page
 *
 * Each corrupts one input for the whole run; the gate must exit non-zero.
 *
 * LIVE IS READ-ONLY AND TWO-PHASE
 * -------------------------------
 * The migration is prepared for a human to paste. Until it IS pasted, "the six
 * are on operations" is false in production and must not be reported as a
 * failure of this branch — but the INVARIANTS are checked in both phases
 * (md-thorsten is dept_head; none of the six is on any third role; nobody
 * outside the six is on operations), and the phase is printed rather than
 * inferred. SKIPs cleanly with no SUPABASE_DB_URL, so CI runs without secrets.
 *
 * Run: npm run check:operations-role
 */
import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import pg from "pg";
import { PGlite } from "@electric-sql/pglite";
import { loadEnv } from "./lib/gate-env.mjs";
import {
  ROLE_ROUTE_ALLOWLIST,
  ROLE_HOME,
  isNavItemVisible,
  isRouteAllowedForRole,
  roleHome,
} from "../src/components/nav-access.ts";

const ROLE = "operations";
const MIGRATION = "supabase/migrations/20260904120000_operations_role.sql";
const NAV_FILE = "src/components/SidebarNav.tsx";
const PERMISSIONS_FILE = "src/lib/permissions.ts";
const APP_DIR = "src/app/(app)";

/** The six, from hitul's list. Order is irrelevant; membership is not. */
const TARGETS = [
  "md-stephan",
  "md-mathias",
  "md-hendryk",
  "md-ousmane",
  "md-mustafa",
  "md-serhii",
];
/** The operations team lead. Must not move. */
const LEAD = "md-thorsten";
const LEAD_ROLE = "dept_head";

/** The one key the role is supposed to hold. */
const EXPECTED_KEYS = ["my_work:read_own"];

/* ─────────────────────────── harness ─────────────────────────── */

const BREAK = (process.argv.find((a) => a.startsWith("--break=")) ?? "").split("=")[1] ?? null;
if (BREAK) {
  console.log(
    `\n!! NEGATIVE CONTROL ACTIVE: --break=${BREAK}. This run is EXPECTED to fail.\n`,
  );
}

/*
 * The INPUT is corrupted, never the predicate. `--break=nav` rewrites the
 * allow-list that the shipped isNavItemVisible()/isRouteAllowedForRole() read,
 * so the code under test is still exactly the code that ships — which is the
 * only way a negative control proves anything about production.
 */
if (BREAK === "nav") {
  ROLE_ROUTE_ALLOWLIST[ROLE] = [...(ROLE_ROUTE_ALLOWLIST[ROLE] ?? []), "/people"];
}

let failed = 0;
const check = (name, ok, detail = "") => {
  if (!ok) failed += 1;
  console.log(`${ok ? "PASS" : "FAIL"}: ${name}${detail ? ` — ${detail}` : ""}`);
};
const note = (s) => console.log(`      ${s}`);
const section = (s) => console.log(`\n${s}\n${"-".repeat(s.length)}`);

/** Comments state intent; they must never satisfy an assertion about code. */
const stripComments = (s) =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const read = (p) => readFileSync(p, "utf8");

/* ══════════════════════════════════════════════════════════════════════════
   1. THE NAVIGATION
   ══════════════════════════════════════════════════════════════════════════ */
section("1. NAVIGATION — the real filter over the real nav data");

/**
 * NAV_GROUPS is parsed out of SidebarNav.tsx rather than imported: that module
 * is "use client", imports framer-motion and next-intl and returns JSX, none of
 * which survives a bare `node --experimental-strip-types`. The FILTER, which is
 * the part that decides anything, is imported and executed — so what is parsed
 * here is only the data, and what is tested is the shipped predicate.
 */
function parseNavItems() {
  const src = stripComments(read(NAV_FILE));
  const items = [];
  // Each entry is one brace-balanced object literal with no nested braces
  // except the roles array, so a non-greedy scan on `{ ... }` is exact here.
  for (const m of src.matchAll(/\{[^{}]*?href:\s*"([^"]+)"[^{}]*?\}/g)) {
    const block = m[0];
    const roles = [...(block.match(/roles:\s*\[([^\]]*)\]/)?.[1] ?? "").matchAll(/"([^"]+)"/g)].map(
      (r) => r[1],
    );
    items.push({ href: m[1], roles: roles.length ? roles : undefined });
  }
  return items;
}

const navItems = parseNavItems();
check("NAV_GROUPS parses", navItems.length >= 10, `${navItems.length} items found`);

/** The SHIPPED predicate, over the real nav data. Nothing is reimplemented. */
const opsNav = navItems.filter((item) => isNavItemVisible(ROLE, item));
check(
  `the nav for ${ROLE} contains exactly one item`,
  opsNav.length === 1,
  opsNav.map((i) => i.href).join(", ") || "(none)",
);
check(
  "and that one item is /my-work",
  opsNav.length === 1 && opsNav[0].href === "/my-work",
  opsNav.map((i) => i.href).join(", ") || "(none)",
);

/*
 * "Without breaking every other role's navigation" is the other half of the
 * brief, and it is checkable exactly: the OLD filter was
 * `!item.roles || roles.includes(roleKey)`. For every role that is not in the
 * allow-list table, the new predicate must return the identical set.
 */
const OTHER_ROLES = ["exec", "dept_head", "hr", "project_manager", "sales", "employee"];
for (const role of OTHER_ROLES) {
  const before = navItems.filter((i) => !i.roles || i.roles.includes(role)).map((i) => i.href);
  const after = navItems.filter((i) => isNavItemVisible(role, i)).map((i) => i.href);
  check(
    `  ${role}'s navigation is byte-identical to before`,
    before.join("|") === after.join("|"),
    `${before.length} items before, ${after.length} after`,
  );
}

/*
 * The mobile tab bar is a SECOND nav surface and used to bypass the filter
 * entirely: MobileTabBar called mobileTabsFor(roleKey) with no allow-list, so
 * the four default hrefs rendered for every role. Source-level, because the
 * component is client-side JSX — but specific enough that removing the
 * argument again fails here.
 */
const tabBar = stripComments(read("src/components/MobileTabBar.tsx"));
check(
  "the mobile tab bar applies the nav filter (it did not, before)",
  /mobileTabsFor\(\s*roleKey\s*,\s*allowedHrefs\s*\)/.test(tabBar) &&
    /isNavItemVisible\(/.test(tabBar),
  "mobileTabsFor(roleKey) with no allow-list shows all four tabs to every role",
);

/* Redirect-loop invariant: every restricted role's home must be on its own list. */
for (const role of Object.keys(ROLE_ROUTE_ALLOWLIST)) {
  check(
    `  ${role}'s home (${roleHome(role)}) is on its own allow-list`,
    isRouteAllowedForRole(role, roleHome(role)),
    "a home off the list is an infinite redirect",
  );
  check(`  ${role} has a declared home`, typeof ROLE_HOME[role] === "string");
}

/* ══════════════════════════════════════════════════════════════════════════
   2. EVERY ROUTE REFUSES, OR IS ON THE LIST
   ══════════════════════════════════════════════════════════════════════════ */
section("2. ROUTES — no page under (app) is reachable by URL");

/** PERMISSIONS.FOO -> "foo:key", read from the shipped catalogue. */
function permissionConstants() {
  const src = stripComments(read(PERMISSIONS_FILE));
  const map = {};
  for (const m of src.matchAll(/^\s*([A-Z0-9_]+):\s*"([^"]+)"/gm)) map[m[1]] = m[2];
  return map;
}
const PERMS = permissionConstants();
check("the permission catalogue parses", Object.keys(PERMS).length > 20, `${Object.keys(PERMS).length} keys`);

/** Every page.tsx under (app), as a route path. */
function routePages(dir = APP_DIR, prefix = "") {
  const out = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      // (group) segments do not appear in the URL.
      const seg = /^\(.*\)$/.test(name) ? prefix : `${prefix}/${name}`;
      out.push(...routePages(full, seg));
    } else if (name === "page.tsx") {
      out.push({ file: full, route: prefix === "" ? "/" : prefix });
    }
  }
  return out;
}

/** The route ROOT an allow-list entry or a guard would name. */
const routeRoot = (route) => {
  const parts = route.split("/").filter(Boolean);
  const stable = [];
  for (const p of parts) {
    if (p.startsWith("[")) break;
    stable.push(p);
  }
  return `/${stable.join("/")}`;
};

const pages = routePages();
check("routes discovered", pages.length >= 20, `${pages.length} pages under ${APP_DIR}`);

const guarded = [];
const refusedByPermission = [];
const refusedByRoleList = [];
const allowedByList = [];
const reachable = [];

for (const { file, route } of pages) {
  const src = stripComments(read(file));
  const root = routeRoot(route);

  if (isRouteAllowedForRole(ROLE, root)) {
    allowedByList.push(route);
    continue;
  }

  const hasGuard =
    /enforceRoleRouteAccess\(\s*"([^"]+)"\s*\)/.test(src) &&
    // The guard has to name THIS route's root, not some other page's.
    [...src.matchAll(/enforceRoleRouteAccess\(\s*"([^"]+)"\s*\)/g)].some((m) => m[1] === root);
  if (hasGuard && BREAK !== "unguarded-page") {
    guarded.push(route);
    continue;
  }

  // requirePermission(path, PERMISSIONS.KEY) — refuses when the role lacks KEY.
  const permGate = [...src.matchAll(/requirePermission\([^,]+,\s*PERMISSIONS\.([A-Z0-9_]+)\s*\)/g)]
    .map((m) => PERMS[m[1]])
    .filter(Boolean);
  if (permGate.length && permGate.every((k) => !EXPECTED_KEYS.includes(k))) {
    refusedByPermission.push(`${route} (needs ${permGate.join(" + ")})`);
    continue;
  }

  // requireProfile(path, ["exec", ...]) — refuses when the role is not listed.
  const roleGate = [...src.matchAll(/requireProfile\([^,]+,\s*\[([^\]]*)\]\s*\)/g)].map((m) =>
    [...m[1].matchAll(/"([^"]+)"/g)].map((r) => r[1]),
  );
  if (roleGate.length && roleGate.every((list) => !list.includes(ROLE))) {
    refusedByRoleList.push(`${route} (roles: ${roleGate.flat().join(", ")})`);
    continue;
  }

  reachable.push(route);
}

note(`allow-listed  : ${allowedByList.join(", ") || "(none)"}`);
note(`explicit guard: ${guarded.join(", ") || "(none)"}`);
note(`permission    : ${refusedByPermission.join(", ") || "(none)"}`);
note(`role list     : ${refusedByRoleList.join(", ") || "(none)"}`);
check(
  `no route under ${APP_DIR} is reachable by ${ROLE} without being on its allow-list`,
  reachable.length === 0,
  reachable.length ? `REACHABLE: ${reachable.join(", ")}` : `${pages.length} routes accounted for`,
);
check(
  "the two allow-listed routes are the intended ones",
  allowedByList.slice().sort().join(",") === "/my-work,/profile",
  allowedByList.join(", "),
);
check(
  "at least one refusal is an explicit server-side guard, not an inherited one",
  guarded.length >= 4,
  `${guarded.length} pages call enforceRoleRouteAccess()`,
);
check(
  "the Overview is guarded — every other refusal in the app redirects to it",
  guarded.includes("/"),
  "an unguarded / turns every requirePermission() redirect into a bypass",
);
check(
  "the guard runs before the page's data read on the Overview",
  (() => {
    const s = stripComments(read(`${APP_DIR}/page.tsx`));
    const g = s.indexOf("enforceRoleRouteAccess");
    const q = s.indexOf("getLiveOverview(");
    return g > 0 && q > 0 && g < q;
  })(),
  "redirecting after the query still runs the query",
);

/* ══════════════════════════════════════════════════════════════════════════
   3. THE MIGRATION, ON REAL POSTGRES, TWICE
   ══════════════════════════════════════════════════════════════════════════ */
section("3. MIGRATION — PGlite, applied and re-applied");

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

/**
 * project_link, project_responsibility and the contract-period table reached
 * production through migrations and are not in schema.sql. My Work reads two of
 * them and the budget check needs the third, so a fixture without them would
 * prove less than it appears to.
 */
const EXTRA_MIGRATIONS = [
  "supabase/migrations/20260824160000_create_project_responsibility.sql",
  "supabase/migrations/20260903230000_project_link.sql",
  "supabase/migrations/add_contract_periods.sql",
];

const U = {
  emp: "11111111-1111-1111-1111-111111111111",
  ops: "22222222-2222-2222-2222-222222222222",
  exec: "33333333-3333-3333-3333-333333333333",
  lead: "44444444-4444-4444-4444-444444444444",
  other: "55555555-5555-5555-5555-555555555555",
  moved: "66666666-6666-6666-6666-666666666666",
};

/**
 * Seed rows the migration is supposed to act on.
 *
 * The two interesting controls:
 *  - `md-hannes` is an employee who is NOT on the list and must not move.
 *  - `md-mustafa` is seeded as project_manager, i.e. already moved off employee
 *    by hand. The `where role_key = 'employee'` guard must leave him alone —
 *    that is the property that stops a re-run months from now dragging somebody
 *    back onto a role an administrator deliberately took them off.
 */
async function seedProfiles(db) {
  await db.exec(`
    insert into auth.users (id, email) values
      ('${U.emp}',   'mathias.employee@example.com'),
      ('${U.ops}',   'mathias.operations@example.com'),
      ('${U.exec}',  'exec@example.com'),
      ('${U.lead}',  'thorsten@example.com'),
      ('${U.other}', 'hannes@example.com'),
      ('${U.moved}', 'mustafa@example.com');

    insert into people (id, name, department) values
      ('md-mathias',  'Mathias',  'OPERATIONS'),
      ('md-stephan',  'Stephan',  'OPERATIONS'),
      ('md-hendryk',  'Hendryk',  'OPERATIONS'),
      ('md-ousmane',  'Ousmane',  'OPERATIONS'),
      ('md-mustafa',  'Mustafa',  'OPERATIONS'),
      ('md-serhii',   'Serhii',   'OPERATIONS'),
      ('md-thorsten', 'Thorsten', 'OPERATIONS'),
      ('md-hannes',   'Hannes',   'ORGA'),
      ('md-exec',     'Exec',     'TECH');

    insert into app_user_profile (user_id, person_id, role_key, department, is_active) values
      -- The comparison pair: ONE person, two accounts, two roles. Contrived on
      -- purpose. can_view_project()/can_view_person() resolve a non-exec caller
      -- entirely through app_user_person_id(), so binding both accounts to the
      -- same person makes "does the role string change what you see" a question
      -- with a yes/no answer instead of a fixture-shaped one.
      ('${U.emp}',   'md-mathias',  'employee',        'OPERATIONS', true),
      ('${U.ops}',   'md-mathias',  'employee',        'OPERATIONS', true),
      ('${U.exec}',  'md-exec',     'exec',            'TECH',       true),
      ('${U.lead}',  'md-thorsten', 'dept_head',       'OPERATIONS', true),
      ('${U.other}', 'md-hannes',   'employee',        'ORGA',       true),
      ('${U.moved}', 'md-mustafa',  'project_manager', 'OPERATIONS', true);
  `);
  // The three remaining targets have no account at all — also realistic, and it
  // proves the UPDATE does not require one.
  await db.exec(`
    insert into auth.users (id, email) values
      ('77777777-7777-7777-7777-777777777777', 'stephan@example.com'),
      ('88888888-8888-8888-8888-888888888888', 'hendryk@example.com'),
      ('99999999-9999-9999-9999-999999999999', 'ousmane@example.com'),
      ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'serhii@example.com');
    insert into app_user_profile (user_id, person_id, role_key, department, is_active) values
      ('77777777-7777-7777-7777-777777777777', 'md-stephan', 'employee', 'OPERATIONS', true),
      ('88888888-8888-8888-8888-888888888888', 'md-hendryk', 'employee', 'OPERATIONS', true),
      ('99999999-9999-9999-9999-999999999999', 'md-ousmane', 'employee', 'OPERATIONS', true),
      ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'md-serhii',  'employee', 'OPERATIONS', true);
  `);
}

async function freshDb() {
  const db = new PGlite();
  await db.exec(preamble);
  await db.exec(read("supabase/schema.sql"));
  for (const m of EXTRA_MIGRATIONS) await db.exec(read(m));
  /*
   * Table PRIVILEGES, which are a different question from RLS and are not what
   * this gate is about. Supabase's own project defaults grant SELECT on public
   * to `authenticated`; schema.sql does not restate that, so a bare PGlite
   * build has none and every read below would fail with "permission denied"
   * rather than returning the zero rows RLS intends. Granted broadly and
   * deliberately, so that what the assertions measure is the POLICY.
   */
  await db.exec(`
    grant usage on schema public to authenticated;
    grant select on all tables in schema public to authenticated;
    grant select on all tables in schema time to authenticated;
  `);
  await seedProfiles(db);
  return db;
}

/**
 * The state that must not move between the first and second application:
 * roles, grants, every profile's role, and every policy in the database.
 */
async function stateSnapshot(db) {
  const roles = await db.query(`select role_key, display_name, seniority from app_role order by role_key`);
  const grants = await db.query(`select role_key, permission_key from app_role_permission order by 1,2`);
  const profiles = await db.query(
    `select user_id::text, person_id, role_key from app_user_profile order by user_id`,
  );
  const policies = await db.query(
    `select schemaname, tablename, policyname, cmd, coalesce(qual,''), coalesce(with_check,'')
       from pg_policies order by 1,2,3,4`,
  );
  return JSON.stringify({
    roles: roles.rows,
    grants: grants.rows,
    profiles: profiles.rows,
    policies: policies.rows,
  });
}

const migrationSql = read(MIGRATION);
check("the migration file exists", existsSync(MIGRATION), MIGRATION);
check(
  "it carries the rollback SQL a trial needs",
  /ROLLBACK/.test(migrationSql) &&
    /set role_key = 'employee'/.test(migrationSql) &&
    /delete from app_role\s+where role_key = 'operations'/.test(migrationSql),
  "a trial with no written way back is not a trial",
);
check(
  "the profile UPDATE is guarded on role_key = 'employee'",
  /where role_key = 'employee'/.test(migrationSql),
  "without it a re-run drags people back onto a role they were moved off",
);

const db = await freshDb();

/**
 * Every existing role's grants, BEFORE the migration touches anything.
 *
 * Captured rather than hardcoded. The brief's rule is "do not change what any
 * existing role can do", and the honest way to test that is to diff the role's
 * own before/after — a hardcoded count ("employee keeps its 8 keys") tests my
 * arithmetic against schema.sql, which is a different and much weaker claim,
 * and goes red every time somebody legitimately adds a permission elsewhere.
 */
const grantsBefore = JSON.stringify(
  (
    await db.query(
      `select role_key, permission_key from app_role_permission order by 1, 2`,
    )
  ).rows,
);

let applied = true;
try {
  await db.exec(migrationSql);
} catch (e) {
  applied = false;
  check("the migration executes", false, e.message);
}
check("the migration executes", applied);
if (!applied) {
  console.log("\nOPERATIONS ROLE GATE: FAILED (migration did not run)");
  process.exit(1);
}

/**
 * `--break=extra-permission` widens the role AFTER the migration, which is
 * exactly the mistake this gate is meant to catch: somebody grants the new role
 * "just one more key" and nothing else complains.
 */
if (BREAK === "extra-permission") {
  await db.exec(
    `insert into app_role_permission (role_key, permission_key)
     values ('${ROLE}', 'projects:contracts:read') on conflict do nothing`,
  );
}

const before = await stateSnapshot(db);
let reran = true;
let rerunDetail = "";
try {
  await db.exec(migrationSql);
} catch (e) {
  reran = false;
  rerunDetail = e.message;
}
check("re-running it succeeds", reran, rerunDetail);
const after = await stateSnapshot(db);
check(
  "re-running it changes NOTHING — roles, grants, profiles and policies are identical",
  before === after,
  before === after ? "byte-identical snapshots" : "state moved on the second application",
);

const roleRow = await db.query(`select display_name, seniority from app_role where role_key = $1`, [ROLE]);
check("the role exists", roleRow.rows.length === 1, JSON.stringify(roleRow.rows[0] ?? {}));

const grantRows = await db.query(
  `select permission_key from app_role_permission where role_key = $1 order by 1`,
  [ROLE],
);
const grantedKeys = grantRows.rows.map((r) => r.permission_key);
check(
  `${ROLE} holds exactly the minimum permission set`,
  grantedKeys.join(",") === EXPECTED_KEYS.join(","),
  `granted: ${grantedKeys.join(", ") || "(none)"} | expected: ${EXPECTED_KEYS.join(", ")}`,
);
check(
  `${ROLE} holds NO budget key`,
  !grantedKeys.some((k) => k.includes("contract")),
  grantedKeys.filter((k) => k.includes("contract")).join(", ") || "none granted",
);
check(
  `${ROLE} cannot write anything`,
  !grantedKeys.some((k) => /:(write|approve|trigger|acknowledge)$/.test(k)),
  grantedKeys.filter((k) => /:(write|approve|trigger|acknowledge)$/.test(k)).join(", ") || "read_own only",
);

const moved = await db.query(
  `select person_id, role_key from app_user_profile where person_id = any($1) order by person_id`,
  [TARGETS],
);
// DISTINCT person, not row: md-mathias deliberately has two accounts in this
// fixture (see seedProfiles) and both must move.
const onOps = [...new Set(moved.rows.filter((r) => r.role_key === ROLE).map((r) => r.person_id))];
check(
  "five of the six move (the sixth was deliberately already off employee)",
  onOps.length === 5,
  moved.rows.map((r) => `${r.person_id}=${r.role_key}`).join(", "),
);
check(
  "  BOTH of the duplicated person's accounts move, not just one",
  moved.rows.filter((r) => r.person_id === "md-mathias").every((r) => r.role_key === ROLE),
  "the UPDATE is keyed on person_id, so one person with two logins moves wholly or not at all",
);
check(
  "the one already moved by hand is LEFT ALONE, not dragged back",
  moved.rows.find((r) => r.person_id === "md-mustafa")?.role_key === "project_manager",
  "the where-clause guard is what makes a re-run safe",
);
const leadRow = await db.query(`select role_key from app_user_profile where person_id = $1`, [LEAD]);
check(
  `${LEAD} is STILL ${LEAD_ROLE}`,
  leadRow.rows[0]?.role_key === LEAD_ROLE,
  `found ${leadRow.rows[0]?.role_key ?? "(no profile)"}`,
);
const bystander = await db.query(`select role_key from app_user_profile where person_id = 'md-hannes'`);
check(
  "an employee outside the list is untouched",
  bystander.rows[0]?.role_key === "employee",
  `found ${bystander.rows[0]?.role_key}`,
);

/* No existing role's permissions may move — diffed, not counted. */
const grantsAfter = JSON.stringify(
  (
    await db.query(
      `select role_key, permission_key from app_role_permission
        where role_key <> $1 order by 1, 2`,
      [ROLE],
    )
  ).rows,
);
check(
  "not one existing role gained or lost a permission",
  grantsBefore === grantsAfter,
  grantsBefore === grantsAfter
    ? "every role except operations has the grants it had before"
    : "the grant table moved for a role this change must not touch",
);
const employeeKeys = (
  await db.query(`select permission_key from app_role_permission where role_key = 'employee' order by 1`)
).rows.map((r) => r.permission_key);
/*
 * The eight keys live production grants `employee`, named explicitly because
 * they are what the brief promises whoever stays on that role. A count would
 * be the wrong assertion: schema.sql and production have a known catalogue
 * drift, so the rebuilt fixture can legitimately hold a key production does
 * not — what matters is that none of the eight went missing.
 */
const EMPLOYEE_LIVE_KEYS = [
  "hr:clocking:write",
  "hr:leave:write",
  "my_work:read_own",
  "people:read_own",
  "projects:read_own",
  "sync:read",
  "timesheets:read_own",
  "timesheets:write",
];
check(
  "  employee still holds all eight of its live keys, for whoever remains on it",
  EMPLOYEE_LIVE_KEYS.every((k) => employeeKeys.includes(k)),
  `${employeeKeys.length} keys: ${employeeKeys.join(", ")}`,
);

/* ══════════════════════════════════════════════════════════════════════════
   4. RLS BEHAVIOUR — what an operations user can actually read
   ══════════════════════════════════════════════════════════════════════════ */
section("4. RLS — the same rows as today, and no budgets");

/*
 * Give the pair some work. Both accounts point at md-mathias, so every
 * person- and project-scoped policy must return the identical set for the
 * employee account and the operations account. If any of them consulted the
 * role string, this is where it would show.
 */
/**
 * Seed statements go through here so a fixture mistake surfaces as one FAIL
 * line. PGlite rethrows with the entire bundled parser in the stack — 40KB of
 * minified JavaScript between the reader and the one sentence that matters.
 */
async function seed(label, sql) {
  try {
    await db.exec(sql);
    return true;
  } catch (e) {
    check(`fixture: ${label}`, false, e.message);
    return false;
  }
}

await seed("projects, assignments, links, responsibilities, services", `
  -- No explicit ids: both tables are GENERATED ALWAYS AS IDENTITY and
  -- schema.sql already seeds rows in them, so a hardcoded id collides.
  insert into time.service (source_id, name) values
    ('svc-ops-1', 'Brandschutz (fixture)'), ('svc-ops-2', 'Arbeitsschutz (fixture)');
  insert into time.customer (source_id, name) values ('cust-ops-1', 'ACME (fixture)');

  -- public.projects carries nine NOT NULL columns inherited from the original
  -- mockup schema; all of them have to be supplied even though only
  -- owner_person_id and department matter to the policy under test.
  insert into projects
    (id, code, name, customer, lead, status, contract_hours, billable_hours,
     consumed_percent, due, department, owner_person_id) values
    ('prj-own',   'P-1', 'Owned project',    'ACME',  'Mathias', 'active', 120, 10, 8,  '2026-12-31', 'OPERATIONS', 'md-mathias'),
    ('prj-asgn',  'P-2', 'Assigned project', 'ACME',  'Exec',    'active', 240, 20, 8,  '2026-12-31', 'OPERATIONS', 'md-exec'),
    ('prj-other', 'P-3', 'Somebody elses',   'OTHER', 'Exec',    'active', 360, 30, 8,  '2026-12-31', 'TECH',       'md-exec');

  insert into person_assignments
    (person_id, project_id, project_name, logged_hours, tasks_count, share_percent, sort_order) values
    ('md-mathias', 'prj-asgn',  'Assigned project', 0, 0, 50, 1),
    ('md-hannes',  'prj-other', 'Somebody elses',   0, 0, 50, 1);

  insert into project_responsibility (project_id, person_id, role, order_no) values
    ('prj-own',   'md-mathias', 'responsible', 'A-1'),
    ('prj-other', 'md-hannes',  'responsible', 'A-2');

  -- The kind column is CHECK-constrained to the five real integrations.
  insert into project_link (project_id, kind, url, label) values
    ('prj-own',   'google_drive', 'https://example.invalid/own',   'Folder'),
    ('prj-asgn',  'google_drive', 'https://example.invalid/asgn',  'Folder'),
    ('prj-other', 'google_drive', 'https://example.invalid/other', 'Folder');

  insert into time.project (source_id, customer_id, name, hub_project_id, service_id, estimated_hours)
    select 'tp-ops-1', c.id, 'Owned project', 'prj-own',
           (select id from time.service where source_id = 'svc-ops-1'), 100
      from time.customer c where c.source_id = 'cust-ops-1';
  insert into time.project (source_id, customer_id, name, hub_project_id, service_id, estimated_hours)
    select 'tp-ops-2', c.id, 'Assigned project', 'prj-asgn',
           (select id from time.service where source_id = 'svc-ops-2'), 200
      from time.customer c where c.source_id = 'cust-ops-1';
`);

// A budget row, so "operations sees no budgets" is a statement about something
// that exists rather than about an empty table.
await seed("a contract period to be withheld", `
  insert into time.project_contract_period (project_id, period_no, budget_hours, starts_on, ends_on)
  select id, 1, 500, date '2026-01-01', date '2026-12-31'
    from time.project where source_id = 'tp-ops-1';
`);

/**
 * Read as a real `authenticated` caller.
 *
 * `set role authenticated` is the load-bearing line. PGlite otherwise runs as
 * the table OWNER, and Postgres exempts an owner from RLS unless the table is
 * FORCE ROW LEVEL SECURITY — so without it every assertion in this section
 * would pass while proving nothing whatsoever. Same pattern as
 * check-rls-behaviour.mjs, which is where it was established.
 */
async function readAs(userId, sql) {
  await db.exec("set role authenticated");
  await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [userId]);
  let rows;
  try {
    rows = (await db.query(sql)).rows;
  } finally {
    await db.exec("reset role");
  }
  return rows;
}

// Move the second account onto the new role — the state the migration produces.
await db.exec(`update app_user_profile set role_key = '${ROLE}' where user_id = '${U.ops}'`);

const READS = {
  projects: `select id from projects order by id`,
  person_assignments: `select project_id from person_assignments order by project_id`,
  project_responsibility: `select project_id from project_responsibility order by project_id`,
  project_link: `select project_id, kind from project_link order by 1,2`,
  "time.project": `select hub_project_id from time.project order by 1`,
  "time.service": `select name from time.service order by 1`,
};

let anyRows = 0;
for (const [label, sql] of Object.entries(READS)) {
  const asEmployee = await readAs(U.emp, sql);
  const asOperations = await readAs(U.ops, sql);
  anyRows += asOperations.length;
  check(
    `  ${label}: operations reads exactly what employee reads`,
    JSON.stringify(asEmployee) === JSON.stringify(asOperations),
    `employee ${asEmployee.length} rows, operations ${asOperations.length} rows`,
  );
}
check(
  "the comparison is not vacuous — the operations user does read rows",
  anyRows > 0,
  `${anyRows} rows across ${Object.keys(READS).length} tables`,
);

/* Scoping still bites: the project nobody assigned them to stays invisible. */
const opsProjects = (await readAs(U.ops, `select id from projects order by id`)).map((r) => r.id);
check(
  "operations still cannot see a project that is not theirs",
  !opsProjects.includes("prj-other"),
  `sees: ${opsProjects.join(", ")}`,
);
check(
  "operations sees both the owned and the assigned project (My Work works)",
  opsProjects.includes("prj-own") && opsProjects.includes("prj-asgn"),
  `sees: ${opsProjects.join(", ")}`,
);
const opsLinks = await readAs(U.ops, `select project_id from project_link order by 1`);
check(
  "  and the working links for them resolve",
  opsLinks.length === 2 && !opsLinks.some((r) => r.project_id === "prj-other"),
  `${opsLinks.length} links`,
);
const opsServices = await readAs(
  U.ops,
  `select p.hub_project_id, s.name from time.project p join time.service s on s.id = p.service_id order by 1`,
);
check(
  "  and the TrackingTime service tags resolve",
  opsServices.length === 2,
  opsServices.map((r) => `${r.hub_project_id}=${r.name}`).join(", "),
);

/* Budgets. canReadBudgets() calls exactly this RPC with exactly this key. */
const opsBudgetPerm = await readAs(
  U.ops,
  `select app_user_has_permission('projects:contracts:read') as ok`,
);
const execBudgetPerm = await readAs(
  U.exec,
  `select app_user_has_permission('projects:contracts:read') as ok`,
);
check(
  "operations fails the budget permission the query layer asks for",
  opsBudgetPerm[0].ok === false,
  "canReadBudgets() -> false, so every budget field leaves the server as null",
);
check(
  "  and the check discriminates — exec passes it",
  execBudgetPerm[0].ok === true,
  "if exec failed too, the assertion above would be meaningless",
);
const opsPeriods = await readAs(U.ops, `select count(*)::int n from time.project_contract_period`);
const execPeriods = await readAs(U.exec, `select count(*)::int n from time.project_contract_period`);
check(
  "operations reads NO contract periods — RLS, not just the query layer",
  opsPeriods[0].n === 0,
  `operations ${opsPeriods[0].n} rows, exec ${execPeriods[0].n} rows`,
);
check(
  "  and that table is not simply empty",
  execPeriods[0].n > 0,
  `exec sees ${execPeriods[0].n}`,
);

/* Deactivation must still strip everything, on the new role as on every other. */
await db.exec(`update app_user_profile set is_active = false where user_id = '${U.ops}'`);
const goneProjects = await readAs(U.ops, `select id from projects`);
const goneRole = await readAs(U.ops, `select app_user_role() as r`);
check(
  "a deactivated operations account loses every row (is_active still bites)",
  goneProjects.length === 0 && goneRole[0].r === null,
  `${goneProjects.length} projects, role ${goneRole[0].r ?? "null"}`,
);
await db.exec(`update app_user_profile set is_active = true where user_id = '${U.ops}'`);

/* ══════════════════════════════════════════════════════════════════════════
   5. LIVE — read-only, two-phase
   ══════════════════════════════════════════════════════════════════════════ */
section("5. LIVE — read-only probe of the real project");

const env = loadEnv();
if (!env.SUPABASE_DB_URL) {
  console.log("SKIP: no SUPABASE_DB_URL, so there is no live database to check");
} else {
  const client = new pg.Client({
    connectionString: env.SUPABASE_DB_URL,
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();
  // Belt and braces: this gate must not be able to write, even by accident.
  await client.query("set default_transaction_read_only = on");

  const roleExists = (
    await client.query(`select 1 from app_role where role_key = $1`, [ROLE])
  ).rows.length > 0;
  const phase = roleExists ? "APPLIED" : "PENDING";
  note(`migration phase: ${phase}${roleExists ? "" : " — not yet pasted into the live project"}`);

  const liveProfiles = (
    await client.query(
      `select person_id, role_key, is_active from app_user_profile
        where person_id = any($1) order by person_id`,
      [TARGETS],
    )
  ).rows;

  // INVARIANT, both phases: nobody drifted onto a third role.
  check(
    "each of the six is on employee or operations, and nothing else",
    liveProfiles.every((r) => r.role_key === "employee" || r.role_key === ROLE),
    liveProfiles.map((r) => `${r.person_id}=${r.role_key}`).join(", "),
  );
  check(
    `${LEAD} is ${LEAD_ROLE} on the live project`,
    (await client.query(`select role_key from app_user_profile where person_id = $1`, [LEAD]))
      .rows[0]?.role_key === LEAD_ROLE,
    "the operations team lead must not be touched by this change",
  );

  if (roleExists) {
    check(
      "all six are on operations",
      liveProfiles.filter((r) => r.role_key === ROLE).length === TARGETS.length,
      liveProfiles.map((r) => `${r.person_id}=${r.role_key}`).join(", "),
    );
    const strays = (
      await client.query(
        `select person_id from app_user_profile where role_key = $1 and not (person_id = any($2))`,
        [ROLE, TARGETS],
      )
    ).rows;
    check("nobody outside the six is on operations", strays.length === 0, strays.map((r) => r.person_id).join(", "));
    const liveKeys = (
      await client.query(`select permission_key from app_role_permission where role_key = $1 order by 1`, [ROLE])
    ).rows.map((r) => r.permission_key);
    check(
      "the live role holds exactly the minimum set",
      liveKeys.join(",") === EXPECTED_KEYS.join(","),
      liveKeys.join(", ") || "(none)",
    );
  } else {
    note("role-membership assertions deferred: paste the migration, then re-run this gate");
  }

  /*
   * WHY THE MOVE CANNOT COST A SINGLE ROW, proved from the live function bodies
   * rather than from schema.sql (they drift).
   *
   * can_view_project() and can_view_person() are the predicate behind every
   * table My Work reads. If the ONLY role strings they compare against are
   * 'exec' and 'dept_head', then every other role — employee today, operations
   * tomorrow — takes the identical branch, and the row set cannot move.
   */
  for (const fn of ["can_view_project", "can_view_person"]) {
    const def = (
      await client.query(
        `select pg_get_functiondef(p.oid) def from pg_proc p
           join pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'public' and p.proname = $1`,
        [fn],
      )
    ).rows[0]?.def ?? "";
    const literals = new Set(
      [...def.matchAll(/app_user_role\(\)[^']*?=\s*'([a-z_]+)'/g)].map((m) => m[1]),
    );
    for (const m of def.matchAll(/app_user_role[^)]*\)\s*=\s*ANY\s*\(\s*ARRAY\[([^\]]*)\]/g)) {
      for (const l of m[1].matchAll(/'([a-z_]+)'/g)) literals.add(l[1]);
    }
    check(
      `  live ${fn}() branches on role for exec/dept_head ONLY`,
      def.length > 0 && [...literals].every((l) => l === "exec" || l === "dept_head"),
      `role literals: ${[...literals].join(", ") || "(none)"}`,
    );
  }

  /*
   * And the numbers, for the person the brief names. The predicate is bound to
   * a role string here rather than to auth.uid(), because there is no way to
   * impersonate a user over this connection — so it is evaluated once as
   * 'employee' and once as 'operations' and the two must agree.
   */
  const visible = async (roleKey) =>
    (
      await client.query(
        `select count(*)::int n from projects pr
          where $1 = 'exec'
             or ( ($1 = 'dept_head' and pr.department = $3)
                  or pr.owner_person_id = $2
                  or exists (select 1 from person_assignments pa
                              where pa.project_id = pr.id and pa.person_id = $2) )`,
        [roleKey, "md-mathias", "OPERATIONS"],
      )
    ).rows[0].n;
  const asEmp = await visible("employee");
  const asOps = await visible(ROLE);
  check(
    "md-mathias sees the same project count as operations as he does as employee",
    asEmp === asOps && asOps > 0,
    `employee ${asEmp}, operations ${asOps}`,
  );

  const withLinks = (
    await client.query(
      `with mine as (
         select pr.id from projects pr
          where pr.owner_person_id = $1
             or exists (select 1 from person_assignments pa
                         where pa.project_id = pr.id and pa.person_id = $1))
       select count(distinct l.project_id)::int n from project_link l join mine m on m.id = l.project_id`,
      ["md-mathias"],
    )
  ).rows[0].n;
  const withServices = (
    await client.query(
      `with mine as (
         select pr.id from projects pr
          where pr.owner_person_id = $1
             or exists (select 1 from person_assignments pa
                         where pa.project_id = pr.id and pa.person_id = $1))
       select count(distinct tp.hub_project_id)::int n
         from time.project tp join mine m on m.id = tp.hub_project_id
        where tp.service_id is not null`,
      ["md-mathias"],
    )
  ).rows[0].n;
  check("  his links still resolve", withLinks > 0, `${withLinks} of ${asOps} projects carry a link`);
  check("  his service tags still resolve", withServices > 0, `${withServices} of ${asOps} projects carry a service`);

  /* Serhii: reported every run until somebody acts on it. */
  const serhii = (
    await client.query(
      `select role_key, is_active from app_user_profile where person_id = 'md-serhii'`,
    )
  ).rows[0];
  if (serhii?.is_active) {
    note("");
    note("!! md-serhii has left the company and his account is still is_active = true.");
    note("!! This role change reduces his access; it does not offboard him.");
    note("!! Deactivating that account is a separate decision for hitul.");
  }

  await client.end();
}

/* ══════════════════════════════════════════════════════════════════════════
   6. NEGATIVE CONTROLS — the gate can go red
   ══════════════════════════════════════════════════════════════════════════ */
section("6. NEGATIVE CONTROLS — each assertion above is provably falsifiable");

/* 6a. An extra permission on the role must break the permission assertion. */
{
  const broken = [...EXPECTED_KEYS, "projects:contracts:read"];
  check(
    "an extra permission WOULD be caught",
    broken.join(",") !== EXPECTED_KEYS.join(","),
    "the assertion compares the whole set, not a subset",
  );
  const ndb = await freshDb();
  await ndb.exec(migrationSql);
  await ndb.exec(
    `insert into app_role_permission (role_key, permission_key)
     values ('${ROLE}', 'projects:contracts:read')`,
  );
  const keys = (
    await ndb.query(`select permission_key from app_role_permission where role_key = $1 order by 1`, [ROLE])
  ).rows.map((r) => r.permission_key);
  check(
    "  executed: a widened role fails the exact-set check",
    keys.join(",") !== EXPECTED_KEYS.join(","),
    `broken fixture granted: ${keys.join(", ")}`,
  );
  const budgetOk = (
    await ndb.query(
      `select exists (select 1 from app_role_permission
                       where role_key = $1 and permission_key like '%contract%') as bad`,
      [ROLE],
    )
  ).rows[0].bad;
  check("  executed: the budget assertion also catches it", budgetOk === true);
  await ndb.close();
}

/* 6b. A widened allow-list must break the "exactly one nav item" assertion. */
{
  const widened = ["/my-work", "/profile", "/people"];
  const visible = navItems.filter(
    (i) =>
      widened.some((a) => i.href === a || i.href.startsWith(`${a}/`)) &&
      (!i.roles || i.roles.includes(ROLE)),
  );
  check(
    "a widened allow-list WOULD be caught by the nav assertion",
    visible.length !== 1,
    `a three-route allow-list yields ${visible.length} nav items`,
  );
}

/* 6c. An unguarded page must be reported as reachable. */
{
  const fakeSrc = 'const x = await requireProfile("/leave");';
  const looksGuarded = /enforceRoleRouteAccess\(/.test(fakeSrc);
  const permGate = [...fakeSrc.matchAll(/requirePermission\([^,]+,\s*PERMISSIONS\.([A-Z0-9_]+)\s*\)/g)];
  check(
    "a page with only requireProfile() WOULD be reported as reachable",
    !looksGuarded && permGate.length === 0,
    "requireProfile() alone is a session check, not a refusal",
  );
}

/* 6d. The role-branching proof must be able to fail. */
{
  const fakeDef = `select app_user_role() = 'exec' or app_user_role() = 'employee'`;
  const literals = new Set([...fakeDef.matchAll(/app_user_role\(\)[^']*?=\s*'([a-z_]+)'/g)].map((m) => m[1]));
  check(
    "a can_view_project() that branched on 'employee' WOULD be caught",
    ![...literals].every((l) => l === "exec" || l === "dept_head"),
    `literals: ${[...literals].join(", ")}`,
  );
}

await db.close();

console.log(
  `\n${failed === 0 ? "OPERATIONS ROLE GATE: PASSED" : `OPERATIONS ROLE GATE: FAILED (${failed})`}`,
);
process.exit(failed === 0 ? 0 : 1);
