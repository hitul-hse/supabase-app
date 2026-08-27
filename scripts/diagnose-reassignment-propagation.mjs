// Prove the reassignment gap end to end, before building anything on top of it.
//
// The user's chain: team lead reassigns the responsible person -> that person
// sees the project in My Work as RESPONSIBLE.
//
// decide_project_responsible_change updates projects.owner_person_id and
// person_assignments but NOT project_responsibility. my-work.ts:516 sets the
// `responsible` rung exclusively from project_responsibility. So the prediction
// is: after an approved reassignment the new person appears as `owner`, and the
// OLD person still holds the RESPONSIBLE badge.
//
// Simulate the RPC's exact writes in a transaction and read back what my-work
// would compute. ROLLS BACK; nothing is persisted.
import { readFileSync } from "node:fs";
import pg from "pg";

const env = Object.fromEntries(
  readFileSync("C:/Supabase/.env.local", "utf8").split(/\r?\n/)
    .filter((l) => l && !l.startsWith("#") && l.includes("="))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^"|"$/g, "")]; }));

const c = new pg.Client({ connectionString: env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
await c.connect();

// A project that has BOTH an owner and a project_responsibility 'responsible'
// row, so the divergence is visible.
const { rows: [target] } = await c.query(`
  select p.id, p.name, p.owner_person_id, r.person_id as responsible_person_id
  from public.projects p
  join public.project_responsibility r on r.project_id = p.id and r.role = 'responsible'
  where p.owner_person_id is not null and p.owner_person_id = r.person_id
  limit 1`);

if (!target) { console.log("No project has a matching owner and responsible row; cannot demonstrate."); await c.end(); process.exit(0); }

const { rows: [newPerson] } = await c.query(
  `select id, name from public.people where id <> $1 and id like 'md-%' limit 1`, [target.owner_person_id]);
const nameOf = async (id) => (await c.query(`select name from public.people where id = $1`, [id])).rows[0]?.name ?? id;

console.log("SCENARIO: a team lead reassigns the responsible person (e.g. sick leave)\n");
console.log(`  project            ${target.id}  "${String(target.name).slice(0, 44)}"`);
console.log(`  currently owned by ${await nameOf(target.owner_person_id)}`);
console.log(`  reassigning to     ${newPerson.name}\n`);

// What my-work would say for a given person on this project.
const myWorkRole = async (personId) => {
  const { rows: [r] } = await c.query(`
    select
      (select owner_person_id from public.projects where id = $1) = $2 as is_owner,
      exists (select 1 from public.person_assignments where project_id = $1 and person_id = $2) as is_assigned,
      exists (select 1 from public.project_responsibility where project_id = $1 and person_id = $2 and role = 'responsible') as is_responsible,
      exists (select 1 from public.project_responsibility where project_id = $1 and person_id = $2 and role = 'replacement') as is_replacement`,
    [target.id, personId]);
  // my-work.ts:536 ladder: responsible > owner > replacement > assigned.
  if (r.is_responsible) return "RESPONSIBLE";
  if (r.is_owner) return "OWNER";
  if (r.is_replacement) return "REPLACEMENT";
  if (r.is_assigned) return "ASSIGNED";
  return "(not shown at all)";
};

console.log("BEFORE the reassignment:");
console.log(`  ${(await nameOf(target.owner_person_id)).padEnd(18)} -> ${await myWorkRole(target.owner_person_id)}`);
console.log(`  ${newPerson.name.padEnd(18)} -> ${await myWorkRole(newPerson.id)}`);

// Replay exactly what the RPC does on approval (migration lines 170-185).
await c.query("begin");
const { rows: [proj] } = await c.query(`select name from public.projects where id = $1`, [target.id]);
await c.query(`update public.projects set owner_person_id = $2,
                 lead = coalesce((select name from public.people where id = $2), lead)
               where id = $1`, [target.id, newPerson.id]);
await c.query(`delete from public.person_assignments
               where project_id = $1 and person_id is not distinct from $2`,
  [target.id, target.owner_person_id]);
await c.query(`insert into public.person_assignments
                 (person_id, project_id, project_name, logged_hours, tasks_count, share_percent, sort_order)
               values ($1, $2, $3, 0, 0, 100,
                 (select coalesce(max(sort_order),0)+1 from public.person_assignments where project_id = $2))`,
  [newPerson.id, target.id, proj.name]);

console.log("\nAFTER the approved reassignment (the RPC's exact writes):");
const oldRole = await myWorkRole(target.owner_person_id);
const newRole = await myWorkRole(newPerson.id);
console.log(`  ${(await nameOf(target.owner_person_id)).padEnd(18)} -> ${oldRole}`);
console.log(`  ${newPerson.name.padEnd(18)} -> ${newRole}`);

await c.query("rollback");

console.log("\nVERDICT:");
const bug = oldRole === "RESPONSIBLE" || newRole !== "RESPONSIBLE";
if (bug) {
  console.log("  CONFIRMED BUG. After the reassignment:");
  if (oldRole === "RESPONSIBLE") console.log(`    - the person who HANDED OVER still reads RESPONSIBLE`);
  if (newRole !== "RESPONSIBLE") console.log(`    - the person who TOOK OVER reads ${newRole}, not RESPONSIBLE`);
  console.log("  Cause: decide_project_responsible_change never writes");
  console.log("  public.project_responsibility, which my-work.ts:516 reads for that rung.");
  console.log("  Fix: the RPC must move the 'responsible' role row too.");
} else {
  console.log("  No divergence: the reassignment propagates correctly.");
}

// Prove the rollback held.
const { rows: [after] } = await c.query(
  `select owner_person_id from public.projects where id = $1`, [target.id]);
console.log(`\nRollback check: owner is ${after.owner_person_id}, expected ${target.owner_person_id} — ${after.owner_person_id === target.owner_person_id ? "UNCHANGED" : "LEAKED"}`);
await c.end();
