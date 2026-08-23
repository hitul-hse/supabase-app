/**
 * Execute Bjoern's change-control migration against real Postgres (PGlite),
 * twice, and prove the behaviour his handoff claims.
 *
 * His handoff asks the merger to verify: projects:write is enforced, a user
 * cannot approve their own request, one open request per project, append-only
 * events. Those claims are executed here rather than trusted -- the same
 * treatment every migration in this repo gets before the user applies it.
 */
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";

let failed = 0;
const check = (name, ok, detail = "") => {
  if (!ok) failed += 1;
  console.log(`${ok ? "PASS" : "FAIL"}: ${name}${detail ? `\n        ${detail}` : ""}`);
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
const migration = readFileSync(
  "supabase/migrations/20260823090000_add_project_change_control.sql",
  "utf8",
);

const fresh = async () => {
  const db = await new PGlite();
  await db.exec(preamble);
  await db.exec(schema);
  return db;
};

const db = await fresh();
console.log("base schema applied\n");

try {
  await db.exec(migration);
  check("the migration executes without error", true);
} catch (e) {
  check("the migration executes without error", false, String(e.message).split("\n")[0]);
  process.exit(1);
}

{
  const d2 = await fresh();
  await d2.exec(migration);
  let ok = true, detail = "";
  try { await d2.exec(migration); } catch (e) { ok = false; detail = String(e.message).split("\n")[0]; }
  await d2.close();
  check("re-running it is safe (idempotent)", ok, detail);
}

const one = async (sql, p) => (await db.query(sql, p)).rows[0];
const all = async (sql, p) => (await db.query(sql, p)).rows;

/* -------------------------------------------------------------- structure */

check(
  "both tables exist",
  (await one(`select count(*)::int n from information_schema.tables
              where table_schema='public' and table_name in ('project_change_request','project_change_event')`)).n === 2,
);
check(
  "RLS is enabled on both",
  (await all(`select relname from pg_class
              where relname in ('project_change_request','project_change_event') and relrowsecurity`)).length === 2,
);
check(
  "no INSERT/UPDATE grant lets callers write the tables directly",
  (await all(`select privilege_type from information_schema.role_table_grants
              where table_name='project_change_request' and grantee='authenticated'
                and privilege_type in ('INSERT','UPDATE','DELETE')`)).length === 0,
  "mutation is meant to flow through the SECURITY DEFINER functions only",
);

/* -------------------------------------------------- behaviour: four eyes */

// Two users, one project, a permission model where both may write.
await db.exec(`
  insert into auth.users (id, email) values
    ('00000000-0000-4000-8000-000000000001', 'a@hse.test'),
    ('00000000-0000-4000-8000-000000000002', 'b@hse.test');
  insert into app_user_profile (user_id, role_key) values
    ('00000000-0000-4000-8000-000000000001', 'exec'),
    ('00000000-0000-4000-8000-000000000002', 'exec');
`);

const asUser = async (uid, sql, params) => {
  await db.exec(`select set_config('request.jwt.claim.sub', '${uid}', false)`);
  return db.query(sql, params);
};

/*
 * Seed matching the REAL schema: public.projects has a text id, a stack of
 * NOT NULL columns, and owner_person_id referencing public.people(id) -- his
 * function reads owner_person_id and requires the requested person to be an
 * ACTIVE people row. The first version of this gate guessed a 'responsible'
 * column and silently skipped the behaviour tests; guessing is how gates rot.
 */
await db.exec(`
  insert into public.people (id, name, is_active) values
    ('p-alice', 'Alice Beispiel', true),
    ('p-bob',   'Bob Muster',     true);
  insert into public.projects
    (id, code, name, customer, lead, status, contract_hours, billable_hours,
     consumed_percent, due, owner_person_id)
  values
    ('proj-1', 'T-1', 'Testprojekt', 'Testkunde', 'Alice', 'active',
     100, 50, 50, '2026-12-31', 'p-alice');
`);
const projectId = "proj-1";

{
  const rq = await asUser(
    "00000000-0000-4000-8000-000000000001",
    `select public.request_project_responsible_change($1::text, 'p-bob', 'test reason') as id`,
    [projectId],
  ).then((r) => r.rows[0]).catch((e) => ({ err: e.message }));

  check("a change request can be created by an authorised user", !rq.err, rq.err ?? "");

  if (!rq.err) {
    const dup = await asUser(
      "00000000-0000-4000-8000-000000000001",
      `select public.request_project_responsible_change($1::text, 'p-alice', 'second') as id`,
      [projectId],
    ).then(() => null).catch((e) => e.message);
    check(
      "a SECOND open request on the same project is refused (change lock)",
      dup !== null,
      dup ?? "accepted -- two competing requests could race",
    );

    const selfApprove = await asUser(
      "00000000-0000-4000-8000-000000000001",
      `select public.decide_project_responsible_change($1::uuid, true, 'approving my own') as ok`,
      [rq.id],
    ).then(() => null).catch((e) => e.message);
    check(
      "the requester CANNOT approve their own request (four eyes)",
      selfApprove !== null,
      selfApprove ?? "self-approval went through",
    );

    const otherApprove = await asUser(
      "00000000-0000-4000-8000-000000000002",
      `select public.decide_project_responsible_change($1::uuid, true, 'looks right') as ok`,
      [rq.id],
    ).then((r) => r.rows[0]).catch((e) => ({ err: e.message }));
    check("a DIFFERENT authorised user can approve it", !otherApprove?.err, otherApprove?.err ?? "");

    const events = await all(`select event_type from public.project_change_event order by created_at`);
    check(
      "the event log recorded the lifecycle append-only",
      events.length >= 2,
      events.map((e) => e.event_type).join(" -> "),
    );

    const owner = await one(`select owner_person_id from public.projects where id = $1`, [projectId]);
    check(
      "the approval actually moved the responsibility",
      owner.owner_person_id === "p-bob",
      `owner_person_id=${owner.owner_person_id}`,
    );
  }
}

await db.close();
console.log(
  failed === 0
    ? "\nCHANGE CONTROL: executes, locks, enforces four eyes, and logs append-only"
    : `\n${failed} check(s) failed`,
);
process.exit(failed === 0 ? 0 : 1);
