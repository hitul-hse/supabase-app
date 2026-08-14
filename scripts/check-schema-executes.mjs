// Executes supabase/schema.sql against a real Postgres engine (PGlite is
// Postgres compiled to WASM, not a simulation), so "this file runs on a fresh
// project" is verified by execution rather than by static inspection.
//
// Supabase provides a few things a bare Postgres doesn't, so we stand them up
// first: the auth schema with auth.users, the anon/authenticated roles, and
// auth.uid(). Everything after that is the project's own schema.sql, unmodified.
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";

const db = await new PGlite();

const preamble = `
  create schema if not exists auth;
  create table auth.users (
    id uuid primary key,
    email text
  );
  do $$ begin
    if not exists (select 1 from pg_roles where rolname = 'anon') then
      create role anon nologin;
    end if;
    if not exists (select 1 from pg_roles where rolname = 'authenticated') then
      create role authenticated nologin;
    end if;
  end $$;
  -- Stand-in for Supabase's auth.uid(), which reads the request JWT.
  create or replace function auth.uid() returns uuid
    language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
`;

await db.exec(preamble);
console.log("preamble: auth schema, anon/authenticated roles, auth.uid() created");

const sql = readFileSync("supabase/schema.sql", "utf8");

try {
  await db.exec(sql);
  console.log("EXECUTED supabase/schema.sql with no errors");
} catch (err) {
  console.log("SCHEMA FAILED TO EXECUTE:");
  console.log("  " + (err.message || err));
  process.exit(1);
}

// Confirm the objects the app depends on actually exist afterwards.
const expectedTables = [
  "app_role",
  "app_user_profile",
  "approval_decisions",
  "executive_metrics",
  "files",
  "netflix_users",
  "people",
  "person_assignments",
  "person_qualifications",
  "project_tasks",
  "project_timeline",
  "projects",
  "sync_sources",
  "team_utilisations",
  "timesheet_entries",
  "weekly_bookings",
  "weekly_trends",
];

const { rows: tables } = await db.query(
  `select tablename from pg_tables where schemaname = 'public' order by tablename`,
);
const got = tables.map((r) => r.tablename);
const missingTables = expectedTables.filter((t) => !got.includes(t));

const { rows: fns } = await db.query(
  `select proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' order by proname`,
);
const gotFns = fns.map((r) => r.proname);
const expectedFns = [
  "app_user_department",
  "app_user_person_id",
  "app_user_role",
  "can_view_person",
  "can_view_project",
];
const missingFns = expectedFns.filter((f) => !gotFns.includes(f));

const { rows: policies } = await db.query(
  `select tablename, policyname, cmd, qual, with_check from pg_policies where schemaname = 'public'`,
);

const { rows: seeded } = await db.query(`select role_key from app_role order by seniority desc`);

let failed = false;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}: ${name}${detail ? " — " + detail : ""}`);
  if (!ok) failed = true;
};

check("all 17 expected tables created", missingTables.length === 0, missingTables.join(", "));
check("all 5 role helper functions created", missingFns.length === 0, missingFns.join(", "));
check("24 policies created", policies.length === 24, `got ${policies.length}`);
check(
  "app_role seeded with 4 roles",
  seeded.length === 4 && seeded[0].role_key === "exec",
  seeded.map((r) => r.role_key).join(","),
);

// Bug #4: the approvals UPDATE policy must carry WITH CHECK, not just USING.
const upd = policies.find(
  (p) => p.tablename === "approval_decisions" && p.cmd === "UPDATE",
);
check(
  "approval_decisions UPDATE policy has a WITH CHECK expression",
  Boolean(upd && upd.with_check),
  upd ? `with_check=${upd.with_check}` : "policy missing",
);

// Bug #5: profiles need exec-writable policies for all three write commands.
for (const cmd of ["INSERT", "UPDATE", "DELETE"]) {
  check(
    `app_user_profile has an ${cmd} policy`,
    policies.some((p) => p.tablename === "app_user_profile" && p.cmd === cmd),
  );
}

// Bug #6: assignment-based project access must key off project_id.
const { rows: cols } = await db.query(
  `select column_name from information_schema.columns
   where table_name = 'person_assignments' and column_name = 'project_id'`,
);
check("person_assignments.project_id column exists", cols.length === 1);

const { rows: fk } = await db.query(
  `select confrelid::regclass as target
   from pg_constraint
   where conrelid = 'person_assignments'::regclass and contype = 'f'
     and 'project_id' = any (
       select attname from pg_attribute
       where attrelid = conrelid and attnum = any (conkey)
     )`,
);
check(
  "person_assignments.project_id is a real FK to projects",
  fk.some((r) => r.target === "projects"),
);

const { rows: def } = await db.query(
  `select prosrc from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname='public' and proname='can_view_project'`,
);
check(
  "can_view_project joins assignments on project_id, not project_name",
  def[0].prosrc.includes("pa.project_id = pr.id") &&
    !def[0].prosrc.includes("pa.project_name = pr.name"),
);

// Bug: deactivated accounts must lose their role.
for (const fn of ["app_user_role", "app_user_department", "app_user_person_id"]) {
  const { rows } = await db.query(
    `select prosrc from pg_proc p join pg_namespace n on n.oid=p.pronamespace
     where n.nspname='public' and proname=$1`,
    [fn],
  );
  check(`${fn}() filters on is_active`, rows[0].prosrc.includes("is_active"));
}

// The helpers must not be callable by anon.
const { rows: acl } = await db.query(
  `select proname, proacl::text from pg_proc p join pg_namespace n on n.oid=p.pronamespace
   where n.nspname='public' and proname = any($1)`,
  [expectedFns],
);
check(
  "role helpers are not executable by anon",
  acl.every((r) => !/(^|,)anon=/.test(r.proacl || "")),
  acl.map((r) => `${r.proname}:${r.proacl}`).join(" "),
);

// Every table carrying real data must have RLS on.
const { rows: rls } = await db.query(
  `select relname from pg_class c join pg_namespace n on n.oid=c.relnamespace
   where n.nspname='public' and c.relkind='r' and not c.relrowsecurity`,
);
check("RLS enabled on every public table", rls.length === 0, rls.map((r) => r.relname).join(", "));

await db.close();
process.exit(failed ? 1 : 0);
