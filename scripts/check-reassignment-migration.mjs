/*
 * House rule: a migration runs in PGlite TWICE before anyone pastes it into
 * production. Twice, because a non-idempotent migration passes the first run and
 * breaks the re-run that follows a partial apply.
 *
 * This one is about an OUTCOME, not a schema change: after an approved
 * responsibility handover, does the new person actually read as RESPONSIBLE in
 * My Work, and does the old person stop reading that way?
 *
 * So the test builds the smallest schema the RPC touches, seeds the two cases
 * that behave differently, calls the real function, and then computes the same
 * role ladder my-work.ts:536 applies. Asserting "the SQL did not throw" would
 * have passed against the buggy version too -- that is exactly how the bug
 * survived since 20260823090000.
 */
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";

const sql = readFileSync(
  "C:/Supabase/supabase/migrations/20260827080000_reassignment_moves_responsibility.sql", "utf8");
const db = await new PGlite();

let failures = 0;
const check = (label, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}: ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures += 1;
};

/*
 * PGlite has no auth schema and no app_user_has_permission. Stub both, because
 * the point here is the DATA PROPAGATION, not the permission model -- that is
 * already covered by check-change-control.mjs against the live database. The
 * stub returns a fixed uuid so the four-eyes rule can still be exercised.
 */
await db.exec(`
  create schema auth;

  -- Supabase provisions these roles; PGlite does not, and the migration grants
  -- EXECUTE to authenticated. Same preamble as check-factorial-identity-migration.mjs.
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

  create table auth.uid_stub (v uuid);
  insert into auth.uid_stub values ('11111111-1111-1111-1111-111111111111');
  create function auth.uid() returns uuid language sql stable as $$ select v from auth.uid_stub limit 1 $$;
  create function public.app_user_has_permission(p_key text) returns boolean language sql stable as $$ select true $$;

  create table public.people (
    id text primary key,
    name text not null,
    is_active boolean not null default true
  );
  create table public.projects (
    id text primary key,
    name text not null,
    owner_person_id text references public.people(id),
    lead text
  );
  create table public.person_assignments (
    id bigserial primary key,
    person_id text not null references public.people(id),
    project_id text references public.projects(id),
    project_name text not null,
    logged_hours numeric not null,
    tasks_count integer not null,
    share_percent numeric not null,
    sort_order integer not null
  );
  create table public.project_responsibility (
    project_id text not null references public.projects(id) on delete cascade,
    person_id text not null references public.people(id),
    role text not null check (role in ('responsible','replacement')),
    source text not null default 'masterdata',
    order_no text,
    created_at timestamptz not null default now(),
    unique (project_id, person_id, role)
  );
  create table public.project_change_request (
    id uuid primary key default gen_random_uuid(),
    project_id text not null references public.projects(id),
    field_name text not null,
    expected_owner_person_id text,
    requested_person_id text not null,
    reason text not null,
    requested_by uuid not null,
    status text not null default 'pending',
    decided_by uuid,
    decided_at timestamptz,
    decision_reason text,
    applied_at timestamptz
  );
  create table public.project_change_event (
    id bigserial primary key,
    request_id uuid,
    project_id text,
    event_type text,
    field_name text,
    old_person_id text,
    new_person_id text,
    actor_user_id uuid,
    reason text,
    created_at timestamptz not null default now()
  );
`);

await db.exec(`
  insert into public.people (id, name) values
    ('md-bjrn','Björn'), ('md-hendryk','Hendryk'), ('md-thorsten','Thorsten');

  -- CASE A: hand over to someone with no prior role on the project.
  insert into public.projects (id, name, owner_person_id, lead)
    values ('p-plain','AWB: Aufgaben&Ziele 2026','md-bjrn','Björn');
  insert into public.project_responsibility (project_id, person_id, role, order_no)
    values ('p-plain','md-bjrn','responsible','ORD-1');
  insert into public.person_assignments
    (person_id, project_id, project_name, logged_hours, tasks_count, share_percent, sort_order)
    values ('md-bjrn','p-plain','AWB: Aufgaben&Ziele 2026',0,0,100,0);

  -- CASE B: promote the NAMED REPLACEMENT, the commonest real case (74 projects).
  insert into public.projects (id, name, owner_person_id, lead)
    values ('p-repl','Caseking (Betriebsarzt)','md-bjrn','Björn');
  insert into public.project_responsibility (project_id, person_id, role, order_no) values
    ('p-repl','md-bjrn','responsible','ORD-2'),
    ('p-repl','md-hendryk','replacement','ORD-2');
  insert into public.person_assignments
    (person_id, project_id, project_name, logged_hours, tasks_count, share_percent, sort_order) values
    ('md-bjrn','p-repl','Caseking (Betriebsarzt)',0,0,100,0),
    ('md-hendryk','p-repl','Caseking (Betriebsarzt)',0,0,0,1);
`);

// The migration itself, twice.
await db.exec(sql);
check("the migration applies", true);
await db.exec(sql);
check("it applies a SECOND time (idempotent)", true);

/*
 * The role ladder from my-work.ts:536, responsible > owner > replacement >
 * assigned. Recomputed here rather than imported, because the point is to prove
 * the DATABASE now supports the label the page derives.
 */
const roleFor = async (projectId, personId) => {
  const { rows: [r] } = await db.query(`
    select
      (select owner_person_id from public.projects where id = $1) = $2 as is_owner,
      exists (select 1 from public.person_assignments where project_id = $1 and person_id = $2) as is_assigned,
      exists (select 1 from public.project_responsibility where project_id = $1 and person_id = $2 and role = 'responsible') as is_responsible,
      exists (select 1 from public.project_responsibility where project_id = $1 and person_id = $2 and role = 'replacement') as is_replacement
  `, [projectId, personId]);
  if (r.is_responsible) return "RESPONSIBLE";
  if (r.is_owner) return "OWNER";
  if (r.is_replacement) return "REPLACEMENT";
  if (r.is_assigned) return "ASSIGNED";
  return "(absent)";
};

// A different requester than the approver, or the four-eyes rule fires.
const REQUESTER = "22222222-2222-2222-2222-222222222222";
const raise = async (projectId, personId) => {
  const { rows: [{ id }] } = await db.query(`
    insert into public.project_change_request
      (project_id, field_name, expected_owner_person_id, requested_person_id, reason, requested_by)
    values ($1,'responsible_person',(select owner_person_id from public.projects where id=$1),$2,'sick leave cover',$3)
    returning id`, [projectId, personId, REQUESTER]);
  return id;
};

console.log("\n--- CASE A: hand over to someone with no prior role ---");
check("before: Björn is RESPONSIBLE", (await roleFor("p-plain", "md-bjrn")) === "RESPONSIBLE");
check("before: Thorsten is absent", (await roleFor("p-plain", "md-thorsten")) === "(absent)");

const reqA = await raise("p-plain", "md-thorsten");
await db.query(`select public.decide_project_responsible_change($1, true, 'approved for cover')`, [reqA]);

const aOld = await roleFor("p-plain", "md-bjrn");
const aNew = await roleFor("p-plain", "md-thorsten");
check("after: Thorsten reads RESPONSIBLE", aNew === "RESPONSIBLE", `got ${aNew}`);
check("after: Björn no longer reads RESPONSIBLE", aOld !== "RESPONSIBLE", `got ${aOld}`);

const { rows: [provA] } = await db.query(
  `select source, order_no from public.project_responsibility where project_id='p-plain' and role='responsible'`);
check("the new row is marked source='change_control', not 'masterdata'", provA.source === "change_control", `got ${provA.source}`);
check("it keeps the workbook order number", provA.order_no === "ORD-1", `got ${provA.order_no}`);

console.log("\n--- CASE B: promote the named replacement ---");
check("before: Hendryk is the REPLACEMENT", (await roleFor("p-repl", "md-hendryk")) === "REPLACEMENT");

const reqB = await raise("p-repl", "md-hendryk");
await db.query(`select public.decide_project_responsible_change($1, true, 'named cover takes over')`, [reqB]);

const bNew = await roleFor("p-repl", "md-hendryk");
check("after: Hendryk reads RESPONSIBLE", bNew === "RESPONSIBLE", `got ${bNew}`);

const { rows: [selfCover] } = await db.query(`
  select count(*)::int as n from public.project_responsibility
  where project_id='p-repl' and person_id='md-hendryk' and role='replacement'`);
check("his stale REPLACEMENT row is gone (nobody is their own cover)", selfCover.n === 0, `${selfCover.n} left`);

const { rows: [only] } = await db.query(`
  select count(*)::int as n from public.project_responsibility where project_id='p-repl' and role='responsible'`);
check("exactly one responsible row remains", only.n === 1, `${only.n} rows`);

console.log("\n--- the rest of the flow is unchanged ---");
const { rows: [audit] } = await db.query(
  `select count(*)::int as n from public.project_change_event where event_type='applied'`);
check("both approvals were written to the audit trail", audit.n === 2, `${audit.n} applied events`);

const { rows: [status] } = await db.query(
  `select count(*)::int as n from public.project_change_request where status='applied'`);
check("both requests are marked applied", status.n === 2, `${status.n}`);

// The four-eyes rule must still bite.
const reqC = await db.query(`
  insert into public.project_change_request
    (project_id, field_name, expected_owner_person_id, requested_person_id, reason, requested_by)
  values ('p-plain','responsible_person',(select owner_person_id from public.projects where id='p-plain'),
          'md-bjrn','self approval attempt','11111111-1111-1111-1111-111111111111')
  returning id`);
let fourEyes = false;
try { await db.query(`select public.decide_project_responsible_change($1, true, 'approving my own')`, [reqC.rows[0].id]); }
catch (e) { fourEyes = /four-eyes/.test(e.message); }
check("four-eyes approval is still enforced", fourEyes);

console.log(`\n${failures === 0 ? "PASS" : `FAIL (${failures})`}`);
process.exit(failures ? 1 : 0);
