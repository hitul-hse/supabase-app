/*
 * Execute the masterdata-source migration against a real Postgres (PGlite),
 * twice, and assert its post-conditions. The user applies DDL by hand, so a
 * migration must be proven to run -- and to run twice -- before it is handed
 * over.
 */
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";

/*
 * Both artefacts are tested: the migration file and the paste file the user
 * actually runs. They must agree -- a paste file that drifts from its
 * migration is how a verified change ships unverified.
 */
const MIGRATION = "supabase/migrations/20260824100000_allow_masterdata_people_source.sql";
const PASTE = "supabase/APPLY-IN-SQL-EDITOR-3.sql";

let failed = 0;
const check = (name, ok, detail = "") => {
  if (!ok) failed += 1;
  console.log(`${ok ? "PASS" : "FAIL"}: ${name}${detail ? ` — ${detail}` : ""}`);
};

const db = new PGlite();

// The pre-migration shape, as it exists in production today.
await db.exec(`
  create table public.people (
    id text primary key,
    name text not null,
    is_active boolean not null default true,
    source text not null default 'seed' check (source in ('seed', 'factorial'))
  );
  create table public.app_user_profile (
    user_id uuid primary key,
    person_id text references public.people(id)
  );
  insert into public.people (id, name, is_active, source) values
    ('emp-1', 'Anna Brandt', false, 'seed'),
    ('emp-2', 'C. Haas', false, 'seed'),
    ('md-bjrn', 'Björn', true, 'seed'),
    ('md-hendryk', 'Hendryk', true, 'seed');
  insert into public.app_user_profile (user_id, person_id) values
    ('11111111-1111-1111-1111-111111111111', 'md-bjrn');
`);

// The constraint really does reject 'masterdata' before the migration.
let rejected = false;
try {
  await db.exec(`update public.people set source = 'masterdata' where id = 'md-bjrn'`);
} catch {
  rejected = true;
}
check("before the migration, 'masterdata' is rejected by the check constraint", rejected);

const sql = readFileSync(MIGRATION, "utf8");

for (const pass of [1, 2]) {
  try {
    await db.exec(sql);
    check(`migration executes (pass ${pass})`, true);
  } catch (e) {
    check(`migration executes (pass ${pass})`, false, e.message);
    break;
  }

  const counts = await db.query(
    `select source, count(*)::int as n from public.people group by source order by source`
  );
  const bySource = Object.fromEntries(counts.rows.map((r) => [r.source, r.n]));
  check(
    `after pass ${pass}: the md-* rows are masterdata`,
    bySource.masterdata === 2,
    JSON.stringify(bySource)
  );
  check(
    `after pass ${pass}: the emp-* mockups stay seed`,
    bySource.seed === 2,
    "relabelling those would erase the distinction the migration restores"
  );
}

// The widened domain accepts the new value and still rejects nonsense.
await db.exec(`insert into public.people (id, name, source) values ('md-new', 'New', 'masterdata')`);
check("the widened constraint accepts 'masterdata'", true);
let stillRejects = false;
try {
  await db.exec(`insert into public.people (id, name, source) values ('x', 'X', 'invented')`);
} catch {
  stillRejects = true;
}
check("the constraint still rejects an unknown source", stillRejects);

// The default is unchanged: a row with no stated provenance is not masterdata.
await db.exec(`insert into public.people (id, name) values ('md-default', 'Defaulted')`);
const def = await db.query(`select source from public.people where id = 'md-default'`);
check(
  "the column default stays 'seed' (no silent provenance claims)",
  def.rows[0].source === "seed",
  def.rows[0].source
);

// The post-condition the production script asserts.
const seedLinked = await db.query(`
  select count(*)::int as n from public.app_user_profile p
    join public.people pe on pe.id = p.person_id
   where pe.source = 'seed'`);
check("no profile is left pointing at a seed person", seedLinked.rows[0].n === 0);

// The paste file must carry the same DDL as the migration.
const paste = readFileSync(PASTE, "utf8");
for (const clause of [
  "drop constraint if exists people_source_check",
  "check (source in ('seed', 'factorial', 'masterdata'))",
  "where id like 'md-%'",
]) {
  check(`the paste file carries: ${clause.slice(0, 46)}`, paste.includes(clause));
}
check(
  "the paste file does NOT relabel the emp-* mockups",
  !/emp-%/.test(paste),
  "those rows are fiction and must stay labelled as such",
);

await db.close();
console.log(failed === 0 ? "\nMIGRATION: executes twice, post-conditions hold" : `\nMIGRATION: ${failed} FAILURES`);
process.exit(failed === 0 ? 0 : 1);
