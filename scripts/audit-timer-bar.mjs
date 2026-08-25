// The timer strip renders above every page. That is a deliberate choice
// (TimerBar's own comment cites Toggl), but a permanent control on every screen
// has to earn the space. Three questions, answered with data rather than taste:
//
//   1. Is anyone actually using it? If no entry in the database was ever created
//      by the timer, it is costing every user vertical space on every page for a
//      feature nobody uses.
//   2. How much room does it take, especially on a phone?
//   3. Who even can use it? TimerBarSlot returns null without a linked person,
//      so for some accounts it is invisible anyway.
import { readFileSync } from "node:fs";
import pg from "pg";

const env = Object.fromEntries(
  readFileSync("C:/Supabase/.env.local", "utf8").split(/\r?\n/)
    .filter((l) => l && !l.startsWith("#") && l.includes("="))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^"|"$/g, "")]; }));

const c = new pg.Client({ connectionString: env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
await c.connect();
const q = async (l, s) => { try { const r = await c.query(s); console.log(`\n### ${l}`); console.table(r.rows.slice(0, 15)); return r.rows; } catch (e) { console.log(`\n### ${l} FAILED: ${e.message.slice(0,110)}`); return []; } };

await q("time.entry by source_system - which ones did a human start in-app?", `
  select source_system, count(*)::int entries,
         min(started_at)::date first, max(started_at)::date last
  from time.entry group by 1 order by 2 desc`);

await q("entries that look timer-created (manual source)", `
  select id, member_id, started_at, ended_at, duration_seconds, notes
  from time.entry where source_system = 'manual' order by started_at desc limit 10`);

await q("is any timer running right now?", `
  select count(*)::int running from time.entry where ended_at is null`);

await q("how many accounts can even see the bar (need a person_id)", `
  select
    count(*)::int total_active,
    count(*) filter (where person_id is not null)::int can_see_bar,
    count(*) filter (where person_id is null)::int bar_hidden
  from public.app_user_profile where is_active`);

await c.end();
