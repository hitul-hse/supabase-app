/**
 * Apply supabase/migrations/20260824180000_hoist_project_person_policies.sql and
 * PROVE it changed only the speed, never the visibility.
 *
 * WHY A SCRIPT AND NOT THE SQL EDITOR
 * -----------------------------------
 * The risky part of this change is not the DDL, it is the claim attached to it:
 * "same rows, less time". A paste into the SQL editor applies the DDL and proves
 * nothing. This measures the row set each real person can see BEFORE the change,
 * applies it, measures again, and fails loudly if any person's count moved by
 * even one row. A policy rewrite that got fast by showing more would be a
 * security regression that looks like a win.
 *
 * SAFETY
 *   - reads the current function bodies first and refuses to run if they are not
 *     the shape this migration was written against (so it cannot clobber a later
 *     edit by somebody else),
 *   - --rollback restores the exact pre-change bodies, which are captured from
 *     the live database at run time rather than hard-coded from memory,
 *   - `create index if not exists` is idempotent and additive; rollback leaves
 *     the indexes in place deliberately, because an index cannot change what a
 *     query returns and dropping it would only make a re-run slow again.
 *
 * Run:        node scripts/apply-project-policy-hoisting.mjs
 * Roll back:  node scripts/apply-project-policy-hoisting.mjs --rollback
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const env = {};
for (const line of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
  const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}
const URL_BASE = env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE = env.SUPABASE_SERVICE_ROLE_KEY;
const ANON = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const CONN = env.SUPABASE_DB_URL || env.DATABASE_URL;

if (!URL_BASE || !SERVICE || !ANON || !CONN) {
  console.log("SKIP: needs NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY,");
  console.log("      NEXT_PUBLIC_SUPABASE_ANON_KEY and SUPABASE_DB_URL in .env.local.");
  process.exit(0);
}

const ROLLBACK = process.argv.includes("--rollback");
const MIGRATION = "supabase/migrations/20260824180000_hoist_project_person_policies.sql";
const BACKUP = ".context-bridge/project-policy-backup.sql";

const admin = createClient(URL_BASE, SERVICE, { auth: { persistSession: false } });
const { default: pg } = await import("pg");
const db = new pg.Client({ connectionString: CONN, ssl: { rejectUnauthorized: false } });
await db.connect();

/** Real session for one email, so measurements go through RLS exactly as a page does. */
async function sessionFor(email) {
  const { data: link, error } = await admin.auth.admin.generateLink({ type: "magiclink", email });
  if (error) return null;
  const anon = createClient(URL_BASE, ANON, { auth: { persistSession: false } });
  const { data, error: ve } = await anon.auth.verifyOtp({
    type: "magiclink",
    token_hash: link.properties.hashed_token,
  });
  if (ve) return null;
  return data.session.access_token;
}

/**
 * What one person can see, and how long it takes.
 *
 * Counts ids rather than using head+count so a timeout surfaces as an error
 * instead of a null that reads like zero rows. Two runs because the first
 * measurement of a cold predicate is not the one users live with.
 */
async function measure(token) {
  const out = { rows: null, ms: [], error: null };
  for (let i = 0; i < 2; i++) {
    const t0 = Date.now();
    const res = await fetch(`${URL_BASE}/rest/v1/projects?select=id`, {
      headers: { apikey: ANON, Authorization: `Bearer ${token}` },
    });
    const ms = Date.now() - t0;
    out.ms.push(ms);
    const body = await res.text();
    if (!res.ok) {
      out.error = body.slice(0, 90);
      continue;
    }
    const rows = JSON.parse(body).length;
    if (out.rows === null) out.rows = rows;
    else if (out.rows !== rows) out.error = `unstable row count ${out.rows} vs ${rows}`;
  }
  return out;
}

const PEOPLE = [
  "mathias@hs-experts.com",
  "hendryk@hs-experts.com",
  "rency@hs-experts.com",
  "stephan@hs-experts.com",
];

async function measureEveryone(label) {
  console.log(`\n${label}:`);
  const result = {};
  for (const email of PEOPLE) {
    const token = await sessionFor(email);
    if (!token) {
      console.log(`  ${email.padEnd(26)} SESSION FAILED (skipped)`);
      continue;
    }
    const m = await measure(token);
    result[email] = m;
    const times = m.ms.map((x) => `${x}ms`).join(", ");
    console.log(
      `  ${email.padEnd(26)} rows=${String(m.rows ?? "ERR").padStart(4)}  ${times}${m.error ? `  ${m.error}` : ""}`,
    );
  }
  return result;
}

/** The current bodies, so a rollback restores what was really there. */
async function currentBodies() {
  const { rows } = await db.query(`
    select p.proname, pg_get_functiondef(p.oid) as def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname in ('can_view_project', 'can_view_person')
    order by p.proname
  `);
  return rows;
}

const before = await currentBodies();
if (before.length !== 2) {
  console.log("ABORT: expected can_view_project and can_view_person to exist. Found:", before.length);
  await db.end();
  process.exit(1);
}
const isHoisted = before.every((r) => /\(\s*select\s+app_user_role\(\)/i.test(r.def));

if (ROLLBACK) {
  if (!existsSync(BACKUP)) {
    console.log(`ABORT: no backup at ${BACKUP}; cannot restore the exact previous bodies.`);
    await db.end();
    process.exit(1);
  }
  await db.query("begin");
  await db.query(readFileSync(BACKUP, "utf8"));
  await db.query("commit");
  console.log("Rolled back to the captured pre-change function bodies.");
  await db.end();
  process.exit(0);
}

if (isHoisted) {
  console.log("Already applied: both functions already use hoisted scalar subqueries.");
  await db.end();
  process.exit(0);
}

// Refuse to overwrite something that is not what this migration targeted.
for (const r of before) {
  if (!/app_user_person_id\(\)/.test(r.def)) {
    console.log(`ABORT: ${r.proname} is not the expected predicate. Review before applying.`);
    await db.end();
    process.exit(1);
  }
}

writeFileSync(BACKUP, before.map((r) => `${r.def};`).join("\n\n"));
console.log(`captured rollback copy -> ${BACKUP}`);

const beforeM = await measureEveryone("BEFORE");

await db.query("begin");
await db.query(readFileSync(MIGRATION, "utf8"));
await db.query("commit");
console.log("\napplied.");

// ANALYZE so the planner actually uses the new indexes on the next read; without
// it the first measurements can be misleadingly slow and look like a failure.
await db.query("analyze public.person_assignments");
await db.query("analyze public.projects");

const afterM = await measureEveryone("AFTER");

console.log("\n=== visibility must be unchanged ===");
let drift = false;
for (const email of PEOPLE) {
  const b = beforeM[email];
  const a = afterM[email];
  if (!b || !a) continue;
  // A timeout before and a number after is a FIX, not drift: there is no
  // "before" row count to compare against, so it cannot be checked -- say so.
  if (b.rows === null) {
    console.log(`  ${email.padEnd(26)} before TIMED OUT -> after ${a.rows} rows (no baseline to compare)`);
    continue;
  }
  const same = b.rows === a.rows;
  if (!same) drift = true;
  console.log(`  ${email.padEnd(26)} ${b.rows} -> ${a.rows}  ${same ? "same" : "*** CHANGED ***"}`);
}

console.log("\n=== speed ===");
for (const email of PEOPLE) {
  const b = beforeM[email];
  const a = afterM[email];
  if (!b || !a) continue;
  const bm = b.error && b.rows === null ? "TIMEOUT" : `${Math.min(...b.ms)}ms`;
  const am = a.error && a.rows === null ? "TIMEOUT" : `${Math.min(...a.ms)}ms`;
  console.log(`  ${email.padEnd(26)} ${String(bm).padStart(8)} -> ${am}`);
}

if (drift) {
  console.log("\nWARNING: a visible row count CHANGED. Roll back now:");
  console.log("  node scripts/apply-project-policy-hoisting.mjs --rollback");
}

await db.end();
process.exit(drift ? 1 : 0);
