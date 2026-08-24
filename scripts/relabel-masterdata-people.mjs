/*
 * Relabel the nine masterdata people rows: source 'seed' -> 'masterdata'.
 *
 * The import wrote 'seed' against its own documented contract (fixed in
 * import-masterdata-projects.mjs), so these real colleagues were tagged as
 * mockup fiction. Every gate that reasons about "the mockup people rows" swept
 * them in, and check-people-live-source could not tell a real link from a
 * dangerous one.
 *
 * SCOPED BY THE ID PREFIX THE IMPORT ITSELF ASSIGNS ('md-'), not by name, not
 * by is_active. The eight emp-* rows keep source='seed' -- they ARE seed
 * fiction (uniform 40h, invented employee numbers), kept only because
 * timesheet foreign keys lock them.
 *
 * Idempotent.
 */
import pg from "pg";
import { readFileSync } from "node:fs";

for (const line of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
  const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}

const client = new pg.Client({
  connectionString: process.env.SUPABASE_DB_URL,
  ssl: { rejectUnauthorized: false },
});
await client.connect();

const before = await client.query(
  "select source, count(*)::int n from public.people group by source order by source"
);
console.log("before:", JSON.stringify(before.rows));

const updated = await client.query(
  `update public.people
      set source = 'masterdata'
    where id like 'md-%'
      and source <> 'masterdata'
    returning id, name`
);
for (const row of updated.rows) console.log(`relabelled ${row.id} (${row.name})`);

const after = await client.query(
  "select source, count(*)::int n from public.people group by source order by source"
);
console.log("after: ", JSON.stringify(after.rows));

// Post-conditions: the two populations are now distinguishable, and every
// linked profile/member points at a masterdata row rather than a seed row.
const seedLinked = await client.query(`
  select p.user_id, p.person_id
    from public.app_user_profile p
    join public.people pe on pe.id = p.person_id
   where pe.source = 'seed'`);
if (seedLinked.rowCount > 0) {
  throw new Error(`${seedLinked.rowCount} profile(s) linked to a seed person: ${JSON.stringify(seedLinked.rows)}`);
}
const memberSeedLinked = await client.query(`
  select m.email, m.hub_person_id
    from time.member m
    join public.people pe on pe.id = m.hub_person_id
   where pe.source = 'seed'`);
if (memberSeedLinked.rowCount > 0) {
  throw new Error(`${memberSeedLinked.rowCount} member(s) linked to a seed person`);
}
console.log(`\n${updated.rowCount} row(s) relabelled; no profile or member points at a seed person.`);

await client.end();
