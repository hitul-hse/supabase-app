/**
 * Prove that "my customers and projects" shows a person THEIR work and nobody
 * else's -- and that the speed fix did not buy that speed with visibility.
 *
 * THREE THINGS ARE ASSERTED, IN ORDER OF HOW BADLY THEY FAIL
 * ----------------------------------------------------------
 * 1. EQUIVALENCE. The hoisted can_view_project()/can_view_person() return the
 *    EXACT same row set as the original per-row predicate, for every role, on a
 *    real Postgres (PGlite). This is the one that matters: a policy rewrite that
 *    got fast by widening access is a data leak that looks like a performance
 *    win, and nothing else in the suite would notice.
 * 2. WIRING. /my-work is reachable -- present in the sidebar nav and carrying a
 *    real icon rather than the generic fallback dot. The page existed for a
 *    while with neither, which made it dead code that happened to compile.
 * 3. ATTRIBUTION. my-work.ts's union rule: a project you both own and are
 *    assigned to appears ONCE, as owner. Double counting there would report 60
 *    projects for a person who has 54.
 *
 * WHY PGlite AND NOT THE LIVE DATABASE
 * ------------------------------------
 * The equivalence claim needs BOTH predicates evaluated against the SAME rows,
 * and the old one no longer exists in production. A fixture lets both run side
 * by side. The live numbers are measured separately by
 * scripts/apply-project-policy-hoisting.mjs, which refuses to finish if any
 * person's visible row count moved.
 */
import { readFileSync, existsSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";

let failed = 0;
const check = (name, ok, detail = "") => {
  if (!ok) failed += 1;
  console.log(`${ok ? "PASS" : "FAIL"}: ${name}${detail ? ` — ${detail}` : ""}`);
};

const MIGRATION = "supabase/migrations/20260824180000_hoist_project_person_policies.sql";
const TILE_MIGRATION = "supabase/migrations/20260824190000_add_my_work_module.sql";
const NAV = "src/components/SidebarNav.tsx";
const ICONS = "src/components/nav-icons.tsx";
const QUERY = "src/lib/queries/my-work.ts";
const PAGE = "src/app/(app)/my-work/page.tsx";

/** Comments describe intent; they must never satisfy an assertion about code. */
const stripComments = (s) =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "").replace(/^\s*--.*$/gm, "");

/* ─────────────────────────── 1. EQUIVALENCE ─────────────────────────────── */

const db = new PGlite();

await db.exec(`
  create table public.people (
    id text primary key,
    name text not null,
    department text,
    is_active boolean not null default true
  );
  create table public.projects (
    id text primary key,
    name text not null,
    customer text,
    department text,
    owner_person_id text references public.people(id)
  );
  create table public.person_assignments (
    id bigserial primary key,
    person_id text not null references public.people(id),
    project_id text references public.projects(id),
    share_percent int
  );
  create table public.app_user_profile (
    user_id uuid primary key,
    person_id text references public.people(id),
    role_key text not null,
    department text,
    is_active boolean not null default true
  );

  insert into public.people (id, name, department) values
    ('md-mathias',  'Mathias',  'OPERATIONS'),
    ('md-hendryk',  'Hendryk',  'OPERATIONS'),
    ('md-thorsten', 'Thorsten', 'OPERATIONS'),
    ('md-bjrn',     'Björn',    'MANAGEMENT'),
    ('md-lab',      'Lab Person','LAB');

  insert into public.projects (id, name, customer, department, owner_person_id) values
    ('p-own-1',   'Mathias owns 1', 'HOCHTIEF',   'OPERATIONS', 'md-mathias'),
    ('p-own-2',   'Mathias owns 2', 'BerlinAnalytix','OPERATIONS','md-mathias'),
    ('p-both',    'Owned+assigned', 'Elbe',       'OPERATIONS', 'md-mathias'),
    ('p-assign-1','Assigned only',  'MBition',    'OPERATIONS', 'md-hendryk'),
    ('p-assign-2','Assigned only 2','KIKO',       'LAB',        'md-hendryk'),
    ('p-other',   'Nobody else s',  'Caseking',   'LAB',        'md-lab'),
    ('p-orphan',  'No owner',       'Theion',     null,         null);

  insert into public.person_assignments (person_id, project_id, share_percent) values
    ('md-mathias', 'p-both',     100),
    ('md-mathias', 'p-assign-1', 0),
    ('md-mathias', 'p-assign-2', 0),
    ('md-hendryk', 'p-assign-1', 100),
    ('md-lab',     'p-other',    100);

  insert into public.app_user_profile (user_id, person_id, role_key, department) values
    ('00000000-0000-0000-0000-000000000001', 'md-mathias',  'employee',  'OPERATIONS'),
    ('00000000-0000-0000-0000-000000000002', 'md-thorsten', 'dept_head', 'OPERATIONS'),
    ('00000000-0000-0000-0000-000000000003', 'md-bjrn',     'exec',      'MANAGEMENT'),
    ('00000000-0000-0000-0000-000000000004', 'md-lab',      'employee',  'LAB');
`);

// auth.uid() stands in for the session. A settable GUC is exactly how Supabase
// resolves it in production, so the shape of the test matches the shape of the
// thing being tested.
await db.exec(`
  create schema if not exists auth;
  create or replace function auth.uid() returns uuid
  language sql stable as $$ select nullif(current_setting('test.uid', true), '')::uuid $$;

  create or replace function app_user_role() returns text
  language sql stable as $$ select role_key from app_user_profile where user_id = auth.uid() and is_active $$;
  create or replace function app_user_department() returns text
  language sql stable as $$ select department from app_user_profile where user_id = auth.uid() and is_active $$;
  create or replace function app_user_person_id() returns text
  language sql stable as $$ select person_id from app_user_profile where user_id = auth.uid() and is_active $$;
`);

// The ORIGINAL predicates, under a different name so both can be evaluated on
// the same rows in the same session.
await db.exec(`
  create or replace function old_can_view_project(target_project_id text)
  returns boolean language sql stable as $$
    select app_user_role() = 'exec'
      or exists (
        select 1 from projects pr where pr.id = target_project_id and (
          (app_user_role() = 'dept_head' and pr.department = app_user_department())
          or pr.owner_person_id = app_user_person_id()
          or exists (select 1 from person_assignments pa where pa.project_id = pr.id and pa.person_id = app_user_person_id())
        )
      );
  $$;
  create or replace function old_can_view_person(target_person_id text)
  returns boolean language sql stable as $$
    select app_user_role() = 'exec'
      or (app_user_role() = 'dept_head'
          and exists (select 1 from people p where p.id = target_person_id and p.department = app_user_department()))
      or target_person_id = app_user_person_id();
  $$;
`);

// Apply the migration under test. `security definer` and the index DDL are
// fine in PGlite; the point is that the FUNCTION BODIES are the shipped ones.
const migrationSql = readFileSync(MIGRATION, "utf8");
try {
  await db.exec(migrationSql);
  check("the hoisting migration executes against a real Postgres", true);
} catch (e) {
  check("the hoisting migration executes against a real Postgres", false, String(e.message).slice(0, 120));
}

// Idempotent: a migration that cannot be re-run is a migration nobody dares run.
try {
  await db.exec(migrationSql);
  check("the hoisting migration is idempotent (runs twice)", true);
} catch (e) {
  check("the hoisting migration is idempotent (runs twice)", false, String(e.message).slice(0, 120));
}

const USERS = [
  ["mathias (employee)", "00000000-0000-0000-0000-000000000001"],
  ["thorsten (dept_head)", "00000000-0000-0000-0000-000000000002"],
  ["bjorn (exec)", "00000000-0000-0000-0000-000000000003"],
  ["lab person (employee)", "00000000-0000-0000-0000-000000000004"],
];

for (const [label, uid] of USERS) {
  await db.exec(`select set_config('test.uid', '${uid}', false)`);

  const oldRows = await db.query(
    `select id from projects where old_can_view_project(id) order by id`,
  );
  const newRows = await db.query(
    `select id from projects where can_view_project(id) order by id`,
  );
  const a = oldRows.rows.map((r) => r.id).join(",");
  const b = newRows.rows.map((r) => r.id).join(",");
  check(
    `projects: hoisted predicate is row-identical for ${label}`,
    a === b,
    a === b ? `${newRows.rows.length} rows` : `old=[${a}] new=[${b}]`,
  );

  const oldP = await db.query(`select id from people where old_can_view_person(id) order by id`);
  const newP = await db.query(`select id from people where can_view_person(id) order by id`);
  const c = oldP.rows.map((r) => r.id).join(",");
  const d = newP.rows.map((r) => r.id).join(",");
  check(
    `people: hoisted predicate is row-identical for ${label}`,
    c === d,
    c === d ? `${newP.rows.length} rows` : `old=[${c}] new=[${d}]`,
  );
}

// Absolute claims, not just "the same as before": if BOTH predicates were
// broken in the same way, every equivalence check above would still pass.
await db.exec(`select set_config('test.uid', '00000000-0000-0000-0000-000000000001', false)`);
const mathias = (await db.query(`select id from projects where can_view_project(id) order by id`)).rows.map((r) => r.id);
check(
  "an employee sees exactly what they own or are assigned to",
  mathias.join(",") === "p-assign-1,p-assign-2,p-both,p-own-1,p-own-2",
  mathias.join(","),
);
check("an employee does NOT see another person's project", !mathias.includes("p-other"));
check("an employee does NOT see an unowned project", !mathias.includes("p-orphan"));

await db.exec(`select set_config('test.uid', '00000000-0000-0000-0000-000000000003', false)`);
const exec = (await db.query(`select count(*)::int as n from projects where can_view_project(id)`)).rows[0].n;
check("an exec still sees every project", exec === 7, `${exec} of 7`);

await db.exec(`select set_config('test.uid', '00000000-0000-0000-0000-000000000002', false)`);
const head = (await db.query(`select id from projects where can_view_project(id) order by id`)).rows.map((r) => r.id);
check(
  "a dept_head sees their department, not another's",
  head.includes("p-own-1") && !head.includes("p-other"),
  head.join(","),
);

// The hoist is the whole point of the migration: without the scalar subqueries
// the predicate is correct and unusably slow, which is how this shipped.
const projSrc = (await db.query(
  `select pg_get_functiondef(oid) as def from pg_proc where proname = 'can_view_project'`,
)).rows[0].def;
/**
 * EVERY call must be hoisted, not merely one of them.
 *
 * The first version of this check tested `/\(select app_user_role\(\)\)/`, i.e.
 * "does at least one hoisted call exist". can_view_project calls
 * app_user_role() TWICE, so reverting the first one back to a bare call left the
 * second still wrapped -- and the check passed while the function was straight
 * back to its per-row cost. Counting bare calls is the only form that catches a
 * partial revert.
 */
function unhoisted(src, fn) {
  const bare = [...src.matchAll(new RegExp(`${fn}\\(\\)`, "gi"))].length;
  const wrapped = [...src.matchAll(new RegExp(`\\(\\s*select\\s+${fn}\\(\\)\\s*\\)`, "gi"))].length;
  // Every wrapped occurrence also matches the bare pattern, so the difference is
  // the number of call sites still evaluated per row.
  return bare - wrapped;
}

for (const fn of ["app_user_role", "app_user_department", "app_user_person_id"]) {
  const n = unhoisted(projSrc, fn);
  check(
    `can_view_project: every ${fn}() call is hoisted into a scalar subquery`,
    n === 0,
    n === 0 ? "" : `${n} bare call(s) remain`,
  );
}

const personSrc = (await db.query(
  `select pg_get_functiondef(oid) as def from pg_proc where proname = 'can_view_person'`,
)).rows[0].def;
for (const fn of ["app_user_role", "app_user_department", "app_user_person_id"]) {
  const n = unhoisted(personSrc, fn);
  check(
    `can_view_person: every ${fn}() call is hoisted`,
    n === 0,
    n === 0 ? "" : `${n} bare call(s) remain`,
  );
}

// The index is half the fix -- without it the EXISTS is a sequential scan per
// candidate row, which is where the 82k buffer hits came from.
const idx = await db.query(
  `select indexname from pg_indexes where tablename = 'person_assignments' and indexname like '%person%'`,
);
check(
  "person_assignments is indexed on (person_id, project_id)",
  idx.rows.some((r) => r.indexname === "person_assignments_person_project_idx"),
  idx.rows.map((r) => r.indexname).join(", "),
);
const idx2 = await db.query(
  `select indexname from pg_indexes where tablename = 'projects' and indexname = 'projects_owner_person_idx'`,
);
check("projects is indexed on owner_person_id", idx2.rows.length === 1);

await db.close();

/* ─────────────────────────────── 2. WIRING ──────────────────────────────── */

const nav = stripComments(readFileSync(NAV, "utf8"));
check('the sidebar has a "/my-work" entry', /href:\s*"\/my-work"/.test(nav));
check('the sidebar entry is labelled "My Work"', /href:\s*"\/my-work"[^}]*label:\s*"My Work"/.test(nav));
check(
  "My Work is in RECORDS, above People",
  nav.indexOf('"/my-work"') > nav.indexOf('title: "RECORDS"') &&
    nav.indexOf('"/my-work"') < nav.indexOf('"/people"'),
);
check(
  "My Work has no roles gate (everyone has a book of work)",
  !/href:\s*"\/my-work"[^}]*roles:/.test(nav),
);

const icons = stripComments(readFileSync(ICONS, "utf8"));
check(
  "/my-work has a real nav icon, not the fallback dot",
  /"\/my-work":\s*Icon(?!Dot)\w+/.test(icons),
);
check("IconMyWork is defined", /export function IconMyWork/.test(icons));

const tile = readFileSync(TILE_MIGRATION, "utf8");
check("the portal tile migration inserts a my_work module", /insert into public\.app_module[\s\S]*'my_work'/.test(tile));
check("the tile points at /my-work", /'\/my-work'/.test(tile));
check(
  "tile visibility is derived from people:read_own, the one permission every role holds",
  /permission_key\s*=\s*'people:read_own'/.test(stripComments(tile)),
);
check(
  "the tile grant is derived from an existing grant, not a hard-coded role list",
  /insert into public\.app_role_permission[\s\S]*select\s+rp\.role_key/.test(stripComments(tile)),
);

/* ─────────────────────────── 3. ATTRIBUTION ─────────────────────────────── */

/**
 * The query module and page are landing in a separate commit, so this section
 * REPORTS rather than asserts when they are absent.
 *
 * Discovered the hard way: the first version read them unconditionally and
 * crashed with ENOENT on a clean checkout -- i.e. the gate depended on files it
 * was not committing, which is precisely the half-committed-feature failure it
 * exists to prevent. A gate that cannot run is worse than one that says what it
 * could not check.
 */
if (!existsSync(QUERY) || !existsSync(PAGE)) {
  console.log(
    `SKIP: ${QUERY} / ${PAGE} not present in this checkout — attribution rules not checked here.`,
  );
  console.log("      (they are asserted once those files land; scoping and wiring above still ran)");
  console.log(`\n${failed === 0 ? "OK" : `${failed} FAILED`}`);
  process.exit(failed === 0 ? 0 : 1);
}

const query = readFileSync(QUERY, "utf8");
const querySrc = stripComments(query);
check(
  "getMyWork takes no person id -- identity comes from the session",
  /export async function getMyWork\(\s*supabase:\s*SupabaseTyped\s*\)/.test(querySrc),
);
check(
  "it resolves the caller through auth.getUser()",
  /supabase\.auth\.getUser\(\)/.test(querySrc),
);
// Deliberately loose about WHICH claims exist: the module has since grown
// "responsible" and "replacement" alongside owner/assigned. Pinning the exact
// identifier list would fail on a correct refactor. What must hold is the
// PROPERTY -- a project you have no claim on at all is skipped.
check(
  "a row with no claim at all is dropped",
  /if\s*\(!isOwner\s*&&\s*!isAssigned[^)]*\)\s*continue/.test(querySrc),
);
// Likewise: the roles form a strict ladder and exactly one rung is assigned, so
// a project reachable two ways still appears once. Asserted via ROLE_ORDER
// (the declared precedence) plus a single-assignment `const role`, not via the
// shape of the ternary.
check(
  "roles are a declared precedence ladder, so one project yields one row",
  /ROLE_ORDER\s*:\s*MyRole\[\]\s*=\s*\[/.test(querySrc) &&
    /const\s+role\s*:\s*MyRole\s*=/.test(querySrc),
);
check(
  "ownership outranks assignment in that ladder",
  (() => {
    const m = /ROLE_ORDER\s*:\s*MyRole\[\]\s*=\s*\[([^\]]*)\]/.exec(querySrc);
    if (!m) return false;
    const order = m[1].split(",").map((s) => s.trim().replace(/"/g, ""));
    return order.indexOf("owner") !== -1 && order.indexOf("owner") < order.indexOf("assigned");
  })(),
);
check(
  "an unset budget stays null rather than becoming 0%",
  /n\s*!==\s*null\s*&&\s*n\s*>\s*0\s*\?\s*n\s*:\s*null/.test(querySrc),
);
check(
  "an unlinked account is reported, not rendered as an empty book of work",
  /unlinked/.test(querySrc) && /emptyWork\([^)]*true\)/.test(querySrc),
);

const page = stripComments(readFileSync(PAGE, "utf8"));
check(
  "the page uses the cookie-bound server client, never the service role",
  /createClient\(\)/.test(page) && !/SERVICE_ROLE/.test(page),
);
check(
  "the page gates on a session but not on a wider permission",
  /requireProfile\(/.test(page) && !/requirePermission\(/.test(page),
);

/* ── the union rule, exercised rather than pattern-matched ───────────────── */

const { assembleMyWork } = await import("../src/lib/queries/my-work.ts").catch(() => ({}));
if (typeof assembleMyWork === "function") {
  const work = assembleMyWork(
    "md-mathias",
    "Mathias",
    [
      { id: "p-both", code: "A", name: "Owned+assigned", customer: "Elbe", status: "active", contract_hours: 10, logged_hours: 5, owner_person_id: "md-mathias", due: null },
      { id: "p-assign", code: "B", name: "Assigned", customer: "MBition", status: "active", contract_hours: 0, logged_hours: 3, owner_person_id: "md-hendryk", due: "n/a" },
      { id: "p-foreign", code: "C", name: "Not mine", customer: "X", status: "active", contract_hours: 5, logged_hours: 1, owner_person_id: "md-lab", due: null },
    ],
    [
      { person_id: "md-mathias", project_id: "p-both", project_name: "Owned+assigned", logged_hours: 2, share_percent: 100 },
      { person_id: "md-mathias", project_id: "p-assign", project_name: "Assigned", logged_hours: 1, share_percent: 0 },
    ],
  );
  check("a project owned AND assigned is counted once", work.totals.projects === 2, `${work.totals.projects}`);
  check("it is counted as owned", work.totals.owned === 1, `${work.totals.owned}`);
  check("a project that is neither owned nor assigned is excluded", !work.projects.some((p) => p.id === "p-foreign"));
  check(
    "a 0 contract yields a null consumed percent, never 0%",
    work.projects.find((p) => p.id === "p-assign")?.consumedPercent === null,
  );
  check(
    'a due date of "n/a" becomes null rather than a literal string',
    work.projects.find((p) => p.id === "p-assign")?.dueDate === null,
  );
  check("customers are grouped from the surviving projects", work.totals.customers === 2, `${work.totals.customers}`);
} else {
  // Node cannot import .ts directly on every version; the source assertions
  // above still cover the rule, so say what was skipped rather than pass.
  console.log("SKIP: assembleMyWork not importable here (source assertions still applied)");
}

console.log(`\n${failed === 0 ? "OK" : `${failed} FAILED`}`);
process.exitCode = failed === 0 ? 0 : 1;
