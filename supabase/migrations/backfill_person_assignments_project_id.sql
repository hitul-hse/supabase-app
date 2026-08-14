-- Backfill for person_assignments.project_id, added when can_view_project()
-- stopped matching assignments by project_name.
--
-- Run this ONCE on any database created before that change. On a database
-- built from the current schema.sql there is nothing to backfill, and running
-- it is harmless.
--
-- Why it matters: assignment-based project access now keys off project_id. Any
-- pre-existing row has project_id = NULL, so until this runs, a project_manager
-- or employee sees only projects they own outright, not the ones they are
-- merely assigned to. Exec and dept_head access is unaffected.

begin;

-- Only fill rows where the name resolves to exactly one project. A name shared
-- by several projects is precisely the ambiguity that made the old join unsafe,
-- so those are deliberately left NULL and reported below for manual mapping.
update person_assignments pa
set project_id = pr.id
from projects pr
where pa.project_id is null
  and pr.name = pa.project_name
  and (select count(*) from projects p2 where p2.name = pa.project_name) = 1;

-- Anything still unresolved needs a human decision. Review this output before
-- committing if you are running it interactively.
select
  pa.id,
  pa.person_id,
  pa.project_name,
  (select count(*) from projects p2 where p2.name = pa.project_name) as matching_projects
from person_assignments pa
where pa.project_id is null
order by pa.project_name, pa.id;

commit;
