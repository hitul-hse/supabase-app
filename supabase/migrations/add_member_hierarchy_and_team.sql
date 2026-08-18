-- Give the real TrackingTime roster somewhere to record teams and reporting lines.
--
-- WHY THIS IS NEEDED AT ALL. The Hub's org chart used to read `org_chart_nodes`,
-- a view over the eight seeded mockup people, whose `manager_id` was hand-written
-- fiction. Those rows are gone from every page. The People tab now shows the real
-- 49-member roster from TrackingTime, and TrackingTime cannot supply a hierarchy.
--
-- MEASURED, not assumed. The TrackingTime API does expose four relevant fields --
-- `supervisor`, `is_supervisor`, `user_group_id`, `user_group_name` -- which the
-- importer silently drops. So the earlier note in OrgChartView ("TrackingTime
-- holds no manager relationship") was wrong about the API. But asking the live
-- account for all 49 users:
--
--     users with a supervisor set  : 0 of 49
--     users flagged is_supervisor  : 0
--     users with a user_group_id   : 0 of 49
--
-- Every one is empty. Nobody has ever filled them in on the vendor side, so there
-- is nothing to import and no hierarchy to derive. Importing those fields anyway
-- would produce a chart of 49 orphans.
--
-- HENCE: the reporting line and team are recorded HERE, by a human, and are
-- deliberately nullable so an unrecorded relationship stays visibly unknown
-- rather than defaulting to something plausible. That is the whole point -- the
-- mockup's failure was not that its chart was ugly, it was that it looked
-- authoritative while being invented.
--
-- IF the vendor fields are ever populated, a follow-up can backfill these columns
-- from them and keep manual edits as an override. The shape below is chosen to
-- make that possible: `supervisor_source` records where the link came from.

alter table time.member
  -- Self-referencing: a member's manager is another member. ON DELETE SET NULL
  -- rather than CASCADE, because deleting a manager must not delete their team.
  add column if not exists supervisor_member_id bigint
    references time.member(id) on delete set null,

  -- Where the reporting line came from. 'manual' is a person's judgement;
  -- 'trackingtime' would mean it was imported from the vendor's supervisor field.
  -- Recording this means a future sync can refresh imported links without
  -- silently overwriting decisions a human made.
  add column if not exists supervisor_source text
    check (supervisor_source in ('manual', 'trackingtime')),

  -- Team as a plain label, not a foreign key to a teams table.
  --
  -- Deliberate: there is no team data anywhere yet, so a `team` table would start
  -- empty and its rows would be invented the moment anyone used it. A nullable
  -- text label lets real teams emerge from what people actually type, and can be
  -- normalised into a table later once the names have stopped changing. The
  -- alternative -- inventing SAFETY/ENG/LAB as the mockup did -- is what this work
  -- exists to undo.
  add column if not exists team text,

  -- Job title, which the vendor genuinely does not carry in any form. Distinct
  -- from `role`: role is a TrackingTime ACCESS LEVEL (ADMIN, CO_WORKER) and says
  -- nothing about what someone does. Conflating the two is why the mockup showed
  -- "SENIOR SAFETY CONSULTANT" for data no system held.
  add column if not exists job_title text;

-- A member cannot report to themselves. Cheap to state, and it removes the most
-- likely single-row mistake when somebody fills this in by hand.
do $$ begin
  if not exists (
    select 1 from pg_constraint where conname = 'member_supervisor_not_self'
  ) then
    alter table time.member
      add constraint member_supervisor_not_self
      check (supervisor_member_id is null or supervisor_member_id <> id);
  end if;
end $$;

-- A link must say where it came from, and a source must describe a link. Either
-- both or neither, so a row can never claim provenance for a relationship that
-- does not exist.
do $$ begin
  if not exists (
    select 1 from pg_constraint where conname = 'member_supervisor_source_paired'
  ) then
    alter table time.member
      add constraint member_supervisor_source_paired
      check ((supervisor_member_id is null) = (supervisor_source is null));
  end if;
end $$;

create index if not exists member_supervisor_idx on time.member (supervisor_member_id);
create index if not exists member_team_idx on time.member (team);

-- NOTE ON CYCLES. This schema prevents self-reference but not a longer loop
-- (A reports to B reports to A). Enforcing that in the database needs a recursive
-- trigger, which is a real cost on every write for a table of 49 rows edited by
-- hand. Instead the org chart builder detects cycles when reading and surfaces
-- them, so a mistake is visible rather than rendering an infinite tree. Guarded by
-- npm run check:org-hierarchy.
