/*
 * Every view must run with the CALLER's rights, or be allow-listed here with a
 * reason a person wrote down.
 *
 * WHY THIS EXISTS AS A GENERAL GATE. A view without `security_invoker` runs
 * with its owner's rights, and the owner is `postgres`, which is exempt from
 * row-level security. So the view is a path to a protected table that skips
 * every policy on it -- a table that looks safe and an endpoint that is not.
 * This has now happened twice:
 *
 *   public.budget_alert_feed      served customer names, staff names, budget
 *                                 overruns and notification email addresses to
 *                                 ANONYMOUS callers (fixed 20260825141000).
 *   time.contract_period_status   served every project's budget, dates and
 *                                 contract reference to any signed-in caller,
 *                                 including deactivated accounts whose role
 *                                 resolves to nothing (fixed 20260903090000).
 *
 * The second one is the reason this file enumerates instead of naming. Every
 * check that existed inspected views BY NAME -- a hard-coded list written
 * before contract periods were built -- so a view added later was never on
 * anybody's list and nothing failed. A gate that only knows the views it was
 * told about cannot catch the next one.
 *
 * WHAT IT CHECKS. Every `create [or replace] view` statement in supabase/*.sql
 * and supabase/migrations/*.sql must carry `with (security_invoker = true)`
 * INLINE, or name the view in ALLOWED below.
 *
 * WHY INLINE, AND NOT "SOMEWHERE A LATER ALTER FIXES IT". `create or replace
 * view` with no WITH clause RESETS reloptions to null -- verified in PGlite,
 * and the mechanism by which the August fix could have been quietly undone:
 * supabase/APPLY-IN-SQL-EDITOR.sql re-creates budget_alert_feed, its own header
 * says "SAFE TO RE-RUN", and re-running it would have put the view back on
 * owner rights with no error and nothing to see. A fix that only exists in an
 * `alter` is a fix that any replay of the source file removes.
 *
 * WHAT IT DOES NOT CHECK. This is a source-side gate: it reads the SQL in the
 * repository, not the live database, so it runs in CI with no credentials. The
 * live state is a separate question and drifts -- confirm it read-only with:
 *
 *     select n.nspname, c.relname, c.reloptions
 *       from pg_class c join pg_namespace n on n.oid = c.relnamespace
 *      where c.relkind in ('v','m')
 *        and n.nspname in ('public','time','crm','projects','raw','stg');
 *
 * Run: npm run check:views-are-invoker
 */
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, "..");

const SCHEMAS = ["public", "time", "crm", "projects", "raw", "stg"];

/*
 * The deliberate bypasses. Each one is a view whose whole purpose is to be
 * company-wide, and each is safe only because of what it does NOT project.
 * Adding an entry here is a decision, not a formality: say what it exposes and
 * why the RLS it skips would make the feature pointless.
 */
const ALLOWED = {
  "public.org_chart_nodes":
    "Org chart nodes: id, name, role, department, manager_id, and nothing else — no rates, "
    + "holiday balances or certificates. people's read policy is can_view_person(), so an "
    + "invoker-rights org chart shows an employee only herself. Tried in August and reverted: "
    + "every non-exec dropped from 26 nodes to 1. See 20260825141000_views_must_not_bypass_rls.sql.",
  "public.user_display_names":
    "user_id -> display name only. app_user_profile's own policy lets you read your own row "
    + "unless you are exec, so with invoker rights every comment author but yourself reads "
    + "'Team member'. Guarded by npm run test:task-comments-rls.",
  "time.org_chart":
    "The real 49-member roster: identity and reporting line. Deliberately omits user_id, "
    + "weekly_hours and everything from member_rate/member_utilisation — what it omits IS the "
    + "boundary. time.member's read policy is can_view_member(id), which is right for hours and "
    + "useless for a chart (rendered as an employee it read '0 OF 1 PLACED'). Argued at length "
    + "in supabase/migrations/add_org_chart_view.sql; guarded by npm run test:time-org-chart-view.",
};

/** Strip block and line comments so prose about SQL is not read as SQL. */
const stripComments = (sql) => sql
  .replace(/\/\*[\s\S]*?\*\//g, " ")
  .split("\n")
  .map((line) => {
    const i = line.indexOf("--");
    return i === -1 ? line : line.slice(0, i);
  })
  .join("\n");

const CREATE_VIEW = /create\s+(?:or\s+replace\s+)?(materialized\s+)?view\s+(?:if\s+not\s+exists\s+)?([a-zA-Z0-9_."]+)/gi;

/** Every create-view statement in one file, with whether the WITH clause is inline. */
function scan(sql, label) {
  const found = [];
  const clean = stripComments(sql);
  for (const m of clean.matchAll(CREATE_VIEW)) {
    const raw = m[2].replace(/"/g, "");
    const qualified = raw.includes(".") ? raw.toLowerCase() : `public.${raw.toLowerCase()}`;
    // The WITH clause always sits between the view name and the AS that opens
    // the query, so that is the only span worth reading.
    const rest = clean.slice(m.index + m[0].length);
    const asAt = rest.search(/\bas\b/i);
    const head = asAt === -1 ? rest.slice(0, 400) : rest.slice(0, asAt);
    found.push({
      view: qualified,
      materialized: Boolean(m[1]),
      invoker: /security_invoker\s*=\s*true/i.test(head),
      where: `${label}:${clean.slice(0, m.index).split("\n").length}`,
    });
  }
  return found;
}

function sqlFiles() {
  const files = [];
  for (const f of readdirSync(join(repo, "supabase"))) {
    if (f.endsWith(".sql")) files.push(join(repo, "supabase", f));
  }
  for (const f of readdirSync(join(repo, "supabase", "migrations")).sort()) {
    if (f.endsWith(".sql")) files.push(join(repo, "supabase", "migrations", f));
  }
  return files;
}

/** The gate itself, as a function, so the negative control can run it too. */
function audit(sources) {
  const statements = sources.flatMap(({ sql, label }) => scan(sql, label));
  const problems = [];
  for (const s of statements) {
    if (s.invoker) continue;
    if (ALLOWED[s.view]) continue;
    if (!SCHEMAS.includes(s.view.split(".")[0])) continue;
    problems.push(s);
  }
  return { statements, problems };
}

let failures = 0;
const check = (label, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}: ${label}${detail ? `\n        ${detail}` : ""}`);
  if (!ok) failures += 1;
};

const sources = sqlFiles().map((f) => ({ sql: readFileSync(f, "utf8"), label: relative(repo, f) }));
const { statements, problems } = audit(sources);

const views = [...new Set(statements.map((s) => s.view))].sort();
console.log(`scanned ${sources.length} SQL files, ${statements.length} create-view statements, ${views.length} distinct views\n`);

check(
  "the scan found views at all (a regex that matches nothing passes everything)",
  statements.length >= 20,
  `${statements.length} statements`,
);

for (const view of views) {
  const all = statements.filter((s) => s.view === view);
  const bad = all.filter((s) => !s.invoker);
  if (ALLOWED[view]) {
    console.log(`ALLOWED: ${view} — ${ALLOWED[view].slice(0, 90)}…`);
    continue;
  }
  check(
    `${view} is created with security_invoker in all ${all.length} place(s)`,
    bad.length === 0,
    bad.length ? `missing at ${bad.map((b) => b.where).join(", ")}` : "",
  );
}

// An allow-list entry that no longer matches anything is a justification for a
// view that no longer exists — it stops protecting anything and starts hiding
// the next one that takes the same name.
for (const view of Object.keys(ALLOWED)) {
  check(
    `allow-list entry ${view} still corresponds to a real view`,
    views.includes(view),
    views.includes(view) ? "" : "no create-view statement found — remove the entry",
  );
  check(
    `allow-list entry ${view} carries a written justification`,
    (ALLOWED[view] ?? "").trim().length >= 80,
  );
}

// Materialized views cannot be security_invoker at all; if one appears it needs
// a deliberate decision rather than a silent pass.
for (const s of statements.filter((x) => x.materialized)) {
  check(
    `materialized view ${s.view} is allow-listed (matviews always run as their owner)`,
    Boolean(ALLOWED[s.view]),
    s.where,
  );
}

check(
  "no view outside the allow-list bypasses RLS",
  problems.length === 0,
  problems.map((p) => `${p.view} at ${p.where}`).join("\n        "),
);

/* --------------------------------------------------------- negative control */

// A gate nobody has watched fail is a gate nobody knows works. Run the same
// analyser over a source file that does exactly what contract_period_status did.
const planted = audit([{
  sql: "create or replace view time.brand_new_leak as select * from time.project_contract_period;",
  label: "(negative control)",
}]);
check(
  "negative control: a NEW non-invoker view is reported as a failure",
  planted.problems.length === 1 && planted.problems[0].view === "time.brand_new_leak",
  JSON.stringify(planted.problems),
);

// And the mirror image: the same view WITH the clause must pass, or the gate is
// just failing everything.
const plantedOk = audit([{
  sql: "create or replace view time.brand_new_leak\nwith (security_invoker = true) as select 1;",
  label: "(negative control)",
}]);
check(
  "negative control: the same view WITH security_invoker passes",
  plantedOk.problems.length === 0,
);

console.log(failures === 0
  ? "\nEVERY VIEW EITHER RESPECTS RLS OR IS A DOCUMENTED DECISION"
  : `\n${failures} check(s) failed`);
process.exit(failures === 0 ? 0 : 1);
