/*
 * Runs 20260826140000 in PGlite TWICE (house rule) and then attacks it.
 *
 * "It executed without error" is not evidence that a constraint works. A CHECK
 * that is too loose is invisible until bad data is already in the table, so every
 * constraint this migration adds is tested by trying to VIOLATE it. If an insert
 * that should be impossible succeeds, that is the failure.
 *
 * Run: node scripts/check-factorial-identity-migration.mjs
 */
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";

const sql = readFileSync("C:/Supabase/supabase/migrations/20260826140000_factorial_identity_review.sql", "utf8");
const db = await new PGlite();

let failures = 0;
const check = (l, ok, d = "") => { console.log(`${ok ? "PASS" : "FAIL"}: ${l}${d ? ` — ${d}` : ""}`); if (!ok) failures += 1; };

/** Assert a statement is REJECTED. The point of a constraint is what it refuses. */
const rejects = async (label, stmt) => {
  try {
    await db.exec(stmt);
    check(label, false, "it was ACCEPTED — the constraint is too loose");
    // Undo, so one leak does not cascade into the next assertion.
    await db.exec("delete from crm.factorial_identity_review where factorial_employee_id like 'probe-%'");
    await db.exec("delete from crm.factorial_person_reference where external_id like 'probe-%'");
  } catch (e) {
    check(label, true, e.message.split("\n")[0].slice(0, 88));
  }
};
const accepts = async (label, stmt) => {
  try { await db.exec(stmt); check(label, true); }
  catch (e) { check(label, false, e.message.split("\n")[0].slice(0, 88)); }
};

/* ------------------------------------------- the minimum live-shaped schema */

await db.exec(`
  create schema crm;
  create schema auth;
  -- Supabase provisions these roles; PGlite does not, and the migration's RLS
  -- policy grants TO authenticated. Same preamble as check-schema-executes.mjs.
  do $$
  begin
    if not exists (select 1 from pg_roles where rolname = 'anon') then
      create role anon nologin;
    end if;
    if not exists (select 1 from pg_roles where rolname = 'authenticated') then
      create role authenticated nologin;
    end if;
    if not exists (select 1 from pg_roles where rolname = 'service_role') then
      create role service_role nologin bypassrls;
    end if;
  end $$;
  create table auth.users (id uuid primary key default gen_random_uuid());
  create table public.people (
    id text primary key,
    name text not null,
    factorial_employee_id text unique
  );
  create table crm.factorial_person_reference (
    id uuid primary key default gen_random_uuid(),
    person_id text not null references public.people(id) on delete cascade,
    source_system text not null check (source_system = 'factorial'),
    entity_type text not null check (entity_type = 'person'),
    external_id text not null,
    account_ref text not null,
    first_seen_at timestamptz not null default now(),
    last_seen_at timestamptz not null default now(),
    is_active boolean not null default true,
    source_payload_hash text,
    unique (source_system, external_id, entity_type, account_ref)
  );
  create table public.weekly_employee_summary (
    id bigserial primary key,
    period_start date not null,
    period_end date not null,
    factorial_employee_id text not null,
    trackingtime_user_id text,
    employee_name text not null,
    person_id text references public.people(id) on delete set null,
    worked_minutes integer not null,
    worked_day_count integer not null,
    expected_minutes integer not null,
    absence_minutes integer,
    absence_label text,
    billable_seconds integer not null,
    travel_time_seconds integer not null,
    internal_project_seconds integer not null,
    empty_tasks_seconds integer not null,
    review_entry_count integer not null default 0,
    synced_at timestamptz not null default now(),
    unique (period_start, factorial_employee_id)
  );
  -- The RLS policy calls this; PGlite has no Supabase auth.
  create function public.app_user_role() returns text language sql stable as $$ select 'exec'::text $$;
  insert into public.people (id, name) values ('md-rency', 'Rency Sebastian'), ('md-mathias', 'Mathias');
  insert into auth.users (id) values ('11111111-1111-1111-1111-111111111111');
`);

/* ---------------------------------------------------------- run it, twice */

for (const pass of [1, 2]) {
  try { await db.exec(sql); console.log(`\nrun ${pass}: executed`); }
  catch (e) {
    check(`run ${pass} executes`, false, e.message.split("\n")[0]);
    // Stop here. Every assertion below reads objects this migration creates, so
    // continuing would bury the real cause under a wall of "does not exist".
    console.log("\nAborting: nothing below can be judged if the migration did not run.");
    process.exit(1);
  }
}

/* ------------------------------------------------------- shape assertions */

const cols = async (schema, table) => (await db.query(
  `select column_name, is_nullable from information_schema.columns
    where table_schema=$1 and table_name=$2`, [schema, table])).rows;

const fpr = Object.fromEntries((await cols("crm", "factorial_person_reference")).map((r) => [r.column_name, r.is_nullable]));
console.log("");
check("provenance columns added to the mapping table",
  ["match_method", "matched_email", "reviewed_by", "reviewed_at"].every((c) => c in fpr));

const wes = Object.fromEntries((await cols("public", "weekly_employee_summary")).map((r) => [r.column_name, r.is_nullable]));
check("expected_minutes became nullable", wes.expected_minutes === "YES",
  "a NOT NULL expectation forces 0 or a fake 40h week when Factorial says source=none");
check("expected_minutes_source was added", "expected_minutes_source" in wes);

const rls = (await db.query(
  `select relrowsecurity from pg_class where oid='crm.factorial_identity_review'::regclass`)).rows[0];
check("RLS is enabled on the review queue", rls.relrowsecurity === true,
  "it holds employee names and work emails");
const pol = (await db.query(
  `select policyname from pg_policies where schemaname='crm' and tablename='factorial_identity_review'`)).rows;
check("exactly one exec-only policy exists", pol.length === 1, JSON.stringify(pol.map((p) => p.policyname)));

const idx = (await db.query(
  `select indexname from pg_indexes where schemaname='crm' and tablename='factorial_identity_review'`)).rows;
check("the partial open-queue index exists",
  idx.some((i) => i.indexname === "factorial_identity_review_open_idx"), JSON.stringify(idx.map((i) => i.indexname)));

/* ============ the constraints must REFUSE things. This is the real test. ============ */

console.log("\n--- the review queue must refuse incoherent rows");

await accepts("a plain unmatched row is allowed (no reviewer needed)", `
  insert into crm.factorial_identity_review
    (factorial_employee_id, factorial_company_id, status, status_reason, candidate_count)
  values ('probe-1', 'c1', 'unmatched', 'no time.member carries that email', 0)`);

await rejects("an invented status is refused", `
  insert into crm.factorial_identity_review
    (factorial_employee_id, factorial_company_id, status, status_reason)
  values ('probe-2', 'c1', 'probably_fine', 'vibes')`);

await rejects("a TERMINAL exclusion with no accountable human is refused", `
  insert into crm.factorial_identity_review
    (factorial_employee_id, factorial_company_id, status, status_reason)
  values ('probe-3', 'c1', 'excluded_not_a_person', 'info@ is a mailbox')`);

await accepts("the same exclusion WITH a reviewer is allowed", `
  insert into crm.factorial_identity_review
    (factorial_employee_id, factorial_company_id, status, status_reason, reviewed_by, reviewed_at)
  values ('probe-4', 'c1', 'excluded_not_a_person', 'info@ is a mailbox',
          '11111111-1111-1111-1111-111111111111', now())`);

await rejects("'ambiguous' with a single confident candidate is refused", `
  insert into crm.factorial_identity_review
    (factorial_employee_id, factorial_company_id, status, status_reason, candidate_count, candidate_person_id)
  values ('probe-5', 'c1', 'ambiguous', 'claims ambiguity while naming one person', 1, 'md-rency')`);

await rejects("'resolved_auto' that names nobody is refused", `
  insert into crm.factorial_identity_review
    (factorial_employee_id, factorial_company_id, status, status_reason)
  values ('probe-6', 'c1', 'resolved_auto', 'resolved to... nothing')`);

await rejects("the same employee twice in the same company is refused", `
  insert into crm.factorial_identity_review
    (factorial_employee_id, factorial_company_id, status, status_reason)
  values ('probe-1', 'c1', 'unmatched', 'duplicate')`);

await accepts("the same employee id in a DIFFERENT company is allowed", `
  insert into crm.factorial_identity_review
    (factorial_employee_id, factorial_company_id, status, status_reason)
  values ('probe-1', 'c2', 'unmatched', 'multi-company tenant')`);

console.log("\n--- the mapping table must refuse unauditable provenance");

await rejects("a name-similarity match_method is refused", `
  insert into crm.factorial_person_reference
    (person_id, source_system, entity_type, external_id, account_ref, match_method)
  values ('md-rency', 'factorial', 'person', 'probe-a', 'c1', 'fuzzy_name')`);

await rejects("a 'manual' mapping with no human is refused", `
  insert into crm.factorial_person_reference
    (person_id, source_system, entity_type, external_id, account_ref, match_method)
  values ('md-rency', 'factorial', 'person', 'probe-b', 'c1', 'manual')`);

await rejects("an AUTOMATIC mapping that claims a human is refused", `
  insert into crm.factorial_person_reference
    (person_id, source_system, entity_type, external_id, account_ref, match_method, reviewed_by, reviewed_at)
  values ('md-rency', 'factorial', 'person', 'probe-c', 'c1', 'exact_email_via_time_member',
          '11111111-1111-1111-1111-111111111111', now())`);

await accepts("a lawful automatic mapping is allowed", `
  insert into crm.factorial_person_reference
    (person_id, source_system, entity_type, external_id, account_ref, match_method, matched_email)
  values ('md-rency', 'factorial', 'person', 'probe-d', 'c1',
          'exact_email_via_time_member', 'rency@hs-experts.com')`);

await accepts("a lawful manual mapping is allowed", `
  insert into crm.factorial_person_reference
    (person_id, source_system, entity_type, external_id, account_ref, match_method, reviewed_by, reviewed_at)
  values ('md-mathias', 'factorial', 'person', 'probe-e', 'c1', 'manual',
          '11111111-1111-1111-1111-111111111111', now())`);

console.log("\n--- weekly_employee_summary must not fake an expectation");

await accepts("an unknown expectation is NULL with a stated source", `
  insert into public.weekly_employee_summary
    (period_start, period_end, factorial_employee_id, employee_name, worked_minutes,
     worked_day_count, expected_minutes, expected_minutes_source, billable_seconds,
     travel_time_seconds, internal_project_seconds, empty_tasks_seconds)
  values ('2026-08-17','2026-08-23','probe-w1','A',2400,5,null,'none',0,0,0,0)`);

await rejects("a number with source='none' is refused (a contradiction)", `
  insert into public.weekly_employee_summary
    (period_start, period_end, factorial_employee_id, employee_name, worked_minutes,
     worked_day_count, expected_minutes, expected_minutes_source, billable_seconds,
     travel_time_seconds, internal_project_seconds, empty_tasks_seconds)
  values ('2026-08-17','2026-08-23','probe-w2','B',2400,5,2400,'none',0,0,0,0)`);

await rejects("a number with NO source is refused (unauditable)", `
  insert into public.weekly_employee_summary
    (period_start, period_end, factorial_employee_id, employee_name, worked_minutes,
     worked_day_count, expected_minutes, expected_minutes_source, billable_seconds,
     travel_time_seconds, internal_project_seconds, empty_tasks_seconds)
  values ('2026-08-17','2026-08-23','probe-w3','C',2400,5,2400,null,0,0,0,0)`);

await rejects("an invented source is refused", `
  insert into public.weekly_employee_summary
    (period_start, period_end, factorial_employee_id, employee_name, worked_minutes,
     worked_day_count, expected_minutes, expected_minutes_source, billable_seconds,
     travel_time_seconds, internal_project_seconds, empty_tasks_seconds)
  values ('2026-08-17','2026-08-23','probe-w4','D',2400,5,2400,'assumed_40h',0,0,0,0)`);

await accepts("a real contract-derived expectation is allowed", `
  insert into public.weekly_employee_summary
    (period_start, period_end, factorial_employee_id, employee_name, worked_minutes,
     worked_day_count, expected_minutes, expected_minutes_source, billable_seconds,
     travel_time_seconds, internal_project_seconds, empty_tasks_seconds)
  values ('2026-08-17','2026-08-23','probe-w5','E',2280,5,2400,'contract_hours',1000,200,100,0)`);

console.log(failures === 0
  ? "\nMIGRATION IS SAFE TO PASTE: idempotent, and every constraint refuses what it should"
  : `\n${failures} check(s) failed — DO NOT PASTE`);
process.exit(failures === 0 ? 0 : 1);
