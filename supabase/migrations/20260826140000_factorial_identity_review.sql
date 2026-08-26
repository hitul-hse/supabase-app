-- Factorial Phase 1: the identity review queue, and provenance on the mapping.
--
-- WHAT THIS IS FOR
-- ----------------
-- The Factorial sync must map each Factorial employee to a public.people row.
-- The only honest key is the work email, and measurement says that key does not
-- reach everyone (node scripts/check-factorial-identity-baseline.mjs, 26 Aug):
--
--     18  resolve exactly   email -> time.member -> hub_person_id -> people
--     29  do not            25 archived leavers, 4 carrying real hours
--      2  are not people    info@ and jobs@ are shared mailboxes
--
-- 29 of 49 is not an edge case, so "unresolved" needs somewhere to live. Without
-- a queue the sync has exactly two options, and both are unacceptable: guess by
-- name similarity (forbidden, ADR-001, and this is an authorisation-adjacent
-- join), or drop the employee silently and under-report the company's hours.
--
-- So: a resolved mapping goes in crm.factorial_person_reference, which already
-- exists and needs no structural change. Everything else becomes a row here that
-- a human can act on.
--
-- WHAT THIS DELIBERATELY DOES NOT DO
-- ----------------------------------
-- No staging tables for worked_times / leaves / contract_versions. Those describe
-- payloads nobody has seen yet: there is no Factorial credential and no demo
-- tenant, so their column lists would be transcribed from documentation rather
-- than observed. Writing them now would be inventing a schema and calling it a
-- migration. They land in Phase 1 proper, once a real response can be inspected.
--
-- This migration only encodes what is already measured: the identity problem.
--
-- IDEMPOTENT: every statement is `if not exists` or guarded. Safe to re-run.

/* ============================================================ 1. provenance */

-- crm.factorial_person_reference records WHICH person a Factorial id maps to,
-- but not HOW that was decided or by whom. For an authorisation-adjacent join
-- that is the difference between an auditable mapping and a rumour.
alter table crm.factorial_person_reference
  add column if not exists match_method  text,
  add column if not exists matched_email text,
  add column if not exists reviewed_by   uuid references auth.users(id),
  add column if not exists reviewed_at   timestamptz;

do $$
begin
  -- Exactly two lawful origins for a mapping. Not "email_similar", not "name".
  if not exists (select 1 from pg_constraint where conname = 'factorial_person_reference_match_method_check') then
    alter table crm.factorial_person_reference
      add constraint factorial_person_reference_match_method_check
      check (match_method is null or match_method in ('exact_email_via_time_member', 'manual'));
  end if;

  -- A manual mapping must name its human; an automatic one must not claim one.
  -- This is what stops a script backdating itself as a human decision.
  if not exists (select 1 from pg_constraint where conname = 'factorial_person_reference_manual_needs_reviewer') then
    alter table crm.factorial_person_reference
      add constraint factorial_person_reference_manual_needs_reviewer
      check (
        match_method is null
        or (match_method = 'manual'  and reviewed_by is not null and reviewed_at is not null)
        or (match_method <> 'manual' and reviewed_by is null     and reviewed_at is null)
      );
  end if;
end $$;

comment on column crm.factorial_person_reference.match_method is
  'How this mapping was decided. exact_email_via_time_member = the Factorial login email '
  'matched exactly one time.member.email (lowercased, trimmed) whose hub_person_id was '
  'already set. manual = a human decided, and reviewed_by/reviewed_at are then mandatory. '
  'Name similarity is forbidden (ADR-001).';
comment on column crm.factorial_person_reference.matched_email is
  'The lowercased address that produced the match, kept for audit. Work addresses only.';

/* ========================================================= 2. review queue */

create table if not exists crm.factorial_identity_review (
  id                     uuid primary key default gen_random_uuid(),

  -- The Factorial side is identified by its exact keys, never by a name.
  factorial_employee_id  text not null,
  factorial_company_id   text not null,
  factorial_login_email  text,          -- NULL is honest when Factorial has none
  factorial_full_name    text,          -- display only; forbidden as a match input
  factorial_active       boolean,

  -- What the matcher actually found.
  candidate_member_id    bigint,        -- time.member.id, exact email only
  candidate_person_id    text references public.people(id) on delete set null,
  candidate_count        integer not null default 0,   -- >1 means ambiguous

  status                 text not null,
  status_reason          text not null,

  reviewed_by            uuid references auth.users(id),
  reviewed_at            timestamptz,
  resolution_note        text,

  first_seen_at          timestamptz not null default now(),
  last_seen_at           timestamptz not null default now(),

  -- One row per employee per company. The company id matters: the unique key on
  -- factorial_person_reference already includes account_ref for the same reason.
  constraint factorial_identity_review_employee_key
    unique (factorial_company_id, factorial_employee_id),

  constraint factorial_identity_review_status_check
    check (status in (
      'unmatched',             -- no time.member carries that email
      'bridged_unlinked',      -- member matched, but it has no hub_person_id
      'ambiguous',             -- 2+ candidates, or the person is already claimed
      'excluded_not_a_person', -- shared mailbox. TERMINAL.
      'excluded_not_employee', -- external or contractor. TERMINAL.
      'resolved_manual',       -- a human mapped it; the mapping row now exists
      'resolved_auto'          -- became resolvable on a later run and auto-closed
    )),

  -- A terminal or manual decision requires an accountable human. The machine
  -- states (unmatched / bridged_unlinked / ambiguous / resolved_auto) do not.
  constraint factorial_identity_review_decision_needs_reviewer
    check (
      status in ('unmatched', 'bridged_unlinked', 'ambiguous', 'resolved_auto')
      or (reviewed_by is not null and reviewed_at is not null)
    ),

  -- Ambiguity is defined by evidence, not by feel: either several candidates, or
  -- a single candidate whose person is already taken (hence no candidate_person_id).
  constraint factorial_identity_review_ambiguous_has_grounds
    check (status <> 'ambiguous' or candidate_count > 1 or candidate_person_id is null),

  -- A resolved row must actually name the person it resolved to, or "resolved"
  -- means nothing.
  constraint factorial_identity_review_resolved_has_person
    check (status not in ('resolved_manual', 'resolved_auto') or candidate_person_id is not null)
);

-- The working index: the open queue, worst-first by staleness. Partial, because
-- the terminal and resolved rows are history and should not slow the queue down.
create index if not exists factorial_identity_review_open_idx
  on crm.factorial_identity_review (status, last_seen_at desc)
  where status in ('unmatched', 'bridged_unlinked', 'ambiguous');

comment on table crm.factorial_identity_review is
  'Every Factorial employee that could NOT be mapped to public.people by exact email. '
  'Exists so an unresolved employee is a reviewable row rather than a silent omission or '
  'a fuzzy guess. Rows are re-evaluated on every sync; terminal decisions are never '
  'reopened. Baseline at creation (26 Aug 2026): 18 resolvable, 29 queued, 2 excluded.';
comment on column crm.factorial_identity_review.factorial_full_name is
  'Display only, so a human can recognise the row. Forbidden as a matching input (ADR-001).';
comment on column crm.factorial_identity_review.candidate_count is
  'How many time.member rows matched the email. 0 = unmatched, 1 = decidable, >1 = ambiguous.';
comment on column crm.factorial_identity_review.last_seen_at is
  'Touched every sync the employee is still present. A row that stops being touched means '
  'the employee left Factorial; it is not deleted, because the history stays true.';

/* ================================================================== 3. RLS */

-- This table holds employee names and work emails. It follows the exec-only
-- policy already on crm.factorial_person_reference ("customer master exec
-- access"), so the access model does not acquire a second dialect.
alter table crm.factorial_identity_review enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
     where schemaname = 'crm'
       and tablename  = 'factorial_identity_review'
       and policyname = 'factorial identity review exec access'
  ) then
    create policy "factorial identity review exec access"
      on crm.factorial_identity_review
      for all to authenticated
      using (public.app_user_role() = 'exec')
      with check (public.app_user_role() = 'exec');
  end if;
end $$;

/* ================================ 4. weekly_employee_summary honest nulls */

-- expected_minutes is NOT NULL, which collides head-on with the honest-nulls
-- rule this repo just spent a migration restoring elsewhere.
--
-- Factorial's estimated_times endpoint returns source='none' when it does not
-- know a day's expectation, and a week with no contract in force has no
-- expectation at all. The column currently forces a number for both:
--   0    reads as "expected nothing", i.e. infinite utilisation
--   2400 reinvents the fake uniform 40h that Factorial is being brought in to replace
--
-- The table has 0 rows, so this is free now and a data migration later.
alter table public.weekly_employee_summary
  alter column expected_minutes drop not null;

alter table public.weekly_employee_summary
  add column if not exists expected_minutes_source text;

do $$
begin
  -- The provenance of an expectation decides whether it can be trusted. These
  -- are Factorial's own documented source values plus our two local cases.
  if not exists (select 1 from pg_constraint where conname = 'weekly_employee_summary_expected_source_check') then
    alter table public.weekly_employee_summary
      add constraint weekly_employee_summary_expected_source_check
      check (expected_minutes_source is null or expected_minutes_source in (
        'shift_management', 'work_schedule', 'contract_hours',
        'none',            -- Factorial explicitly does not know
        'mixed',           -- the week's days disagree; the sum is still real
        'no_contract'      -- no contract version covers this week
      ));
  end if;

  -- An expectation without a stated source is unauditable; a source of 'none' or
  -- 'no_contract' with a number attached is a contradiction.
  if not exists (select 1 from pg_constraint where conname = 'weekly_employee_summary_expected_coherent') then
    alter table public.weekly_employee_summary
      add constraint weekly_employee_summary_expected_coherent
      check (
        (expected_minutes is null and (expected_minutes_source is null
                                       or expected_minutes_source in ('none', 'no_contract')))
        or (expected_minutes is not null and expected_minutes_source is not null
            and expected_minutes_source not in ('none', 'no_contract'))
      );
  end if;
end $$;

comment on column public.weekly_employee_summary.expected_minutes is
  'Expected working minutes for the period. NULL means genuinely unknown (Factorial '
  'source=none, or no contract in force) -- render n/a, never 0, and never fall back to '
  'a nominal 40h week. expected_minutes_source states where the figure came from.';
comment on column public.weekly_employee_summary.expected_minutes_source is
  'Provenance of expected_minutes. Factorial values: shift_management, work_schedule, '
  'contract_hours, none. Local values: mixed (the week''s days disagree), no_contract.';

-- The unit trap, recorded on the columns rather than in a doc nobody reads: four
-- columns are SECONDS while everything around them is MINUTES. A mix-up here is
-- a 60x error in a billing-adjacent figure.
comment on column public.weekly_employee_summary.billable_seconds is
  'SECONDS, unlike the *_minutes columns beside it. From time.entry, bounded at today.';
comment on column public.weekly_employee_summary.travel_time_seconds is
  'SECONDS. Travel has no customer order by definition; see diagnose-project-bridge.mjs.';
comment on column public.weekly_employee_summary.internal_project_seconds is
  'SECONDS. Internal/HSE work, which structurally carries no customer order.';
comment on column public.weekly_employee_summary.empty_tasks_seconds is
  'SECONDS. Time logged with no task, which is a data-quality signal not a work category.';
comment on column public.weekly_employee_summary.worked_minutes is
  'MINUTES, from Factorial worked_times, bounded at today. TrackingTime holds future-dated '
  'planned entries, so an unbounded sum reports unworked time as worked.';
