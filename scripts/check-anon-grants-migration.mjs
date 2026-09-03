/*
 * House rule: a migration runs in PGlite TWICE and the OUTCOME is asserted,
 * before anyone pastes it into the SQL editor.
 *
 * 20260903120000_anon_holds_no_write_privileges.sql takes INSERT, UPDATE,
 * DELETE, TRUNCATE, REFERENCES and TRIGGER away from `anon` on every table in
 * public, time, crm, projects, raw and stg, and fixes the DEFAULT PRIVILEGES so
 * the next `create table` does not hand them straight back.
 *
 * THE NEGATIVE CONTROL IS THE POINT OF THIS FILE. A REVOKE always "succeeds",
 * including against a database that never had the grant, so running the
 * migration and finding no anon write privileges afterwards proves nothing at
 * all. So before the migration this rebuilds production's measured state --
 * Supabase's stock `grant all on all tables in schema public to anon` plus the
 * matching default privilege -- and asserts:
 *
 *   1. anon really does hold TRUNCATE on the public tables, and
 *   2. anon can really TRUNCATE one with RLS enabled and no anon policy,
 *      which is the claim the migration's header makes and the reason the
 *      grant matters. If that truncate is refused, the header is wrong and
 *      this gate says so instead of quietly agreeing.
 *   3. creating a NEW table hands anon all seven privileges again.
 *
 * Then it runs the migration, twice, and asserts the mirror image, plus the
 * two things a fix must not break: `authenticated` still writes, and `anon`
 * keeps the SELECT grant the migration deliberately leaves alone.
 *
 * Run: npm run check:anon-grants-migration
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";

const REPO = fileURLToPath(new URL("..", import.meta.url));
const read = (...p) => readFileSync(join(REPO, ...p), "utf8");

const migration = read("supabase", "migrations", "20260903120000_anon_holds_no_write_privileges.sql");

let failures = 0;
const check = (label, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}: ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures += 1;
};

const WRITE_PRIVS = ["INSERT", "UPDATE", "DELETE", "TRUNCATE", "REFERENCES", "TRIGGER"];

/*
 * MAINTAIN (PostgreSQL 17) is checked through pg_class.relacl, not
 * information_schema, because information_schema does not report it: the live
 * ACL is `anon=arwdDxtm/postgres` — eight letters — while
 * role_table_grants returns six. A gate that only knew the SQL-standard names
 * would have declared this migration complete while anon kept VACUUM FULL,
 * CLUSTER and LOCK TABLE on the staff roster.
 */
const WRITE_LETTERS = "awdDxtm";
const anonLetters = async (db, schema, table) => {
  const r = await db.query(
    `select c.relacl::text as acl from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = $1 and c.relname = $2`, [schema, table]);
  return (/(?:^|[{,])anon=([a-zA-Z*]*)\//.exec(r.rows[0]?.acl ?? "")?.[1] ?? "").replace(/\*/g, "");
};

/*
 * A miniature of the real database rather than the whole schema.sql: this
 * migration is about GRANTS, and grants do not care what the columns are. The
 * schemas are the six the migration names, so a missing one would surface here
 * as a syntax error rather than in the SQL editor. RLS is enabled with no anon
 * policy on `people`, which is exactly production's configuration for the
 * tables that matter.
 */
const base = `
  create schema if not exists auth;
  create schema if not exists time;
  create schema if not exists crm;
  create schema if not exists projects;
  create schema if not exists raw;
  create schema if not exists stg;
  do $$ begin
    if not exists (select 1 from pg_roles where rolname='anon') then create role anon nologin; end if;
    if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin; end if;
    if not exists (select 1 from pg_roles where rolname='service_role') then create role service_role nologin bypassrls; end if;
  end $$;
  grant usage on schema public to anon, authenticated;

  create table public.people (id text primary key, name text);
  insert into public.people (id, name) values ('md-hitul','Hitul'), ('md-bjrn','Björn');
  alter table public.people enable row level security;
  -- The real shape: a policy for authenticated only. anon is refused by RLS,
  -- which is precisely what does NOT apply to truncate.
  create policy people_read on public.people for select to authenticated using (true);
  create policy people_write on public.people for all to authenticated using (true) with check (true);

  create table public.weekly_employee_summary (id bigint generated always as identity primary key, hours numeric);
  insert into public.weekly_employee_summary (hours) values (7.5);
  alter table public.weekly_employee_summary enable row level security;
  create policy wes_read on public.weekly_employee_summary for select to authenticated using (true);
`;

/** Supabase's stock default privileges on schema public, as measured. */
const vulnerable = `
  grant all on all tables in schema public to anon, authenticated, service_role;
  grant all on all sequences in schema public to anon, authenticated, service_role;
  alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
  alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
`;

const privsOf = async (db, schema, table, grantee) => {
  const r = await db.query(
    `select privilege_type from information_schema.role_table_grants
      where table_schema = $1 and table_name = $2 and grantee = $3
      order by privilege_type`,
    [schema, table, grantee],
  );
  return r.rows.map((x) => x.privilege_type);
};

const writePrivCount = async (db, grantee, schemas) => {
  const r = await db.query(
    `select count(*)::int as n from information_schema.role_table_grants
      where grantee = $1 and table_schema = any($2) and privilege_type = any($3)`,
    [grantee, schemas, WRITE_PRIVS],
  );
  return r.rows[0].n;
};

/** Run one statement as a role, the way PostgREST does. Returns an error string or null. */
const asRole = async (db, role, sql) => {
  await db.exec(`set role ${role};`);
  try { await db.exec(sql); return null; }
  catch (e) { return String(e.message).split("\n")[0]; }
  finally { await db.exec("reset role;"); }
};

const SCHEMAS = ["public", "time", "crm", "projects", "raw", "stg"];

const db = await new PGlite();
await db.exec(base);
await db.exec(vulnerable);
console.log("miniature database built in production's measured grant state\n");

/* ------------------------------------- 1. NEGATIVE CONTROL: reproduce it -- */

const before = await privsOf(db, "public", "people", "anon");
check(
  "negative control: anon holds the seven Supabase defaults on public.people",
  WRITE_PRIVS.every((p) => before.includes(p)) && before.includes("SELECT"),
  before.join(","),
);
const beforeLetters = await anonLetters(db, "public", "people");
check(
  "negative control: and the raw ACL shows MAINTAIN too, which information_schema hides",
  [...WRITE_LETTERS].every((ch) => beforeLetters.includes(ch)),
  `anon=${beforeLetters} (a=insert r=select w=update d=delete D=truncate x=references t=trigger m=maintain)`,
);

const beforeCount = await writePrivCount(db, "anon", SCHEMAS);
check(
  "negative control: anon holds write-shaped privileges across the six schemas",
  beforeCount > 0,
  `${beforeCount} (grantee, table, privilege) triples`,
);

// The claim the migration header makes, tested rather than asserted.
const truncated = await asRole(db, "anon", "truncate public.people;");
check(
  "negative control: anon CAN truncate an RLS-protected table it has no policy on",
  truncated === null,
  truncated ?? "truncate succeeded — RLS did not apply, which is the whole defect",
);
const emptied = (await db.query("select count(*)::int as n from public.people")).rows[0].n;
check(
  "negative control: and the table really is empty afterwards",
  emptied === 0,
  `${emptied} rows left of 2`,
);
// Put the rows back so the post-migration assertions run against real data.
await db.exec("insert into public.people (id, name) values ('md-hitul','Hitul'), ('md-bjrn','Björn');");

// A DELETE, by contrast, IS filtered by RLS. Stating the difference here is
// what stops a future reader "simplifying" the migration into a delete policy.
const deleted = await asRole(db, "anon", "delete from public.weekly_employee_summary;");
const survived = (await db.query("select count(*)::int as n from public.weekly_employee_summary")).rows[0].n;
check(
  "negative control: a DELETE by anon is stopped by RLS — only truncate walks past it",
  survived === 1,
  deleted ? `refused: ${deleted}` : `delete ran but removed nothing (${survived} row left)`,
);

await db.exec("create table public.made_later (id int);");
const later = await privsOf(db, "public", "made_later", "anon");
check(
  "negative control: a NEW table inherits all seven privileges for anon",
  WRITE_PRIVS.every((p) => later.includes(p)),
  later.join(","),
);

/* --------------------------------------------- 2. run the migration TWICE -- */

for (const pass of [1, 2]) {
  try {
    await db.exec(migration);
    console.log(`\nrun ${pass}: executed without error`);
  } catch (e) {
    check(`run ${pass}: the migration executes`, false, String(e.message).split("\n")[0]);
    break;
  }

  const after = await privsOf(db, "public", "people", "anon");
  check(
    `run ${pass}: anon holds NO write-shaped privilege on public.people`,
    WRITE_PRIVS.every((p) => !after.includes(p)),
    `anon holds: ${after.join(",") || "(nothing)"}`,
  );
  check(
    `run ${pass}: anon KEEPS select on public.people — the fix removes writes, not reads`,
    after.includes("SELECT"),
    `anon holds: ${after.join(",") || "(nothing)"}`,
  );

  const count = await writePrivCount(db, "anon", SCHEMAS);
  check(
    `run ${pass}: zero anon write privileges across ${SCHEMAS.join(", ")}`,
    count === 0,
    `${count} remaining`,
  );

  const nowTruncated = await asRole(db, "anon", "truncate public.people;");
  check(
    `run ${pass}: anon can no longer truncate public.people`,
    nowTruncated !== null && /denied/i.test(nowTruncated),
    nowTruncated ?? "TRUNCATE STILL SUCCEEDED",
  );
  const stillThere = (await db.query("select count(*)::int as n from public.people")).rows[0].n;
  check(`run ${pass}: the rows are still there`, stillThere === 2, `${stillThere} of 2`);

  // The default-privilege half. A table created AFTER the migration is the only
  // way to test it, and it is the half that makes the fix outlive the next
  // migration.
  await db.exec(`create table public.made_after_${pass} (id int);`);
  const fresh = await privsOf(db, "public", `made_after_${pass}`, "anon");
  check(
    `run ${pass}: a table created AFTER the migration gives anon no write privileges`,
    WRITE_PRIVS.every((p) => !fresh.includes(p)),
    `anon holds: ${fresh.join(",") || "(nothing)"}`,
  );
  check(
    `run ${pass}: that new table still gives anon select (defaults changed for writes only)`,
    fresh.includes("SELECT"),
    `anon holds: ${fresh.join(",") || "(nothing)"}`,
  );

  /*
   * The literal ACL, in the exact shape scripts/check-anon-grants.mjs greps on
   * production. Asserting the behaviour above and the representation here means
   * the two gates cannot drift into disagreeing about what "fixed" looks like.
   * Postgres spells them a=INSERT r=SELECT w=UPDATE d=DELETE D=TRUNCATE
   * x=REFERENCES t=TRIGGER, so `anon=r/` is the target and anything else is a
   * regrant waiting for the next create table.
   */
  const peopleLetters = await anonLetters(db, "public", "people");
  check(
    `run ${pass}: the raw ACL on public.people is read-only for anon`,
    ![...WRITE_LETTERS].some((ch) => peopleLetters.includes(ch)),
    `anon=${peopleLetters || "(no entry)"}`,
  );

  const acl = (await db.query(
    `select d.defaclacl::text as acl from pg_default_acl d
       join pg_namespace n on n.oid = d.defaclnamespace
      where n.nspname = 'public' and d.defaclobjtype = 'r'`)).rows.map((r) => r.acl).join(" | ");
  const defLetters = (/(?:^|[{,])anon=([a-zA-Z*]*)\//.exec(acl)?.[1] ?? "").replace(/\*/g, "");
  check(
    `run ${pass}: the public default ACL leaves anon with read only`,
    ![...WRITE_LETTERS].some((ch) => defLetters.includes(ch)),
    `anon=${defLetters || "(absent)"} in ${acl}`,
  );

  const seqUpdate = await db.query(
    `select count(*)::int as n from information_schema.role_usage_grants
      where grantee = 'anon' and object_schema = 'public'`);
  check(
    `run ${pass}: anon keeps sequence USAGE (nextval is not a write)`,
    seqUpdate.rows[0].n > 0,
    `${seqUpdate.rows[0].n} usage grant(s)`,
  );

  /* ------------- the control that stops this being a fix that breaks the app */
  const authWrite = await asRole(db, "authenticated",
    "insert into public.people (id, name) values ('md-test','Test');");
  check(
    `run ${pass}: control — an AUTHENTICATED caller can still write`,
    authWrite === null,
    authWrite ?? "",
  );
  await db.exec("delete from public.people where id = 'md-test';");

  const authPrivs = await privsOf(db, "public", "people", "authenticated");
  check(
    `run ${pass}: control — authenticated keeps all seven privileges`,
    [...WRITE_PRIVS, "SELECT"].every((p) => authPrivs.includes(p)),
    authPrivs.join(","),
  );
  const svcPrivs = await privsOf(db, "public", "people", "service_role");
  check(
    `run ${pass}: control — service_role is untouched (the sync writes as it)`,
    [...WRITE_PRIVS, "SELECT"].every((p) => svcPrivs.includes(p)),
    svcPrivs.join(","),
  );
}

/* ------------------------- 3. the guard: a schema that does not exist yet -- */

/*
 * crm, projects and stg arrive in later migrations, so this file WILL be pasted
 * one day against a database that has not got them. A flat
 * `revoke ... on all tables in schema crm` aborts there, leaving the fix
 * half-applied. Prove the guard rather than trust it.
 */
await db.exec("drop schema crm cascade; drop schema stg cascade;");
let guarded = null;
try { await db.exec(migration); } catch (e) { guarded = String(e.message).split("\n")[0]; }
check(
  "the migration still runs when crm and stg do not exist yet",
  guarded === null,
  guarded ?? "skipped the absent schemas and finished",
);
const guardedLetters = await anonLetters(db, "public", "people");
check(
  "and public is still fixed after that run",
  ![...WRITE_LETTERS].some((ch) => guardedLetters.includes(ch)),
  `anon=${guardedLetters || "(no entry)"}`,
);

await db.close();

console.log(failures === 0
  ? "\nMIGRATION IS SAFE TO PASTE (idempotent across two runs; anon loses every write, keeps select, and authenticated is untouched)"
  : `\n${failures} check(s) failed — DO NOT PASTE`);
process.exit(failures === 0 ? 0 : 1);
