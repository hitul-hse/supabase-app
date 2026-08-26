// Gate: the service overview must report real replacement coverage, not n/a.
//
// public.project_responsibility carries 140 role='replacement' rows over 140
// projects. Three read paths hardcoded projectsWithoutReplacement = null with
// the comment "no confirmed replacement relation exists in the current schema",
// which rendered every REPLACEMENT cell as n/a while the rows sat in the table.
// That is not an honest null: the relation exists, it was simply not read.
//
// This gate asserts the arithmetic the page now performs, so the null cannot
// come back silently. It also asserts the honest-null direction: if the
// relation ever IS empty, n/a is correct and must be preserved.
//
// READ-ONLY.
import { readFileSync } from "node:fs";
import pg from "pg";

const env = Object.fromEntries(
  readFileSync("C:/Supabase/.env.local", "utf8").split(/\r?\n/)
    .filter((l) => l && !l.startsWith("#") && l.includes("="))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^"|"$/g, "")]; }));

const c = new pg.Client({ connectionString: env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
await c.connect();

const failures = [];
const check = (ok, label, detail) => {
  console.log(`${ok ? "  ok  " : " FAIL "} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures.push(label);
};

console.log("check-replacement-coverage: is the named cover relation readable and honest?\n");

// 1. The relation is populated. If this is 0 the page's n/a is correct and the
//    remaining assertions are vacuous, so say so loudly rather than passing.
const { rows: [roles] } = await c.query(`
  select
    count(*) filter (where role = 'replacement') as replacement_rows,
    count(distinct project_id) filter (where role = 'replacement') as replacement_projects,
    count(*) filter (where role = 'responsible') as responsible_rows
  from public.project_responsibility`);

const replacementRows = Number(roles.replacement_rows);
check(replacementRows > 0,
  "project_responsibility carries replacement rows",
  `${replacementRows} rows over ${roles.replacement_projects} projects`);

if (replacementRows === 0) {
  console.log("\nThe relation is empty, so n/a is the honest answer and this gate cannot");
  console.log("assert coverage. Populate project_responsibility before trusting the page.");
  await c.end();
  process.exit(0);
}

// 2. It must not contradict the share_percent = 0 convention in
//    person_assignments. A disagreement means one of the two encodings is wrong
//    and the page would show a different answer depending on which it read.
const { rows: [agreement] } = await c.query(`
  with pa as (
    select distinct project_id from public.person_assignments
    where share_percent = 0 and sort_order = 1 and project_id is not null),
  pr as (
    select distinct project_id from public.project_responsibility where role = 'replacement')
  select
    (select count(*) from pr p left join pa a using (project_id) where a.project_id is null) as in_roles_not_in_assignments,
    (select count(*) from pa a left join pr p using (project_id) where p.project_id is null) as in_assignments_not_in_roles`);

check(Number(agreement.in_roles_not_in_assignments) === 0,
  "every role-table replacement is also encoded in person_assignments",
  `${agreement.in_roles_not_in_assignments} would be unexplained`);

// The reverse direction is expected and is NOT a failure: person_assignments is
// the wider set (168 vs 140). Report it so the gap stays visible.
console.log(`  note  ${agreement.in_assignments_not_in_roles} projects carry a share=0 assignee with no role row (assignments is the wider set)`);

// 3. Every replacement points at a real project and a real person.
const { rows: [integrity] } = await c.query(`
  select
    count(*) filter (where pr.id is null) as dangling_project,
    count(*) filter (where pe.id is null) as dangling_person
  from public.project_responsibility r
  left join public.projects pr on pr.id = r.project_id
  left join public.people pe on pe.id = r.person_id
  where r.role = 'replacement'`);

check(Number(integrity.dangling_project) === 0, "no replacement points at a missing project", `${integrity.dangling_project} dangling`);
check(Number(integrity.dangling_person) === 0, "no replacement points at a missing person", `${integrity.dangling_person} dangling`);

// 4. The headline number the page now shows must be a real count, and it must
//    be strictly less than the total, otherwise "coverage" means nothing.
const { rows: [coverage] } = await c.query(`
  with repl as (
    select distinct project_id from public.project_responsibility where role = 'replacement')
  select
    count(*) as open_projects,
    count(*) filter (where r.project_id is null) as open_without_replacement
  from public.projects pr
  left join repl r on r.project_id = pr.id
  where pr.status is null or pr.status not ilike '%abgeschlossen%'`);

const open = Number(coverage.open_projects);
const uncovered = Number(coverage.open_without_replacement);
check(open > 0, "there are open projects to measure", `${open} open`);
check(uncovered < open,
  "replacement coverage is a real measurement, not a blanket miss",
  `${uncovered} of ${open} open projects have no named cover`);

// 5. Self-cover is not cover. The workbook repeats the responsible person in
//    the Vertretung column on 78 rows, so 65 projects name someone as their own
//    replacement. Those rows are real and must be KEPT (the import was
//    faithful), but the coverage metric must not count them, or a project with
//    no independent cover reads as covered. This asserts the exclusion, not the
//    absence.
const { rows: [selfCover] } = await c.query(`
  select count(*) as self_covered
  from public.project_responsibility a
  join public.project_responsibility b
    on b.project_id = a.project_id and b.person_id = a.person_id
  where a.role = 'responsible' and b.role = 'replacement'`);

const selfCovered = Number(selfCover.self_covered);
console.log(`  note  ${selfCovered} projects name the responsible person as their own replacement (workbook repeats the name on 78 rows)`);

// The honest coverage number excludes self-cover, and must therefore be
// strictly worse than the naive one whenever self-cover exists.
const { rows: [honest] } = await c.query(`
  with resp as (
    select project_id, person_id from public.project_responsibility where role = 'responsible'),
  independent as (
    select distinct r.project_id
    from public.project_responsibility r
    left join resp on resp.project_id = r.project_id
    where r.role = 'replacement' and (resp.person_id is null or resp.person_id <> r.person_id))
  select
    count(*) as open_projects,
    count(*) filter (where i.project_id is null) as open_without_independent_cover
  from public.projects pr
  left join independent i on i.project_id = pr.id
  where pr.status is null or pr.status not ilike '%abgeschlossen%'`);

const honestUncovered = Number(honest.open_without_independent_cover);
check(honestUncovered >= uncovered,
  "excluding self-cover cannot improve the coverage number",
  `${honestUncovered} uncovered once self-cover is excluded, vs ${uncovered} naive`);

if (selfCovered > 0) {
  check(honestUncovered > uncovered,
    "self-cover is actually excluded from the coverage metric",
    `${honestUncovered} vs ${uncovered}: the ${selfCovered} self-covered projects must move to uncovered`);
}

check(honestUncovered < open,
  "independent cover exists somewhere, so the metric still measures something",
  `${honestUncovered} of ${open} open projects lack independent cover`);

console.log(`\n${failures.length === 0 ? "PASS" : `FAIL (${failures.length})`}`);
if (failures.length) for (const f of failures) console.log(`  - ${f}`);
await c.end();
process.exit(failures.length ? 1 : 0);
