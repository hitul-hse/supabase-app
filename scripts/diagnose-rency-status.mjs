// Is the PEOPLE allowlist's exclusion of Rency Sebastian defensible?
//
// If Rency is archived / departed, omitting them from a forward-looking
// utilisation view is a legitimate decision that merely needs documenting. If
// Rency is an active member with logged time, the dashboard is silently hiding
// the company's largest responsibility holder (62 responsible projects).
// READ-ONLY.
import { readFileSync } from "node:fs";
import pg from "pg";

const env = Object.fromEntries(
  readFileSync("C:/Supabase/.env.local", "utf8").split(/\r?\n/)
    .filter((l) => l && !l.startsWith("#") && l.includes("="))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^"|"$/g, "")]; }));

const c = new pg.Client({ connectionString: env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
await c.connect();
const q = async (label, sql) => {
  try { const r = await c.query(sql); console.log(`\n### ${label}`); console.table(r.rows); return r.rows; }
  catch (e) { console.log(`\n### ${label} FAILED: ${e.message}`); return null; }
};

// time.entry has no `date`; bound on started_at so future-dated planned entries
// cannot inflate "hours logged" (the repo's standing rule).
await q("TrackingTime status of the excluded vs included names", `
  select m.display_name, m.is_archived, m.status, m.role, m.job_title,
         (select count(*) from time.entry e where e.member_id = m.id) as entries,
         (select round(coalesce(sum(e.duration_seconds),0)/3600.0, 1) from time.entry e
           where e.member_id = m.id and e.started_at <= now()) as hours_to_date
  from time.member m
  where m.display_name ilike any (array[
    '%rency%','%sch_nemann%','%hendryk%','%mathias%','%thorsten%',
    '%stephan%','%mustafa%','%ousmane%','%serhii%'])
  order by hours_to_date desc nulls last`);

await q("the working organisation (not archived AND has logged time)", `
  select count(*) as working_members
  from time.member m
  where m.is_archived is not true
    and exists (select 1 from time.entry e where e.member_id = m.id and e.started_at <= now())`);

await q("VERDICT: is Rency part of the working organisation?", `
  select m.display_name, m.is_archived, m.status,
         exists (select 1 from time.entry e where e.member_id = m.id and e.started_at <= now()) as has_logged_time,
         (m.is_archived is not true
          and exists (select 1 from time.entry e where e.member_id = m.id and e.started_at <= now())) as in_working_org
  from time.member m
  where m.display_name ilike '%rency%'`);

console.log("\nREAD-ONLY: nothing was written.");
await c.end();
