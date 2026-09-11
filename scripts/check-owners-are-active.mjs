/*
 * Does any live project answer to somebody who has left?
 *
 * WHY THIS EXISTS
 * ---------------
 * On 2026-09-04 md-serhii was offboarded — the fourth departure the Hub has
 * modelled, and the FIRST one that left live responsibility behind. The three
 * before him (fq-kamila, fq-liliia, fq-pablo) between them owned zero projects,
 * held zero project_responsibility rows and zero person_assignments, so
 * deactivating them cost nothing and nobody had to notice.
 *
 * Serhii owned 10483_00298_601_01 — HEC Solar, CRITICAL, 3 contract hours
 * against 30.5 logged. After the offboarding that project is owned by an
 * inactive person, and NOTHING IN THE APP SAYS SO: projects.owner_person_id
 * carries no is_active filter on any read path, so the row does not appear on a
 * "needs an owner" list, does not colour differently, and does not show up in
 * any count. It simply sits there, critical and unowned, until a human happens
 * to open it.
 *
 * That is the failure this repository keeps paying for in other forms: not a
 * wrong answer, but silence where an answer should be. A gate is the cheapest
 * place to put the noticing, because it runs whether or not anyone remembers.
 *
 * WHAT IT ASSERTS
 * ---------------
 * For every project that is NOT closed:
 *   1. owner_person_id, when set, names an active person.
 *   2. every project_responsibility row with role='responsible' names an
 *      active person.
 *
 * Both are checked because they answer different questions. The owner is who
 * the system thinks is accountable; the responsible row is who the business
 * wrote down in the masterdata workbook. They can disagree, and when a person
 * leaves, either can be left pointing at nobody.
 *
 * WHAT IT DELIBERATELY DOES NOT DO
 * --------------------------------
 * It does not check `replacement` rows. A replacement who has left is worth
 * knowing about but is not an unowned project — the named lead is still there —
 * and failing a build for it would train people to ignore this gate.
 *
 * It does not reassign anything. Who inherits a customer is a human decision,
 * and the audited path (request_project_responsible_change ->
 * decide_project_responsible_change, reachable from the Reassignment picker)
 * writes a change_event that a SQL UPDATE would skip.
 *
 * EXPECTED TO BE RED WHEN FIRST ADDED. HEC Solar is the case that prompted it.
 * Hand that project over and this goes green; that is the whole point, and an
 * allow-list entry for it was deliberately NOT added, because an exception
 * granted on day one is how a gate becomes decoration.
 */
import { loadEnv } from "./lib/gate-env.mjs";
import pg from "pg";

const env = loadEnv();
if (!env.SUPABASE_DB_URL) {
  console.log("SKIP: no SUPABASE_DB_URL — this gate reads the live roster");
  process.exit(0);
}

let failures = 0;
const check = (ok, label, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}: ${label}${detail ? `\n        ${detail}` : ""}`);
  if (!ok) failures += 1;
};

/*
 * Projects considered live. `status` is free text on this table and carries
 * CRITICAL / WARNING / ACTIVE / NORMAL and a NULL for 54 rows, so the honest
 * filter is "not explicitly closed" rather than an allow-list of good values —
 * a new status string must not silently drop a project out of this check.
 */
const NOT_CLOSED = `coalesce(lower(p.status), '') not in ('closed', 'done', 'archived', 'cancelled')`;

const client = new pg.Client({ connectionString: env.SUPABASE_DB_URL });
await client.connect();
try {
  await client.query("begin read only");

  const { rows: orphanOwners } = await client.query(`
    select p.id, p.name, p.customer, p.status, p.owner_person_id, pe.name as owner_name
      from public.projects p
      join public.people pe on pe.id = p.owner_person_id
     where ${NOT_CLOSED}
       and pe.is_active = false
     order by p.id`);

  check(
    orphanOwners.length === 0,
    "every live project's owner is an active person",
    orphanOwners.length
      ? orphanOwners
          .map((r) => `${r.id} (${r.status}) "${r.name}" — owner ${r.owner_name} has left`)
          .join("\n        ")
      : "no project is owned by somebody who has left",
  );

  const { rows: orphanResponsible } = await client.query(`
    select p.id, p.name, p.status, pe.name as person_name,
           (select string_agg(pe2.name, ', ')
              from public.project_responsibility r2
              join public.people pe2 on pe2.id = r2.person_id
             where r2.project_id = p.id and r2.role = 'replacement'
               and pe2.is_active) as active_replacement
      from public.projects p
      join public.project_responsibility r on r.project_id = p.id and r.role = 'responsible'
      join public.people pe on pe.id = r.person_id
     where ${NOT_CLOSED}
       and pe.is_active = false
     order by p.id`);

  check(
    orphanResponsible.length === 0,
    "every live project's named responsible is an active person",
    orphanResponsible.length
      ? orphanResponsible
          .map(
            (r) =>
              `${r.id} (${r.status}) — responsible ${r.person_name} has left` +
              (r.active_replacement
                ? `; recorded replacement is ${r.active_replacement}`
                : "; NO active replacement recorded"),
          )
          .join("\n        ")
      : "no project names a departed person as responsible",
  );

  /*
   * A negative control. If the two queries above found nothing because the
   * JOIN is wrong rather than because the data is clean, this catches it: the
   * same shape run against is_active = true must return rows, since live
   * projects self-evidently do have active owners.
   */
  const { rows: sanity } = await client.query(`
    select count(*)::int as n
      from public.projects p
      join public.people pe on pe.id = p.owner_person_id
     where ${NOT_CLOSED} and pe.is_active`);
  check(
    sanity[0].n > 0,
    "negative control: the same join DOES find active owners",
    `${sanity[0].n} live project(s) owned by an active person — proves the join and filter work`,
  );

  await client.query("rollback");
} finally {
  await client.end();
}

console.log(
  failures === 0
    ? "\nOWNERS ARE ACTIVE: every live project answers to somebody who still works here."
    : `\nOWNERS ARE ACTIVE: ${failures} FAILED — hand these over in the Reassignment picker, which writes the audit trail.`,
);
process.exit(failures === 0 ? 0 : 1);
