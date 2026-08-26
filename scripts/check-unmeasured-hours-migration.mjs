/*
 * House rule: a migration is executed in PGlite TWICE before anyone pastes it
 * into production. Twice, because a migration that is not idempotent will pass
 * the first run and break the re-run that inevitably happens after a partial
 * apply.
 *
 * This builds the smallest schema the migration touches (public.projects and
 * time.project with the columns and NOT NULL constraints the live DB actually
 * has), seeds the two cases that matter, applies the migration twice, and then
 * asserts the OUTCOME rather than just "it did not throw".
 */
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";

const sql = readFileSync("C:/Supabase/supabase/migrations/20260826120000_projects_admit_unmeasured_hours.sql", "utf8");
const db = await new PGlite();

let failures = 0;
const check = (label, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}: ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures += 1;
};

// Mirror the live shape: the three columns the migration relaxes are NOT NULL here.
await db.exec(`
  create schema time;
  create table public.projects (
    id text primary key,
    name text not null,
    customer text not null,
    contract_hours numeric not null,
    billable_hours numeric not null,
    consumed_percent numeric not null,
    status text not null,
    logged_hours numeric,
    remaining_hours numeric
  );
  create table time.project (
    id integer primary key,
    hub_project_id text
  );
`);

await db.exec(`
  insert into public.projects values
    -- unmeasured: no TT link, wrote a plausible 0. This must become NULL.
    ('unmeasured-1', 'AWB: Aufgaben&Ziele 2026', 'AWB',   800, 0,   0, 'NORMAL', 0, 800),
    ('unmeasured-2', 'Netto (Markets Visits)',   'Netto', 550, 0,   0, 'NORMAL', 0, 550),
    -- measured and genuinely zero so far: HAS a TT link. Must NOT be nulled.
    ('measured-zero','Linked but unworked',      'X',     100, 0,   0, 'NORMAL', 0, 100),
    -- measured with real hours: must be left completely alone.
    ('measured-real','Linked and worked',        'Y',     200, 90, 60, 'NORMAL', 120, 80);
  insert into time.project values (1, 'measured-zero'), (2, 'measured-real');
`);

for (const pass of [1, 2]) {
  try {
    await db.exec(sql);
    console.log(`\nrun ${pass}: executed without error`);
  } catch (e) {
    console.log(`\nrun ${pass}: THREW — ${e.message}`);
    failures += 1;
    break;
  }

  const { rows } = await db.query(`
    select id, logged_hours, billable_hours, remaining_hours, consumed_percent, status
      from public.projects order by id`);
  const by = Object.fromEntries(rows.map((r) => [r.id, r]));

  const allNull = (r) => r.logged_hours === null && r.billable_hours === null
    && r.remaining_hours === null && r.consumed_percent === null && r.status === null;

  check(`run ${pass}: an unmeasured order reads NULL, not 0`,
    allNull(by["unmeasured-1"]) && allNull(by["unmeasured-2"]),
    JSON.stringify(by["unmeasured-1"]));

  // PGlite returns `numeric` as a STRING, so compare through Number(). A strict
  // === 0 against "0" fails and reports the migration as broken when it is not.
  check(`run ${pass}: a TT-linked order with 0h is left as a measured zero`,
    Number(by["measured-zero"].logged_hours) === 0 && by["measured-zero"].status === "NORMAL",
    "a linked order that genuinely has no hours yet is a fact, not a gap");

  check(`run ${pass}: a measured order with real hours is untouched`,
    Number(by["measured-real"].logged_hours) === 120
      && Number(by["measured-real"].consumed_percent) === 60
      && by["measured-real"].status === "NORMAL",
    JSON.stringify(by["measured-real"]));
}

// The columns must actually be nullable now, or the importer's null writes will
// fail at runtime rather than here.
const { rows: cols } = await db.query(`
  select column_name, is_nullable from information_schema.columns
   where table_schema='public' and table_name='projects'
     and column_name in ('consumed_percent','billable_hours','status','contract_hours')
   order by column_name`);
console.log("");
console.table(cols);
const nullable = Object.fromEntries(cols.map((c) => [c.column_name, c.is_nullable]));
check("consumed_percent, billable_hours and status became nullable",
  nullable.consumed_percent === "YES" && nullable.billable_hours === "YES" && nullable.status === "YES");
check("contract_hours stayed NOT NULL",
  nullable.contract_hours === "NO",
  "the contract figure comes from the signed order, so it is known even when hours are not");

console.log(failures === 0
  ? "\nMIGRATION IS SAFE TO PASTE (idempotent across two runs)"
  : `\n${failures} check(s) failed — DO NOT PASTE`);
process.exit(failures === 0 ? 0 : 1);
