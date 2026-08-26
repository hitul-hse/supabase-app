// Does the 28-project role-table gap actually cost anyone a REPLACEMENT badge
// on /my-work? my-work.ts:504 reads project_responsibility exclusively, so a
// project missing from that table cannot be labelled replacement even when
// person_assignments names the cover.
//
// But my-work also has an `assigned` rung fed from person_assignments, so the
// project may still be visible, just labelled one rung lower. Establish which
// it is before claiming impact.
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

// The gap projects, and whether the named cover is ALSO reachable through the
// paths my-work uses: owner_person_id, or any person_assignments row.
await q("per person: gap projects where they are the named cover", `
  with gap as (
    select pa.project_id, pa.person_id
    from public.person_assignments pa
    where pa.share_percent = 0 and pa.sort_order = 1 and pa.project_id is not null
      and not exists (select 1 from public.project_responsibility r
                       where r.project_id = pa.project_id and r.role = 'replacement'))
  select pe.name as person, count(*) as gap_projects,
         count(*) filter (where p.owner_person_id = g.person_id) as also_owner,
         count(*) filter (where p.owner_person_id is distinct from g.person_id) as cover_only
  from gap g
  left join public.projects p on p.id = g.project_id
  left join public.people pe on pe.id = g.person_id
  group by pe.name
  order by gap_projects desc`);

// The sharp question: for a cover-only gap project, does my-work show it at all?
// It appears if the person has ANY person_assignments row for it, which they do
// by construction (that is where the share=0 row lives). So the project is
// visible but labelled `assigned` rather than `replacement`.
await q("are gap projects still reachable on /my-work (via an assignment row)?", `
  with gap as (
    select pa.project_id, pa.person_id
    from public.person_assignments pa
    where pa.share_percent = 0 and pa.sort_order = 1 and pa.project_id is not null
      and not exists (select 1 from public.project_responsibility r
                       where r.project_id = pa.project_id and r.role = 'replacement'))
  select
    count(*) as gap_rows,
    count(*) filter (where exists (
      select 1 from public.person_assignments pa2
      where pa2.project_id = g.project_id and pa2.person_id = g.person_id)) as visible_via_assignment,
    count(*) filter (where exists (
      select 1 from public.project_responsibility r
      where r.project_id = g.project_id and r.person_id = g.person_id and r.role = 'responsible')) as would_be_responsible
  from gap g`);

console.log("\nVERDICT:");
console.log("  A gap project is still LISTED on /my-work, because the share=0 row itself");
console.log("  satisfies the `assigned` rung. What is lost is the REPLACEMENT badge and");
console.log("  the role count, so the page understates the person's cover duty rather");
console.log("  than hiding the project. Real, but a mislabel, not a disappearance.");

console.log("\nREAD-ONLY: nothing was written.");
await c.end();
