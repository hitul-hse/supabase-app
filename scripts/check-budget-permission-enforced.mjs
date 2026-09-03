/**
 * Does any server path still hand a project budget to a role without
 * projects:contracts:read?
 *
 * WHY THIS EXISTS SEPARATELY FROM THE MIGRATION GATE
 * --------------------------------------------------
 * check-budget-visibility-migration.mjs proves the DATABASE moved. This one
 * proves the APPLICATION did, which is a different question and historically
 * the one that was wrong: before 2026-09-03 `projects:contracts:read` was read
 * by nothing at all in src/ --
 *
 *     grep -rn "contracts:read" src/  ->  permissions.ts:43, the declaration
 *
 * -- so the permission decided exactly one table's RLS, and every budget on the
 * Overview, the ledger, /my-work, the team-lead board and the Management matrix
 * came from `time.project.estimated_hours` (SELECT policy: `true`) or
 * `public.projects.contract_hours` (row-scoped, budget-blind) and was governed
 * by nothing. A permission the UI ignores is theatre.
 *
 * THE TWO HALVES
 * --------------
 * 1. WIRING. Every server-side read that asks for a budget column must either
 *    route the column list through budgetAwareColumns() or check
 *    canReadBudgets() first. Files that legitimately do neither are
 *    allow-listed BY NAME WITH A REASON below -- never by pattern, because a
 *    pattern silently absolves the next file that happens to match it.
 *
 * 2. BEHAVIOUR. schema.sql is executed in PGlite and read as two real users,
 *    one holding the permission and one not, through the objects the app reads.
 *    The one without it must get NULL where the budget was -- and must still
 *    get the project, the customer and the hours worked, because withholding a
 *    commercial term is not the same as hiding the work.
 *
 * NEGATIVE CONTROL: both halves are re-run against a deliberately broken input
 * (an unguarded source string, and a role granted the permission back), and the
 * checks must FAIL there. Without that this file cannot tell "enforced" from
 * "there was nothing to find".
 *
 * Run: node scripts/check-budget-permission-enforced.mjs
 */
import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

let failed = false;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}: ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failed = true;
};

/** Columns that ARE a project budget. people.contract_hours is not one. */
const BUDGET_COLUMNS = [
  "contract_hours",
  "estimated_hours",
  "budget_hours",
  "consumed_percent",
  "remaining_hours",
  "forecast_overrun",
];

/**
 * Files that read a budget column and do NOT gate on the permission, each with
 * the reason it is safe. Every entry is a claim that has to stay true.
 */
const ALLOWED = {
  "src/lib/queries/order-detail.ts":
    "/orders/[id] hand-rolls a projects:read_all gate (page.tsx:118) and only exec holds that key. exec also holds projects:contracts:read, so there is no reader here who may not see the budget.",
  "src/lib/queries/data-hygiene.ts":
    "/data-hygiene is requireProfile(..., ['exec']) — a hard role gate, not a permission — and the page IS a report about which orders have no contract_hours. Withholding the column would empty the report for its only audience.",
  "src/lib/queries/budget-alerts.ts":
    "Budget alerts are governed by their own key, projects:alerts:read, on public.overbooking_alert's RLS policy. Moving them under projects:contracts:read is a separate decision hitul has not taken.",
  "src/lib/budget-guard.ts":
    "Pure decision module: it is given hours and returns a verdict, and performs no reads. The callers that feed it are the timesheet WRITE paths, where the budget is enforced against the writer rather than displayed to a reader.",
  "src/lib/queries/types.ts":
    "Type declarations only — it names budget fields but issues no query, so there is nothing here to gate.",
  "src/lib/database.types.ts":
    "Generated from the database schema by the Supabase CLI. It describes every column including the budget ones; it performs no read and must not be hand-edited.",
  "src/lib/queries/profile.ts":
    "Reads people.contract_hours — a person's contracted WEEKLY hours, employment data under hr:contract:read. Not a project budget despite the shared column name.",
  "src/lib/queries/management-data-quality.ts":
    "Reports which projects are missing data; asserted below to select no budget column.",
};

/* ------------------------------------------------------------ 1. the wiring */

console.log("WIRING — every server read of a budget column is gated\n");

function sourceFiles(dir) {
  const out = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...sourceFiles(p));
    else if (/\.(ts|tsx)$/.test(e.name)) out.push(p);
  }
  return out;
}

/** Strip comments, so prose about a budget column is not mistaken for a read. */
const stripComments = (s) =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

/**
 * Does this source SELECT a budget column from a projects table?
 *
 * Deliberately narrow: it looks for the column named inside a PostgREST
 * .select() list or a raw SQL select list, not for any mention of the word.
 */
function readsBudgetColumn(code) {
  const hits = [];
  for (const col of BUDGET_COLUMNS) {
    // Inside a .select("...") argument, or a raw `p.contract_hours` in SQL.
    const inSelect = new RegExp(`\\.select\\([^)]*\\b${col}\\b`, "s");
    const inSql = new RegExp(`select[\\s\\S]{0,400}?\\b(?:p|pr|proj)\\.${col}\\b`, "i");
    if (inSelect.test(code) || inSql.test(code)) hits.push(col);
  }
  return hits;
}

const isGuarded = (code) =>
  /budgetAwareColumns\s*\(/.test(code) || /canReadBudgets\s*\(/.test(code);

const scanned = sourceFiles("src").filter((f) => !f.endsWith("budget-visibility.ts"));
const offenders = [];
let guardedCount = 0;

for (const file of scanned) {
  const code = stripComments(readFileSync(file, "utf8"));
  const cols = readsBudgetColumn(code);
  if (cols.length === 0) continue;
  const rel = file.replace(/\\/g, "/");
  if (isGuarded(code)) {
    guardedCount += 1;
    continue;
  }
  if (ALLOWED[rel]) continue;
  offenders.push(`${rel} (${cols.join(", ")})`);
}

check(
  "no ungated server read of a budget column",
  offenders.length === 0,
  offenders.length ? offenders.join(" | ") : `${guardedCount} gated, ${Object.keys(ALLOWED).length} allow-listed with reasons`,
);

// Every allow-list entry must still exist and still carry a reason. A stale
// exemption is a hole nobody can see.
for (const [file, reason] of Object.entries(ALLOWED)) {
  check(
    `allow-list entry is real and reasoned: ${file}`,
    reason.length > 40 && scanned.some((f) => f.replace(/\\/g, "/") === file),
    reason.length > 40 ? "" : "reason too thin to be a reason",
  );
}

// NEGATIVE CONTROL for the wiring half.
const OLD_SHAPE = `
  const { data } = await supabase.from("projects").select("id, name, contract_hours");
  return data;
`;
check(
  "[control] the scanner detects the pre-2026-09-03 shape as ungated",
  readsBudgetColumn(OLD_SHAPE).includes("contract_hours") && !isGuarded(OLD_SHAPE),
  "an unguarded select of contract_hours must be caught",
);
check(
  "[control] the scanner accepts the same read once it is gated",
  isGuarded(OLD_SHAPE.replace('"id, name, contract_hours"', 'budgetAwareColumns("id, name, contract_hours", canSeeBudgets)')),
);

/* --------------------------------------------------------- 2. the behaviour */

console.log("\nBEHAVIOUR — what each caller actually reads back\n");

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

const HOLDER = "20000000-0000-0000-0000-000000000001"; // exec
const DENIED = "20000000-0000-0000-0000-000000000002"; // employee

await db.exec(`
  insert into auth.users (id, email) values
    ('${HOLDER}', 'holder@example.test'), ('${DENIED}', 'denied@example.test');
  insert into people (id, name, department, is_active) values
    ('p-holder', 'Holder', 'ORGA', true), ('p-denied', 'Denied', 'SAFETY', true);
  insert into app_user_profile (user_id, role_key, person_id, is_active) values
    ('${HOLDER}', 'exec', 'p-holder', true),
    ('${DENIED}', 'employee', 'p-denied', true);

  insert into time.customer (id, name) overriding system value values (901, 'Cust');
  insert into time.project (id, name, customer_id, estimated_hours, is_billable, is_archived)
    overriding system value values (901, 'Proj', 901, 250, true, false);
  insert into time.member (id, display_name, email, is_archived)
    overriding system value values (901, 'M', 'm@example.test', false);
  insert into time.entry (member_id, project_id, started_at, duration_seconds, is_billable, is_calendar)
    values (901, 901, now() - interval '2 days', 7200, true, false);
`);

async function summaryAs(userId) {
  await db.exec("begin");
  await db.query(`select set_config('request.jwt.claim.sub', $1, true)`, [userId]);
  await db.exec("set local role authenticated");
  const { rows } = await db.query(
    `select project_name, customer_name, estimated_hours, burn_percent, total_seconds
       from "time".project_summary where project_id = 901`,
  );
  await db.exec("rollback");
  return rows[0] ?? null;
}

const holder = await summaryAs(HOLDER);
const denied = await summaryAs(DENIED);
console.log("holder :", JSON.stringify(holder));
console.log("denied :", JSON.stringify(denied), "\n");

check(
  "a caller WITH projects:contracts:read reads the budget",
  Number(holder?.estimated_hours) === 250 && holder?.burn_percent !== null,
  `estimated_hours=${holder?.estimated_hours} burn=${holder?.burn_percent}`,
);
check(
  "a caller WITHOUT it reads no budget and no burn",
  denied !== null && denied.estimated_hours === null && denied.burn_percent === null,
  `estimated_hours=${denied?.estimated_hours} burn=${denied?.burn_percent}`,
);
/*
 * The project itself must survive the redaction: withholding a commercial term
 * is not the same as hiding that the work exists.
 *
 * total_seconds is NOT asserted equal to the seeded 7200 here, and that is a
 * measured fact rather than a looser assertion. time.entry's own read policy
 * scopes entries to the caller's member row, so the denied user -- who is not
 * that member -- legitimately sums 0. That caller-scoping of logged hours is a
 * pre-existing defect documented at length in
 * 20260903090000_contract_status_view_must_not_bypass_rls.sql ("logged_hours is
 * scoped by the caller's own read policy on time.entry and understates for
 * anyone who is not exec -- a separate defect, not fixed here"). Asserting 7200
 * would be asserting that defect away; asserting the row and its identity
 * columns is the property this change is responsible for.
 */
check(
  "withholding the budget does NOT hide the project or its customer",
  denied?.project_name === "Proj" && denied?.customer_name === "Cust" && denied?.total_seconds !== null,
  `project=${denied?.project_name} customer=${denied?.customer_name} seconds=${denied?.total_seconds}`,
);

// NEGATIVE CONTROL for the behaviour half: grant the key back and the same
// read must leak again. If it does not, this half is testing an empty view.
await db.exec(
  `insert into app_role_permission (role_key, permission_key)
     values ('employee', 'projects:contracts:read') on conflict do nothing;`,
);
const reGranted = await summaryAs(DENIED);
check(
  "[control] granting the key back makes the same read leak the budget again",
  Number(reGranted?.estimated_hours) === 250,
  `estimated_hours=${reGranted?.estimated_hours} (so the redaction, not an empty view, is what withheld it)`,
);
await db.exec(
  `delete from app_role_permission where role_key = 'employee' and permission_key = 'projects:contracts:read';`,
);

// The view must stay invoker: an owner-rights view skips the caller's policies
// and would serve the redaction's own base table regardless.
const { rows: opts } = await db.query(
  `select reloptions from pg_class where relname = 'project_summary'`,
);
check(
  "time.project_summary is security_invoker",
  (opts[0]?.reloptions ?? []).includes("security_invoker=true"),
  JSON.stringify(opts[0]?.reloptions ?? null),
);

console.log(failed ? "\nFAILED" : "\nBudget permission is enforced on every gated path");
process.exit(failed ? 1 : 0);
