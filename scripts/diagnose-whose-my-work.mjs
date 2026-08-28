/*
 * URGENT: is Björn actually seeing Mathias's work, or is he seeing his OWN work
 * while believing he is signed in as Mathias?
 *
 * Those have opposite fixes. A cross-user data leak is a security incident. A
 * browser that kept Björn's session cookie and ignored the magic link is a
 * demo-procedure problem.
 *
 * The distinguishing evidence: WHAT WOULD EACH ACCOUNT SEE. getMyWork takes no
 * person id -- it resolves the caller from the verified session
 * (check-my-work-scoping proves that) -- so if the page showed Mathias's book of
 * work, the session WAS Mathias's. And if it showed Björn's, the two lists differ
 * and the difference is visible from here.
 *
 * Björn is `exec`, Mathias is `employee`, so their books differ by construction.
 *
 * READ-ONLY.
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
  if (!r.rows.length) console.log("   (no rows)");
  else console.table(r.rows);
  return r.rows;
};

await q("the two accounts", `
  select u.email, p.user_id, p.person_id, p.role_key, p.department, p.is_active
    from public.app_user_profile p join auth.users u on u.id = p.user_id
   where lower(u.email) in ('mathias@hs-experts.com','bjoern.schoenemann@hs-experts.com')
   order by u.email`);

/*
 * The "book of work" each person would see: owner, assigned, responsible or
 * replacement. Replicating the ladder from my-work.ts so the counts are
 * comparable, not the RLS predicate (which an exec passes on everything).
 */
const book = async (personId, label) => {
  const rows = await q(`${label}: projects with a personal claim`, `
    select p.id, p.name,
           (p.owner_person_id = $1) as is_owner,
           exists (select 1 from public.person_assignments a
                    where a.person_id = $1 and a.project_id = p.id) as is_assigned,
           exists (select 1 from public.project_responsibility r
                    where r.person_id = $1 and r.project_id = p.id and r.role = 'responsible') as is_responsible,
           exists (select 1 from public.project_responsibility r
                    where r.person_id = $1 and r.project_id = p.id and r.role = 'replacement') as is_replacement
      from public.projects p
     where p.owner_person_id = $1
        or exists (select 1 from public.person_assignments a where a.person_id = $1 and a.project_id = p.id)
        or exists (select 1 from public.project_responsibility r where r.person_id = $1 and r.project_id = p.id)
     order by p.id
     limit 12`, [personId]);
  const { rows: [n] } = await c.query(`
    select count(*) as n from public.projects p
     where p.owner_person_id = $1
        or exists (select 1 from public.person_assignments a where a.person_id = $1 and a.project_id = p.id)
        or exists (select 1 from public.project_responsibility r where r.person_id = $1 and r.project_id = p.id)`,
    [personId]);
  console.log(`   -> ${label} book size: ${n.n} projects (showing up to 12)`);
  return Number(n.n);
};

const mathias = await book("md-mathias", "MATHIAS (md-mathias, employee)");
const bjoern = await book("md-bjrn", "BJÖRN (md-bjrn, exec)");

console.log("\n" + "=".repeat(78));
console.log("HOW TO TELL WHICH SESSION THE PAGE WAS USING");
console.log("=".repeat(78));
console.log(`  Mathias's My Work shows ${mathias} projects.`);
console.log(`  Björn's   My Work shows ${bjoern} projects.`);
if (mathias !== bjoern) {
  console.log("  The counts DIFFER, so the page itself tells you whose session it is.");
} else {
  console.log("  The counts happen to match, so compare the project NAMES above instead.");
}
console.log("");
console.log("  The page header also prints the signed-in person's name, and My Work");
console.log("  resolves identity from the verified session only -- getMyWork takes no");
console.log("  person id (proven by npm run test:my-work-scoping).");
console.log("");
console.log("  So if Björn saw MATHIAS's list, the magic link worked and he was Mathias.");
console.log("  If he saw HIS OWN list, the browser reused his existing session and the");
console.log("  link never took effect -- which is what a non-incognito window does.");

/* ------------------------------ is there any cross-account leak path at all? */

await q("does any account share Mathias's person_id?", `
  select u.email, p.role_key, p.is_active
    from public.app_user_profile p join auth.users u on u.id = p.user_id
   where p.person_id = 'md-mathias'`);

await q("recent sign-ins on both accounts (did the link actually get used?)", `
  select email, last_sign_in_at, created_at::date
    from auth.users
   where lower(email) in ('mathias@hs-experts.com','bjoern.schoenemann@hs-experts.com')
   order by last_sign_in_at desc nulls last`);

await c.end();
console.log("\nREAD-ONLY: nothing was written.");
