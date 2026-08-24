// Two findings need grounding before anyone acts on them.
//
// 1. The permission catalogue drift: src/lib/permissions.ts declares 36 keys,
//    the DB has 29. Seven are missing. If a policy or a UI gate calls
//    app_user_has_permission('projects:contracts:read') and the row does not
//    exist, what actually happens - does it deny everyone, or is it unused?
// 2. Every route takes 3-10s. Find where the time goes: is it the DB queries,
//    or the client bundle?
import { readFileSync } from "node:fs";
import pg from "pg";

const env = Object.fromEntries(
  readFileSync("C:/Supabase/.env.local", "utf8").split(/\r?\n/)
    .filter((l) => l && !l.startsWith("#") && l.includes("="))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^"|"$/g, "")]; }));

const c = new pg.Client({ connectionString: env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
await c.connect();
const q = async (l, s, p) => { try { const r = await c.query(s, p); console.log(`\n### ${l}`); console.table(r.rows.slice(0, 20)); return r.rows; } catch (e) { console.log(`\n### ${l} FAILED: ${e.message}`); return []; } };

const MISSING = ["projects:contracts:read", "projects:contracts:write", "projects:alerts:read",
  "projects:alerts:acknowledge", "admin:profiles:read", "admin:profiles:write", "admin:entries:write"];

await q("do the 7 missing permissions appear in any RLS policy?", `
  select c.relname as table, p.polname, pg_get_expr(p.polqual, p.polrelid) as using_expr
  from pg_policy p
  join pg_class c on c.oid = p.polrelid
  where pg_get_expr(p.polqual, p.polrelid) ~ 'contracts:read|contracts:write|alerts:read|alerts:acknowledge|profiles:read|profiles:write|entries:write'
  order by 1,2`);

await q("what app_user_has_permission does with an unknown key", `
  select pg_get_functiondef(oid) def from pg_proc where proname='app_user_has_permission' limit 1`);

await q("permission catalogue: what IS in the DB", `
  select key from public.app_permission order by 1`);

await q("role -> permission counts", `
  select r.key role, count(rp.permission_key)::int perms
  from public.app_role r
  left join public.app_role_permission rp on rp.role_key = r.key
  group by 1 order by 2 desc`);

// Where does page time go? Time the heaviest real queries directly.
console.log("\n\n=== query timing (server-side, no network) ===");
const timeIt = async (label, sql) => {
  const t0 = Date.now();
  try { const r = await c.query(sql); console.log(`  ${String(Date.now() - t0).padStart(6)}ms  ${label}  (${r.rows.length} rows)`); }
  catch (e) { console.log(`  ERROR ${label}: ${e.message.slice(0, 80)}`); }
};
await timeIt("projects (all cols)", "select * from public.projects");
await timeIt("person_assignments", "select * from public.person_assignments");
await timeIt("time.entry full scan", "select count(*) from time.entry");
await timeIt("time.entry with joins", `
  select e.id, m.display_name, p.name, cu.name
  from time.entry e
  join time.member m on m.id = e.member_id
  left join time.project p on p.id = e.project_id
  left join time.customer cu on cu.id = e.customer_id
  limit 2000`);
await timeIt("week_summary view", "select * from time.week_summary limit 500");
await timeIt("member_utilisation view", "select * from time.member_utilisation");

await q("missing indexes on the hot foreign keys", `
  select c.relname as table, a.attname as column
  from pg_attribute a
  join pg_class c on c.oid = a.attrelid
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname in ('public','time')
    and a.attname in ('person_id','project_id','member_id','customer_id','owner_person_id')
    and a.attnum > 0 and not a.attisdropped
    and not exists (
      select 1 from pg_index i
      where i.indrelid = c.oid and a.attnum = any(i.indkey)
    )
  order by 1,2`);

await c.end();
