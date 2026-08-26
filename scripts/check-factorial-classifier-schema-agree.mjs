/*
 * Does every status the CLASSIFIER can emit actually satisfy the DATABASE's
 * constraints?
 *
 * This is the seam between two things I built separately, and separately-tested
 * components are exactly where an integration fails. The classifier
 * (lib/factorial.mjs) decides a status; the migration (20260826140000) constrains
 * what a row may look like. Each was tested against itself. Neither was tested
 * against the other.
 *
 * The specific worry, found by reading them side by side: the classifier returns
 * `excluded_not_a_person` for a shared mailbox with no reviewer attached, but
 * factorial_identity_review_decision_needs_reviewer requires reviewed_by AND
 * reviewed_at for exactly that status. If true, the first sync would abort on an
 * insert -- and the fix is a design decision, not a typo: either the classifier
 * must not auto-exclude, or the constraint must accept a machine exclusion.
 *
 * This builds the real schema in PGlite and tries to insert a row for EVERY
 * status the classifier can produce, exactly as a sync would write it.
 */
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { classifyEmployee } from "./lib/factorial.mjs";

const sql = readFileSync("C:/Supabase/supabase/migrations/20260826140000_factorial_identity_review.sql", "utf8");
const db = await new PGlite();

let failures = 0;
const check = (l, ok, d = "") => { console.log(`${ok ? "PASS" : "FAIL"}: ${l}${d ? `\n        ${d}` : ""}`); if (!ok) failures += 1; };

await db.exec(`
  create schema crm; create schema auth;
  do $$ begin
    if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin; end if;
  end $$;
  create table auth.users (id uuid primary key default gen_random_uuid());
  create table public.people (id text primary key, name text not null, factorial_employee_id text unique);
  create table crm.factorial_person_reference (
    id uuid primary key default gen_random_uuid(),
    person_id text not null references public.people(id) on delete cascade,
    source_system text not null check (source_system='factorial'),
    entity_type text not null check (entity_type='person'),
    external_id text not null, account_ref text not null,
    first_seen_at timestamptz not null default now(),
    last_seen_at timestamptz not null default now(),
    is_active boolean not null default true, source_payload_hash text,
    unique (source_system, external_id, entity_type, account_ref));
  create table public.weekly_employee_summary (
    id bigserial primary key, period_start date not null, period_end date not null,
    factorial_employee_id text not null, trackingtime_user_id text,
    employee_name text not null, person_id text references public.people(id) on delete set null,
    worked_minutes integer not null, worked_day_count integer not null,
    expected_minutes integer not null, absence_minutes integer, absence_label text,
    billable_seconds integer not null, travel_time_seconds integer not null,
    internal_project_seconds integer not null, empty_tasks_seconds integer not null,
    review_entry_count integer not null default 0, synced_at timestamptz not null default now(),
    unique (period_start, factorial_employee_id));
  create function public.app_user_role() returns text language sql stable as $$ select 'exec'::text $$;
  insert into public.people (id, name) values ('md-rency','Rency'),('md-a','A'),('md-b','B'),('md-taken','Taken');
`);
await db.exec(sql);

/* ---- the classifier's full output space, driven by realistic inputs ---- */

const members = new Map([
  ["rency@hs-experts.com", [{ id: 1, hub_person_id: "md-rency" }]],
  ["nolink@hs-experts.com", [{ id: 2, hub_person_id: null }]],
  ["twin@hs-experts.com", [{ id: 3, hub_person_id: "md-a" }, { id: 4, hub_person_id: "md-b" }]],
  ["taken@hs-experts.com", [{ id: 5, hub_person_id: "md-taken" }]],
]);
const claimed = new Set(["md-taken"]);

const cases = [
  ["a resolvable employee",        "rency@hs-experts.com"],
  ["a member with no person link", "nolink@hs-experts.com"],
  ["two members on one email",     "twin@hs-experts.com"],
  ["a person already claimed",     "taken@hs-experts.com"],
  ["a shared mailbox",             "info@hs-experts.com"],
  ["an unknown address",           "stranger@hs-experts.com"],
  ["no email at all",              null],
];

const seen = new Set();
let i = 0;

for (const [label, email] of cases) {
  i += 1;
  const v = classifyEmployee({ login_email: email, full_name: "Some One", active: true }, members, claimed);
  seen.add(v.status);

  // A resolvable verdict becomes a MAPPING row, not a queue row.
  if (v.status === "resolvable") {
    try {
      await db.exec(`
        insert into crm.factorial_person_reference
          (person_id, source_system, entity_type, external_id, account_ref, match_method, matched_email)
        values ('${v.personId}', 'factorial', 'person', 'emp-${i}', 'co-1',
                'exact_email_via_time_member', '${email}')`);
      check(`${label} -> mapping row accepted`, true, `match_method=exact_email_via_time_member`);
    } catch (e) {
      check(`${label} -> mapping row accepted`, false, e.message.split("\n")[0]);
    }
    continue;
  }

  /*
   * Everything else becomes a QUEUE row, written the way a sync would: no
   * reviewer, because no human has looked at it yet. That is the whole point of
   * a queue.
   */
  const personId = v.personId ? `'${v.personId}'` : "null";
  const memberId = v.memberId ?? "null";
  try {
    await db.exec(`
      insert into crm.factorial_identity_review
        (factorial_employee_id, factorial_company_id, factorial_login_email,
         factorial_full_name, factorial_active, candidate_member_id,
         candidate_person_id, candidate_count, status, status_reason)
      values ('emp-${i}', 'co-1', ${email ? `'${email}'` : "null"},
              'Some One', true, ${memberId}, ${personId}, ${v.count},
              '${v.status}', ${JSON.stringify(v.reason).replace(/^"|"$/g, "'").replace(/'/g, "''").replace(/^''|''$/g, "'")})`);
    check(`${label} -> queue row accepted as status '${v.status}'`, true);
  } catch (e) {
    check(`${label} -> queue row accepted as status '${v.status}'`, false,
      `${e.message.split("\n")[0]}\n        THE SYNC WOULD ABORT HERE. Classifier and schema disagree.`);
  }
}

console.log(`\nstatuses the classifier can emit: ${[...seen].sort().join(", ")}`);

/* ------- every emittable status must be nameable in the schema at all ------- */

const { rows: allowed } = await db.query(`
  select pg_get_constraintdef(oid) as def from pg_constraint
   where conname = 'factorial_identity_review_status_check'`);
const def = allowed[0]?.def ?? "";
for (const s of [...seen].filter((x) => x !== "resolvable")) {
  check(`'${s}' is an allowed status in the schema`, def.includes(`'${s}'`));
}

console.log(failures === 0
  ? "\nCLASSIFIER AND SCHEMA AGREE: every verdict the sync can reach is writable."
  : `\n${failures} disagreement(s) — the sync would fail at runtime on a real roster`);
process.exit(failures === 0 ? 0 : 1);
