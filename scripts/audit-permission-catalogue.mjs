// Compare the LIVE permission catalogue against supabase/schema.sql.
//
// The gate scripts/check-permissions-rls.mjs does NOT read the live database:
// it loads schema.sql into PGlite (its lines ~26-46). So when it says
// "DB has 29" it means schema.sql seeds 29 rows. Production has 37 and is
// correct -- every key src/lib/permissions.ts declares is present there.
//
// That makes schema.sql, the file whose own header calls itself "the only place
// these objects are defined", the thing that is wrong. Anyone rebuilding from
// it gets a database where six live RLS policies call app_user_has_permission()
// with keys that do not exist, so contract periods, budget alerts and profile
// administration are silently unreachable.
//
// This script is the source-of-truth diff. It does not grep schema.sql -- it
// EXECUTES it into a throwaway PGlite exactly as the gate does, then diffs the
// resulting tables against live row by row. Grepping would miss a row that is
// present but has a different description or sort_order, and it was grepping
// that made the earlier reading of this drift incomplete.
//
// Read-only against production. It never writes.
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import pg from "pg";

const env = Object.fromEntries(
  readFileSync("C:/Supabase/.env.local", "utf8").split(/\r?\n/)
    .filter((l) => l && !l.startsWith("#") && l.includes("="))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^"|"$/g, "")]; }));

const lit = (v) => (v === null || v === undefined ? "null" : `'${String(v).replace(/'/g, "''")}'`);

// --- what schema.sql actually produces --------------------------------------
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
await db.exec(readFileSync("C:/Supabase/supabase/schema.sql", "utf8"));

const PERM_COLS = "permission_key, display_name, resource, action, description, module_key, sort_order";
const filePerms = (await db.query(`select ${PERM_COLS} from app_permission order by permission_key`)).rows;
const fileRoles = (await db.query(`select role_key, display_name, seniority from app_role order by role_key`)).rows;
const fileGrants = (await db.query(`select role_key, permission_key from app_role_permission order by 1,2`)).rows;
const fileModules = (await db.query(`select module_key, display_name, href, is_live, sort_order from app_module order by module_key`)).rows;
await db.close();

// --- what production actually has -------------------------------------------
const c = new pg.Client({ connectionString: env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
await c.connect();
const livePerms = (await c.query(`select ${PERM_COLS} from public.app_permission order by permission_key`)).rows;
const liveRoles = (await c.query(`select role_key, display_name, seniority from public.app_role order by role_key`)).rows;
const liveGrants = (await c.query(`select role_key, permission_key from public.app_role_permission order by 1,2`)).rows;
const liveModules = (await c.query(`select module_key, display_name, href, is_live, sort_order from public.app_module order by module_key`)).rows;
await c.end();

let drift = 0;
const head = (s) => console.log(`\n=== ${s}`);

// --- app_permission ---------------------------------------------------------
head(`app_permission — live ${livePerms.length}, schema.sql ${filePerms.length}`);
const fileByKey = new Map(filePerms.map((r) => [r.permission_key, r]));
const liveByKey = new Map(livePerms.map((r) => [r.permission_key, r]));

const permMissing = livePerms.filter((r) => !fileByKey.has(r.permission_key));
const permExtra = filePerms.filter((r) => !liveByKey.has(r.permission_key));
if (permMissing.length) {
  drift++;
  console.log(`live but MISSING from schema.sql (${permMissing.length}):`);
  for (const r of permMissing) console.log(`   ${r.permission_key}`);
  console.log("\n-- tuples to add, mirrored from live:");
  for (const r of [...permMissing].sort((a, b) => a.sort_order - b.sort_order)) {
    console.log(`  (${lit(r.permission_key)}, ${lit(r.display_name)}, ${lit(r.resource)}, ${lit(r.action)}, ${lit(r.description)}, ${lit(r.module_key)}, ${r.sort_order}),`);
  }
}
if (permExtra.length) {
  drift++;
  console.log(`\nin schema.sql but NOT live (${permExtra.length}): ${permExtra.map((r) => r.permission_key).join(", ")}`);
}

// Same key, different content. This is the class of drift a grep cannot see.
const permDiff = [];
for (const [k, l] of liveByKey) {
  const f = fileByKey.get(k);
  if (!f) continue;
  for (const col of ["display_name", "resource", "action", "description", "module_key", "sort_order"]) {
    if (String(l[col]) !== String(f[col])) permDiff.push({ key: k, col, live: l[col], schema: f[col] });
  }
}
if (permDiff.length) {
  drift++;
  console.log(`\nsame key, DIFFERENT content (${permDiff.length}):`);
  for (const d of permDiff) console.log(`   ${d.key}.${d.col}\n      live:   ${d.live}\n      schema: ${d.schema}`);
} else {
  console.log("\nshared keys: content identical.");
}

// --- app_role ---------------------------------------------------------------
head(`app_role — live ${liveRoles.length}, schema.sql ${fileRoles.length}`);
const fileRoleMap = new Map(fileRoles.map((r) => [r.role_key, r]));
const liveRoleMap = new Map(liveRoles.map((r) => [r.role_key, r]));
for (const [k, l] of liveRoleMap) {
  const f = fileRoleMap.get(k);
  if (!f) { drift++; console.log(`   MISSING from schema.sql: ${k} (${l.display_name}, seniority ${l.seniority})`); continue; }
  if (l.display_name !== f.display_name || String(l.seniority) !== String(f.seniority)) {
    drift++;
    console.log(`   DIFFERS: ${k} live=(${l.display_name}, ${l.seniority}) schema=(${f.display_name}, ${f.seniority})`);
  }
}
for (const k of fileRoleMap.keys()) if (!liveRoleMap.has(k)) { drift++; console.log(`   in schema.sql but NOT live: ${k}`); }

// --- app_role_permission ----------------------------------------------------
head(`app_role_permission — live ${liveGrants.length}, schema.sql ${fileGrants.length}`);
const pair = (g) => `${g.role_key}|${g.permission_key}`;
const fileSet = new Set(fileGrants.map(pair));
const liveSet = new Set(liveGrants.map(pair));

const grantMissing = liveGrants.filter((g) => !fileSet.has(pair(g)));
const grantExtra = fileGrants.filter((g) => !liveSet.has(pair(g)));

const perRole = (rows) => {
  const m = new Map();
  for (const g of rows) m.set(g.role_key, (m.get(g.role_key) ?? 0) + 1);
  return m;
};
const lc = perRole(liveGrants), fc = perRole(fileGrants);
for (const k of new Set([...lc.keys(), ...fc.keys()].sort())) {
  console.log(`   ${k.padEnd(16)} live ${String(lc.get(k) ?? 0).padStart(3)}   schema.sql ${String(fc.get(k) ?? 0).padStart(3)}`);
}

if (grantMissing.length) {
  drift++;
  console.log(`\nlive grants MISSING from schema.sql (${grantMissing.length}):`);
  for (const g of grantMissing) console.log(`  (${lit(g.role_key)}, ${lit(g.permission_key)}),`);
}
if (grantExtra.length) {
  drift++;
  console.log(`\ngrants in schema.sql but NOT live (${grantExtra.length}):`);
  for (const g of grantExtra) console.log(`   ${g.role_key} -> ${g.permission_key}`);
}

// Referential sanity, in both directions. A grant whose permission has no
// catalogue row is invisible in the admin Role Permissions screen: power that
// cannot be seen or revoked through the UI.
const liveCatalogue = new Set(livePerms.map((r) => r.permission_key));
const orphanLive = liveGrants.filter((g) => !liveCatalogue.has(g.permission_key));
console.log(`\nlive grants with no catalogue row: ${orphanLive.length ? orphanLive.map(pair).join(", ") : "(none)"}`);

// --- app_module -------------------------------------------------------------
// Included because app_permission.module_key points here: a permission whose
// module is absent cannot surface a portal tile, so catalogue drift and module
// drift produce the same invisible-feature symptom.
head(`app_module — live ${liveModules.length}, schema.sql ${fileModules.length}`);
const fileModMap = new Map(fileModules.map((r) => [r.module_key, r]));
const liveModMap = new Map(liveModules.map((r) => [r.module_key, r]));
for (const [k, l] of liveModMap) {
  const f = fileModMap.get(k);
  if (!f) { drift++; console.log(`   MISSING from schema.sql: ${k} (${l.display_name}, href ${l.href}, is_live ${l.is_live})`); continue; }
  for (const col of ["display_name", "href", "is_live", "sort_order"]) {
    if (String(l[col]) !== String(f[col])) { drift++; console.log(`   DIFFERS: ${k}.${col} live=${l[col]} schema=${f[col]}`); }
  }
}
for (const k of fileModMap.keys()) if (!liveModMap.has(k)) { drift++; console.log(`   in schema.sql but NOT live: ${k}`); }

// Every module_key a permission points at must exist in app_module.
const danglingModule = livePerms.filter((r) => !liveModMap.has(r.module_key));
console.log(`   live permissions pointing at a non-existent module: ${danglingModule.length ? danglingModule.map((r) => `${r.permission_key}->${r.module_key}`).join(", ") : "(none)"}`);

// --- which keys the LIVE RLS policies actually depend on ---------------------
// This is the blast radius. A policy calling app_user_has_permission('k') in a
// database rebuilt from schema.sql, where 'k' has no catalogue row and no
// grant, denies everyone -- silently, with no error, just an empty table.
const c2 = new pg.Client({ connectionString: env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
await c2.connect();
const pol = (await c2.query(`
  select n.nspname||'.'||cl.relname as tbl, p.polname,
         coalesce(pg_get_expr(p.polqual, p.polrelid), '') || ' ' ||
         coalesce(pg_get_expr(p.polwithcheck, p.polrelid), '') as expr
  from pg_policy p
  join pg_class cl on cl.oid = p.polrelid
  join pg_namespace n on n.oid = cl.relnamespace`)).rows;
await c2.end();

const usedBy = new Map();
for (const row of pol) {
  for (const m of row.expr.matchAll(/app_user_has_permission\(\s*'([^']+)'/g)) {
    if (!usedBy.has(m[1])) usedBy.set(m[1], new Set());
    usedBy.get(m[1]).add(`${row.tbl}:${row.polname}`);
  }
}
head(`permission keys used by live RLS policies (${usedBy.size})`);
const atRisk = [...usedBy.keys()].filter((k) => !fileByKey.has(k)).sort();
console.log(`   keys with NO catalogue row in schema.sql: ${atRisk.length}`);
for (const k of atRisk) {
  drift++;
  console.log(`   ${k}\n      ${[...usedBy.get(k)].sort().join("\n      ")}`);
}

// --- the code list, which is what the gate actually asserts against ----------
head("src/lib/permissions.ts");
const codeKeys = new Set([...readFileSync("C:/Supabase/src/lib/permissions.ts", "utf8")
  .matchAll(/"([a-z]+:[a-z_:]+)"/g)].map((m) => m[1]));
console.log(`   code declares ${codeKeys.size}; live ${liveCatalogue.size}; schema.sql ${fileByKey.size}`);
console.log(`   in code, not live:       ${[...codeKeys].filter((k) => !liveCatalogue.has(k)).join(", ") || "(none)"}`);
console.log(`   in code, not schema.sql: ${[...codeKeys].filter((k) => !fileByKey.has(k)).join(", ") || "(none)"}`);
console.log(`   live, not in code:       ${[...liveCatalogue].filter((k) => !codeKeys.has(k)).join(", ") || "(none)"}`);

console.log(`\n${drift === 0 ? "schema.sql matches live for app_permission / app_role / app_role_permission." : `${drift} category(ies) of drift above.`}`);

// --- the residual gate failure, and what would actually close it -------------
// Repairing schema.sql fixes the DB side and takes the gate from 2 FAILs to 1.
// The last one is NOT a schema problem, so it is reported here rather than
// papered over by leaving my_work:read_own out of schema.sql -- omitting it
// would make a rebuilt database seed the My Work tile with no permission
// attached, and app_user_modules() joins app_permission.module_key to
// app_module.module_key, so the tile would be invisible to every role
// including exec. That is the same silent-invisibility bug, moved.
//
// Two independent defects keep the gate red, and BOTH must be fixed. Neither
// file is in this script's remit (src/lib/permissions.ts and
// scripts/check-permissions-rls.mjs), so this only measures them.
head("residual gate failure (outside this script's remit)");

const OLD_RE = /"([a-z]+:[a-z_:]+)"/g;
const WIDE_RE = /"([a-z_]+:[a-z_:]+)"/g;
const permSrc = readFileSync("C:/Supabase/src/lib/permissions.ts", "utf8");
const grab = (src, re) => new Set([...src.matchAll(re)].map((m) => m[1]));

// Defect 1: the constant is genuinely absent from the code.
const declared = permSrc.includes('"my_work:read_own"');
console.log(`   1. src/lib/permissions.ts declares my_work:read_own: ${declared}`);

// Defect 2: even once added, the gate's own regex cannot see it. The first
// segment is [a-z]+, which excludes the underscore in "my_work". Every other
// key in the file has a single-word first segment, so this has never bitten.
const withConst = permSrc.replace("  // HR module", '  MY_WORK_READ_OWN:        "my_work:read_own",\n\n  // HR module');
console.log(`   2. gate regex /"([a-z]+:[a-z_:]+)"/ matches "my_work:read_own": ${/"([a-z]+:[a-z_:]+)"/.test('"my_work:read_own"')}`);
console.log(`      adding the constant alone moves the count ${grab(permSrc, OLD_RE).size} -> ${grab(withConst, OLD_RE).size} (no change)`);
console.log(`      widening to /"([a-z_]+:[a-z_:]+)"/ alone moves it ${grab(permSrc, OLD_RE).size} -> ${grab(permSrc, WIDE_RE).size} (no change)`);
console.log(`      doing BOTH moves it ${grab(permSrc, OLD_RE).size} -> ${grab(withConst, WIDE_RE).size}, matching live's ${liveCatalogue.size}`);

const overCapture = [...grab(permSrc, WIDE_RE)].filter((k) => !grab(permSrc, OLD_RE).has(k));
console.log(`      widening captures nothing unintended today: ${overCapture.length === 0} ${overCapture.length ? `(${overCapture.join(", ")})` : ""}`);

