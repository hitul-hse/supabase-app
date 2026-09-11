/*
 * Run the REAL getReassignmentCandidates against the live database.
 *
 * The specific thing this must catch: my first draft of this query joined
 * project_responsibility to person_assignments and reported 85,593 contract
 * hours for one person, because the join fans out. A plausible-looking inflated
 * number is the failure mode here, so the assertions below bound the values
 * against independently-computed truth rather than just checking they are
 * non-empty.
 *
 * "Independently computed" has to mean the same QUESTION, though, and since
 * 6c9c50a (2026-09-03) it did not: see the proxy note further down. The truth
 * query runs as the database owner; the query under test refuses to select a
 * budget column for a caller without projects:contracts:read. Judging one
 * against the other is only satisfiable while nobody owns a measured order, and
 * it was passing on null == null. The arithmetic is now judged as a permitted
 * caller and the withheld posture is asserted separately, so neither half can be
 * vacuous.
 */
import { join, resolve } from "node:path";
import { mkdtempSync, writeFileSync, readFileSync, rmSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
import { loadBindings, transform } from "next/dist/build/swc/index.js";
import { createClient } from "@supabase/supabase-js";
import pg from "pg";
import { record, notRunInChain } from "./lib/gate-result.mjs";

// Guarded: on a CI runner there is no .env.local and the secrets already
// arrive as environment variables. The unguarded read threw ENOENT here before
// the gate could report anything, failing the whole job on a missing file
// rather than on a real defect.
if (existsSync(".env.local")) {
  for (const line of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}

await loadBindings();
const dir = resolve(mkdtempSync(join("node_modules", ".candidates-check-")));
const posix = (p) => p.replace(/\\/g, "/");
const require = createRequire(import.meta.url);

async function compile(srcPath, outName, rewrites = {}) {
  let code = readFileSync(srcPath, "utf8").replace(/^import "server-only";\r?\n/m, "");
  for (const [from, to] of Object.entries(rewrites)) {
    code = code.split(`from "${from}"`).join(`from "${to}"`);
  }
  const out = await transform(code, {
    filename: srcPath,
    jsc: { parser: { syntax: "typescript", tsx: false }, target: "es2022" },
    module: { type: "commonjs" },
  });
  const file = join(dir, outName);
  writeFileSync(file, out.code);
  return file;
}

const serverOnly = join(dir, "server-only.cjs");
writeFileSync(serverOnly, "module.exports = {};");
// The query layer asks src/lib/budget-visibility.ts whether the caller may see
// project budgets before it selects a budget column. Compiled for real rather
// than stubbed: its only runtime import is the constant map in
// @/lib/permissions, so it pulls in no Supabase client, and a stub would let a
// broken gate pass here.
const permissionsFile = await compile("src/lib/permissions.ts", "permissions.cjs");
const budgetVisibilityFile = await compile(
  "src/lib/budget-visibility.ts",
  "budget-visibility.cjs",
  { "@/lib/permissions": posix(permissionsFile) },
);

const modFile = await compile("src/lib/queries/reassignment-candidates.ts", "candidates.cjs", {
  "@/lib/budget-visibility": posix(budgetVisibilityFile),
  "@/lib/database.types": posix(serverOnly),
  "server-only": posix(serverOnly),
});
const { getReassignmentCandidates } = require(modFile);
// The same canReadBudgets() and the same permission key the query itself uses,
// so the posture asserted below cannot drift from the posture enforced above.
const { canReadBudgets } = require(budgetVisibilityFile);
const { PERMISSIONS } = require(permissionsFile);

// No credentials means no live database to read. Say so rather than letting
// createClient throw a bare "supabaseUrl is required.", which on a runner looks
// like a broken gate instead of an absent secret.
if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
  console.log("SKIP: no Supabase credentials, so there is no live database to check");
  notRunInChain();
}

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } },
);

let failures = 0;
const check = (label, ok, detail = "") => {
  record(ok);
  console.log(`${ok ? "PASS" : "FAIL"}: ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures += 1;
};

const PROJECT = "10110_00358_104_01";
console.log(`check-reassignment-candidates-live: who could take over ${PROJECT}?\n`);

/*
 * WHY THIS GATE TALKS TO THE QUERY THROUGH A PROXY
 * ------------------------------------------------
 * getReassignmentCandidates() asks canReadBudgets() before it builds its select
 * list, and budgetAwareColumns() then drops contract_hours for a caller without
 * projects:contracts:read. app_user_has_permission() resolves the caller through
 * app_user_profile -> auth.uid(), and auth.uid() is NULL for a service-role
 * client: the key this gate authenticates with is the ONE caller in the world
 * with no profile row, so it is the one caller that gets the budget withheld.
 *
 * The truth side, meanwhile, is pg.Client on SUPABASE_DB_URL as the database
 * owner reading public.projects.contract_hours raw -- no RLS, no permission, no
 * redaction. Comparing those two is not an independent recomputation of the same
 * question, it is a DIFFERENT question, and it can only be satisfied while
 * nobody owns a measured order. That is what it was doing: both sides read null
 * and the assertion passed on null == null, which under this repo's own rule --
 * an assertion that asserts nothing is red -- was never green.
 *
 * And it has been RED, not merely vacuous, for about a week -- since 6c9c50a
 * itself, not since today's masterdata promote. Dating ownership by the vintage
 * of its project_responsibility row: 125 of the 209 owned projects, carrying
 * 4521.8h, have responsible rows older than today, and that includes all 1638.0h
 * of the largest portfolio. The truth side was already a number for these owners
 * long before the promote wrote anything. The query's arithmetic never changed.
 * It was simply never being asked.
 *
 * So the arithmetic is judged against a caller in the SAME permission posture as
 * the humans this panel is built for. Nothing in src/lib is stubbed: the real
 * canReadBudgets(), the real budgetAwareColumns() and the real query all run,
 * and every other read -- people, project_responsibility, time.member,
 * time.entry -- goes through to the real client untouched. Only the database's
 * answer to "does this caller hold projects:contracts:read" is supplied. The
 * withheld posture is then asserted on its own below, with the raw client,
 * rather than being the accidental subject of every assertion here.
 */
const asPermittedCaller = (client) =>
  new Proxy(client, {
    get(target, prop, receiver) {
      if (prop === "rpc") {
        return async (fn, args) =>
          fn === "app_user_has_permission" && args?.p_key === PERMISSIONS.PROJECTS_CONTRACTS_READ
            ? { data: true, error: null }
            : target.rpc(fn, args);
      }
      const v = Reflect.get(target, prop, receiver);
      return typeof v === "function" ? v.bind(target) : v;
    },
  });

const permitted = asPermittedCaller(supabase);

// The proxy's premise, asserted rather than trusted to a comment. The
// interception matches on the permission KEY; if PERMISSIONS.PROJECTS_CONTRACTS_READ
// ever changes value it stops matching, the call falls through to the real RPC,
// and every assertion below would go red for a reason that has nothing to do
// with the query it is meant to be judging.
check(
  "the proxied caller really answers yes to projects:contracts:read",
  (await canReadBudgets(permitted)) === true,
  `canReadBudgets() resolves ${PERMISSIONS.PROJECTS_CONTRACTS_READ}`,
);

const rows = await getReassignmentCandidates(permitted, PROJECT);

console.log("PERSON            RESP  COVER  CONTRACT-H  LOGGED-30D  ON-PROJECT  ABSENCE");
for (const r of [...rows].sort((a, b) => (b.contractHours ?? -1) - (a.contractHours ?? -1))) {
  console.log(
    `${r.personName.padEnd(17)} ${String(r.responsibleFor).padStart(4)} ${String(r.coversAsReplacement).padStart(6)} ` +
    `${String(r.contractHours ?? "n/a").padStart(11)} ${String(r.loggedLast30Days).padStart(11)} ` +
    `${String(r.alreadyOnProject).padStart(11)}  ${r.absence === null ? "unknown" : JSON.stringify(r.absence)}`,
  );
}

check("candidates are returned", rows.length > 0, `${rows.length} active people`);

// Independent truth, computed with scalar subqueries so no join can inflate it.
const c = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
await c.connect();
const { rows: truth } = await c.query(`
  select pe.id, pe.name,
    (select count(*) from public.project_responsibility r
      where r.person_id = pe.id and r.role = 'responsible') as responsible_for,
    (select count(*) from public.project_responsibility r
      where r.person_id = pe.id and r.role = 'replacement') as covers,
    (select round(sum(pr.contract_hours)::numeric, 1) from public.projects pr
      where pr.owner_person_id = pe.id and pr.contract_hours is not null) as contract_hours
  from public.people pe where pe.is_active`);
const truthById = new Map(truth.map((t) => [t.id, t]));

let mismatches = 0;
for (const r of rows) {
  const t = truthById.get(r.personId);
  if (!t) continue;
  if (Number(t.responsible_for) !== r.responsibleFor) { mismatches += 1; console.log(`   MISMATCH resp ${r.personName}: query ${r.responsibleFor} vs truth ${t.responsible_for}`); }
  if (Number(t.covers) !== r.coversAsReplacement) { mismatches += 1; console.log(`   MISMATCH cover ${r.personName}: query ${r.coversAsReplacement} vs truth ${t.covers}`); }
  const expected = t.contract_hours === null ? null : Math.round(Number(t.contract_hours) * 10) / 10;
  if (expected !== r.contractHours) { mismatches += 1; console.log(`   MISMATCH hours ${r.personName}: query ${r.contractHours} vs truth ${expected}`); }
}
check("every count matches an independent scalar-subquery computation", mismatches === 0, `${mismatches} mismatches`);

// The fan-out guard: total contract hours across all people cannot exceed the
// contract hours that exist. 85,593 for one person failed exactly this.
const { rows: [total] } = await c.query(
  `select round(sum(contract_hours)::numeric,1) as all_contract_hours from public.projects where contract_hours is not null`);
const summed = rows.reduce((s, r) => s + (r.contractHours ?? 0), 0);
check("summed candidate hours do not exceed the hours that exist (fan-out guard)",
  summed <= Number(total.all_contract_hours) + 0.5,
  `candidates sum to ${summed.toFixed(1)}h, the whole order book is ${total.all_contract_hours}h`);

// Honest nulls survive the aggregation.
const { rows: [unmeasured] } = await c.query(`
  select count(*) as n from public.people pe
  where pe.is_active
    and exists (select 1 from public.projects pr where pr.owner_person_id = pe.id)
    and not exists (select 1 from public.projects pr
                     where pr.owner_person_id = pe.id and pr.contract_hours is not null)`);
const nulls = rows.filter((r) => r.contractHours === null && r.responsibleFor + r.coversAsReplacement > 0);
console.log(`\n  ${unmeasured.n} people own only unmeasured orders; ${nulls.length} candidates report n/a hours`);
check("absence is UNKNOWN, never silently 'available'",
  rows.every((r) => r.absence === null), "all null, and the UI must render that as unknown");

// The project's current holders must be flagged, or a lead could 'reassign' to
// the person already responsible.
const onProject = rows.filter((r) => r.alreadyOnProject);
check("people already on the project are flagged", onProject.length > 0,
  onProject.map((r) => r.personName).join(", ") || "none flagged");

/*
 * THE WITHHELD POSTURE, TESTED POSITIVELY
 * ---------------------------------------
 * The proxy above makes every assertion so far a test of the arithmetic. On its
 * own it would also make this gate green on a real LEAK: with canReadBudgets()
 * forced to `return true` inside src/lib/budget-visibility.ts, the proxied run
 * is identical to a correct one, down to the fan-out figure. So the raw
 * service-role client is run as well and the fail-closed path is asserted
 * rather than assumed.
 *
 * This is the only live coverage of column OMISSION on
 * public.projects.contract_hours. check-budget-permission-enforced.mjs's wiring
 * half only greps that budgetAwareColumns() is called; its behaviour half tests
 * the NULL redaction inside the time.project_summary view, which is a different
 * mechanism on a different table.
 */
const rawCanSeeBudgets = await canReadBudgets(supabase);
check(
  "the service-role caller has no profile, so the withheld path is reachable at all",
  rawCanSeeBudgets === false,
  "app_user_has_permission() resolves through app_user_profile -> auth.uid(), which is null for a service-role key",
);

const withheldRows = await getReassignmentCandidates(supabase, PROJECT);
const measured = rows.filter((r) => r.contractHours !== null);
check(
  "there are real contract hours for the withheld read to withhold",
  measured.length > 0,
  `${measured.length} of ${rows.length} candidates carry a figure when the caller may see budgets`,
);

const withheldById = new Map(withheldRows.map((r) => [r.personId, r]));
const leaked = measured.filter((r) => (withheldById.get(r.personId)?.contractHours ?? null) !== null);
check(
  "a caller without projects:contracts:read reads n/a, never a number (fail-closed)",
  measured.length > 0 && leaked.length === 0,
  leaked.length
    ? `LEAKED: ${leaked.map((r) => `${r.personName} ${withheldById.get(r.personId).contractHours}h`).join(", ")}`
    : `all ${measured.length} portfolios withheld as n/a`,
);

/*
 * THE PROXY'S OTHER PREMISE: that a permitted caller is the right caller to
 * judge this panel by. loadReassignmentCandidates() is gated on projects:write,
 * and today both roles holding it -- exec and dept_head -- also hold
 * projects:contracts:read, so nobody who can open the picker sees n/a. NOTHING
 * ENFORCES THAT. The day projects:write is granted to a role without budgets,
 * the picker silently degrades to n/a for every candidate and a gate that only
 * ever ran as a permitted caller would stay green on a fiction. So the pairing
 * is read from the live grant table rather than asserted in a comment.
 */
const { rows: writeRoles } = await c.query(
  `select w.role_key,
     exists (select 1 from public.app_role_permission r
              where r.role_key = w.role_key and r.permission_key = $2) as reads_contracts
   from public.app_role_permission w
   where w.permission_key = $1
   order by w.role_key`,
  [PERMISSIONS.PROJECTS_WRITE, PERMISSIONS.PROJECTS_CONTRACTS_READ],
);
const blindWriters = writeRoles.filter((r) => !r.reads_contracts).map((r) => r.role_key);
check(
  "every role that can open the picker can also see budgets",
  writeRoles.length > 0 && blindWriters.length === 0,
  writeRoles.length === 0
    ? `no role holds ${PERMISSIONS.PROJECTS_WRITE} — this assertion proved nothing`
    : blindWriters.length
      ? `${blindWriters.join(", ")} hold ${PERMISSIONS.PROJECTS_WRITE} without ${PERMISSIONS.PROJECTS_CONTRACTS_READ}, so the picker reads n/a for them`
      : `${writeRoles.map((r) => r.role_key).join(", ")} hold both`,
);

/*
 * Deliberately NOT asserted here: loggedLast30Days. It is printed above and
 * nothing bounds it. The proxy passes those reads (time.member, time.entry)
 * through untouched and the figures are identical proxied and unproxied, so
 * this gate is not made weaker by the change -- but if a future edit to the
 * proxy broke the time-schema reads, no assertion in this file would notice.
 */

await c.end();
console.log(`\n${failures === 0 ? "PASS" : `FAIL (${failures})`}`);
rmSync(dir, { recursive: true, force: true });
process.exit(failures ? 1 : 0);
