/**
 * Prove the round-2 paste file executes as ONE paste against real Postgres,
 * twice, exactly as the user will run it.
 */
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";

let failed = 0;
const check = (name, ok, detail = "") => {
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
const paste = readFileSync("supabase/APPLY-IN-SQL-EDITOR-2.sql", "utf8");

const fresh = async () => {
  const db = await new PGlite();
  await db.exec(preamble);
  await db.exec(schema);
  return db;
};

const db = await fresh();
try {
  await db.exec(paste);
  check("the combined file executes as ONE paste", true);
} catch (e) {
  check("the combined file executes as ONE paste", false, String(e.message).split("\n")[0]);
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
check(
  "all 19 tables exist (17 customer-master + 2 change-control)",
  (await one(`select count(*)::int n from information_schema.tables
              where (table_schema in ('crm','projects','stg') and table_type='BASE TABLE')
                 or (table_schema='public' and table_name in ('project_change_request','project_change_event'))`)).n === 19,
);
check(
  "the order->legal-entity join the dashboard needs is queryable",
  (await one(`select count(*)::int n from projects.project_order po
              left join crm.legal_entity le on le.id = po.legal_entity_id`)).n === 0,
  "empty but joinable — data arrives via the staging importer",
);
check(
  "the four-eyes functions exist",
  (await one(`select count(*)::int n from pg_proc where proname in
              ('request_project_responsible_change','decide_project_responsible_change')`)).n === 2,
);

await db.close();
console.log(failed === 0 ? "\nPASTE FILE 2: ready to hand over" : `\n${failed} check(s) failed`);
process.exit(failed === 0 ? 0 : 1);
