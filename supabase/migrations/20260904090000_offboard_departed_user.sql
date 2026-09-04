-- ============================================================================
-- Offboard one departed colleague: md-serhii (Serhii Vylianskyi)
-- ============================================================================
--
-- WHAT WAS MEASURED, READ-ONLY, ON PRODUCTION 2026-09-04
-- ------------------------------------------------------
-- The vendor already says all four of these people have left. `time.member`
-- carries `is_archived = true` for every one of them -- that flag is set by
-- TrackingTime, not by us:
--
--   member  hub_person_id                     is_archived  user_id
--   16      fq-kamila-evangelista-da-silva    true         null
--   19      fq-liliia-ganeeva                 true         null
--   33      fq-pablo-guerra-ares              true         null
--   38      md-serhii                         true         26154ec6-…-f4506b5d03a6
--
-- Three of the four are modelled as departed on the Hub side. One is not:
--
--   public.people.is_active            md-serhii = true   (the other three: false)
--   public.app_user_profile.is_active  md-serhii = true   (the other three have
--                                                          no profile row at all)
--   auth.users                         serhii@hs-experts.com EXISTS
--                                      (kamila@, liliia@, pablo@ do not)
--
-- So this is drift between the vendor's roster and the Hub's, not a new policy.
-- The migration moves the fourth row into the shape the other three already
-- have. It is deliberately NOT a rename: the `fq-` / `md-` prefixes record
-- which import created the row, and `md-serhii` is referenced by
-- app_user_profile.person_id, person_assignments.person_id,
-- project_responsibility.person_id, projects.owner_person_id and
-- time.member.hub_person_id. Match the STATE, never the id.
--
-- HIS HISTORY IS DELIBERATELY UNTOUCHED
-- -------------------------------------
-- 408 rows in time.entry, 2,266,620 seconds = 629.6 hours, latest 2026-09-23.
-- Not one of them is deleted, anonymised or reassigned by this file. Departed
-- people keep their data for analysis; every historical total must still add
-- up afterwards. The same holds for his one person_assignments row and his one
-- project_responsibility row -- see the report at the bottom, they are left in
-- place on purpose because who inherits a customer is a human decision.
--
-- The three precedents prove this is safe rather than merely intended:
-- Kamila (111 entries), Liliia (2) and Pablo (427) are all is_active = false
-- and all still have their hours.
--
-- WHY THE THIRD STATEMENT (time.member.user_id) IS HERE AND NOT OPTIONAL
-- ---------------------------------------------------------------------
-- Clearing app_user_profile.is_active is what makes app_user_role(),
-- app_user_department() and app_user_person_id() return NULL, which is what
-- makes every role-scoped policy in schema.sql deny. That is most of the
-- boundary -- but not all of it, and the gap is measurable:
--
--     create or replace function time.current_member_id() ... as $$
--       select m.id from time.member m
--       where m.user_id = auth.uid()                        <-- this branch
--          or (m.hub_person_id is not null
--              and m.hub_person_id = app_user_person_id())  <-- is_active-aware
--       limit 1;
--     $$;
--
-- The first branch resolves straight off `time.member.user_id` and never
-- consults app_user_profile, so it survives deactivation intact. The policies
-- that key on it are not all permission-checked:
--
--     "own entry update"  using (member_id = time.current_member_id()
--                                and not is_billed)
--                         with check (member_id = time.current_member_id())
--     "own entry delete"  using (member_id = time.current_member_id()
--                                and not is_billed) or app_user_role()='exec'
--
-- Neither calls app_user_has_permission(). ("own entry insert" does, so inserts
-- stop; reads and writes to existing rows do not.) All 408 of his entries are
-- is_billed = false -- checked, 408/408 -- so a deactivated md-serhii holding a
-- session could still rewrite or delete 629.6 hours of the company's own
-- history. Leaving the link would make the offboarding cosmetic in exactly the
-- place the brief cares about most.
--
-- Nulling the link is the same thing deleteUser() in
-- src/app/(app)/admin/users/actions.ts already does, for the reason it
-- documents there: it keeps the person and keeps the hours (attribution is
-- time.entry.member_id -> time.member, which this does not touch) and removes
-- only the sign-in association. It also matches the three fq- rows exactly,
-- which all carry user_id = null.
--
-- Checked before writing it: nothing regresses.
--   * getRosterCounts() counts `unlinkedPeople` only among NON-archived members,
--     and member 38 is archived, so no Overview KPI moves.
--   * inviteUser() refuses to take over a member already claimed by another
--     account; with the link cleared, a future colleague on that address can be
--     linked instead of hitting that refusal.
--   * time.entry.member_id is untouched, so his hours keep their owner.
--
-- WHAT THIS FILE DOES NOT DO, ON PURPOSE
-- --------------------------------------
--   * It does not touch auth.users. Revoking the SESSION is application work
--     and is done in the same PR by setUserActive() (ban_duration), which is a
--     GoTrue call and cannot be expressed in SQL. Note for whoever pastes this:
--     serhii@hs-experts.com has never signed in (last_sign_in_at is null and
--     email_confirmed_at is null, measured today), so there is no live session
--     to revoke right now -- but the account exists and is not banned, and any
--     invite link still sitting in that mailbox would let it be activated.
--     Consider banning or deleting it from the Supabase dashboard as a separate,
--     deliberate step.
--   * It does not reassign his project. See the report at the bottom.
--
-- SAFE TO RE-RUN. Every statement is guarded so a second run matches zero rows,
-- and the DO block reports its own affected counts rather than assuming them.
-- Proved twice in PGlite by scripts/check-offboarding.mjs, which also seeds the
-- measured pre-state as a negative control and proves the reversal below really
-- reverses.
--
-- ----------------------------------------------------------------------------
-- REVERSAL. The exact SQL to undo this file, if the departure was wrong:
-- ----------------------------------------------------------------------------
--   update public.people
--      set is_active = true
--    where id = 'md-serhii';
--
--   update public.app_user_profile
--      set is_active = true
--    where person_id = 'md-serhii';
--
--   update time.member
--      set user_id = '26154ec6-5018-45f8-bada-f4506b5d03a6'::uuid
--    where hub_person_id = 'md-serhii';
--
-- That uuid is auth.users.id for serhii@hs-experts.com, read from production on
-- 2026-09-04 and written out literally so the reversal does not depend on the
-- auth row still being findable by email. It is a primary key, not a secret.
-- If the account has since been deleted the third statement is unnecessary --
-- the FK is `on delete set null`, so it would already be null.
--
-- Reversing this does NOT restore a sign-in on its own: if the auth user was
-- also banned, lift that with the ACTIVE toggle on /admin/users, which calls
-- ban_duration: "none".
-- ============================================================================

do $$
declare
  v_person_id  constant text := 'md-serhii';
  v_people     int;
  v_profile    int;
  v_member     int;
begin
  -- Refuse to guess. The id is exact and scoped to one row; if it is not there,
  -- say so and change nothing rather than matching on a name. (A NOTICE, not an
  -- exception: this file may be replayed against a database that never had the
  -- row, and aborting there would leave a paste half-applied for no reason.)
  if not exists (select 1 from public.people where id = v_person_id) then
    raise notice 'public.people has no row %, nothing to offboard', v_person_id;
    return;
  end if;

  -- 1. The roster. Drops him from the People directory, from reassignment
  --    candidate lists (getReassignmentCandidates filters is_active) and from
  --    request_project_responsible_change as an INCOMING person. Handing his
  --    project TO somebody else still works: that function only requires the
  --    person receiving the work to be active.
  update public.people
     set is_active = false
   where id = v_person_id
     and is_active;
  get diagnostics v_people = row_count;

  -- 2. The Hub account. This is the one that ends permissions: all three
  --    app_user_*() helpers filter on is_active, so his role resolves to NULL
  --    and every role-scoped policy denies. getCurrentProfile() returns null and
  --    /auth/callback sends him to /access-pending.
  update public.app_user_profile
     set is_active = false
   where person_id = v_person_id
     and is_active;
  get diagnostics v_profile = row_count;

  -- 3. The sign-in association on the vendor record -- see the long note above.
  --    Joined on hub_person_id, an id, never on display_name.
  update time.member
     set user_id = null
   where hub_person_id = v_person_id
     and user_id is not null;
  get diagnostics v_member = row_count;

  raise notice 'offboarded %: people % row(s), app_user_profile % row(s), time.member unlinked % row(s)',
    v_person_id, v_people, v_profile, v_member;

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

-- ============================================================================
-- REPORT -- found, NOT fixed. These need a human decision.
-- ============================================================================
--
-- 1. HE OWNS ONE PROJECT, AND IT IS THE WORST ONE ON THE BOARD.
--
--      projects.id            10483_00298_601_01
--      name                   HEC Solar / construction site supervision
--      customer               HEC Solar LTD
--      department             OPERATIONS
--      status                 CRITICAL
--      contract_hours         3
--      logged_hours           30.5      (consumed_percent 1017)
--      owner_person_id        md-serhii
--
--    After this migration that project is owned by an inactive person. Nothing
--    breaks -- projects.owner_person_id is `on delete set null` and no read
--    path filters the owner on is_active -- but nobody is answerable for a
--    CRITICAL, 1017%-consumed engagement until somebody is named.
--
-- 2. THE REPLACEMENT IS ALREADY RECORDED, so this is not a guess:
--
--      project_responsibility (project 10483_00298_601_01)
--        md-serhii    role = responsible   source = masterdata
--        md-mathias   role = replacement   source = masterdata
--
--    md-mathias is active and already owns 6 other OPERATIONS projects. The
--    handover path exists and is audited -- request_project_responsible_change()
--    then decide_project_responsible_change(), which moves BOTH
--    projects.owner_person_id and the project_responsibility rows -- and it is
--    reachable from the Reassignment picker in the UI. Deliberately not run
--    here: who inherits a customer is hitul's call, and doing it in SQL would
--    also skip the change_event audit trail that the RPC writes.
--
-- 3. ONE person_assignments ROW SURVIVES, and should.
--
--      id 152  person_id md-serhii  project_id 10483_00298_601_01
--              share_percent 100    logged_hours 0
--
--    Retained per the brief. Note logged_hours = 0 on that row while
--    time.entry has 629.6 hours for him: person_assignments is masterdata
--    share-of-work, not measured time. Do not read it as "he did nothing".
--
-- 4. NOBODY REPORTS TO HIM. `select id from public.people where manager_id =
--    'md-serhii'` returns 0 rows, and time.member.supervisor_member_id = 38
--    likewise 0. No reporting line is orphaned.
--
-- 6. THE THREE PRECEDENTS DID NOT COVER THIS CASE, which is why 1-3 need
--    reading rather than skipping. Measured: the fq- trio between them own
--    ZERO projects, hold ZERO project_responsibility rows and ZERO
--    person_assignments rows. They were clean to deactivate because they were
--    carrying nothing. Serhii is the first departure that leaves live
--    responsibility behind, so "match the three existing rows" is necessary
--    here and not sufficient.
--
-- 5. HIS auth.users ROW STILL EXISTS AND IS NOT BANNED. See the note above.
-- ============================================================================
