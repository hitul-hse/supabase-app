/*
 * Prove the round-4 paste file executes as ONE paste against real Postgres,
 * TWICE, exactly as hitul will run it — and that it leaves the policies it
 * claims to leave.
 *
 * WHY TWICE. Everything in that file is written to be idempotent, and the reason
 * is practical rather than theoretical: a paste into the Supabase SQL editor can
 * be interrupted by a dropped connection, and the obvious response is to paste
 * it again. A second run must be harmless. This gate is the only thing that
 * proves it, so a change to that file that quietly breaks re-runnability turns
 * this red rather than being discovered at the keyboard.
 *
 * WHAT IT RUNS AGAINST. The crm schema does not live in supabase/schema.sql; it
 * is created by APPLY-IN-SQL-EDITOR-2.sql, the round-2 paste. So the fixture is
 * schema.sql plus that file, which is also exactly the order the real database
 * was built in. Round 4 is then applied on top.
 */
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { record } from "./lib/gate-result.mjs";

let failed = 0;
const check = (name, ok, detail = "") => {
  record(ok);
  if (!ok) failed += 1;
  console.log(`${ok ? "PASS" : "FAIL"}: ${name}${detail ? ` — ${detail}` : ""}`);
};

const preamble = `
  create schema if not exists auth;
  create table auth.users (id uuid primary key, email text);
  do $$ begin
    if not exists (select 1 from pg_roles where rolname='anon') then create role anon nologin; end if;
    if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin; end if;
    if not exists (select 1 from pg_roles where rolname='service_role') then create role service_role nologin bypassrls; end if;
  end $$;
  create or replace function auth.uid() returns uuid
    language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
`;

const schema = readFileSync("supabase/schema.sql", "utf8");
const round2 = readFileSync("supabase/APPLY-IN-SQL-EDITOR-2.sql", "utf8");
const paste = readFileSync("supabase/APPLY-IN-SQL-EDITOR-4.sql", "utf8");

/*
 * The permission and role rows this file refuses to run without. They exist on
 * the live project; schema.sql does not seed them, so the fixture supplies them
 * and the refusal itself is tested separately below.
 */
const seed = `
  insert into public.app_permission (permission_key, display_name, resource, action)
  select v.k, v.k, 'crm', split_part(v.k, ':', 3)
  from (values ('crm:deal:read'), ('crm:deal:write')) as v(k)
  where not exists (select 1 from public.app_permission p where p.permission_key = v.k);
  insert into public.app_role (role_key, display_name, seniority)
  select v.k, v.k, 50 from (values ('dept_head'), ('exec')) as v(k)
  where not exists (select 1 from public.app_role r where r.role_key = v.k);
  insert into public.app_role_permission (role_key, permission_key)
  select 'exec', v.k from (values ('crm:deal:read'), ('crm:deal:write')) as v(k)
  where not exists (
    select 1 from public.app_role_permission rp
    where rp.role_key = 'exec' and rp.permission_key = v.k);
`;

const fresh = async () => {
  const db = await new PGlite();
  await db.exec(preamble);
  await db.exec(schema);
  await db.exec(round2);
  await db.exec(seed);
  return db;
};

const db = await fresh();
try {
  await db.exec(paste);
  check("the file executes as ONE paste", true);
} catch (e) {
  check("the file executes as ONE paste", false, String(e.message).split("\n")[0]);
  console.log("\nPASTE SQL 4: aborted");
  process.exit(1);
}

{
  const d2 = await fresh();
  await d2.exec(paste);
  let ok = true, detail = "";
  try { await d2.exec(paste); } catch (e) { ok = false; detail = String(e.message).split("\n")[0]; }
  await d2.close();
  check("running the whole paste TWICE is safe", ok, detail);
}

const one = async (sql) => (await db.query(sql)).rows[0];
const all = async (sql) => (await db.query(sql)).rows;

/* ---------------------------------------------------------------- policies */

check(
  "no crm table is left on the old exec-only policy",
  (await one(`select count(*)::int n from pg_policies
              where schemaname='crm' and policyname='customer master exec access'`)).n === 0,
);

const crmTables = (await one(`select count(*)::int n from pg_tables where schemaname='crm'`)).n;
check("the fixture actually created crm tables", crmTables >= 10, `found ${crmTables}`);

for (const cmd of [["customer master read", "SELECT"], ["customer master write", "INSERT"], ["customer master update", "UPDATE"], ["customer master delete", "DELETE"]]) {
  const [name, expected] = cmd;
  const rows = await all(`select tablename, cmd from pg_policies where schemaname='crm' and policyname=${`'${name}'`}`);
  check(
    `every crm table has "${name}" and it is ${expected} only`,
    rows.length === crmTables && rows.every((r) => r.cmd === expected),
    `${rows.length} of ${crmTables} tables; commands: ${[...new Set(rows.map((r) => r.cmd))].join(", ")}`,
  );
}

check(
  "the read policy tests the permission, not the role",
  (await one(`select count(*)::int n from pg_policies
              where schemaname='crm' and policyname='customer master read'
                and qual like '%crm:deal:read%' and qual not like '%app_user_role%'`)).n === crmTables,
);
check(
  "the write policies test crm:deal:write, so read does not imply write",
  (await one(`select count(*)::int n from pg_policies
              where schemaname='crm' and policyname in ('customer master update','customer master delete')
                and qual like '%crm:deal:write%'`)).n === crmTables * 2,
);

/* ------------------------------------------------------------- permissions */

check(
  "dept_head gained crm:deal:read",
  (await one(`select count(*)::int n from public.app_role_permission
              where role_key='dept_head' and permission_key='crm:deal:read'`)).n === 1,
);
check(
  "dept_head did NOT gain crm:deal:write",
  (await one(`select count(*)::int n from public.app_role_permission
              where role_key='dept_head' and permission_key='crm:deal:write'`)).n === 0,
  "read was asked for; write is a separate decision on HSEHU-81",
);
check(
  "exec keeps both, so no existing exec path changes",
  (await one(`select count(*)::int n from public.app_role_permission
              where role_key='exec' and permission_key in ('crm:deal:read','crm:deal:write')`)).n === 2,
);

/* ------------------------------------ what the file leaves deliberately alone */

check(
  "the projects.* tables keep their exec-only policy, untouched by this file",
  (await one(`select count(*)::int n from pg_policies
              where schemaname='projects' and policyname='customer master exec access'`)).n >= 1,
  "opening those needs a can_view_project() scoping decision, not a bare permission",
);

/* ------------------------------------------------------- negative controls */

{
  /* The guard at the top must refuse rather than half-apply when the permission
   * row is missing. Without this, a typo in the key would grant nothing and the
   * paste would report success. */
  const d3 = await new PGlite();
  await d3.exec(preamble);
  await d3.exec(schema);
  await d3.exec(round2);
  /* The round-2 paste already seeds the crm permissions, so simply omitting the
   * fixture seed does NOT reproduce a missing permission -- the first version of
   * this control did that and reported a failure that was its own, not the
   * file's. Remove the row explicitly instead. */
  await d3.exec(`delete from public.app_role_permission where permission_key = 'crm:deal:read';
                 delete from public.app_permission where permission_key = 'crm:deal:read';`);
  let refused = false, msg = "";
  try { await d3.exec(paste); } catch (e) { refused = true; msg = String(e.message).split("\n")[0]; }
  /* The paste opens its own transaction, so a raise inside it leaves the session
   * in an aborted transaction and every later statement fails with "current
   * transaction is aborted" rather than answering. End it before asking what
   * survived -- and the rollback is itself part of what is being asserted: if
   * the file had committed anything before refusing, this would not undo it. */
  await d3.exec("rollback");
  const left = (await d3.query(`select count(*)::int n from pg_policies where schemaname='crm' and policyname='customer master read'`)).rows[0].n;
  await d3.close();
  check("[control] a missing permission row makes the paste REFUSE", refused, msg);
  check("[control] and it changes no policy when it refuses", left === 0, `${left} read policies were created anyway`);
}

await db.close();
console.log(failed === 0 ? "\nPASTE SQL 4: OK" : `\nPASTE SQL 4: ${failed} FAILED`);
process.exit(failed === 0 ? 0 : 1);
