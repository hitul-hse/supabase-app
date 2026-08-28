// Read-only: what does Stefan's missing people row actually cost?
import pg from "pg";
import { loadEnv } from "./lib/gate-env.mjs";

const env = loadEnv();
const c = new pg.Client({ connectionString: env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
await c.connect();

const q = async (sql) => (await c.query(sql)).rows;

const [tot] = await q("select round(sum(duration_seconds)/3600.0,1) h from time.entry where started_at >= '2026-01-01'");
const [orph] = await q(`
  select round(sum(e.duration_seconds)/3600.0,1) h, count(*) n
  from time.entry e join time.member m on m.id = e.member_id
  where m.hub_person_id is null and e.started_at >= '2026-01-01'`);
const [people] = await q("select count(*) n from public.people");
const [members] = await q("select count(*) n from time.member where not is_archived");

console.log("2026 hours, all members      :", tot.h);
console.log("2026 hours, unlinked members :", orph.h, `(${orph.n} entries)`);
console.log("public.people rows           :", people.n);
console.log("active time.member rows      :", members.n);

// Which people-keyed surfaces silently omit him?
const views = await q(`
  select table_name from information_schema.views
  where table_schema = 'public' and view_definition ilike '%people%'
  order by table_name`);
console.log(`\npeople-keyed views that cannot see him (${views.length}):`);
for (const v of views) console.log("  public." + v.table_name);

await c.end();
