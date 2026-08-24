/*
 * A dept_head scoped to a team he is not in.
 *
 * THE BUG, measured with his own session: Thorsten sees exactly ONE member on
 * /team-lead -- himself -- so board.rows is effectively empty and
 * TeamAnalysisSection returns null before either of its branches can render.
 * The gate reported "dept_head sees neither view", which was accurate and not
 * cosmetic: a department head could not see his department.
 *
 * THE CAUSE: two records of one fact, disagreeing.
 *   app_user_profile.department = 'ORGA'      <- what RLS scopes him by
 *   time.member.team            = 'OPERATIONS' <- what the roster says he is
 * RLS scopes the roster to the profile's team, so he was scoped to a team with
 * no members and saw only his own row.
 *
 * WHICH ONE IS TRUE. OPERATIONS. His TrackingTime job_title is literally
 * "Operations manager", his member record has said OPERATIONS since the vendor
 * sync, and Björn (CEO, exec) carries OPERATIONS on both records -- so the
 * roster side is corroborated twice while 'ORGA' appears nowhere else about
 * him. This aligns the profile to the roster, not the reverse: the vendor sync
 * would overwrite the roster on the next run.
 *
 * SEIF is left alone on purpose: profile ENG (a legacy label), no member record
 * at all. There is nothing to align him TO, and inventing a team for a
 * department head is precisely the kind of guess that produced this bug.
 * Reported, not fixed.
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

const disagreements = await client.query(`
  select u.email, p.role_key, p.department as profile_team, m.team as member_team
    from public.app_user_profile p
    join auth.users u on u.id = p.user_id
    join time.member m on lower(m.email) = lower(u.email)
   where m.team is not null
     and (p.department is null or upper(p.department) <> upper(m.team))
   order by u.email`);

console.log("profiles whose team disagrees with the roster:");
for (const row of disagreements.rows) {
  console.log(`   ${row.email} role=${row.role_key} profile=${row.profile_team} member=${row.member_team}`);
}

/*
 * Aligned to the ROSTER, by exact email join -- the roster is the vendor-synced
 * side and would overwrite any correction made there on the next import. Only
 * rows where the roster actually states a team are touched: a null member team
 * is not evidence that the profile is wrong.
 */
const updated = await client.query(`
  update public.app_user_profile p
     set department = upper(m.team)
    from auth.users u, time.member m
   where u.id = p.user_id
     and lower(m.email) = lower(u.email)
     and m.team is not null
     and (p.department is null or upper(p.department) <> upper(m.team))
  returning u.email, p.department`);
for (const row of updated.rows) console.log(`aligned ${row.email} -> ${row.department}`);

// Post-condition: no profile with a rostered member disagrees any more.
const remaining = await client.query(`
  select count(*)::int as n
    from public.app_user_profile p
    join auth.users u on u.id = p.user_id
    join time.member m on lower(m.email) = lower(u.email)
   where m.team is not null
     and (p.department is null or upper(p.department) <> upper(m.team))`);
if (remaining.rows[0].n !== 0) throw new Error(`${remaining.rows[0].n} disagreement(s) remain`);

// What is left unfixable, stated rather than hidden.
const unrostered = await client.query(`
  select u.email, p.role_key, p.department
    from public.app_user_profile p
    join auth.users u on u.id = p.user_id
    left join time.member m on lower(m.email) = lower(u.email)
   where p.role_key in ('dept_head', 'exec')
     and (m.id is null or m.team is null)
   order by u.email`);
console.log(`\n${updated.rowCount} profile(s) aligned. Leaders with no rostered team (need a human):`);
for (const row of unrostered.rows) {
  console.log(`   ${row.email} role=${row.role_key} profile_team=${row.department ?? "null"}`);
}

await client.end();
