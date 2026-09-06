-- Give public.projects.logged_hours the instant it was computed at.
--
-- THE FAULT. logged_hours is a stored snapshot that only
-- scripts/refresh-order-hours.mjs writes, and the row carries nothing that says
-- WHEN. check-order-hours-freshness.mjs therefore had exactly one thing to hold
-- it against -- the live sum of time.entry at now() -- so a figure that was
-- correct when written read as "understated" the moment the next sync landed an
-- entry. The gate could not tell an hour that arrived after the refresh
-- (expected; gone at the next refresh) from an hour the refresh dropped (a
-- defect), and it read red on both. From 2026-09-03 to 2026-09-05 it was red
-- every night with 1, 13, 19, 21 "understated" orders while the actual fault --
-- the nightly refresh step had never run once -- stayed unnamed, because the
-- gate had no way to say "nothing has refreshed this since Wednesday".
--
-- THE COLUMN. logged_hours_as_of is the single per-run instant the refresh
-- bounded its sums at. logged_hours counts every entry that (a) had started by
-- this instant and (b) had been imported by this instant (time.entry.created_at
-- is the import time; the upsert never rewrites it). That definition is
-- re-derivable from time.entry alone, which is what makes the stored figure
-- checkable: everything counted at as_of must still sum to the stored value, and
-- anything newer is lag, reported separately. It also lets a page say "as of
-- Wed 10:12" next to the number, which no page can do today.
--
-- Nullable, no default. Null means "no refresh has recorded itself here", and
-- the gate fails on it by name. A default of now() would stamp every existing
-- row with a time at which no refresh ran -- the exact confusion this column
-- exists to end.
--
-- Idempotent: `add column if not exists`, `comment on column`. Executed twice in
-- PGlite by scripts/check-order-hours-freshness-discriminates.mjs before paste.

alter table public.projects
  add column if not exists logged_hours_as_of timestamptz;

comment on column public.projects.logged_hours_as_of is
  'Instant scripts/refresh-order-hours.mjs bounded logged_hours at: the sum of time.entry rows with started_at <= this and created_at <= this. Null = no refresh has recorded itself since the column was added.';
