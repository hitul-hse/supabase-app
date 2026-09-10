/*
 * Does 20260910120000_masterdata_sheet_warehouse.sql apply twice, keep the
 * old key where it is, and hide the sheet's fields from people who cannot
 * see the project?
 *
 * House rule: a migration runs in PGlite TWICE before anyone pastes it into
 * the Supabase SQL editor -- the failure this catches is "works once, errors
 * on re-paste". This one adds a table for the masterdata sheet's service
 * fields and one for the customer contacts (personal data), plus the new key
 * beside the old on projects.project_order.
 *
 * The world is the real one, not a stub: supabase/schema.sql (public.projects,
 * public.people, the REAL can_view_project over owner and assignments) plus the
 * customer-master foundation (stg.import_batch, projects.project_order), so the
 * policy test discriminates: the owner of a project sees its masterdata row
 * and contacts, a colleague with no claim on it does not. A policy that admits
 * everyone would fail here.
 */
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { record } from "./lib/gate-result.mjs";

const MIGRATION = "supabase/migrations/20260910120000_masterdata_sheet_warehouse.sql";
let failures = 0;
const check = (label, ok, detail = "") => {
  record(ok);
  console.log(`${ok ? "PASS" : "FAIL"}: ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures += 1;
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
const migration = readFileSync(MIGRATION, "utf8");

const fresh = async () => {
  const db = await new PGlite();
  await db.exec(preamble);
  await db.exec(schema);
  await db.exec(foundation);
  await db.exec(legalFields);
  return db;
};

/* ------------------------------------------------------------ applies, twice */
const db = await fresh();
try {
  await db.exec(migration);
  check("the migration executes on the real base schema + foundation", true);
} catch (e) {
  check("the migration executes", false, String(e.message).split("\n")[0]);
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
const all = async (sql, p) => (await db.query(sql, p)).rows;
const one = async (sql, p) => (await db.query(sql, p)).rows[0];

/* ------------------------------------------------------ shape: additive only */
const orderCols = await all(`
  select column_name, data_type, is_nullable from information_schema.columns
  where table_schema='projects' and table_name='project_order'
    and column_name in ('order_number','masterdata_key','last_seen_batch_id','last_seen_at','historical_since')
  order by column_name`);
check("project_order gained masterdata_key, last_seen_batch_id, last_seen_at, historical_since", orderCols.length === 5, orderCols.map((c) => c.column_name).join(", "));
check("project_order.order_number is untouched (still NOT NULL text = the old key)", orderCols.some((c) => c.column_name === "order_number" && c.is_nullable === "NO" && c.data_type === "text"));
check("the new columns are nullable — nothing is fabricated for existing rows", orderCols.filter((c) => c.column_name !== "order_number").every((c) => c.is_nullable === "YES"));
const oldUnique = await one(`select count(*)::int n from pg_constraint where conrelid='projects.project_order'::regclass and conname='project_order_number_key'`);
check("the old key's UNIQUE (project_order_number_key) still stands", oldUnique.n === 1);

const md = await all(`select column_name, data_type, is_nullable from information_schema.columns where table_schema='public' and table_name='project_masterdata' order by ordinal_position`);
const mdNames = md.map((c) => c.column_name);
check("public.project_masterdata exists with the sheet's fields", ["project_id", "masterdata_key", "order_number_old", "customer_number", "language", "contract_start", "contract_end", "responsible_person_id", "replacement_person_id", "responsible_kind", "travel_flat_rate", "file_storage", "lifecycle_status", "historical_since", "last_seen_batch_id", "last_seen_at"].every((c) => mdNames.includes(c)), `${mdNames.length} columns`);
check("no commercial hours column rides on project_masterdata (contract_hours stays on public.projects under redaction)", !mdNames.some((c) => /hours/.test(c)));
check("contract_start / contract_end are real dates, not text", md.filter((c) => /^contract_(start|end)$/.test(c.column_name)).every((c) => c.data_type === "date"));
const contact = await all(`select column_name from information_schema.columns where table_schema='public' and table_name='project_contact' order by ordinal_position`);
check("public.project_contact exists with exactly name, phone, email per slot", ["project_id", "slot", "name", "phone", "email"].every((c) => contact.some((x) => x.column_name === c)) && !contact.some((x) => /notes|address|salutation/.test(x.column_name)), contact.map((c) => c.column_name).join(", "));

/* ------------------------------------------------------ constraints bite */
await db.exec(`
  insert into public.people (id, name) values ('md-owner', 'Owner'), ('md-other', 'Other');
  -- schema.sql still carries the NOT NULLs that 20260826120000 later relaxed; supply them.
  insert into public.projects (id, code, name, customer, lead, status, contract_hours, billable_hours, consumed_percent, due, owner_person_id)
    values ('10110_00358_104_01', '10110_00358_104_01', 'Owned order', 'Kunde A', 'Owner', 'NORMAL', 10, 0, 0, 'n/a', 'md-owner'),
           ('10234_00103_104_01', '10234_00103_104_01', 'Someone else''s order', 'Kunde B', 'Other', 'NORMAL', 10, 0, 0, 'n/a', 'md-other');
`);
const rejects = async (label, sql) => {
  let rejected = false;
  try { await db.exec(sql); } catch { rejected = true; }
  check(label, rejected);
};
await rejects("a customer number that is not five digits is rejected", `insert into public.project_masterdata (project_id, masterdata_key, customer_number) values ('10110_00358_104_01', 'k1', '1011')`);
await rejects("a language other than 1 or 2 is rejected", `insert into public.project_masterdata (project_id, masterdata_key, customer_number, language) values ('10110_00358_104_01', 'k1', '10110', 3)`);
await rejects("a lifecycle_status outside active/historical is rejected", `insert into public.project_masterdata (project_id, masterdata_key, customer_number, lifecycle_status) values ('10110_00358_104_01', 'k1', '10110', 'deleted')`);
await rejects("a masterdata row for a project that does not exist is rejected", `insert into public.project_masterdata (project_id, masterdata_key, customer_number) values ('99999_00001_1000.1_01', 'k9', '99999')`);
await db.exec(`insert into public.project_masterdata (project_id, masterdata_key, order_number_old, customer_number, language, contract_end)
               values ('10110_00358_104_01', '10110_00358_1001.1_01', '10110_00358_104_01', '10110', 1, '2027-12-31')`);
await rejects("the same masterdata_key cannot be given to a second project", `insert into public.project_masterdata (project_id, masterdata_key, customer_number) values ('10234_00103_104_01', '10110_00358_1001.1_01', '10234')`);
await db.exec(`insert into public.project_masterdata (project_id, masterdata_key, customer_number) values ('10234_00103_104_01', '10234_00103_1001.1_01', '10234')`);
await db.exec(`insert into public.project_contact (project_id, slot, name, phone, email) values ('10110_00358_104_01', 1, 'Kontakt Eins', '+49 30 1', 'k1@example.com'), ('10234_00103_104_01', 1, 'Kontakt Zwei', null, null)`);
await rejects("a third contact slot is rejected", `insert into public.project_contact (project_id, slot, name) values ('10110_00358_104_01', 3, 'x')`);
await db.exec(`update projects.project_order set masterdata_key = null where false`); // column usable
await db.exec(`insert into projects.project_order (order_number, masterdata_key) values ('10110_00358_104_01', '10110_00358_1001.1_01')`);
await rejects("project_order cannot hold the same masterdata_key twice", `insert into projects.project_order (order_number, masterdata_key) values ('10111_00001_104_01', '10110_00358_1001.1_01')`);
await db.exec(`insert into projects.project_order (order_number) values ('10111_00001_104_01'), ('10112_00002_104_01')`);
check("many project_order rows may have no masterdata_key yet (partial unique)", (await one(`select count(*)::int n from projects.project_order where masterdata_key is null`)).n === 2);

/* ------------------------------------------------------ the policy excludes */
for (const t of ["project_masterdata", "project_contact"]) {
  const rls = await one(`select relrowsecurity from pg_class where oid = 'public.${t}'::regclass`);
  check(`${t}: row level security is enabled`, rls.relrowsecurity === true);
  const anonGrants = await all(`select privilege_type from information_schema.role_table_grants where table_schema='public' and table_name=$1 and grantee='anon'`, [t]);
  check(`${t}: anon holds no grant`, anonGrants.length === 0, anonGrants.map((g) => g.privilege_type).join(","));
  const authGrants = await all(`select privilege_type from information_schema.role_table_grants where table_schema='public' and table_name=$1 and grantee='authenticated'`, [t]);
  check(`${t}: authenticated holds exactly SELECT`, authGrants.length === 1 && authGrants[0].privilege_type === "SELECT", authGrants.map((g) => g.privilege_type).join(","));
  const svc = await all(`select privilege_type from information_schema.role_table_grants where table_schema='public' and table_name=$1 and grantee='service_role'`, [t]);
  check(`${t}: service_role can write (the promote script's path)`, ["INSERT", "UPDATE", "DELETE", "SELECT"].every((p) => svc.some((g) => g.privilege_type === p)));
}
// Behavioural: the owner of 10110 sees their row; the other project's row is invisible to them.
await db.exec(`insert into auth.users (id, email) values ('11111111-1111-1111-1111-111111111111', 'owner@example.com');
               insert into public.app_user_profile (user_id, person_id, role_key, department, is_active) values ('11111111-1111-1111-1111-111111111111', 'md-owner', 'employee', 'OPERATIONS', true)`);
await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', false);`);
const seenMd = (await all(`select project_id from public.project_masterdata order by 1`)).map((r) => r.project_id);
const seenContacts = (await all(`select project_id from public.project_contact order by 1`)).map((r) => r.project_id);
await db.exec(`reset role`);
check("an employee sees the masterdata row of the project they own", seenMd.includes("10110_00358_104_01"), seenMd.join(", ") || "(none)");
check("and NOT the masterdata row of a project they have no claim on", !seenMd.includes("10234_00103_104_01"), seenMd.join(", "));
check("contacts follow the same rule: own project yes", seenContacts.includes("10110_00358_104_01"), seenContacts.join(", ") || "(none)");
check("contacts of another project are invisible", !seenContacts.includes("10234_00103_104_01"), seenContacts.join(", "));
const asService = await one(`select (select count(*)::int from public.project_masterdata) md, (select count(*)::int from public.project_contact) c`);
check("service role (bypassrls) sees every row — the fixture is real", asService.md === 2 && asService.c === 2, `${asService.md} / ${asService.c}`);

/* ------------------------------------------------------ neighbours untouched */
const foundationTables = await one(`select count(*)::int n from information_schema.tables where table_schema in ('crm','projects','stg') and table_type='BASE TABLE'`);
check("no new table in crm/projects/stg (the foundation gate's 17 still hold)", foundationTables.n === 17, `${foundationTables.n}`);
const projectsCols = await one(`select count(*)::int n from information_schema.columns where table_schema='public' and table_name='projects'`);
const before = await fresh();
const projectsColsBefore = (await before.query(`select count(*)::int n from information_schema.columns where table_schema='public' and table_name='projects'`)).rows[0];
await before.close();
check("public.projects gained no column", projectsCols.n === projectsColsBefore.n, `${projectsColsBefore.n} before, ${projectsCols.n} after`);
const views = await all(`select table_name from information_schema.views where table_schema in ('public','projects') and table_name like '%masterdata%'`);
check("no view was added that would need the invoker allowlist", views.length === 0);

console.log(failures ? `FAIL (${failures})` : "PASS");
process.exit(failures ? 1 : 0);
