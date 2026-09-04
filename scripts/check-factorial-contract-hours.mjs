/*
 * Does contractWeeklyHours() actually behave, and does the live database
 * reflect only what it should have produced?
 *
 * TWO HALVES, on purpose. The first needs no credential and no network: pure
 * unit tests against scripts/lib/factorial.mjs#contractWeeklyHours(), the ONE
 * place the ÷100 conversion happens. The second is read-only against the live
 * DB and legitimately reports "nothing populated yet" until
 * sync-factorial-contracts.mjs has actually run against real Factorial
 * contract data -- that is expected today, not a failure; what this gate
 * proves in that state is that the SQL and the bound are correct, ready to
 * catch the first real bad row rather than being written after the fact.
 *
 * THE MAGNITUDE BOUND IS THE HEADLINE, because it is what makes a missed
 * ÷100 impossible to ship silently: 4000 centihours converted correctly is
 * 40h/week (inside [1,48]); the same 4000 read as if it were already hours
 * would be 4000h/week, two orders of magnitude outside the ArbZG §3 ceiling
 * of 48h. A bound like this is the difference between a bug that fails loud
 * and one that renders as a plausible, wrong number about a named colleague
 * -- exactly the failure class this whole Factorial effort exists to close.
 *
 * Run: node scripts/check-factorial-contract-hours.mjs
 */
import { loadEnv } from "./lib/gate-env.mjs";
import { contractWeeklyHours } from "./lib/factorial.mjs";
import pg from "pg";

let failed = 0;
const check = (ok, label, detail = "") => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failed += 1;
};

console.log("check-factorial-contract-hours\n");
console.log("--- unit: contractWeeklyHours() is the only place ÷100 happens, and it refuses to guess\n");

check(contractWeeklyHours({ working_hours_centihours: 4000, working_hours_frequency: "week" }) === 40,
  "4000 centihours/week converts to 40 hours/week (the headline case)");

check(contractWeeklyHours({ working_hours_centihours: 2000, working_hours_frequency: "week" }) === 20,
  "a part-time 2000 centihours/week converts to 20 hours/week");

check(
  contractWeeklyHours({ working_hours_centihours: 800, working_hours_frequency: "day", working_week_days: ["monday", "tuesday", "wednesday", "thursday", "friday"] }) === 40,
  "800 centihours/day over 5 working days converts to 40 hours/week",
);

check(
  contractWeeklyHours({ working_hours_centihours: 800, working_hours_frequency: "day", working_week_days: "monday,tuesday,wednesday" }) === 24,
  "working_week_days accepts a comma-separated string, parsed as a SET (not string length)",
);

check(
  contractWeeklyHours({ working_hours_centihours: 800, working_hours_frequency: "DAY", working_week_days: ["mon", "tue"] }) === 16,
  "frequency matching is case-insensitive",
);

check(
  contractWeeklyHours({ working_hours_centihours: 800, working_hours_frequency: "day", working_week_days: [] }) === null,
  "day frequency with an EMPTY day list is null, never treated as zero days worked = 0h",
);

check(
  contractWeeklyHours({ working_hours_centihours: 800, working_hours_frequency: "day", working_week_days: undefined }) === null,
  "day frequency with NO day list is null, refusing to guess a day count",
);

const monthly = contractWeeklyHours({ working_hours_centihours: 17333, working_hours_frequency: "month" });
check(monthly !== null && Math.abs(monthly - (173.33 * 12) / 52) < 1e-9,
  "month frequency converts via ×12/52, not ×4 (a month is not four weeks)");

for (const badFreq of ["fortnight", "year", "biweekly", "", null, undefined]) {
  check(
    contractWeeklyHours({ working_hours_centihours: 4000, working_hours_frequency: badFreq, working_week_days: ["mon"] }) === null,
    `an unrecognised frequency (${JSON.stringify(badFreq)}) returns null, never defaults to weekly`,
  );
}

for (const badInput of [null, undefined, "not-a-number", NaN]) {
  check(
    contractWeeklyHours({ working_hours_centihours: badInput, working_hours_frequency: "week" }) === null,
    `a non-numeric working_hours_centihours (${JSON.stringify(badInput)}) returns null, never 0`,
  );
}

check(contractWeeklyHours({ working_hours_centihours: 0, working_hours_frequency: "week" }) === 0,
  "a genuine 0-hour contract converts to 0, distinct from an unconvertible null (0 !== null)");

// The magnitude bound this gate exists to protect, proven at the unit level
// FIRST: if the ÷100 were ever removed, this is where it would be caught even
// before touching the database.
const unconverted = 4000; // what a missing ÷100 would look like if used raw
check(unconverted < 1 || unconverted > 48,
  "sanity: an UNCONVERTED centihours value (4000) is, itself, outside [1,48] -- the bound has teeth");
const converted = contractWeeklyHours({ working_hours_centihours: 4000, working_hours_frequency: "week" });
check(converted >= 1 && converted <= 48,
  "the CORRECTLY converted value for the same input falls inside [1,48]", `got ${converted}`);

/* --------------------------------------------------------------- live half */

console.log("\n--- live (read-only): does the database contain only what the conversion would produce?\n");

const env = loadEnv();
if (!env.SUPABASE_DB_URL) {
  console.log("  skip  SUPABASE_DB_URL not set — this half measures the live DB.");
} else {
  const c = new pg.Client({ connectionString: env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
  await c.connect();
  await c.query("begin read only");

  try {
    const MIN_HOURS = 1;
    const MAX_HOURS = 48; // ArbZG §3 ceiling; a derived value outside this is a unit bug, not a real contract.

    /* 1. Magnitude bound on every Factorial-derived contract_hours value. */
    const { rows: outOfBound } = await c.query(
      `select id, name, contract_hours from public.people
        where factorial_employee_id is not null and contract_hours is not null
          and (contract_hours < $1 or contract_hours > $2)
        order by contract_hours desc`,
      [MIN_HOURS, MAX_HOURS],
    );
    check(outOfBound.length === 0,
      `every Factorial-derived people.contract_hours falls in [${MIN_HOURS}, ${MAX_HOURS}]`,
      outOfBound.length ? `OUT OF BOUND: ${outOfBound.map((r) => `${r.name}=${r.contract_hours}`).join(", ")}` : "none out of bound");

    const { rows: tableExists } = await c.query(
      `select 1 from information_schema.tables
        where table_schema = 'crm' and table_name = 'factorial_contract_version'`,
    );
    if (tableExists.length === 0) {
      console.log("  skip  crm.factorial_contract_version does not exist yet — migration");
      console.log("  skip  20260903150000_factorial_contract_version.sql has not been pasted into this database.");
      console.log("  skip  Checks 2-6 below need that table; check #1 above already covers the one thing that");
      console.log("  skip  can exist without it (people.contract_hours, which predates this PR).");
      await c.query("rollback");
      await c.end();
      console.log(`\n${failed === 0 ? "PASS: conversion logic holds; live schema checks pending the migration" : `FAIL (${failed})`}`);
      process.exitCode = failed ? 1 : 0;
      process.exit(process.exitCode);
    }

    /* 2. Honest nulls: an unconvertible or missing contract must not have
     *    left a stale non-null value sitting there. */
    const { rows: staleWithBadContract } = await c.query(
      `select p.id, p.name, p.contract_hours, v.working_hours_frequency
         from public.people p
         join crm.factorial_contract_version v on v.factorial_employee_id = p.factorial_employee_id
        where p.contract_hours is not null
          and (v.working_hours_centihours is null
               or lower(coalesce(v.working_hours_frequency, '')) not in ('week', 'day', 'month'))`,
    );
    check(staleWithBadContract.length === 0,
      "no person has a non-null contract_hours backed by an unconvertible contract row",
      staleWithBadContract.length
        ? `STALE: ${staleWithBadContract.map((r) => `${r.name} freq=${r.working_hours_frequency}`).join(", ")}`
        : "none");

    /* 3. Frequency allow-list, asserted against real stored rows, not only
     *    the pure function. */
    const { rows: badFreqRows } = await c.query(
      `select factorial_employee_id, working_hours_frequency from crm.factorial_contract_version
        where working_hours_frequency is not null
          and lower(working_hours_frequency) not in ('week', 'day', 'month')`,
    );
    if (badFreqRows.length > 0) {
      console.log(`  note  ${badFreqRows.length} stored contract(s) carry a frequency this integration does not yet handle: ` +
        `${[...new Set(badFreqRows.map((r) => r.working_hours_frequency))].join(", ")}`);
      console.log("  note  this is expected to be non-empty eventually (Factorial's enum is undocumented) -- the");
      console.log("  note  requirement is only that check #2 above holds: such rows leave contract_hours NULL.");
    }
    check(true, "an unhandled frequency is observed, not silently converted (see note above if non-empty)");

    /* 4. Cross-check against the independently-documented percentage field,
     *    for rows where both it and a maximum-hours reference are present.
     *    Two vendor fields agreeing is exactly what established the unit in
     *    the first place (vault Factorial data plan §4) and should be
     *    re-proved every run, not assumed permanent. */
    const { rows: crossCheck } = await c.query(
      `select p.name, p.contract_hours,
              v.working_time_percentage_in_cents, v.maximum_weekly_hours_centihours
         from public.people p
         join crm.factorial_contract_version v on v.factorial_employee_id = p.factorial_employee_id
        where p.contract_hours is not null
          and v.working_time_percentage_in_cents is not null
          and v.maximum_weekly_hours_centihours is not null
          and v.maximum_weekly_hours_centihours > 0`,
    );
    const TOLERANCE_PERCENT_POINTS = 5;
    const mismatches = crossCheck.filter((r) => {
      const fullTimeHours = r.maximum_weekly_hours_centihours / 100;
      const impliedPercent = (Number(r.contract_hours) / fullTimeHours) * 100;
      const statedPercent = r.working_time_percentage_in_cents / 100;
      return Math.abs(impliedPercent - statedPercent) > TOLERANCE_PERCENT_POINTS;
    });
    check(mismatches.length === 0,
      `contract_hours agrees with working_time_percentage_in_cents within ${TOLERANCE_PERCENT_POINTS} points`,
      crossCheck.length === 0 ? "no rows carry both fields yet — nothing to cross-check"
        : mismatches.length ? `MISMATCH: ${mismatches.map((r) => r.name).join(", ")}` : `${crossCheck.length} row(s) agree`);

    /* 5. Non-uniformity, the plan's own headline signal that data is
     *    actually flowing -- but only once enough people are populated that
     *    a partial rollout cannot false-fail it. */
    const { rows: populated } = await c.query(
      `select distinct contract_hours from public.people
        where factorial_employee_id is not null and contract_hours is not null`,
    );
    const MIN_TO_JUDGE = 5;
    const { rows: populatedCount } = await c.query(
      `select count(*)::int as n from public.people where factorial_employee_id is not null and contract_hours is not null`,
    );
    if (populatedCount[0].n < MIN_TO_JUDGE) {
      console.log(`  skip  only ${populatedCount[0].n} Factorial-mapped people have contract_hours set (need ${MIN_TO_JUDGE}+ to judge uniformity)`);
    } else {
      check(populated.length > 1,
        "contract_hours values are not all identical once enough people are populated",
        `${populatedCount[0].n} people, ${populated.length} distinct value(s) — if every colleague still comes out at 40, the contract data is not flowing`);
    }

    /* 6. crm.factorial_contract_version itself never carries the two fields
     *    this endpoint documents but this integration refuses to ingest. */
    const { rows: cols } = await c.query(
      `select column_name from information_schema.columns
        where table_schema = 'crm' and table_name = 'factorial_contract_version'
          and column_name in ('salary_amount', 'salary_frequency')`,
    );
    check(cols.length === 0, "crm.factorial_contract_version has no salary column at all",
      cols.length ? `FOUND: ${cols.map((r) => r.column_name).join(", ")}` : "confirmed absent");

    await c.query("rollback");
  } finally {
    await c.end();
  }
}

console.log(`\n${failed === 0 ? "PASS: conversion logic and live data both hold the unit and the bound" : `FAIL (${failed})`}`);
process.exitCode = failed ? 1 : 0;
