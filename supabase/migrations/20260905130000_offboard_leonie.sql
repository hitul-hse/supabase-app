-- ============================================================================
-- Offboard one departed colleague: fq-leonie-roitsch (Leonie Roitsch)
-- ============================================================================
--
-- READ THIS FIRST: THIS ONE IS THE MIRROR IMAGE OF THE FOUR BEFORE HER
-- ---------------------------------------------------------------------
-- Every earlier departure (fq-kamila-evangelista-da-silva, fq-liliia-ganeeva,
-- fq-pablo-guerra-ares, md-serhii) was the vendor saying "gone" while the Hub
-- still said "active" -- the Hub catching up with a roster it lags behind.
-- This file is the reverse. Measured on production, read-only, on 2026-09-05
-- (12:02-12:06 UTC), Factorial still says Leonie is CURRENT:
--
--   crm.factorial_contract_version   is_active = true, starts_on 2026-03-02,
--                                    ends_on 2027-03-02, effective_on 2026-09-03,
--                                    "Working Student - Marketing", 20 h/week,
--                                    last_seen 2026-09-04 12:15 UTC -- that is
--                                    the nightly feed the day before this file
--                                    was written.
--   crm.factorial_identity_review    factorial_active = true, terminated_on
--                                    null, status resolved_manual,
--                                    candidate_member_id null, and this
--                                    resolution note, written by hitul on
--                                    2026-09-01:
--
--       "Current Factorial employee without a TrackingTime account -- profile
--        created so hours planning, leave and analytics can see them; no
--        time.member to link"
--
-- The only source saying she has left is hitul's statement of 2026-09-05.
-- Pasting this puts the Hub AHEAD of the vendor, on purpose. Whoever opens the
-- identity queue afterwards and sees "Factorial: active / Hub: inactive" is
-- looking at that decision, not at a bug -- and it stays that way until HR
-- closes her contract in Factorial (and even then, see "what the nightly sync
-- will not do" below: her review row will not follow).
--
-- WHAT WAS MEASURED, READ-ONLY, ON PRODUCTION 2026-09-05
-- ------------------------------------------------------
-- Found by ONE name search for discovery; every number below is keyed on the
-- id. public.people.id = 'fq-leonie-roitsch', factorial_employee_id = '3417011'.
--
--   public.people               is_active = true   source = factorial
--                               contract_hours = 20   trackingtime_user_id null
--                               role / department / manager_id all null
--   public.app_user_profile     NO ROW  (the three fq- precedents: no row;
--                                        md-serhii: one row, is_active = false
--                                        since 20260904090000 was pasted)
--   time.member                 NO ROW  by hub_person_id; none by email or by
--                                        name either (precedents: rows 16/19/33,
--                                        is_archived = true, user_id = null)
--   time.entry                  n/a -- attribution is member_id ->
--                                        time.member.hub_person_id, and there is
--                                        no member row, so NO attribution path
--                                        exists. Deliberately not written as
--                                        "0 entries": that would be a plausible
--                                        zero, and the precedents show 111 / 2 /
--                                        427 / 408 entries under exactly that
--                                        join.
--   projects.owner_person_id    0        project_responsibility   0
--   person_assignments          0        people.manager_id = her  0
--   time.member.supervisor_member_id     n/a (no member row)
--   auth.users                  NO ROW for leonie@hs-experts.com, the login
--                                        email Factorial holds. Nothing to ban.
--   crm.factorial_person_reference       1 row, is_active = true, manual -- kept
--   crm.factorial_identity_review        1 row, see above              -- kept
--
-- Of the 16 foreign keys into public.people listed by information_schema
-- (leave_requests, person_qualifications, timesheet_entries, weekly_bookings,
-- weekly_employee_summary, project_change_event, project_change_request and the
-- ones named above), the only ones holding a row for her are the two crm rows,
-- and this file keeps both. weekly_employee_summary by factorial_employee_id
-- '3417011': 0.
--
-- NOTE: public.people has NO email column. Her address exists only in
-- crm.factorial_identity_review.factorial_login_email. Anyone "checking her
-- email" against people, time.member or auth.users will find nothing, and that
-- is the measured state, not a lookup that went wrong.
--
-- What this file moves, on the roster as measured: active people 21 -> 20,
-- active factorial-source people 3 -> 2, sum of contract_hours over active
-- people 621.77 -> 601.77 (her 20 h/week).
--
-- THERE IS NO HISTORY TO PROTECT -- MEASURED, NOT PROMISED
-- --------------------------------------------------------
-- 20260904090000 had 629.6 hours to defend. This file has none to defend
-- because none can be attributed to her: no member row, no entries reachable
-- through one, no assignment, no responsibility, no leave request, no
-- timesheet row. The two crm rows are her Factorial identity, not her history,
-- and they are the shape the four precedents carry too. Nothing is deleted,
-- anonymised or reassigned by this file -- the same rule as before, with
-- nothing for it to bite on today.
--
-- WHY STATEMENTS 2 AND 3 ARE STILL HERE WHEN THEY MATCH NOTHING TODAY
-- -------------------------------------------------------------------
-- On the measured pre-state this file reduces to ONE effective statement:
-- public.people.is_active = false. That already matches the target shape,
-- which is the fq- trio's, proven from production rather than invented:
-- is_active = false, no app_user_profile row, no auth account, Factorial
-- reference row untouched.
--
-- The profile and member statements stay for two reasons. First, the shape:
-- scripts/check-offboarding.mjs proved for md-serhii that the profile flag
-- alone does not end a session and that time.member.user_id is the other half
-- of the boundary; a departure file that silently omits those two would be the
-- wrong template for the next one. Second, the gap between measuring and
-- pasting: inviteUser() creates an app_user_profile row and links a member,
-- and if that happened to her between 2026-09-05 and the paste, this file
-- must still end the access rather than leave it half-done.
--
-- What it must NOT do is let a zero-row count read as success. The DO block
-- therefore counts what is present before it updates, prints "N row(s) of M
-- present" for both, and raises a WARNING when the pre-state differs from
-- what was measured -- so the second and third statements doing real work is
-- something the paste says out loud, not something that passes unnoticed.
--
-- THE PASTE RETURNS A ROW. READ IT.
-- ---------------------------------
-- RAISE NOTICE output is easy to miss in the SQL editor and some clients do
-- not show it at all, so the last statement in this file is a SELECT that
-- returns the end state as a result row:
--
--   id                 fq-leonie-roitsch
--   is_active          false        <- the one thing this file is for
--   contract_hours     20           (unchanged; vendor-owned, see below)
--   profile_rows       0            (measured 0; anything else = the WARNING fired)
--   member_rows        0            (measured 0; same)
--
-- ZERO rows back means the id was not there and NOTHING happened. That is the
-- NOTICE-not-exception path below, made visible: a paste that returns no row
-- has not offboarded anybody.
--
-- WHAT THE NIGHTLY SYNC WILL AND WILL NOT DO AFTERWARDS
-- -----------------------------------------------------
-- scripts/sync-factorial-identity.mjs (.github/workflows/sync-factorial.yml,
-- cron 23 6 * * *) never writes public.people -- zero references to the table
-- in that file -- and its upserts into crm.factorial_identity_review are
-- guarded `where status = any(MACHINE_STATUSES)`, with MACHINE_STATUSES =
-- unmatched, bridged_unlinked, ambiguous, resolved_auto
-- (scripts/sync-factorial-identity.mjs:106). Her row is resolved_manual. So:
--
--   * the machine CANNOT undo this file. Nothing re-activates her.
--   * the machine will also never COMPLETE it. When Factorial eventually
--     records her termination, factorial_active on her review row stays
--     frozen at true and terminated_on stays null, because the row is
--     human-held. Whoever reconciles the identity queue should expect that
--     and not read it as "still employed".
--   * scripts/sync-factorial-contracts.mjs:242 keeps writing
--     people.contract_hours (= 20) for her, keyed on the reference row and not
--     on is_active. Same as the four precedents, harmless, but the number on
--     an inactive row is vendor-true rather than Hub-true. This file does not
--     touch contract_hours, so the receipt row above shows 20.
--
-- WHAT THIS FILE DOES NOT DO, ON PURPOSE
-- --------------------------------------
--   * Nothing in auth.users. There is no row for her (measured), so there is
--     no session to revoke and nothing to ban -- which is also what "no login"
--     means for the three fq- precedents.
--   * Nothing in crm. The reference row and the review row stay, exactly as
--     they do for the precedents; the review row is hitul's own decision
--     record from 2026-09-01 and is not this file's to rewrite.
--   * Nothing to reassign. She owns 0 projects, holds 0 responsibility rows,
--     0 assignments and nobody reports to her, so the "found, not fixed" list
--     at the bottom of 20260904090000 has no counterpart here.
--     scripts/check-owners-are-active.mjs (branch feat/owners-are-active-gate)
--     looks only at owners and responsibles of non-closed projects and cannot
--     go red for her -- checked, not assumed.
--
-- SAFE TO RE-RUN. Every statement is guarded so a second run matches zero rows,
-- and the DO block reports its own affected counts rather than assuming them.
-- Proved twice in PGlite by scripts/check-offboarding-leonie.mjs, which seeds
-- the measured pre-state plus an active control colleague, runs a mutated copy
-- of this file to prove its own assertions can fail, seeds the hypothetical
-- profile-and-member case to prove statements 2 and 3 are live code, and runs
-- the reversal below.
--
-- ----------------------------------------------------------------------------
-- REVERSAL. The exact SQL to undo this file, if the departure was wrong:
-- ----------------------------------------------------------------------------
--   update public.people
--      set is_active = true
--    where id = 'fq-leonie-roitsch';
--
-- That is the whole reversal on the measured pre-state. No uuid is recorded
-- here because no auth account exists for her, so there is no sign-in link to
-- put back and nothing to unban.
--
-- If the paste printed the pre-state WARNING (a profile row or a member row
-- had appeared since 2026-09-05), the second and third statements did real
-- work and the reversal grows by the two corresponding statements from
-- 20260904090000_offboard_departed_user.sql, with the uuid read from
-- auth.users at that time. The receipt row says which case you are in.
-- ============================================================================

do $$
declare
  v_person_id        constant text := 'fq-leonie-roitsch';
  v_people           int;
  v_profile          int;
  v_member           int;
  v_profiles_present int;
  v_members_present  int;
begin
  -- Refuse to guess. The id is exact and scoped to one row; if it is not there,
  -- say so and change nothing rather than matching on a name. (A NOTICE, not an
  -- exception: this file may be replayed against a database that never had the
  -- row, and aborting there would leave a paste half-applied for no reason.
  -- The SELECT at the end of the file returns zero rows in that case.)
  if not exists (select 1 from public.people where id = v_person_id) then
    raise notice 'public.people has no row %, nothing to offboard', v_person_id;
    return;
  end if;

  -- Measured 2026-09-05: NO app_user_profile row and NO time.member row. Count
  -- them before touching anything, so that when statements 2 and 3 below match
  -- zero rows the report can say "0 of 0 present" (correct) and never let
  -- "0 of 1 present" (something is wrong) pass as the same thing.
  select count(*) into v_profiles_present
    from public.app_user_profile where person_id = v_person_id;
  select count(*) into v_members_present
    from time.member where hub_person_id = v_person_id;
  if v_profiles_present > 0 or v_members_present > 0 then
    raise warning 'pre-state differs from what was measured on 2026-09-05 for %: app_user_profile rows = % (measured 0), time.member rows = % (measured 0). Statements 2 and 3 now do real work; re-read the header before trusting the report, and the reversal is no longer one statement.',
      v_person_id, v_profiles_present, v_members_present;
  end if;

  -- 1. The roster. The one statement that does work on the measured pre-state.
  --    Drops her from the People directory, from reassignment candidate lists
  --    (getReassignmentCandidates filters is_active), from hours planning and
  --    from the active contract_hours total.
  update public.people
     set is_active = false
   where id = v_person_id
     and is_active;
  get diagnostics v_people = row_count;

  -- 2. The Hub account, if one has appeared since measurement. Matches zero
  --    rows today. Kept for the reason in the header: the profile flag is what
  --    makes app_user_role() / app_user_person_id() return NULL.
  update public.app_user_profile
     set is_active = false
   where person_id = v_person_id
     and is_active;
  get diagnostics v_profile = row_count;

  -- 3. The sign-in association on a vendor record, if one has appeared since
  --    measurement. Matches zero rows today. Joined on hub_person_id, an id,
  --    never on display_name or email.
  update time.member
     set user_id = null
   where hub_person_id = v_person_id
     and user_id is not null;
  get diagnostics v_member = row_count;

  raise notice 'offboarded %: people % row(s); app_user_profile % row(s) of % present; time.member unlinked % row(s) of % present',
    v_person_id, v_people, v_profile, v_profiles_present, v_member, v_members_present;

  -- Assert the END STATE, not the row counts. On a second run every count above
  -- is 0 and that is correct; what must hold either way is the shape.
  if exists (select 1 from public.people where id = v_person_id and is_active) then
    raise exception 'people.% is still active after the update', v_person_id;
  end if;
  if exists (select 1 from public.app_user_profile where person_id = v_person_id and is_active) then
    raise exception 'app_user_profile for % is still active after the update', v_person_id;
  end if;
  if exists (select 1 from time.member where hub_person_id = v_person_id and user_id is not null) then
    raise exception 'time.member for % still carries a sign-in link', v_person_id;
  end if;
end $$;

-- The receipt. One row back = she was there and is now inactive; read
-- profile_rows / member_rows against the measured zeros. Zero rows back = the id
-- was not there and nothing happened.
select p.id,
       p.is_active,
       p.contract_hours,
       (select count(*) from public.app_user_profile a where a.person_id = p.id)   as profile_rows,
       (select count(*) from time.member m where m.hub_person_id = p.id)          as member_rows
  from public.people p
 where p.id = 'fq-leonie-roitsch';
