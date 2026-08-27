// PHASE 1, the read-only probe: does Factorial's real roster match the hub?
//
// check-factorial-identity-baseline.mjs predicted the outcome ASSUMING Factorial's
// addresses equal TrackingTime's 49. Now there is a credential, so the prediction
// can be tested instead of trusted. 43 employees exist; the baseline assumed 49
// TrackingTime members, so the sets are already known to differ in size.
//
// GDPR POSTURE (doc §11). This reads employee records with an API key that cannot
// be scope-limited, so restraint is enforced in code rather than by the
// credential:
//   - a FIELD ALLOW-LIST is applied the moment each record arrives; salary, bank,
//     social security, disability and termination-reason fields are dropped
//     before anything is counted or printed
//   - NOTHING is written to the database
//   - no name or address is printed in full; emails appear as local-part initial
//     plus domain, which is enough to reason about matching and not enough to
//     read a roster off the terminal
//
// The point is to answer "will the join work" without harvesting the people.
import { readFileSync } from "node:fs";
import pg from "pg";

const env = Object.fromEntries(
  readFileSync("C:/Supabase/.env.local", "utf8").split(/\r?\n/)
    .filter((l) => l && !l.startsWith("#") && l.includes("="))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^"|"$/g, "")]; }));

const KEY = env.FACTORIAL_API_KEY ?? env.FACTORIAL_KEY ?? "";
if (!KEY) { console.log("BLOCKED: no FACTORIAL_API_KEY in .env.local"); process.exit(2); }

const VERSION = "2026-07-01";
const BASE = "https://api.factorialhr.com";

/*
 * The field allow-list. Anything not named here is discarded on arrival. Doc §11
 * requires this to be mechanical rather than a matter of care, because an API key
 * returns everything including compensation.
 */
const ALLOWED = new Set([
  "id", "email", "login_email", "company_id", "employee_id",
  "active", "terminated_on", "start_date", "hired_on",
  "legal_entity_id", "team_ids", "manager_id",
  "working_hours_frequency", "working_hours",
]);
const FORBIDDEN = /salary|bank|swift|iban|social_security|disability|termination_reason|compensation|tax|nationality|birth|address|phone|gender|marital/i;

const narrow = (row) => {
  const out = {};
  for (const [k, v] of Object.entries(row)) {
    if (FORBIDDEN.test(k)) continue;      // belt
    if (!ALLOWED.has(k)) continue;        // and braces
    out[k] = v;
  }
  return out;
};

const call = async (path) => {
  const res = await fetch(`${BASE}${path}`, { headers: { "x-api-key": KEY, Accept: "application/json" } });
  if (!res.ok) throw new Error(`HTTP ${res.status} on ${path}`);
  return res.json();
};

// Paged read using the documented cursor contract.
const fetchAll = async (resource) => {
  const rows = [];
  let cursor = null;
  for (let page = 0; page < 50; page += 1) {
    const qs = new URLSearchParams({ limit: "100" });
    if (cursor) qs.set("after_id", cursor);
    const body = await call(`/api/${VERSION}/resources/${resource}?${qs}`);
    if (!Array.isArray(body.data)) throw new Error(`${resource}: data is not an array`);
    rows.push(...body.data.map(narrow));
    if (!body.meta?.has_next_page) break;
    const next = body.meta.end_cursor;
    if (!next || next === cursor) throw new Error(`${resource}: cursor did not advance`);
    cursor = next;
  }
  return rows;
};

let failures = 0;
const check = (label, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}: ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures += 1;
};

// Enough to reason about a join; not enough to read the roster.
const mask = (e) => {
  const s = String(e ?? "").trim().toLowerCase();
  if (!s.includes("@")) return "(none)";
  const [local, domain] = s.split("@");
  return `${local.slice(0, 1)}${"*".repeat(Math.max(2, local.length - 1))}@${domain}`;
};

console.log("PHASE 1 probe: will the Factorial <-> hub identity join actually work?\n");

const employees = await fetchAll("employees/employees");
check("employees were harvested", employees.length > 0, `${employees.length} records`);

// The allow-list must have actually bitten.
const leakedKeys = [...new Set(employees.flatMap((e) => Object.keys(e)))].filter((k) => FORBIDDEN.test(k) || !ALLOWED.has(k));
check("no forbidden field survived the allow-list", leakedKeys.length === 0,
  leakedKeys.length ? `LEAKED: ${leakedKeys.join(", ")}` : `kept only: ${[...new Set(employees.flatMap((e) => Object.keys(e)))].sort().join(", ")}`);

// The hub side.
const c = new pg.Client({ connectionString: env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
await c.connect();
const { rows: members } = await c.query(
  `select lower(trim(email)) as email, hub_person_id, is_archived from time.member where email is not null`);
const { rows: people } = await c.query(`select id, name from public.people`);
await c.end();

const memberByEmail = new Map(members.map((m) => [m.email, m]));

const norm = (e) => String(e ?? "").trim().toLowerCase();
const SHARED = /^(info|jobs|office|hello|kontakt|contact|admin|noreply|no-reply)@/i;

const buckets = { resolvable: [], bridged_unlinked: [], shared_mailbox: [], unmatched: [], no_email: [] };

for (const e of employees) {
  const email = norm(e.email || e.login_email);
  if (!email) { buckets.no_email.push(e); continue; }
  if (SHARED.test(email)) { buckets.shared_mailbox.push(email); continue; }
  const m = memberByEmail.get(email);
  if (!m) { buckets.unmatched.push(email); continue; }
  if (m.hub_person_id) buckets.resolvable.push(email);
  else buckets.bridged_unlinked.push(email);
}

console.log(`\nFactorial roster: ${employees.length} employees`);
console.log(`Hub side:         ${members.length} TrackingTime members with an email, ${people.length} people rows\n`);
console.log("  MATCH OUTCOME (exact email only, never similarity)");
console.log(`    resolvable         ${String(buckets.resolvable.length).padStart(3)}  email -> member -> person, safe to auto-map`);
console.log(`    bridged_unlinked   ${String(buckets.bridged_unlinked.length).padStart(3)}  email -> member, but that member has no person row`);
console.log(`    unmatched          ${String(buckets.unmatched.length).padStart(3)}  in Factorial, no TrackingTime member with that address`);
console.log(`    shared mailbox     ${String(buckets.shared_mailbox.length).padStart(3)}  not a person; needs a human exclusion`);
console.log(`    no email at all    ${String(buckets.no_email.length).padStart(3)}  cannot be joined on the only candidate key`);

check("some employees resolve cleanly", buckets.resolvable.length > 0, `${buckets.resolvable.length}`);
check("every employee landed in exactly one bucket",
  Object.values(buckets).reduce((s, b) => s + b.length, 0) === employees.length,
  `${Object.values(buckets).reduce((s, b) => s + b.length, 0)} of ${employees.length}`);

if (buckets.unmatched.length) {
  console.log(`\n  UNMATCHED (masked) — in Factorial but not in TrackingTime:`);
  for (const e of buckets.unmatched.slice(0, 15)) console.log(`    ${mask(e)}`);
  if (buckets.unmatched.length > 15) console.log(`    ... and ${buckets.unmatched.length - 15} more`);
}

// The prize: does Factorial know Stefan, whose 149h cannot be attributed?
const stefan = employees.find((e) => norm(e.email || e.login_email).startsWith("stefan"));
console.log(`\n  STEFAN GOELZNER (149h billable, no person row):`);
console.log(`    ${stefan ? `FOUND in Factorial as ${mask(stefan.email || stefan.login_email)}` : "NOT in the Factorial roster"}`);

/*
 * The headline reason for doing this at all: real contract hours replace the
 * fabricated uniform 40h week that makes every utilisation figure a guess.
 */
const withHours = employees.filter((e) => e.working_hours !== null && e.working_hours !== undefined);
const freqs = [...new Set(employees.map((e) => e.working_hours_frequency).filter(Boolean))];
console.log(`\n  CONTRACT HOURS (the fix for the fake uniform 40h week):`);
console.log(`    ${withHours.length} of ${employees.length} employees carry working_hours`);
console.log(`    observed frequencies: ${freqs.join(", ") || "(none reported)"}`);
check("contract hours are actually available", withHours.length > 0,
  withHours.length ? `${withHours.length} records` : "none — utilisation cannot be fixed from this endpoint");

// Absence, which is the last gap in the reassignment feature.
console.log(`\n  ABSENCE (the last gap in the reassignment UI):`);
try {
  const leaves = await fetchAll("timeoff/leaves");
  console.log(`    timeoff/leaves reachable: ${leaves.length} record(s)`);
  check("absence data is reachable", true, `${leaves.length} leave records`);
} catch (e) {
  console.log(`    timeoff/leaves NOT reachable: ${e.message}`);
  check("absence data is reachable", false, e.message);
}

console.log(`\n${failures === 0 ? "PASS — the join is viable" : `FAIL (${failures})`}`);
console.log("READ-ONLY: nothing was written to the database, and no full name or address was printed.");
process.exit(failures ? 1 : 0);
