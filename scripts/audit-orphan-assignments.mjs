// The 8 person_assignments rows with NULL project_id: identify them and see
// whether project_name resolves to a real project, so they can be repaired
// rather than silently excluded from every per-person roll-up.
import { readFileSync } from "node:fs";
import pg from "pg";

const env = Object.fromEntries(
  readFileSync("C:/Supabase/.env.local", "utf8").split(/\r?\n/)
    .filter((l) => l && !l.startsWith("#") && l.includes("="))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^"|"$/g, "")]; }));

const c = new pg.Client({ connectionString: env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
await c.connect();

const orphans = await c.query(`
  select pa.id, pa.person_id, pe.name person_name, pa.project_name, pa.logged_hours
  from public.person_assignments pa
  left join public.people pe on pe.id = pa.person_id
  where pa.project_id is null
  order by pa.person_id`);

console.log(`\n### person_assignments with NULL project_id: ${orphans.rows.length}`);
console.table(orphans.rows);

console.log("\n### can project_name be resolved to a project?");
for (const r of orphans.rows) {
  const exact = await c.query(
    `select id, name from public.projects where lower(btrim(name)) = lower(btrim($1))`, [r.project_name]);
  const fuzzy = exact.rows.length ? [] : (await c.query(
    `select id, name from public.projects where name ilike '%' || $1 || '%' limit 4`,
    [String(r.project_name ?? "").slice(0, 28)])).rows;

  const verdict = exact.rows.length === 1 ? `EXACT -> ${exact.rows[0].id}`
    : exact.rows.length > 1 ? `AMBIGUOUS (${exact.rows.length} exact matches)`
    : fuzzy.length ? `NO EXACT; near: ${fuzzy.map((f) => f.id).join(", ")}`
    : "NO MATCH AT ALL";
  console.log(`  id=${r.id} person=${r.person_name ?? r.person_id} name=${JSON.stringify(r.project_name)}\n      ${verdict}`);
}

await c.end();
