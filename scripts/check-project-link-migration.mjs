/*
 * Does 20260903230000_project_link.sql create a table whose RLS actually
 * EXCLUDES people, and does it survive being applied twice?
 *
 * House rule: a migration runs in PGlite TWICE before anyone pastes it into the
 * Supabase SQL editor. Twice, because the failure this catches is not "the SQL
 * is invalid" -- it is "the SQL works once and then errors on a re-run", which
 * is what turns a routine re-paste into an incident.
 *
 * THE POLICY TEST IS THE POINT, AND IT IS DELIBERATELY NOT STUBBED TRUE
 * --------------------------------------------------------------------
 * Sibling migration checks stub app_user_has_permission() to `select true`
 * because they are testing data propagation, not permissions. This one is
 * testing the permission, so a true-stub would assert nothing: every row would
 * be visible and the gate would pass with the policy removed entirely.
 *
 * So can_view_project() here is a REAL function over a membership table, and
 * the test asserts both directions -- a member sees the link, a non-member does
 * not. A policy that exists but admits everyone is the exact shape of the
 * budget-visibility hole found on this project on 2026-09-03, where every gate
 * was green while `using (true)` sat on the table.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";

const REPO = fileURLToPath(new URL("..", import.meta.url));
const MIGRATION = "supabase/migrations/20260903230000_project_link.sql";
const sql = readFileSync(join(REPO, MIGRATION), "utf8");

let failures = 0;
const check = (label, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}: ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures += 1;
};

const db = await new PGlite();

// Minimal world: the roles Supabase provisions, a projects table, and a real
// membership-based can_view_project() so the policy has something to discriminate on.
await db.exec(`
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

  create table public.projects (
    id text primary key,
    name text not null
  );
  insert into public.projects (id, name) values
    ('10110_00358_104_01', 'AWB: Aufgaben&Ziele 2026'),
    ('10234_00103_104_01', 'Someone else''s project');

  -- Stands in for the real membership model. Deliberately discriminating.
  create table public.my_projects (project_id text primary key);
  insert into public.my_projects values ('10110_00358_104_01');

  -- security definer, matching the real one at supabase/schema.sql:606. Without
  -- it the function cannot read its own membership table as the authenticated
  -- role, and the test would fail for a reason production does not have.
  create function public.can_view_project(target_project_id text)
    returns boolean language sql stable security definer set search_path = public as $$
      select exists (select 1 from public.my_projects m where m.project_id = target_project_id)
    $$;
  grant usage on schema public to authenticated, anon;
  grant execute on function public.can_view_project(text) to authenticated, anon;
`);

/* ---------------------------------------------------------------- apply once */

let firstError = null;
try {
  await db.exec(sql);
} catch (error) {
  firstError = error;
}
check("the migration applies cleanly", firstError === null, firstError?.message ?? "");

/* --------------------------------------------------------- apply again (idempotency) */

let secondError = null;
try {
  await db.exec(sql);
} catch (error) {
  secondError = error;
}
check(
  "it applies a SECOND time without error (idempotent)",
  secondError === null,
  secondError?.message ?? "a re-paste must not fail",
);

/* ------------------------------------------------------------- shape assertions */

const cols = await db.query(`
  select column_name, data_type, is_nullable
  from information_schema.columns
  where table_schema = 'public' and table_name = 'project_link'
  order by ordinal_position
`);
const colNames = cols.rows.map((r) => r.column_name);
check(
  "project_link has the expected columns",
  ["project_id", "kind", "url", "label", "source", "created_at"].every((c) => colNames.includes(c)),
  colNames.join(", "),
);

const kinds = await db.query(`
  select pg_get_constraintdef(oid) as def
  from pg_constraint
  where conrelid = 'public.project_link'::regclass and contype = 'c'
`);
const kindDef = kinds.rows.map((r) => r.def).join(" ");
check(
  "kind is constrained to the five known link types",
  ["asana", "google_chat", "google_drive", "microsoft_teams", "trackingtime"]
    .every((k) => kindDef.includes(k)),
  kindDef.slice(0, 120),
);

// A bad kind must be rejected, or the check constraint is decorative.
let badKindRejected = false;
try {
  await db.exec(`insert into public.project_link (project_id, kind, url)
                 values ('10110_00358_104_01', 'myspace', 'https://example.com')`);
} catch {
  badKindRejected = true;
}
check("an unknown link kind is rejected", badKindRejected);

// The unique constraint must actually stop a duplicate re-import.
await db.exec(`insert into public.project_link (project_id, kind, url)
               values ('10110_00358_104_01', 'google_chat', 'https://chat.google.com/room/AAA')`);
let dupeRejected = false;
try {
  await db.exec(`insert into public.project_link (project_id, kind, url)
                 values ('10110_00358_104_01', 'google_chat', 'https://chat.google.com/room/AAA')`);
} catch {
  dupeRejected = true;
}
check("a duplicate (project, kind, url) is rejected — re-import cannot double up", dupeRejected);

const rls = await db.query(`
  select relrowsecurity from pg_class where oid = 'public.project_link'::regclass
`);
check("row level security is enabled", rls.rows[0]?.relrowsecurity === true);

/* ------------------------------------- the policy must EXCLUDE, not merely exist */

await db.exec(`insert into public.project_link (project_id, kind, url)
               values ('10234_00103_104_01', 'asana', 'https://app.asana.com/other')`);

const asService = await db.query(`select count(*)::int as n from public.project_link`);
check(
  "service role (bypassrls) sees both rows — the fixture is real",
  asService.rows[0].n === 2,
  `saw ${asService.rows[0].n}`,
);

await db.exec("set role authenticated");
const asUser = await db.query(`select project_id from public.project_link order by project_id`);
await db.exec("reset role");

const visible = asUser.rows.map((r) => r.project_id);
check(
  "an authenticated user sees the link for a project they CAN view",
  visible.includes("10110_00358_104_01"),
  visible.join(", ") || "(none)",
);
check(
  "and does NOT see the link for a project they cannot view",
  !visible.includes("10234_00103_104_01"),
  `visible: ${visible.join(", ") || "(none)"}`,
);

/* --------------------------------------------------------------- anon gets nothing */

const anonGrant = await db.query(`
  select count(*)::int as n
  from information_schema.role_table_grants
  where table_schema = 'public' and table_name = 'project_link' and grantee = 'anon'
`);
check("anon holds no grant on project_link", anonGrant.rows[0].n === 0, `${anonGrant.rows[0].n} grant(s)`);

const authGrant = await db.query(`
  select string_agg(privilege_type, ',' order by privilege_type) as p
  from information_schema.role_table_grants
  where table_schema = 'public' and table_name = 'project_link' and grantee = 'authenticated'
`);
check(
  "authenticated holds SELECT and nothing else",
  authGrant.rows[0].p === "SELECT",
  authGrant.rows[0].p ?? "(none)",
);

await db.close();
console.log(failures === 0 ? "\nPROJECT LINK MIGRATION: OK" : `\nPROJECT LINK MIGRATION: ${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
