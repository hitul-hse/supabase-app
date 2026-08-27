/*
 * Prove the migration is necessary, not just harmless.
 *
 * check-reassignment-migration.mjs passes against the NEW function. That alone
 * does not show the fix does anything -- a no-op migration would also pass. So
 * run the SAME assertions against the ORIGINAL function from 20260823090000 and
 * require that they fail, in the specific way the bug predicts:
 *
 *   the person who handed over -> still RESPONSIBLE
 *   the person who took over   -> OWNER, not RESPONSIBLE
 *
 * If this ever passes, the migration has stopped being load-bearing and someone
 * should ask why it is still here.
 */
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";

const original = readFileSync(
  "C:/Supabase/supabase/migrations/20260823090000_add_project_change_control.sql", "utf8");
const db = await new PGlite();

let failures = 0;
const check = (label, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}: ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures += 1;
};

await db.exec(`
  create schema auth;
  do $$
  begin
    if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
    if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
    if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin bypassrls; end if;
  end $$;
  create table auth.users (id uuid primary key default gen_random_uuid());
  create table auth.uid_stub (v uuid);
  insert into auth.uid_stub values ('11111111-1111-1111-1111-111111111111');
  create function auth.uid() returns uuid language sql stable as $$ select v from auth.uid_stub limit 1 $$;
  create function public.app_user_has_permission(p_key text) returns boolean language sql stable as $$ select true $$;

  create table public.people (
    id text primary key, name text not null, is_active boolean not null default true);
  create table public.projects (
    id text primary key, name text not null,
    owner_person_id text references public.people(id), lead text);
  create table public.person_assignments (
    id bigserial primary key,
    person_id text not null references public.people(id),
    project_id text references public.projects(id),
    project_name text not null, logged_hours numeric not null,
    tasks_count integer not null, share_percent numeric not null, sort_order integer not null);
  create table public.project_responsibility (
    project_id text not null references public.projects(id) on delete cascade,
    person_id text not null references public.people(id),
    role text not null check (role in ('responsible','replacement')),
    source text not null default 'masterdata',
    order_no text, created_at timestamptz not null default now(),
    unique (project_id, person_id, role));
`);

/*
 * The original migration also creates RLS policies that need a full Supabase
 * auth surface. Rather than filtering them out line by line -- which breaks
 * multi-line `create policy ... on ... using (...)` statements and produced a
 * syntax error -- build the two tables here and take ONLY the function bodies
 * from the migration, matched on their `create or replace function ... $$;`
 * boundaries. That keeps the function under test byte-identical to the shipped
 * original, which is the whole point of this control.
 */
await db.exec(`
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

const fnBodies = [...original.matchAll(
  /create or replace function public\.(request|decide)_project_responsible_change[\s\S]*?\n\$\$;/g,
)].map((m) => m[0]);

if (fnBodies.length !== 2) {
  console.log(`Expected 2 function definitions in the original migration, found ${fnBodies.length}.`);
  console.log("The migration was restructured; update this control deliberately.");
  process.exit(1);
}

try {
  for (const body of fnBodies) await db.exec(body);
  check("the ORIGINAL decide function loads", true, "byte-identical to 20260823090000");
} catch (e) {
  console.log(`Could not load the original functions: ${e.message}`);
  process.exit(1);
}

await db.exec(`
  insert into public.people (id, name) values ('md-bjrn','Björn'), ('md-thorsten','Thorsten');
  insert into public.projects (id, name, owner_person_id, lead)
    values ('p1','AWB: Aufgaben&Ziele 2026','md-bjrn','Björn');
  insert into public.project_responsibility (project_id, person_id, role, order_no)
    values ('p1','md-bjrn','responsible','ORD-1');
  insert into public.person_assignments
    (person_id, project_id, project_name, logged_hours, tasks_count, share_percent, sort_order)
    values ('md-bjrn','p1','AWB: Aufgaben&Ziele 2026',0,0,100,0);
`);

const roleFor = async (projectId, personId) => {
  const { rows: [r] } = await db.query(`
    select
      (select owner_person_id from public.projects where id = $1) = $2 as is_owner,
      exists (select 1 from public.person_assignments where project_id = $1 and person_id = $2) as is_assigned,
      exists (select 1 from public.project_responsibility where project_id = $1 and person_id = $2 and role = 'responsible') as is_responsible,
      exists (select 1 from public.project_responsibility where project_id = $1 and person_id = $2 and role = 'replacement') as is_replacement`,
    [projectId, personId]);
  if (r.is_responsible) return "RESPONSIBLE";
  if (r.is_owner) return "OWNER";
  if (r.is_replacement) return "REPLACEMENT";
  if (r.is_assigned) return "ASSIGNED";
  return "(absent)";
};

const { rows: [{ id: reqId }] } = await db.query(`
  insert into public.project_change_request
    (project_id, field_name, expected_owner_person_id, requested_person_id, reason, requested_by)
  values ('p1','responsible_person','md-bjrn','md-thorsten','sick leave cover',
          '22222222-2222-2222-2222-222222222222')
  returning id`);
await db.query(`select public.decide_project_responsible_change($1, true, 'approved')`, [reqId]);

const oldRole = await roleFor("p1", "md-bjrn");
const newRole = await roleFor("p1", "md-thorsten");

console.log(`\nAgainst the ORIGINAL function: Björn -> ${oldRole}, Thorsten -> ${newRole}\n`);

// These are inverted on purpose: the bug MUST be present here.
check("the bug is reproduced: the old responsible keeps the badge",
  oldRole === "RESPONSIBLE", `got ${oldRole}, expected RESPONSIBLE`);
check("the bug is reproduced: the new person does NOT read RESPONSIBLE",
  newRole !== "RESPONSIBLE", `got ${newRole}`);

console.log(`\n${failures === 0
  ? "PASS — the bug exists without the migration, so 20260827080000 is load-bearing"
  : `FAIL (${failures}) — the bug did NOT reproduce; re-examine whether the migration is still needed`}`);
process.exit(failures ? 1 : 0);
