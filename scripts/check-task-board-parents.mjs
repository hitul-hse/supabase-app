/**
 * Can the task board attach to a REAL project, and who may write to it?
 *
 * WHY THIS EXISTS
 * ---------------
 * project_tasks and project_sections could only ever hang off public.projects --
 * a five-row table keyed by text ids ("prj-1") that /projects stopped reading
 * months ago. The pages people actually use read time.project: 334 projects
 * imported from TrackingTime, keyed by bigint. There was no join between the two
 * (time.project.hub_project_id exists for exactly this and is populated on 0
 * rows), so a finished Kanban board, subtasks, sections and comments sat in the
 * tree reachable from nowhere.
 *
 * The fix is additive on purpose. Repointing project_id from text to bigint
 * would have meant destroying the existing rows to find out whether they
 * mattered, and they had been called real. So both parents are allowed, and
 * exactly one must be set.
 *
 * THE PART THAT NEEDED A TEST MORE THAN THE PLUMBING
 * -------------------------------------------------
 * Visibility of the two parents is NOT symmetric. A Hub project is scoped by
 * can_view_project() -- owner, department, assignment. A TrackingTime project is
 * readable by every authenticated user, because time.project's own policy is
 * "to authenticated using (true)". So reusing "can you see it" as the write rule
 * -- which is what the old policies did -- would let any signed-in employee
 * delete tasks across all 334 projects. That is the same defect already fixed in
 * projects/actions.ts: gating a WRITE on READ visibility.
 *
 * Writes to a TrackingTime-parented row therefore require projects:write, in the
 * policy as well as in the server action, and that boundary is what most of the
 * assertions below are about.
 *
 * Run: node scripts/check-task-board-parents.mjs
 */
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

const EXEC = "11111111-1111-1111-1111-111111111111";
const STAFF = "22222222-2222-2222-2222-222222222222";

await db.exec(`
  insert into auth.users (id,email) values ('${EXEC}','e@x.com'), ('${STAFF}','s@x.com');

  insert into people (id,name,role,department,since,contract_hours,employee_number,
    capacity_status,logged_this_month,total_monthly_hours,billable_share,open_tasks,
    overdue_tasks,holiday_left,total_holiday) values
    ('p-exec','Ex','Dir','Engineering','2020',40,'E1','ok',10,160,0.5,1,0,10,30),
    ('p-staff','St','Eng','Engineering','2021',40,'E2','ok',10,160,0.5,1,0,10,30);

  insert into app_user_profile (user_id,person_id,role_key,department,is_active) values
    ('${EXEC}','p-exec','exec',null,true),
    ('${STAFF}','p-staff','employee','Engineering',true);

  insert into projects (id,code,name,customer,lead,status,contract_hours,billable_hours,
    consumed_percent,due,owner_person_id,department) values
    ('prj-1','A-1','Hub project','ACME','Ex','active',100,50,50,'Q4','p-exec','Engineering');

  insert into time.customer (id,source_id,name) overriding system value values (1,'c1','ACME');
  insert into time.project (id,source_id,name,customer_id) overriding system value
    values (1,'tp1','Bridge survey',1), (2,'tp2','Other engagement',1);

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

const tryIt = async (sql, params = []) => {
  try {
    await db.query(sql, params);
    return null;
  } catch (e) {
    return e.message;
  }
};

console.log("\nExactly one parent — the constraint that keeps the two models apart:\n");
{
  const both = await tryIt(
    `insert into project_sections (project_id, time_project_id, name, position)
     values ('prj-1', 1, 'Bad', 0)`,
  );
  check("a row naming BOTH parents is rejected", both !== null, both?.slice(0, 60));

  const neither = await tryIt(`insert into project_sections (name, position) values ('Orphan', 0)`);
  check("a row naming NEITHER parent is rejected", neither !== null, neither?.slice(0, 60));
}

console.log("\nAn exec (holds projects:write) can build a board on a real project:\n");
let sectionId, taskId;
await as(EXEC, async () => {
  const err = await tryIt(
    `insert into project_sections (time_project_id, name, position) values (1,'To do',0)`,
  );
  check("creates a section on a TrackingTime project", err === null, err?.slice(0, 90));

  const r = await db.query(`select id from project_sections where time_project_id = 1`);
  sectionId = r.rows[0]?.id;

  const e2 = await tryIt(
    `insert into project_tasks (time_project_id, section_id, name, estimate_hours,
       logged_hours, status, owner, sort_order)
     values (1, $1, 'Survey the deck', 4, 0, 'NOT STARTED', 'Ex', 1)`,
    [sectionId],
  );
  check("creates a task in it", e2 === null, e2?.slice(0, 90));

  const t = await db.query(`select id from project_tasks where time_project_id = 1`);
  taskId = t.rows[0]?.id;
  check("the task is readable back", Boolean(taskId));
});

console.log("\nAn employee can SEE it — but must not be able to change it:\n");
await as(STAFF, async () => {
  const { rows } = await db.query(`select id from project_tasks where time_project_id = 1`);
  check(
    "the task is visible (time.project is readable by everyone signed in)",
    rows.length === 1,
    `${rows.length} rows`,
  );

  const del = await db.query(`delete from project_tasks where id = $1 returning id`, [taskId]);
  check(
    "DELETE without projects:write removes nothing",
    del.rows.length === 0,
    `${del.rows.length} rows deleted`,
  );

  // DELETE and UPDATE fail differently, and both are correct. The USING clause
  // filters a DELETE down to zero rows silently; an UPDATE passes USING (this
  // employee may SEE the row) and then trips WITH CHECK, which raises 42501.
  // A loud refusal is the better of the two, so assert the refusal, not silence.
  const upd = await tryIt(`update project_tasks set status = 'DONE' where id = $1`, [taskId]);
  check("UPDATE without projects:write is refused", upd !== null, upd?.slice(0, 60));

  const ins = await tryIt(
    `insert into project_tasks (time_project_id, name, estimate_hours, logged_hours,
       status, owner, sort_order) values (1,'Sneaked in',1,0,'NOT STARTED','St',9)`,
  );
  check("INSERT without projects:write is refused", ins !== null, ins?.slice(0, 60));
});

console.log("\nNo smuggling across projects — a section must belong to the same parent:\n");
await as(EXEC, async () => {
  const other = await tryIt(
    `insert into project_tasks (time_project_id, section_id, name, estimate_hours,
       logged_hours, status, owner, sort_order)
     values (2, $1, 'Wrong board', 1, 0, 'NOT STARTED', 'Ex', 2)`,
    [sectionId],
  );
  check("a task on project 2 cannot use project 1's section", other !== null, other?.slice(0, 60));

  const mixed = await tryIt(
    `insert into project_tasks (project_id, section_id, name, estimate_hours,
       logged_hours, status, owner, sort_order)
     values ('prj-1', $1, 'Mixed parents', 1, 0, 'NOT STARTED', 'Ex', 3)`,
    [sectionId],
  );
  check("a HUB task cannot use a TrackingTime section", mixed !== null, mixed?.slice(0, 60));
});

console.log("\nThe existing Hub board still works — this change is additive:\n");
await as(EXEC, async () => {
  const err = await tryIt(
    `insert into project_sections (project_id, name, position) values ('prj-1','Legacy',9)`,
  );
  check("a section on a Hub project still inserts", err === null, err?.slice(0, 80));

  const e2 = await tryIt(
    `insert into project_tasks (project_id, name, estimate_hours, logged_hours,
       status, owner, sort_order) values ('prj-1','Legacy task',1,0,'NOT STARTED','Ex',1)`,
  );
  check("a task on a Hub project still inserts", e2 === null, e2?.slice(0, 80));

  const { rows } = await db.query(
    `select count(*)::int as n from project_tasks where project_id = 'prj-1'`,
  );
  check("it reads back through the rewritten read policy", rows[0].n === 1, `${rows[0].n} rows`);
});

console.log("\nDeleting the project takes its board with it:\n");
{
  await db.query(`delete from time.project where id = 1`);
  const { rows } = await db.query(
    `select count(*)::int as n from project_tasks where time_project_id = 1`,
  );
  check("tasks cascade with the TrackingTime project", rows[0].n === 0, `${rows[0].n} left`);
}


console.log("");
console.log("The wiring — this feature's original defect was being reachable from nowhere:");
console.log("");
{
  const detail = readFileSync("src/app/(app)/projects/[id]/page.tsx", "utf8");
  check("the project page mounts TasksSection", detail.includes("<TasksSection"));
  check(
    "it passes a time_project_id parent, not a Hub one",
    detail.includes(`field: "time_project_id"`),
  );
  check("it reads the board", detail.includes("getTimeProjectBoard"));

  // Every component below TasksSection, and the actions they post to. Each was
  // orphaned before this change: written, working, and imported by nothing.
  const src = [
    "TasksSection", "AddTaskForm", "TaskListView", "TaskBoardView", "TaskRow",
  ];
  const all = src
    .map((n) => readFileSync(`src/app/(app)/projects/${n}.tsx`, "utf8"))
    .join(" ") + detail;
  for (const n of src.slice(1)) {
    check(`${n} is imported by something`, all.includes(`from "./${n}"`));
  }

  const actions = readFileSync("src/app/(app)/projects/actions.ts", "utf8");
  check(
    "the write path accepts either parent",
    actions.includes("time_project_id") && actions.includes("readParent"),
  );
  check(
    "negative control: a page without the mount WOULD be caught",
    !"<div>nothing here</div>".includes("<TasksSection"),
  );
}
console.log(
  failed
    ? "\nTASK BOARD PARENTS: the board cannot safely attach to a real project\n"
    : "\nTASK BOARD PARENTS: boards attach to real projects, and only projects:write may change them\n",
);

process.exitCode = failed ? 1 : 0;
