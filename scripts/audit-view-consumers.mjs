// Both views now compute zero for everything. The question that decides how
// urgent this is: does a user ever SEE those zeros, and does anything act on
// them? A view nobody reads is dead code; a view driving a budget alert is a
// live wrong answer.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import pg from "pg";

const walk = (dir, out = []) => {
  for (const n of readdirSync(dir)) {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) { if (!/node_modules|\.next/.test(n)) walk(p, out); }
    else out.push(p);
  }
  return out;
};

console.log("=== who reads these views in the app ===");
const files = walk("C:/Supabase/src").filter((f) => /\.(ts|tsx)$/.test(f));
for (const name of ["billable_value_by_person", "project_budget_status"]) {
  const hits = [];
  for (const f of files) {
    const s = readFileSync(f, "utf8");
    if (s.includes(name)) {
      s.split("\n").forEach((l, i) => { if (l.includes(name)) hits.push(`${f.replace("C:/Supabase/", "")}:${i + 1}  ${l.trim().slice(0, 90)}`); });
    }
  }
  console.log(`\n${name}: ${hits.length} reference(s)`);
  for (const h of hits) console.log(`   ${h}`);
}

console.log("\n=== and in scripts / SQL ===");
for (const name of ["billable_value_by_person", "project_budget_status"]) {
  const hits = [];
  for (const f of [...walk("C:/Supabase/scripts"), ...walk("C:/Supabase/supabase")].filter((f) => /\.(mjs|cjs|sql|ts)$/.test(f))) {
    const s = readFileSync(f, "utf8");
    if (s.includes(name)) hits.push(f.replace("C:/Supabase/", ""));
  }
  console.log(`${name}: ${[...new Set(hits)].join(", ") || "(none)"}`);
}

// Does anything else depend on them at the database level?
const env = Object.fromEntries(
  readFileSync("C:/Supabase/.env.local", "utf8").split(/\r?\n/)
    .filter((l) => l && !l.startsWith("#") && l.includes("="))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^"|"$/g, "")]; }));
const c = new pg.Client({ connectionString: env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
await c.connect();

const dep = await c.query(`
  select dependent_ns.nspname || '.' || dependent_view.relname as dependent,
         source_ns.nspname || '.' || source_table.relname as depends_on
  from pg_depend
  join pg_rewrite on pg_depend.objid = pg_rewrite.oid
  join pg_class as dependent_view on pg_rewrite.ev_class = dependent_view.oid
  join pg_class as source_table on pg_depend.refobjid = source_table.oid
  join pg_namespace dependent_ns on dependent_ns.oid = dependent_view.relnamespace
  join pg_namespace source_ns on source_ns.oid = source_table.relnamespace
  where source_table.relname in ('billable_value_by_person','project_budget_status','timesheet_entries')
    and dependent_view.relname <> source_table.relname
  group by 1,2 order by 2,1`);
console.log("\n=== database-level dependents ===");
console.table(dep.rows);

// The overbooking_alert table is written by something - does it use these?
const trg = await c.query(`
  select tgname, pg_get_triggerdef(oid) def
  from pg_trigger where not tgisinternal
    and tgrelid in ('public.timesheet_entries'::regclass)`);
console.log("\n=== triggers on timesheet_entries ===");
for (const r of trg.rows) console.log(`   ${r.tgname}: ${r.def.slice(0, 140)}`);

await c.end();
