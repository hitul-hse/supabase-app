// Apply 20260828120000 and verify the effect, rather than assuming it landed.
import { readFileSync } from "node:fs";
import pg from "pg";
import { loadEnv } from "./lib/gate-env.mjs";

const env = loadEnv();
const c = new pg.Client({ connectionString: env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
await c.connect();

const before = await c.query(
  "select (select count(*) from public.people) p, (select count(*) from time.member where hub_person_id is null and not is_archived) u");
console.log("before: people =", before.rows[0].p, " active unlinked members =", before.rows[0].u);

const sql = readFileSync("supabase/migrations/20260828120000_external_staff_are_people.sql", "utf8");
await c.query(sql);
console.log("migration executed with no errors");

// Idempotency is a claim in the file header, so prove it.
await c.query(sql);
console.log("second execution also clean (idempotent)");

const after = await c.query(
  "select (select count(*) from public.people) p, (select count(*) from time.member where hub_person_id is null and not is_archived) u");
console.log("after : people =", after.rows[0].p, " active unlinked members =", after.rows[0].u);

const { rows: stefan } = await c.query(
  "select id, name, role, source, contract_hours, is_active from public.people where id = 'ext-stefan-goelzner'");
console.log("\nperson row:", JSON.stringify(stefan[0]));

const { rows: link } = await c.query(
  "select id, display_name, hub_person_id from time.member where id = 40");
console.log("time.member link:", JSON.stringify(link[0]));

// The hours must now be reachable through the people key.
const { rows: hrs } = await c.query(`
  select round(sum(e.duration_seconds)/3600.0,1) h, count(*) n
  from time.entry e join time.member m on m.id = e.member_id
  where m.hub_person_id = 'ext-stefan-goelzner' and e.started_at >= '2026-01-01'`);
console.log("hours now visible via people key:", hrs[0].h, `(${hrs[0].n} entries)`);

// And the RPC's own gate must accept him, since that is what blocked assignment.
const { rows: ok } = await c.query(
  "select exists (select 1 from public.people where id = 'ext-stefan-goelzner' and is_active) assignable");
console.log("passes the RPC's is-active test:", ok[0].assignable);

await c.end();
