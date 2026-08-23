/**
 * Execute Bjoern's customer-master foundation migration (crm/projects/stg
 * schemas) against real Postgres, twice, and check the security claims that
 * were the reason we held it back.
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
const foundation = readFileSync("supabase/migrations/20260822130000_create_customer_master_foundation.sql", "utf8");
const legalFields = readFileSync("supabase/migrations/20260822140000_add_customer_master_legal_entity_fields.sql", "utf8");

const fresh = async () => {
  const db = await new PGlite();
  await db.exec(preamble);
  await db.exec(schema);
  return db;
};

const db = await fresh();
console.log("base schema applied\n");

try {
  await db.exec(foundation);
  check("the foundation migration executes without error", true);
  await db.exec(legalFields);
  check("the legal-entity fields follow-up executes", true);
} catch (e) {
  check("the migrations execute", false, String(e.message).split("\n")[0]);
  process.exit(1);
}

{
  const d2 = await fresh();
  await d2.exec(foundation);
  await d2.exec(legalFields);
  let ok = true, detail = "";
  try { await d2.exec(foundation); await d2.exec(legalFields); }
  catch (e) { ok = false; detail = String(e.message).split("\n")[0]; }
  await d2.close();
  check("re-running both is safe (idempotent)", ok, detail);
}

const all = async (sql, p) => (await db.query(sql, p)).rows;
const one = async (sql, p) => (await db.query(sql, p)).rows[0];

/* --------------------------- the security review this was held back for */

const tables = await all(`
  select table_schema, table_name from information_schema.tables
  where table_schema in ('crm','projects','stg') and table_type='BASE TABLE'
  order by 1,2
`);
check("all 17 customer-master tables exist", tables.length === 17, `${tables.length} found`);

const noRls = await all(`
  select n.nspname||'.'||c.relname as t from pg_class c
  join pg_namespace n on n.oid=c.relnamespace
  where n.nspname in ('crm','projects','stg') and c.relkind='r' and not c.relrowsecurity
`);
check("RLS is enabled on EVERY table", noRls.length === 0, noRls.map((r) => r.t).join(", ") || "");

const policies = await all(`
  select schemaname, tablename, policyname, qual from pg_policies
  where schemaname in ('crm','projects','stg')
`);
check(
  "crm and projects tables carry the exec-only policy",
  policies.filter((p) => p.policyname === "customer master exec access").length === 15, // 17 tables minus the 2 stg tables, which get NO authenticated policy
  `${policies.length} policies total`,
);
check(
  "the policy really gates on the exec role",
  policies.every((p) => /app_user_role\(\)\s*=\s*'exec'/.test(String(p.qual))),
);

// stg must have NO authenticated path at all: staging is importer-only.
const stgPolicies = policies.filter((p) => p.schemaname === "stg");
const stgGrants = await all(`
  select table_name, privilege_type from information_schema.role_table_grants
  where table_schema='stg' and grantee='authenticated'
`);
check(
  "stg has no policies and no authenticated grants (importer-only, via direct pg)",
  stgPolicies.length === 0 && stgGrants.length === 0,
  `${stgPolicies.length} policies, ${stgGrants.length} grants`,
);

const anonGrants = await all(`
  select table_schema, table_name from information_schema.role_table_grants
  where table_schema in ('crm','projects','stg') and grantee='anon'
`);
check("anon has no access anywhere", anonGrants.length === 0);

// The key join his read models need: order_number -> legal entity.
const cols = (await all(`
  select column_name from information_schema.columns
  where table_schema='projects' and table_name='project_order'
`)).map((r) => r.column_name);
check(
  "projects.project_order carries order_number and legal_entity_id",
  cols.includes("order_number") && cols.includes("legal_entity_id"),
  cols.join(", "),
);

await db.close();
console.log(
  failed === 0
    ? "\nCUSTOMER MASTER FOUNDATION: executes, idempotent, exec-only, staging locked down"
    : `\n${failed} check(s) failed`,
);
process.exit(failed === 0 ? 0 : 1);
