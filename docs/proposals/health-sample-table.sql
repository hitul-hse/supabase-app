-- PROPOSAL ONLY. NOT APPLIED.
--
-- platform.health_sample: the Postgres twin of ~/.night-shift/health-samples.jsonl
-- (src/lib/health-history.ts, scripts/sample-system-health.mjs). It exists on
-- paper so that if history ever has to be visible from a cloud deployment --
-- where there is no rig file -- the columns, cadence and retention are already
-- decided and match the JSONL line for line.
--
-- Why it is not applied by the System Health PR:
--   * every read on /admin/system-health is a SELECT and the page's own rule is
--     that it never writes; the rig sampler is the only writer, and it appends
--     to a file it owns;
--   * `platform` is not a schema on the live database today (checked
--     2026-09-02: `select nspname from pg_namespace where nspname='platform'`
--     returns nothing), so this file would be the migration that creates it,
--     and the house rule is that migrations and RLS policies are never touched
--     unless explicitly asked;
--   * the migration workflow here is PGlite twice, then the owner pastes it.
--
-- Cadence: one row per hour (user timer `hse-health-sample.timer`,
-- RandomizedDelaySec=300) plus one row per night-shift cycle. ~25-30 rows/day.
-- Retention: 90 days, pruned by the writer on each write (a scheduled
--   `delete from platform.health_sample where sampled_at < now() - interval '90 days'`
--   would replace the file pruning; ~2,700 rows at steady state).
-- Access: RLS enabled with NO policies, so only the service role (which
--   bypasses RLS) can read or write. The page reads Postgres directly as the
--   DB owner today, so it would see the rows; PostgREST clients would not.

create schema if not exists platform;

create table if not exists platform.health_sample (
  id                  bigint generated always as identity primary key,
  sampled_at          timestamptz not null default now(),
  host                text,                       -- os.hostname() of the sampler; null when unknown

  -- efficiency inputs
  db_latency_ms       numeric(10, 1),             -- median of 3 `select 1` round trips
  cache_hit_pct       numeric(5, 1),              -- blks_hit / (blks_hit + blks_read) × 100; null when no block activity
  xact_commit         bigint,
  xact_rollback       bigint,
  deadlocks           bigint,
  conn_active         int,
  conn_max            int,

  -- consumption inputs
  db_size_bytes       bigint,
  db_budget_bytes     bigint,                     -- the budget the score was measured against (see readBudget)

  -- security inputs the sampler can see (env flags and response headers are web-process facts; not sampled)
  rls_enabled         int,
  rls_total           int,
  users_without_role  int,

  -- per-source freshness, same shape as HealthSampleSource[] in src/lib/health-history.ts:
  -- [{ source, status, startedAt, finishedAt, ageHours, lastOkAgeHours }]
  sources             jsonb not null default '[]'::jsonb,

  -- the four sub-scores and the composite, computed by the same formulas as the page
  score_freshness     smallint check (score_freshness    between 0 and 100),
  score_efficiency    smallint check (score_efficiency   between 0 and 100),
  score_security      smallint check (score_security     between 0 and 100),
  score_consumption   smallint check (score_consumption  between 0 and 100),
  score_composite     smallint check (score_composite    between 0 and 100),
  cap_applied         boolean,
  security_scope      text,                       -- e.g. 'rls+users only'

  -- field name -> why it is null; empty object when everything was measured
  reasons             jsonb not null default '{}'::jsonb
);

comment on table platform.health_sample is
  'Hourly health samples for /admin/system-health. PROPOSAL, not applied; the rig writes ~/.night-shift/health-samples.jsonl instead. 90-day retention.';

create index if not exists health_sample_sampled_at_idx
  on platform.health_sample (sampled_at desc);

alter table platform.health_sample enable row level security;
-- No policies on purpose: with RLS on and no policy, anon and authenticated see
-- nothing and cannot write; only the service role (and the DB owner) can.
