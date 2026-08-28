// Read-only: who owns the 645.2h that no people-keyed view can see?
import pg from "pg";
import { loadEnv } from "./lib/gate-env.mjs";

const env = loadEnv();
const c = new pg.Client({ connectionString: env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
await c.connect();

const { rows } = await c.query(`
  select m.id, m.display_name, m.email, m.role, m.is_archived,
         count(*) n, round(sum(e.duration_seconds)/3600.0,1) h,
         min(e.started_at::date) first_day, max(e.started_at::date) last_day
  from time.entry e
  join time.member m on m.id = e.member_id
  where m.hub_person_id is null and e.started_at >= '2026-01-01'
  group by m.id, m.display_name, m.email, m.role, m.is_archived
  order by h desc`);

console.log(`${rows.length} unlinked member(s) with 2026 hours:\n`);
for (const r of rows) {
  console.log(`  ${String(r.h).padStart(7)}h  ${String(r.n).padStart(4)} entries  ${(r.display_name || "(no name)").padEnd(22)}`
    + ` ${(r.email || "(no email)").padEnd(36)} ${r.role}${r.is_archived ? "  ARCHIVED" : ""}`);
  console.log(`            ${r.first_day.toISOString().slice(0, 10)} .. ${r.last_day.toISOString().slice(0, 10)}`);
}

await c.end();
