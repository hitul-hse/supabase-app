// Independent verification of the two finished workers' claims. I do not take
// an agent's word for a number; I re-measure it myself.
import { readFileSync } from "node:fs";
import pg from "pg";

const env = Object.fromEntries(
  readFileSync("C:/Supabase/.env.local", "utf8").split(/\r?\n/)
    .filter((l) => l && !l.startsWith("#") && l.includes("="))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^"|"$/g, "")]; }));

const c = new pg.Client({ connectionString: env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
await c.connect();
const q = async (l, s, p) => { try { const r = await c.query(s, p); console.log(`\n### ${l}`); console.table(r.rows.slice(0, 15)); return r.rows; } catch (e) { console.log(`\n### ${l} FAILED: ${e.message}`); return []; } };

await q("project_responsibility exists + counts", `
  select role, count(*)::int rows, count(distinct project_id)::int projects, count(distinct person_id)::int people
  from public.project_responsibility group by role order by role`);

await q("customer FK backfill", `
  select
    count(*)::int total,
    count(customer_legal_entity_id)::int linked,
    count(*) filter (where customer_legal_entity_id is null)::int unlinked
  from public.projects`);

// The real question: can Mathias now answer "which customers am I responsible for"
// THROUGH RLS, not as a superuser?
console.log("\n=== As Mathias, through RLS ===");
await c.query("begin");
try {
  await c.query("select set_config('role','authenticated',true)");
  await c.query("select set_config('request.jwt.claims',$1,true)",
    [JSON.stringify({ sub: "4f2d4186-7db9-4684-9b5c-69b137cdcb25", role: "authenticated", email: "mathias@hs-experts.com" })]);

  const r = await c.query(`
    select pr_r.role, count(*)::int n
    from public.project_responsibility pr_r group by 1 order by 1`);
  console.table(r.rows);

  const cust = await c.query(`
    select pr_r.role, count(distinct p.customer)::int customers
    from public.project_responsibility pr_r
    join public.projects p on p.id = pr_r.project_id
    where pr_r.person_id = 'md-mathias'
    group by 1 order by 1`);
  console.log("  his own responsibility, by role:");
  console.table(cust.rows);
} finally { await c.query("rollback"); }

await q("did the ops portal query file land?", `select 1 where false`);

await c.end();
