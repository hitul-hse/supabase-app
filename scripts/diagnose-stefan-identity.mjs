/*
 * Is "who is Stefan Goelzner" really a question only the user can answer?
 *
 * I have asserted that three times without testing it. The hub may already hold
 * the answer: if an app_user_profile, a people row, or a project_responsibility
 * entry names him, then linking his time.member row is a mechanical join rather
 * than a judgement call, and I have been sitting on a solvable problem.
 *
 * READ-ONLY. Looks for him by every exact key available, and by NOTHING else --
 * a name-similarity match on a person is precisely what ADR-001 forbids.
 */
import { readFileSync } from "node:fs";
import pg from "pg";

const env = Object.fromEntries(
  readFileSync("C:/Supabase/.env.local", "utf8").split(/\r?\n/)
    .filter((l) => l && !l.startsWith("#") && l.includes("="))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^"|"$/g, "")]; }));

const c = new pg.Client({ connectionString: env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
await c.connect();
const q = async (label, sql, params = []) => {
  const r = await c.query(sql, params);
  console.log(`\n### ${label}`);
  if (r.rows.length === 0) console.log("   (no rows)");
  else console.table(r.rows);
  return r.rows;
};

const EMAIL = "stefan-external@hs-expert.com";

await q("his time.member row, in full", `
  select id, source_id, email, display_name, role, status, is_archived,
         hub_person_id, user_id, team, job_title, weekly_hours, created_at::date
    from time.member where email = $1`, [EMAIL]);

/* ---------------- exact-key routes to an identity, each tried in turn ------- */

await q("1. an auth user with that exact address?", `
  select id, email, created_at::date, last_sign_in_at::date
    from auth.users where lower(email) = lower($1)`, [EMAIL]);

await q("2. an app_user_profile whose auth email matches?", `
  select p.user_id, p.person_id, p.role_key, p.department, p.is_active, u.email
    from public.app_user_profile p join auth.users u on u.id = p.user_id
   where lower(u.email) = lower($1)`, [EMAIL]);

await q("3. does any people row already carry his TrackingTime id? (exact key)", `
  select id, name, is_active, source, trackingtime_user_id, factorial_employee_id
    from public.people
   where trackingtime_user_id = (select source_id from time.member where email = $1)`, [EMAIL]);

await q("4. is he named as responsible or replacement on any order?", `
  select r.role, count(*) as orders
    from public.project_responsibility r
    join public.people p on p.id = r.person_id
   where p.name ilike '%goelzner%' or p.name ilike '%stefan%'
   group by r.role`);

await q("5. every people row whose id or name mentions stefan (EVIDENCE, not a match)", `
  select id, name, is_active, source, role, department, trackingtime_user_id
    from public.people
   where id ilike '%stefan%' or name ilike '%stefan%' or name ilike '%goelzner%'`);

/* ------------------------------- what his hours are attached to ------------- */

await q("6. which customers/projects his time lands on", `
  select coalesce(tc.name, '(no customer)') as customer,
         tp.name as tt_project,
         tp.hub_project_id,
         count(e.id) as entries,
         round(sum(e.duration_seconds)/3600.0, 1) as hours,
         count(*) filter (where e.is_billable) as billable
    from time.member m
    join time.entry e on e.member_id = m.id and e.started_at::date <= current_date
    left join time.project tp on tp.id = e.project_id
    left join time.customer tc on tc.id = e.customer_id
   where m.email = $1
   group by 1, 2, 3
   order by 5 desc`, [EMAIL]);

await q("7. does the DOMAIN typo have a sibling? (hs-expert vs hs-experts)", `
  select email, display_name, is_archived, hub_person_id
    from time.member
   where email ilike '%hs-expert.com' or email ilike '%hs-experts.com'
   order by email`);

await c.end();

console.log("\n" + "=".repeat(78));
console.log("READ-ONLY. No link was created.");
console.log("=".repeat(78));
console.log("The verdict depends on what the rows above show:");
console.log("  - if an app_user_profile or people row names him, the link is MECHANICAL");
console.log("    and I should propose it (exact key, ADR-001 satisfied).");
console.log("  - if nothing in the hub knows him, then 'employee, contractor, or");
console.log("    neither' is genuinely an HR fact and the user must supply it. His");
console.log("    address is on a MISSPELLED domain, so no exact key can ever reach him.");
