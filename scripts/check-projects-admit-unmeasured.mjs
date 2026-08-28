/*
 * Gate: the projects ledger must never report an unmeasured order as 0.
 *
 * Audit of 26 Aug 2026. Of 231 orders, 177 resolve to a TrackingTime project by
 * the exact key time.project.hub_project_id; 54 do not. Those 54 reported
 * logged_hours = 0, consumed_percent = 0 and status = 'NORMAL' across 1,724
 * contract hours, because the columns were NOT NULL and the importer had no
 * hours to write. They were not on budget; they were unobserved.
 *
 * Note the population this gate deliberately does NOT touch: 113 linked orders
 * also report 0 (3,256 contract hours). They are measured and simply have no
 * logged time yet, so their 0 is a fact. Conflating the two would delete real
 * information, which is why "measured" is decided by the link and never by
 * whether the number happens to be zero.
 *
 * This is the "honest nulls, never a plausible 0" rule applied to the one table
 * that was violating it. The distinction the gate enforces:
 *
 *   no TT link  -> unmeasured -> every derived hour column must be NULL
 *   has TT link -> measured   -> 0 is a legitimate value (linked, not yet worked)
 *
 * "Has a TT link" is decided only by the exact key time.project.hub_project_id
 * (ADR-001), never by name similarity.
 *
 * Run: node scripts/check-projects-admit-unmeasured.mjs
 */
import { readFileSync } from "node:fs";
import pg from "pg";
import { loadEnv } from "./lib/gate-env.mjs";

const env = loadEnv();

const c = new pg.Client({ connectionString: env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
await c.connect();

let failures = 0;
const check = (label, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}: ${label}${detail ? `\n        ${detail}` : ""}`);
  if (!ok) failures += 1;
};

/* ---------------------------------------------------- the schema must allow it */

const { rows: cols } = await c.query(`
  select column_name, is_nullable from information_schema.columns
   where table_schema='public' and table_name='projects'
     and column_name in ('logged_hours','billable_hours','remaining_hours','consumed_percent','status','contract_hours')`);
const nullable = Object.fromEntries(cols.map((r) => [r.column_name, r.is_nullable]));

for (const col of ["logged_hours", "billable_hours", "remaining_hours", "consumed_percent", "status"]) {
  check(`${col} is nullable`, nullable[col] === "YES",
    nullable[col] === "YES" ? "" : "a NOT NULL hour column forces the importer to invent a 0");
}
check("contract_hours stays NOT NULL", nullable.contract_hours === "NO",
  "the contract figure comes from the signed order, so it is known even when hours are not");

/* --------------------------------------------------------------- the row state */

const { rows: [state] } = await c.query(`
  select
    count(*) as total,
    count(*) filter (where linked) as measured,
    count(*) filter (where not linked) as unmeasured,
    -- the bug: unmeasured but reporting a number
    count(*) filter (where not linked and logged_hours is not null)     as unmeasured_with_logged,
    count(*) filter (where not linked and consumed_percent is not null) as unmeasured_with_percent,
    count(*) filter (where not linked and status is not null)           as unmeasured_with_status,
    coalesce(sum(contract_hours) filter (where not linked and consumed_percent is not null), 0) as contract_hours_misreported
  from (
    select p.*, exists (select 1 from time.project tp where tp.hub_project_id = p.id) as linked
      from public.projects p
  ) s`);

console.log(`\n${state.total} orders: ${state.measured} measured (TT-linked), ${state.unmeasured} unmeasured\n`);

check("no unmeasured order reports logged_hours",
  Number(state.unmeasured_with_logged) === 0,
  `${state.unmeasured_with_logged} order(s) state hours nobody measured`);

check("no unmeasured order reports a consumed percentage",
  Number(state.unmeasured_with_percent) === 0,
  `${state.unmeasured_with_percent} order(s) covering ${Number(state.contract_hours_misreported).toFixed(0)} contract hours claim a burn figure with no hour data behind it`);

check("no unmeasured order claims a budget status",
  Number(state.unmeasured_with_status) === 0,
  `${state.unmeasured_with_status} order(s) are labelled NORMAL/WARNING/CRITICAL without being measured`);

// The inverse must also hold, or the fix has overreached: a linked order that has
// genuinely logged nothing yet is a measured fact and must keep its 0.
const { rows: [inverse] } = await c.query(`
  select count(*) as linked_nulled
    from public.projects p
   where exists (select 1 from time.project tp where tp.hub_project_id = p.id)
     and logged_hours is null`);
check("no TT-linked order was nulled out",
  Number(inverse.linked_nulled) === 0,
  `${inverse.linked_nulled} linked order(s) lost a measured value — 0h on a linked order is a fact, not a gap`);

/* ------------------------------------------------- the importer must not regress */

const src = readFileSync("C:/Supabase/scripts/import-masterdata-projects.mjs", "utf8");
check("the importer distinguishes measured from unmeasured",
  /const measured = hits\.length === 1/.test(src),
  "without that flag the next import rewrites the same plausible zeros");
check("the importer writes null hours when unmeasured",
  /logged_hours: measured \?/.test(src) && /billable_hours: measured \?/.test(src),
  "");
check("the importer does not coerce consumed_percent to 0",
  !/Math\.round\(\(logged \/ contract\) \* 100\) : 0/.test(src),
  "the `: 0` fallback is the original bug");

await c.end();
console.log(failures === 0
  ? "\nUNMEASURED ORDERS: the ledger admits what it does not know"
  : `\n${failures} check(s) failed`);
process.exit(failures === 0 ? 0 : 1);
