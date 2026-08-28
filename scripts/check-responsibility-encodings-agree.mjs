// Gate: the two responsibility encodings must not disagree silently.
//
// The same fact is stored twice:
//   public.person_assignments      share_percent = 0 / sort_order = 1  -> named cover
//   public.project_responsibility  role = 'replacement'                -> named cover
//
// They disagree on which projects have a named cover: person_assignments knows
// 168, project_responsibility knows 140. The 28-project difference is not a
// deliberate filter -- all 28 are ABSENT FROM project_responsibility ENTIRELY (0
// of them carry any role row, not even 'responsible'), so the role table is
// simply incomplete. 25 of the 28 name a genuinely different person from the
// responsible, so they are real cover rather than self-cover noise that a later,
// stricter import might have dropped on purpose.
//
// (For context on the wider tables: person_assignments references 177 distinct
// projects in total and project_responsibility 149, out of 231.)
//
// This matters because the two are now read by different pages:
//   management-employee-ownership.ts -> person_assignments  (the wider, complete set)
//   management-service-overview.ts   -> project_responsibility
//   my-work.ts                       -> project_responsibility
//
// Measured impact on /my-work (diagnose-my-work-role-gap.mjs): all 28 projects
// are still LISTED, because the share=0 assignment row itself satisfies the
// `assigned` rung. What is lost is the REPLACEMENT badge and the role count, so
// the page understates 25 projects' worth of cover duty -- 12 for Mathias, 5
// each for Thorsten and Hendryk, 3 for Stephan. A mislabel, not a
// disappearance, which is why this is a pinned tolerance and not a failure.
//
// The gate does not decide which table wins -- that is a data-ownership call.
// It records the disagreement with an explicit tolerance so it cannot grow
// unnoticed, and it fails outright on the one thing that is unambiguously wrong:
// a project in the role table that the assignment table contradicts.
//
// READ-ONLY.

import pg from "pg";
import { loadEnv } from "./lib/gate-env.mjs";

const env = loadEnv();

// No database URL means no live database to check -- on CI without secrets, or
// on a clean checkout. Skipping says so; passing pg an undefined connection
// string makes it default to localhost:5432 and fail with ECONNREFUSED, which
// reads like a broken gate rather than an absent credential.
if (!env.SUPABASE_DB_URL) {
  console.log("SKIP: no SUPABASE_DB_URL, so there is no live database to check");
  process.exit(0);
}

// The known, accepted size of the gap. Raising this must be a deliberate edit
// with a reason, which is the whole point of pinning it.
const KNOWN_GAP = 28;

const c = new pg.Client({ connectionString: env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
await c.connect();

const failures = [];
const check = (ok, label, detail) => {
  console.log(`${ok ? "  ok  " : " FAIL "} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures.push(label);
};

console.log("check-responsibility-encodings-agree: do the two cover tables tell the same story?\n");

// 1. The gap must not grow. Shrinking is fine and expected once someone
//    backfills the role table.
const { rows: [gap] } = await c.query(`
  with pa as (
    select distinct project_id from public.person_assignments
    where share_percent = 0 and sort_order = 1 and project_id is not null),
  pr as (
    select distinct project_id from public.project_responsibility where role = 'replacement')
  select
    (select count(*) from pa) as in_assignments,
    (select count(*) from pr) as in_responsibility,
    (select count(*) from pa left join pr using (project_id) where pr.project_id is null) as only_in_assignments,
    (select count(*) from pr left join pa using (project_id) where pa.project_id is null) as only_in_responsibility`);

const onlyInAssignments = Number(gap.only_in_assignments);
console.log(`  note  person_assignments knows ${gap.in_assignments} covered projects, project_responsibility knows ${gap.in_responsibility}`);

check(onlyInAssignments <= KNOWN_GAP,
  `the assignments-only gap has not grown beyond the known ${KNOWN_GAP}`,
  `${onlyInAssignments} projects carry a share=0 cover with no replacement role row`);

if (onlyInAssignments < KNOWN_GAP) {
  console.log(`  note  the gap SHRANK to ${onlyInAssignments}. Lower KNOWN_GAP in this gate to lock the improvement in.`);
}

// 2. The role table must never claim cover the assignment table denies. This
//    direction has no legitimate explanation and was 0 when written.
check(Number(gap.only_in_responsibility) === 0,
  "the role table never claims cover that person_assignments contradicts",
  `${gap.only_in_responsibility} unexplained`);

// 3. Where BOTH tables name a cover for the same project, they must name the
//    same person. A silent disagreement here means two pages show different
//    names for the same field.
const { rows: [conflict] } = await c.query(`
  with pa as (
    select project_id, person_id from public.person_assignments
    where share_percent = 0 and sort_order = 1 and project_id is not null),
  pr as (
    select project_id, person_id from public.project_responsibility where role = 'replacement')
  select count(*) as disagreements
  from pa join pr using (project_id)
  where pa.person_id <> pr.person_id`);

check(Number(conflict.disagreements) === 0,
  "where both tables name a cover, they name the same person",
  `${conflict.disagreements} projects would show two different names`);

// 4. The 28 are absent from the role table ENTIRELY, which is the evidence that
//    the table is incomplete rather than deliberately filtered. If that ever
//    stops being true, the diagnosis in this gate's header is stale and the
//    reader needs to know.
const { rows: [absence] } = await c.query(`
  with pa as (
    select distinct pa.project_id from public.person_assignments pa
    where pa.share_percent = 0 and pa.sort_order = 1 and pa.project_id is not null),
  pr as (
    select distinct project_id from public.project_responsibility where role = 'replacement')
  select count(*) filter (where exists (
           select 1 from public.project_responsibility r where r.project_id = pa.project_id)) as have_any_role_row
  from pa left join pr using (project_id)
  where pr.project_id is null`);

check(Number(absence.have_any_role_row) === 0,
  "every gap project is absent from the role table entirely (incomplete, not filtered)",
  `${absence.have_any_role_row} have a role row but no replacement one, which would change the diagnosis`);

console.log(`\n${failures.length === 0 ? "PASS" : `FAIL (${failures.length})`}`);
if (failures.length) {
  for (const f of failures) console.log(`  - ${f}`);
  console.log("\nRun `node scripts/diagnose-responsibility-table-gap.mjs` for the per-project detail.");
}
await c.end();
process.exit(failures.length ? 1 : 0);
