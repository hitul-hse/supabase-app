/*
 * Complete the RLS chain that decides what a department head can see.
 *
 * THE FULL CHAIN, read from the live functions:
 *   time.can_view_member(id)
 *     -> m.hub_person_id must be set          (fixed: link-profiles-to-people)
 *     -> public.can_view_person(person_id)
 *          -> people.department = app_user_department()
 *
 * The last link is broken for every masterdata person: people.department is
 * NULL on all nine md-* rows, so `p.department = app_user_department()` is
 * never true and a dept_head sees only himself no matter what his profile
 * says. That is why aligning Thorsten's profile to OPERATIONS alone did not
 * fix the page -- the roster knew his team, the PEOPLE row did not, and RLS
 * reads the people row.
 *
 * THE SOURCE OF TRUTH is time.member.team: vendor-synced, corroborated by
 * job_title ("Operations manager", "CEO"), and the value the profile was just
 * aligned to. Copying it onto the linked people row makes all three records
 * state one fact.
 *
 * SCOPE: only rows where the roster ACTUALLY states a team (3 of 9 today --
 * Björn, Thorsten, and nobody else). The remaining six stay null: their team is
 * genuinely unrecorded, and guessing is what produced the disagreement this
 * script exists to repair. They are reported, not filled.
 *
 * Idempotent.
 */
import pg from "pg";
import { readFileSync } from "node:fs";

for (const line of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
  const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}

const client = new pg.Client({
  connectionString: process.env.SUPABASE_DB_URL,
  ssl: { rejectUnauthorized: false },
});
await client.connect();

const updated = await client.query(`
  update public.people p
     set department = upper(m.team)
    from time.member m
   where m.hub_person_id = p.id
     and m.team is not null
     and (p.department is null or p.department <> upper(m.team))
  returning p.id, p.name, p.department`);
for (const row of updated.rows) console.log(`people.${row.id} (${row.name}) department = ${row.department}`);

// What the chain now yields per leader, stated as the page would see it.
const scope = await client.query(`
  select u.email,
         pr.role_key,
         pr.department as viewer_team,
         (select count(*)::int
            from time.member m
            join public.people pe on pe.id = m.hub_person_id
           where pe.department = pr.department
             and not m.is_archived) as visible_teammates
    from public.app_user_profile pr
    join auth.users u on u.id = pr.user_id
   where pr.role_key in ('dept_head', 'exec')
   order by pr.role_key, u.email`);
console.log("\nwhat each leader's team scope now resolves to:");
for (const row of scope.rows) {
  console.log(
    `   ${String(row.email).padEnd(38)} ${String(row.role_key).padEnd(10)} team=${String(row.viewer_team ?? "-").padEnd(11)} rostered teammates=${row.visible_teammates}`
  );
}

const stillNull = await client.query(`
  select p.id, p.name
    from public.people p
    join time.member m on m.hub_person_id = p.id
   where p.department is null
   order by p.id`);
console.log(`\n${updated.rowCount} row(s) updated. Linked people with no team on the roster (need a human, via People > org chart):`);
for (const row of stillNull.rows) console.log(`   ${row.id} ${row.name}`);

await client.end();
