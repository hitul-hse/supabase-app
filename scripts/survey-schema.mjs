// Survey the live schema: which tables exist, how they link, and where the
// masterdata -> customer/project/person joins actually land.
import { readFileSync } from "node:fs";
import pg from "pg";

const env = Object.fromEntries(
  readFileSync("C:/Supabase/.env.local", "utf8")
    .split(/\r?\n/)
    .filter((l) => l && !l.startsWith("#") && l.includes("="))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^"|"$/g, "")];
    }),
);

const client = new pg.Client({
  connectionString: env.SUPABASE_DB_URL,
  ssl: { rejectUnauthorized: false },
});
await client.connect();

const q = async (label, sql) => {
  try {
    const r = await client.query(sql);
    console.log(`\n=== ${label} (${r.rows.length}) ===`);
    console.log(JSON.stringify(r.rows, null, 1).slice(0, 3000));
  } catch (e) {
    console.log(`\n=== ${label} FAILED: ${e.message}`);
  }
};

await q("schemas", `select nspname from pg_namespace where nspname not like 'pg_%' and nspname not in ('information_schema') order by 1`);

await q("tables by schema", `
  select table_schema, table_name
  from information_schema.tables
  where table_schema in ('public','time','hr','crm','masterdata','customer_master','ops')
    and table_type='BASE TABLE'
  order by 1,2`);

await client.end();
