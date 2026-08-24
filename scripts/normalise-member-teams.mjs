/*
 * Normalise time.member.team to the canonical casing.
 *
 * WHAT IS AND IS NOT FIXABLE HERE. The audit found team null on 44 of 49
 * members. For the eight md-* staff I linked to people rows, their team is an
 * ORG FACT nobody has recorded -- public.people.department is null for them
 * too. Inventing it would be exactly the mock data this codebase spent weeks
 * removing, so those stay null and the org-chart editor remains the way a human
 * records them. That is Class B: genuinely absent, honestly displayed.
 *
 * What IS fixable: the live data holds both "OPERATIONS" and "Operations",
 * two spellings of one team. src/lib/teams.ts states the convention ("Values
 * are stored uppercase to match what is already in the database"), so the
 * lowercase variants are drift from hand entry. The read layer already papers
 * over it with teamKey() -- but a stored value that needs normalising on every
 * read is a latent bug: the next surface that compares team with `=` and
 * forgets teamKey silently splits one team into two.
 *
 * Only case changes. No row gains or loses a team.
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
  "select team, count(*)::int n from time.member where team is not null group by team order by team"
);
console.log("before:", JSON.stringify(before.rows));

/*
 * The canonical set, mirroring src/lib/teams.ts. A value NOT in this set is
 * left exactly as it is rather than uppercased blindly: an unknown label is a
 * question for a human, and silently rewriting it would destroy the evidence.
 */
const CANONICAL = ["ORGA", "OPERATIONS", "TECH", "HR"];

const result = await client.query(
  `update time.member
      set team = upper(team)
    where team is not null
      and team <> upper(team)
      and upper(team) = any($1::text[])
    returning email, team`,
  [CANONICAL]
);
for (const row of result.rows) console.log(`normalised ${row.email} -> ${row.team}`);

const after = await client.query(
  "select team, count(*)::int n from time.member where team is not null group by team order by team"
);
console.log("after: ", JSON.stringify(after.rows));

// Post-condition: no two stored values differ only by case.
const keys = after.rows.map((r) => r.team);
const folded = new Set(keys.map((k) => k.toUpperCase()));
if (folded.size !== keys.length) {
  throw new Error(`case-duplicate teams remain: ${keys.join(", ")}`);
}
console.log(`\n${result.rowCount} row(s) normalised; ${keys.length} distinct teams, no case duplicates.`);

await client.end();
