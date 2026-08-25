/**
 * A view must not answer confidently from an empty table.
 *
 * ── The failure this exists to catch ────────────────────────────────────────
 *
 * `project_budget_status` and `billable_value_by_person` aggregate
 * `public.timesheet_entries`. That table is empty -- its 28 rows were mockup
 * data for an inactive seed person, removed 2026-08-24 -- while every real hour
 * lives in `time.entry`.
 *
 * Both views wrapped their aggregates in `COALESCE(sum(...), 0)`. With no rows
 * to sum, that turned "unknown" into "zero" for 231 projects, and turned
 * `is_over_budget` into a flat `false`: a positive assurance that no project had
 * overrun its budget, computed from no data whatsoever. Nothing rendered it
 * yet, which is exactly why it survived -- but `getProjectBudgetStatus()` sits
 * typed and ready in hse.ts, so the next budget widget would have shipped
 * silent zeroes into a commercial report.
 *
 * ── What is asserted ───────────────────────────────────────────────────────
 *
 *   1. While the source table is empty, the numeric columns are NULL, not 0.
 *   2. `is_over_budget` is NULL, not false. A boolean is the dangerous case:
 *      a NULL number renders as an em dash and is obviously missing, whereas
 *      `false` reads as a checked, passing result.
 *   3. Both views keep `security_invoker`, so RLS still filters them. A
 *      `create or replace view` silently drops that option if omitted, which
 *      would turn a fix into a data leak.
 *
 * Assertion 1 is deliberately conditional on the table being empty. If someone
 * repoints these views at `time.entry` and real numbers appear, zeroes become
 * legitimate again and this check steps aside rather than blocking the
 * improvement it is meant to protect.
 *
 * Read-only. SKIPs cleanly without .env.local so CI runs without credentials.
 */
import { readFileSync, existsSync } from "node:fs";

let failed = false;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}: ${name}${detail ? ` \u2014 ${detail}` : ""}`);
  if (!ok) failed = true;
};

const ENV = "C:/Supabase/.env.local";
if (!existsSync(ENV)) { console.log("SKIP: no .env.local"); process.exit(0); }

const env = Object.fromEntries(
  readFileSync(ENV, "utf8").split(/\r?\n/)
    .filter((l) => l && !l.startsWith("#") && l.includes("="))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^"|"$/g, "")]; }));

if (!env.SUPABASE_DB_URL) { console.log("SKIP: SUPABASE_DB_URL not set"); process.exit(0); }

const pg = (await import("pg")).default;
const c = new pg.Client({ connectionString: env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
await c.connect();

try {
  const src = (await c.query("select count(*)::int n from public.timesheet_entries")).rows[0].n;
  console.log(`public.timesheet_entries holds ${src} row(s)\n`);

  if (src === 0) {
    const b = (await c.query(`
      select
        count(*)::int rows,
        count(*) filter (where hours_logged = 0)::int zero_hours,
        count(*) filter (where is_over_budget = false)::int asserts_ok
      from public.project_budget_status`)).rows[0];

    check("project_budget_status reports unknown hours as NULL, not 0",
      b.zero_hours === 0,
      b.zero_hours ? `${b.zero_hours} of ${b.rows} rows claim 0 hours logged from an empty table` : "");

    check("project_budget_status does not assert a project is within budget",
      b.asserts_ok === 0,
      b.asserts_ok ? `${b.asserts_ok} rows say is_over_budget=false with no hours to check` : "");

    const v = (await c.query(`
      select count(*) filter (where billable_hours_logged = 0)::int zero
      from public.billable_value_by_person`)).rows[0];

    check("billable_value_by_person reports unknown hours as NULL, not 0",
      v.zero === 0,
      v.zero ? `${v.zero} people credited with exactly 0 billable hours` : "");
  } else {
    console.log("source table has rows, so zeroes may be real \u2014 value checks skipped");
  }

  const opts = await c.query(`
    select c.relname, coalesce(array_to_string(c.reloptions, ','), '') opts
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname in ('billable_value_by_person','project_budget_status')`);

  for (const r of opts.rows) {
    check(`${r.relname} keeps security_invoker so RLS still filters it`,
      /security_invoker=true/.test(r.opts),
      r.opts ? `options: ${r.opts}` : "no reloptions set");
  }
} finally {
  await c.end();
}

console.log(failed ? "\nFAILED" : "\nALL CHECKS PASSED");
process.exit(failed ? 1 : 0);
