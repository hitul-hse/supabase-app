// Verifies the backfill migration against real Postgres: it must restore access
// for unambiguous assignments, and must NOT guess when a project name is
// ambiguous (that ambiguity is the original vulnerability).
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";

const EMP = "33333333-3333-3333-3333-333333333333";
const AMB = "55555555-5555-5555-5555-555555555555";

const db = await new PGlite();
await db.exec(`
  create schema if not exists auth;
  create table auth.users (id uuid primary key, email text);
  do $$ begin
    if not exists (select 1 from pg_roles where rolname='anon') then create role anon nologin; end if;
    if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin; end if;
  end $$;
  create or replace function auth.uid() returns uuid
    language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
`);
await db.exec(readFileSync("supabase/schema.sql", "utf8"));

// Simulate a pre-migration database: assignments carry only project_name.
await db.exec(`
  insert into auth.users (id,email) values ('${EMP}','m@x.com'), ('${AMB}','a@x.com');
  insert into people (id,name,role,department,since,contract_hours,employee_number,
    capacity_status,logged_this_month,total_monthly_hours,billable_share,open_tasks,
    overdue_tasks,holiday_left,total_holiday) values
    ('p-emp','Bob','Eng','Engineering','2021',40,'E2','ok',10,160,0.5,1,0,10,30),
    ('p-amb','Dee','Eng','Engineering','2021',40,'E3','ok',10,160,0.5,1,0,10,30);
  insert into projects (id,code,name,customer,lead,status,contract_hours,billable_hours,
    consumed_percent,due,owner_person_id,department) values
    ('prj-uniq','U-1','Tunnel','ACME','Ann','active',100,50,50,'Q4',null,'Engineering'),
    ('prj-dup-a','D-1','Bridge','ACME','Ann','active',100,50,50,'Q4',null,'Engineering'),
    ('prj-dup-b','D-2','Bridge','SECRET','Cara','active',100,50,50,'Q4',null,'Sales');
`);

// Legacy rows: project_name populated, project_id NULL.
await db.exec(`
  insert into person_assignments (person_id,project_id,project_name,logged_hours,
    tasks_count,share_percent,sort_order) values
    ('p-emp', null, 'Tunnel', 10,1,50,1),
    ('p-amb', null, 'Bridge', 10,1,50,1);
  insert into app_user_profile (user_id,person_id,role_key,department,is_active) values
    ('${EMP}','p-emp','employee','Engineering',true),
    ('${AMB}','p-amb','employee','Engineering',true);
  grant usage on schema public to authenticated;
  grant select, insert, update, delete on all tables in schema public to authenticated;
`);

async function projectsFor(uid) {
  await db.exec("set role authenticated");
  await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [uid]);
  const { rows } = await db.query("select id from projects order by id");
  await db.exec("reset role");
  return rows.map((r) => r.id).join(",");
}

let failed = false;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}: ${name}${detail ? " — " + detail : ""}`);
  if (!ok) failed = true;
};

// Before the backfill, assignment-based access is dormant. This is the gap the
// migration exists to close, and it confirms the test is measuring something.
check("before backfill: assigned employee sees no projects", (await projectsFor(EMP)) === "", `saw: ${await projectsFor(EMP)}`);

await db.exec(readFileSync("supabase/migrations/backfill_person_assignments_project_id.sql", "utf8"));

// Unambiguous name resolves, so access is restored.
check("after backfill: employee sees their uniquely-named project", (await projectsFor(EMP)) === "prj-uniq", `saw: ${await projectsFor(EMP)}`);

// Ambiguous name must stay NULL rather than guessing, and must not grant access
// to either same-named project.
const { rows: amb } = await db.query(
  `select project_id from person_assignments where person_id = 'p-amb'`,
);
check("ambiguous assignment left NULL rather than guessed", amb[0].project_id === null, `project_id=${amb[0].project_id}`);
check("ambiguous assignment grants access to neither project", (await projectsFor(AMB)) === "", `saw: ${await projectsFor(AMB)}`);

// Re-running must be safe.
await db.exec(readFileSync("supabase/migrations/backfill_person_assignments_project_id.sql", "utf8"));
check("migration is idempotent", (await projectsFor(EMP)) === "prj-uniq");

await db.close();
process.exit(failed ? 1 : 0);
