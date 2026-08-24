// Two claims from the timesheet diagnosis decide what to do next, so I verify
// them myself rather than take the report's word.
//
//   1. public.timesheet_entries is mockup data belonging to an inactive seed row.
//   2. time.entry is real, but the hub bridge only covers part of it, so hours
//      cannot be attributed to hub projects for the unbridged remainder.
import { readFileSync } from "node:fs";
import pg from "pg";

const env = Object.fromEntries(
  readFileSync("C:/Supabase/.env.local", "utf8").split(/\r?\n/)
    .filter((l) => l && !l.startsWith("#") && l.includes("="))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^"|"$/g, "")]; }));

const c = new pg.Client({ connectionString: env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
await c.connect();
const q = async (l, s, p) => { const r = await c.query(s, p); console.log(`\n### ${l}`); console.table(r.rows.slice(0, 15)); return r.rows; };

await q("claim 1: is EVERY timesheet_entries row an inactive seed person?", `
  select pe.id, pe.name, pe.is_active, pe.source, count(*)::int rows
  from public.timesheet_entries t
  join public.people pe on pe.id = t.person_id
  group by 1,2,3,4`);

await q("claim 2: how much REAL time can reach a hub project?", `
  select
    count(*)::int total_entries,
    count(*) filter (where p.hub_project_id is not null)::int bridged_to_hub,
    count(*) filter (where e.project_id is null)::int no_project_at_all,
    round(sum(e.duration_seconds)/3600.0, 1) total_hours,
    round(sum(e.duration_seconds) filter (where p.hub_project_id is not null)/3600.0, 1) bridged_hours
  from time.entry e
  left join time.project p on p.id = e.project_id`);

await q("the 9 members with time but no hub link (who are they?)", `
  select m.display_name, m.email, m.user_id is not null as has_auth_user,
         count(e.id)::int entries, round(sum(e.duration_seconds)/3600.0,1) hours
  from time.member m
  join time.entry e on e.member_id = m.id
  where m.hub_person_id is null
  group by 1,2,3 order by entries desc`);

// Does an unbridged member map to a real hub person by name? If so the bridge
// is fillable, not fundamentally missing.
await q("can those members be matched to public.people by name?", `
  select m.display_name, pe.id matched_person, pe.is_active
  from time.member m
  left join public.people pe
    on lower(btrim(pe.name)) = lower(btrim(m.display_name))
    or lower(split_part(m.display_name,' ',1)) = lower(btrim(pe.name))
  where m.hub_person_id is null
    and exists (select 1 from time.entry e where e.member_id = m.id)
  order by 1`);

await c.end();
