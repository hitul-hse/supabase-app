// Coverage for project sections -- the Asana-equivalent model where a section
// and a board column are the *same object*: "a header above a list of tasks in
// a list view or a column in a board view" (developers.asana.com/reference/sections).
//
// The board previously had four hard-coded status columns, which cannot
// express a per-project workflow. Sections replace that.
//
// The integrity rule worth testing is the same class of bug already fixed for
// subtasks: a task's section must belong to the task's own project, or a task
// can be filed into another client's column.
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

const OWNER = "11111111-1111-1111-1111-111111111111"; // owns prj-a
const OUTSIDER = "22222222-2222-2222-2222-222222222222"; // owns prj-b only

await db.exec(`
  insert into auth.users (id, email) values ('${OWNER}','owner@x.com'), ('${OUTSIDER}','out@x.com');

  insert into people (id,name,role,department,since,contract_hours,employee_number,
    capacity_status,logged_this_month,total_monthly_hours,billable_share,open_tasks,
    overdue_tasks,holiday_left,total_holiday) values
    ('p-owner','Owner','Eng','Engineering','2020',40,'E1','ok',10,160,0.5,1,0,10,30),
    ('p-out','Out','Sales','Sales','2022',40,'S1','ok',10,160,0.5,1,0,10,20);

  insert into projects (id,code,name,customer,lead,status,contract_hours,billable_hours,
    consumed_percent,due,owner_person_id,department) values
    ('prj-a','A-1','Bridge','ACME','Owner','active',100,50,50,'Q4','p-owner','Engineering'),
    ('prj-b','B-1','Pitch','OTHER','Out','active',100,50,50,'Q4','p-out','Sales');

  insert into app_user_profile (user_id,person_id,role_key,department,is_active) values
    ('${OWNER}', 'p-owner','project_manager', null, true),
    ('${OUTSIDER}', 'p-out','project_manager', null, true);

  grant usage on schema public to authenticated;
  grant select, insert, update, delete on all tables in schema public to authenticated;
`);

let failed = false;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}: ${name}${detail ? " — " + detail : ""}`);
  if (!ok) failed = true;
};

async function as(uid, fn) {
  await db.exec("set role authenticated");
  await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [uid]);
  try {
    return await fn();
  } finally {
    await db.exec("reset role");
  }
}

// --- creating sections ---

const created = await as(OWNER, () =>
  db.query(
    `insert into project_sections (project_id, name, position) values ('prj-a','In review',1) returning id`,
  ),
);
check("someone who can view a project can add a section to it", created.rows.length === 1);
const SECTION_A = created.rows[0].id;

let outsiderCreate = false;
try {
  await as(OUTSIDER, () =>
    db.query(`insert into project_sections (project_id, name, position) values ('prj-a','Sneaky',9)`),
  );
} catch {
  outsiderCreate = true;
}
check("an outsider cannot add a section to a project they can't view", outsiderCreate);

const outsiderRead = await as(OUTSIDER, () =>
  db.query(`select id from project_sections where project_id='prj-a'`),
);
check("an outsider cannot read another project's sections", outsiderRead.rows.length === 0);

// --- the cross-project integrity rule ---

const sectionB = await as(OUTSIDER, () =>
  db.query(
    `insert into project_sections (project_id, name, position) values ('prj-b','Their column',1) returning id`,
  ),
);
const SECTION_B = sectionB.rows[0].id;

const task = await as(OWNER, () =>
  db.query(
    `insert into project_tasks (project_id,name,estimate_hours,logged_hours,status,owner,sort_order)
     values ('prj-a','Task one',4,0,'todo','Owner',1) returning id`,
  ),
);
const TASK = task.rows[0].id;

const ok = await as(OWNER, () =>
  db.query(`update project_tasks set section_id=${SECTION_A} where id=${TASK} returning id`),
);
check("a task can be filed into a section of its own project", ok.rows.length === 1);

let crossProject = false;
try {
  await as(OWNER, () =>
    db.query(`update project_tasks set section_id=${SECTION_B} where id=${TASK}`),
  );
} catch {
  crossProject = true;
}
const stillA = await db.query(`select section_id from project_tasks where id=${TASK}`);
check(
  "a task CANNOT be filed into a section belonging to a different project",
  crossProject && Number(stillA.rows[0].section_id) === Number(SECTION_A),
  `section_id=${stillA.rows[0].section_id}`,
);

// --- deleting a section must not delete the work in it ---

await as(OWNER, () => db.query(`delete from project_sections where id=${SECTION_A}`));
const survivor = await db.query(`select id, section_id from project_tasks where id=${TASK}`);
check(
  "deleting a section leaves its tasks alive and unfiled, not deleted",
  survivor.rows.length === 1 && survivor.rows[0].section_id === null,
  JSON.stringify(survivor.rows[0]),
);

// --- WIP limit is stored, and advisory ---

const wip = await as(OWNER, () =>
  db.query(
    `insert into project_sections (project_id, name, position, wip_limit)
     values ('prj-a','Doing',2,3) returning id, wip_limit`,
  ),
);
check("a section can carry a WIP limit", Number(wip.rows[0].wip_limit) === 3);

// Deliberately advisory: blocking the fourth card would stop real work to
// satisfy a number. The UI warns; the database does not refuse.
const WIP_SECTION = wip.rows[0].id;
let overfilled = 0;
for (let i = 0; i < 5; i++) {
  const r = await as(OWNER, () =>
    db.query(
      `insert into project_tasks (project_id,name,estimate_hours,logged_hours,status,owner,sort_order,section_id)
       values ('prj-a','WIP ${i}',1,0,'todo','Owner',${10 + i},${WIP_SECTION}) returning id`,
    ),
  );
  overfilled += r.rows.length;
}
check("a WIP limit is advisory -- exceeding it is allowed, not blocked", overfilled === 5);

// --- due dates ---

const due = await as(OWNER, () =>
  db.query(`update project_tasks set due_on='2026-09-30' where id=${TASK} returning due_on`),
);
check("a task can carry a due date", due.rows.length === 1);

await db.close();
process.exit(failed ? 1 : 0);
