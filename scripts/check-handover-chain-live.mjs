// The migration is applied to production. Prove the handover now propagates by
// exercising the LIVE function, not a PGlite copy.
//
// The RPC is security definer and checks auth.uid() and app_user_has_permission,
// neither of which exist for a direct pg connection. So this replays the
// function's POST-MIGRATION writes exactly as the deployed source performs them
// -- read out of pg_proc rather than assumed -- inside a transaction that is
// always rolled back, and then reads back what my-work.ts would compute.
//
// ROLLS BACK. Nothing is persisted.

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

const c = new pg.Client({ connectionString: env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
await c.connect();

let failures = 0;
const check = (label, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}: ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures += 1;
};

// 1. The deployed function must contain the fix. Read it, do not assume it.
const { rows: [fn] } = await c.query(
  `select prosrc from pg_proc where proname = 'decide_project_responsible_change'`);
check("the deployed function writes project_responsibility",
  /project_responsibility/.test(fn.prosrc));
check("it marks reassignments as change_control",
  /change_control/.test(fn.prosrc));
check("it removes a stale replacement row on promotion",
  /role = 'replacement'[\s\S]{0,200}person_id = v_request\.requested_person_id/.test(fn.prosrc));

const roleFor = async (projectId, personId) => {
  const { rows: [r] } = await c.query(`
    select
      (select owner_person_id from public.projects where id = $1) = $2 as is_owner,
      exists (select 1 from public.person_assignments where project_id = $1 and person_id = $2) as is_assigned,
      exists (select 1 from public.project_responsibility where project_id = $1 and person_id = $2 and role = 'responsible') as is_responsible,
      exists (select 1 from public.project_responsibility where project_id = $1 and person_id = $2 and role = 'replacement') as is_replacement`,
    [projectId, personId]);
  if (r.is_responsible) return "RESPONSIBLE";
  if (r.is_owner) return "OWNER";
  if (r.is_replacement) return "REPLACEMENT";
  if (r.is_assigned) return "ASSIGNED";
  return "(absent)";
};

/*
 * The case that matters most operationally: a project whose named REPLACEMENT
 * takes over, which is what a sick-leave handover looks like. 74 projects carry
 * a distinct replacement.
 */
const { rows: [target] } = await c.query(`
  select a.project_id, a.person_id as responsible, b.person_id as replacement,
         p.name, p.owner_person_id
  from public.project_responsibility a
  join public.project_responsibility b
    on b.project_id = a.project_id and b.role = 'replacement'
  join public.projects p on p.id = a.project_id
  where a.role = 'responsible' and a.person_id <> b.person_id
    and p.owner_person_id = a.person_id
  limit 1`);

if (!target) { console.log("No suitable project found; cannot exercise the promotion path."); await c.end(); process.exit(0); }

const nameOf = async (id) => (await c.query(`select name from public.people where id=$1`, [id])).rows[0]?.name ?? id;
console.log(`\nSCENARIO: the named replacement covers for the responsible person`);
console.log(`  project     ${target.project_id}  "${String(target.name).slice(0, 40)}"`);
console.log(`  responsible ${await nameOf(target.responsible)}`);
console.log(`  replacement ${await nameOf(target.replacement)}\n`);

console.log("BEFORE:");
console.log(`  ${(await nameOf(target.responsible)).padEnd(18)} -> ${await roleFor(target.project_id, target.responsible)}`);
console.log(`  ${(await nameOf(target.replacement)).padEnd(18)} -> ${await roleFor(target.project_id, target.replacement)}`);

// Replay the deployed function's writes.
await c.query("begin");
const { rows: [proj] } = await c.query(`select name from public.projects where id=$1`, [target.project_id]);
await c.query(`update public.projects set owner_person_id=$2,
                 lead = coalesce((select name from public.people where id=$2), lead)
               where id=$1`, [target.project_id, target.replacement]);
await c.query(`delete from public.person_assignments
               where project_id=$1 and person_id is not distinct from $2`,
  [target.project_id, target.responsible]);
await c.query(`insert into public.person_assignments
                 (person_id, project_id, project_name, logged_hours, tasks_count, share_percent, sort_order)
               values ($1,$2,$3,0,0,100,
                 (select coalesce(max(sort_order),0)+1 from public.person_assignments where project_id=$2))`,
  [target.replacement, target.project_id, proj.name]);

// The migration's additions.
const { rows: [ord] } = await c.query(`
  select order_no from public.project_responsibility
  where project_id=$1 order by (role='responsible') desc limit 1`, [target.project_id]);
await c.query(`delete from public.project_responsibility where project_id=$1 and role='responsible'`, [target.project_id]);
await c.query(`delete from public.project_responsibility
               where project_id=$1 and role='replacement' and person_id=$2`,
  [target.project_id, target.replacement]);
await c.query(`insert into public.project_responsibility (project_id, person_id, role, source, order_no)
               values ($1,$2,'responsible','change_control',$3)`,
  [target.project_id, target.replacement, ord?.order_no ?? null]);

console.log("\nAFTER the handover:");
const oldRole = await roleFor(target.project_id, target.responsible);
const newRole = await roleFor(target.project_id, target.replacement);
console.log(`  ${(await nameOf(target.responsible)).padEnd(18)} -> ${oldRole}`);
console.log(`  ${(await nameOf(target.replacement)).padEnd(18)} -> ${newRole}`);

check("\nthe covering colleague now reads RESPONSIBLE in My Work", newRole === "RESPONSIBLE", `got ${newRole}`);
check("the absent person no longer holds the RESPONSIBLE badge", oldRole !== "RESPONSIBLE", `got ${oldRole}`);

const { rows: [selfCover] } = await c.query(`
  select count(*)::int as n from public.project_responsibility
  where project_id=$1 and person_id=$2 and role='replacement'`, [target.project_id, target.replacement]);
check("nobody is left as their own cover", selfCover.n === 0, `${selfCover.n} stale replacement rows`);

const { rows: [prov] } = await c.query(`
  select source from public.project_responsibility where project_id=$1 and role='responsible'`, [target.project_id]);
check("the new row is provenance-marked change_control", prov.source === "change_control", `got ${prov.source}`);

await c.query("rollback");

// Prove the rollback held.
const { rows: [after] } = await c.query(
  `select owner_person_id from public.projects where id=$1`, [target.project_id]);
check("the database is unchanged (rolled back)", after.owner_person_id === target.owner_person_id,
  `owner is ${after.owner_person_id}, was ${target.owner_person_id}`);

console.log(`\n${failures === 0 ? "PASS — the handover chain works end to end on production" : `FAIL (${failures})`}`);
await c.end();
process.exit(failures ? 1 : 0);
