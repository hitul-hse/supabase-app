// Stefan Goelzner logs 139.8h of billable time (59 entries) and has no
// hub_person_id, found by check-factorial-identity-baseline. Rency Sebastian was
// a person who existed in public.people but was excluded from the management
// allowlist. Is Stefan the same class of bug, or a different one?
//
// This matters for check:management-people-complete: that gate only sees people
// who carry a project_responsibility row. Someone logging real hours with no
// person row at all is invisible to it, which would be a hole in the gate rather
// than a hole in the data.
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
  const r = await c.query(sql); console.log(`\n### ${label}`); console.table(r.rows); return r.rows;
};

await q("does Stefan exist in public.people at all?", `
  select id, name, source from public.people where name ilike '%stefan%' or name ilike '%goelzner%'`);

await q("Stefan's TrackingTime member row", `
  select m.id, m.display_name, m.email, m.hub_person_id, m.is_archived, m.role,
         (select count(*) from time.entry e where e.member_id = m.id and e.started_at <= now()) as entries,
         (select round(coalesce(sum(e.duration_seconds),0)/3600.0,1) from time.entry e
           where e.member_id = m.id and e.started_at <= now()) as hours_to_date
  from time.member m where m.display_name ilike '%goelzner%'`);

// The generalised question: who logs real billable time and is NOT reachable
// from public.people? That is the population my gate cannot see.
await q("everyone logging billable time with no person link", `
  select m.display_name, m.email, m.is_archived,
         (select count(*) from time.entry e where e.member_id = m.id and e.started_at <= now()) as entries,
         (select round(coalesce(sum(e.duration_seconds),0)/3600.0,1) from time.entry e
           where e.member_id = m.id and e.started_at <= now() and e.is_billable) as billable_hours
  from time.member m
  where m.hub_person_id is null
    and exists (select 1 from time.entry e where e.member_id = m.id and e.started_at <= now() and e.is_billable)
  order by billable_hours desc nulls last`);

// And the inverse, which is what my gate DOES cover: people in the allowlist who
// carry responsibility. Confirm Stefan is genuinely outside its remit rather
// than something it should have caught.
await q("does Stefan carry any responsibility or assignment?", `
  select
    (select count(*) from public.project_responsibility r
      join public.people pe on pe.id = r.person_id
      where pe.name ilike '%stefan%' or pe.name ilike '%goelzner%') as responsibility_rows,
    (select count(*) from public.person_assignments pa
      join public.people pe on pe.id = pa.person_id
      where pe.name ilike '%stefan%' or pe.name ilike '%goelzner%') as assignment_rows,
    (select count(*) from public.projects p
      join public.people pe on pe.id = p.owner_person_id
      where pe.name ilike '%stefan%' or pe.name ilike '%goelzner%') as owned_projects`);

console.log("\nVERDICT:");
console.log("  If Stefan has no public.people row, he is a DIFFERENT bug from Rency:");
console.log("  Rency existed and was filtered out by the allowlist; Stefan was never");
console.log("  imported. check:management-people-complete keys off");
console.log("  project_responsibility, so it cannot see him, and that is a real limit");
console.log("  of the gate worth stating rather than a failure of the data.");

console.log("\nREAD-ONLY: nothing was written.");
await c.end();
