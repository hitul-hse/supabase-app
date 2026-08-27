// Before building a page that reads five tables, confirm what RLS lets a normal
// user see. A detail page that leaks another department's contract value would be
// a worse bug than the missing page.
// READ-ONLY.
import { readFileSync } from "node:fs";
import pg from "pg";

const env = Object.fromEntries(
  readFileSync("C:/Supabase/.env.local", "utf8").split(/\r?\n/)
    .filter((l) => l && !l.startsWith("#") && l.includes("="))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^"|"$/g, "")]; }));

const c = new pg.Client({ connectionString: env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
await c.connect();
const q = async (label, sql) => {
  try { const r = await c.query(sql); console.log(`\n### ${label}`); console.table(r.rows); return r.rows; }
  catch (e) { console.log(`\n### ${label} FAILED: ${e.message}`); return null; }
};

await q("RLS state on every table the detail page would read", `
  select n.nspname as schema, c.relname as table, c.relrowsecurity as rls_enabled,
         (select count(*) from pg_policies p
           where p.schemaname = n.nspname and p.tablename = c.relname) as policies
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where (n.nspname, c.relname) in (
    ('public','projects'), ('public','people'), ('public','person_assignments'),
    ('public','project_responsibility'), ('public','project_change_request'),
    ('time','project'), ('time','service'), ('time','entry'), ('crm','legal_entity'))
  order by 1, 2`);

await q("the policies on public.projects", `
  select policyname, cmd, roles::text, left(coalesce(qual, with_check), 160) as predicate
  from pg_policies where schemaname='public' and tablename='projects'`);

await q("the policies on project_responsibility", `
  select policyname, cmd, roles::text, left(coalesce(qual, with_check), 160) as predicate
  from pg_policies where schemaname='public' and tablename='project_responsibility'`);

// crm.legal_entity carries customer names; if it has no RLS the page must not
// select from it directly under a user session.
await q("does crm.legal_entity restrict reads?", `
  select policyname, cmd, roles::text, left(coalesce(qual, with_check), 160) as predicate
  from pg_policies where schemaname='crm' and tablename='legal_entity'`);

console.log("\nREAD-ONLY: nothing was written.");
await c.end();
