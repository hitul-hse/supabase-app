import { readFileSync } from "node:fs";
import pg from "pg";

const env = Object.fromEntries(
  readFileSync("C:/Supabase/.env.local", "utf8").split(/\r?\n/)
    .filter((l) => l && !l.startsWith("#") && l.includes("="))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^"|"$/g, "")]; }));

const c = new pg.Client({ connectionString: env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
await c.connect();

const q = async (label, sql) => {
  const r = await c.query(sql);
  console.log(`\n### ${label}`);
  console.table(r.rows);
};

await q("nullability of the hour columns", `
  select column_name, is_nullable, column_default
    from information_schema.columns
   where table_schema='public' and table_name='projects'
     and column_name in ('status','consumed_percent','logged_hours','billable_hours','remaining_hours','contract_hours')
   order by column_name`);

await q("CHECK constraints on public.projects", `
  select conname, pg_get_constraintdef(oid) as def
    from pg_constraint
   where conrelid='public.projects'::regclass and contype='c'`);

await q("what status values exist today", `
  select status, count(*) from public.projects group by status order by 2 desc`);

await q("the shape of the lie: contract>0 and logged=0", `
  select
    count(*) as total,
    count(*) filter (where logged_hours = 0) as logged_zero,
    count(*) filter (where logged_hours = 0 and contract_hours > 0) as zero_with_contract,
    coalesce(sum(contract_hours) filter (where logged_hours = 0 and contract_hours > 0), 0) as contract_hours_at_stake,
    count(*) filter (where logged_hours is null) as logged_null
  from public.projects`);

await c.end();
console.log("\nREAD-ONLY.");
