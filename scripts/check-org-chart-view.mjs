// The org chart is company-wide directory info (name/role/department/manager),
// deliberately NOT restricted by can_view_person() the way the rest of `people`
// is -- an employee needs to see who their manager and peers are, not just
// themselves. org_chart_nodes is a view that intentionally bypasses that RLS
// (same "definer" pattern as the netflix_* views, just in the opposite
// direction: those use security_invoker=true to respect RLS, this one
// deliberately omits it to bypass it). This test proves two things: the
// bypass actually works (an employee sees the whole roster), and it's a safe
// bypass (only identity/reporting-line columns are exposed, never the
// sensitive HR fields on the base table).
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";

const db = await new PGlite();

await db.exec(`
  create schema if not exists auth;
  create table auth.users (id uuid primary key, email text);
  do $$ begin
    if not exists (select 1 from pg_roles where rolname='anon') then create role anon nologin; end if;
    if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin; end if;
    if not exists (select 1 from pg_roles where rolname='service_role') then create role service_role nologin bypassrls; end if;
  end $$;
  create or replace function auth.uid() returns uuid
    language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
`);

await db.exec(readFileSync("supabase/schema.sql", "utf8"));

const EMP = "11111111-1111-1111-1111-111111111111";

await db.exec(`
  insert into auth.users (id, email) values ('${EMP}','emp@x.com');

  insert into people (id,name,role,department,manager_id) values
    ('p-lead','Lead Person','TEAM LEAD SAFETY','Safety', null),
    ('p-report','Report Person','SAFETY CONSULTANT','Safety', 'p-lead');

  insert into app_user_profile (user_id,person_id,role_key,department,is_active) values
    ('${EMP}', 'p-report', 'employee', null, true);

  grant usage on schema public to authenticated;
  grant select, insert, update, delete on all tables in schema public to authenticated;
`);

let failed = false;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}: ${name}${detail ? " — " + detail : ""}`);
  if (!ok) failed = true;
};

async function as(uid, sql) {
  await db.exec("set role authenticated");
  await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [uid]);
  const res = await db.query(sql);
  await db.exec("reset role");
  return res.rows;
}

// Baseline: the restrictive base-table policy really does limit an employee
// to their own row (otherwise this whole test would be checking nothing).
const basePeople = await as(EMP, "select id from people");
check("baseline: employee sees only themselves on the people table", basePeople.length === 1 && basePeople[0].id === "p-report");

// The view: an employee sees the whole roster, including their manager.
const orgNodes = await as(EMP, "select id, name, manager_id from org_chart_nodes order by id");
check("org_chart_nodes: employee sees the whole roster (not just themselves)", orgNodes.length === 2);
check(
  "org_chart_nodes: employee can see their own manager's node",
  orgNodes.some((r) => r.id === "p-lead" && r.manager_id === null),
);

// Safety: the view must not leak sensitive columns from the base table.
let columnsError = null;
try {
  await as(EMP, "select holiday_left from org_chart_nodes limit 1");
} catch (e) {
  columnsError = e;
}
check("org_chart_nodes does not expose sensitive HR columns like holiday_left", columnsError !== null);

await db.close();
process.exit(failed ? 1 : 0);
