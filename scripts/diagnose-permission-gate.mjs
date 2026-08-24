// The gate says the catalogue has 29 rows; I measured 37 as a superuser. Both
// cannot be true, so find out which connection sees what. The likely answer is
// RLS: the gate connects differently, and app_permission is row-level secured,
// so it counts only the rows ITS role can see. If so the gate is comparing a
// filtered view against the full code list and will fail forever.
import { readFileSync } from "node:fs";
import pg from "pg";

const env = Object.fromEntries(
  readFileSync("C:/Supabase/.env.local", "utf8").split(/\r?\n/)
    .filter((l) => l && !l.startsWith("#") && l.includes("="))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^"|"$/g, "")]; }));

const c = new pg.Client({ connectionString: env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
await c.connect();

console.log("as superuser:");
console.log(`   app_permission rows: ${(await c.query("select count(*)::int n from app_permission")).rows[0].n}`);

const rls = await c.query(`
  select c.relname, c.relrowsecurity, c.relforcerowsecurity
  from pg_class c join pg_namespace n on n.oid=c.relnamespace
  where n.nspname='public' and c.relname in ('app_permission','app_role','app_role_permission')`);
console.log("\nRLS posture:");
console.table(rls.rows);

const pol = await c.query(`
  select c.relname, p.polname, pg_get_expr(p.polqual,p.polrelid) q
  from pg_policy p join pg_class c on c.oid=p.polrelid
  join pg_namespace n on n.oid=c.relnamespace
  where n.nspname='public' and c.relname='app_permission'`);
console.log("\napp_permission policies:");
for (const r of pol.rows) console.log(`   ${r.polname}: ${r.q}`);

// What does the code file actually declare? The gate greps for "x:y" strings,
// which will also match anything else shaped like that.
const src = readFileSync("C:/Supabase/src/lib/permissions.ts", "utf8");
const codeKeys = [...src.matchAll(/"([a-z]+:[a-z_:]+)"/g)].map((m) => m[1]);
console.log(`\ncode keys matched by the gate's regex: ${codeKeys.length} (${new Set(codeKeys).size} unique)`);

const dbKeys = (await c.query("select permission_key from app_permission")).rows.map((r) => r.permission_key);
const dbSet = new Set(dbKeys);
const codeSet = new Set(codeKeys);
console.log(`db keys: ${dbSet.size}`);
console.log(`\nin code but NOT in db: ${[...codeSet].filter((k) => !dbSet.has(k)).join(", ") || "(none)"}`);
console.log(`in db but NOT in code: ${[...dbSet].filter((k) => !codeSet.has(k)).join(", ") || "(none)"}`);

await c.end();
