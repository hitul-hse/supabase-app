// Do my 8 unmatchable/ambiguous orders and sloth's 8 mis-named orders describe
// the same problem?
//
// I reached mine from the workbook side (a name that reaches zero or several
// projects). Sloth reached its eight from the database side (a project whose
// name belongs to a different customer). If they intersect, the intersection is
// the same root cause seen twice, and fixing the name fixes both symptoms.
// READ-ONLY.
import { readFileSync } from "node:fs";
import pg from "pg";

const env = Object.fromEntries(
  readFileSync("C:/Supabase/.env.local", "utf8").split(/\r?\n/)
    .filter((l) => l && !l.startsWith("#") && l.includes("="))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^"|"$/g, "")]; }));

// Sloth's eight, parsed out of its findings doc so this cannot drift from it.
const SLOTH_DOC = "docs/order-name-corruption-findings.md";
const slothIds = [...new Set(
  (readFileSync(SLOTH_DOC, "utf8").match(/\d{5}_\d{5}_\d+_\d+/g) ?? []),
)].sort();

// My four, from check-order-project-matching's ambiguous output.
const MINE_AMBIGUOUS = [
  "10747_00360_104_01", "10738_00319_104_01",
  "10110_00375_205_01", "10361_00178_205_01",
];

const inBoth = MINE_AMBIGUOUS.filter((id) => slothIds.includes(id)).sort();
const onlySloth = slothIds.filter((id) => !MINE_AMBIGUOUS.includes(id));
const onlyMine = MINE_AMBIGUOUS.filter((id) => !slothIds.includes(id));

console.log(`sloth's mis-named orders (${slothIds.length}, parsed from ${SLOTH_DOC}):`);
for (const id of slothIds) console.log(`  ${id}`);
console.log(`\nmy ambiguous orders (${MINE_AMBIGUOUS.length}):`);
for (const id of MINE_AMBIGUOUS.sort()) console.log(`  ${id}`);

console.log(`\nIN BOTH (${inBoth.length}) — the same root cause found from two directions:`);
for (const id of inBoth) console.log(`  ${id}`);
console.log(`\nonly sloth (${onlySloth.length}): ${onlySloth.join(", ") || "none"}`);
console.log(`only mine (${onlyMine.length}): ${onlyMine.join(", ") || "none"}`);

const c = new pg.Client({ connectionString: env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
await c.connect();

if (inBoth.length) {
  const { rows } = await c.query(
    `select id, name, customer, contract_hours, logged_hours, status
     from public.projects where id = any($1) order by id`, [inBoth]);
  console.log("\nThe shared rows, as stored:");
  for (const r of rows) {
    console.log(`  ${r.id}`);
    console.log(`      name     "${r.name}"`);
    console.log(`      customer "${r.customer}"`);
    console.log(`      ${r.contract_hours}h contract, ${r.logged_hours ?? "n/a"}h logged, ${r.status}`);
  }
  console.log("\n=> Renaming these fixes BOTH symptoms at once: the name stops belonging");
  console.log("   to the wrong customer (sloth's finding) AND the workbook name stops");
  console.log("   colliding, so the order matches 1:1 (mine).");
}

// The unmatchable five are a separate population: no name collision, no wrong
// customer, just no usable identity. Confirm they are absent from sloth's set.
const MY_UNMATCHABLE_CUSTOMERS = ["PBS Germany Operations GmbH", "Trinity Bet Operations Ltd", "Quantica3D"];
const { rows: absent } = await c.query(
  `select $1::text[] as looked_for,
          (select count(*) from public.projects where customer = any($1)) as found_in_db`,
  [MY_UNMATCHABLE_CUSTOMERS]);
console.log(`\nMy 5 unmatchable orders are a DIFFERENT population: their customers`);
console.log(`(${MY_UNMATCHABLE_CUSTOMERS.join(", ")}) appear in ${absent[0].found_in_db} project(s).`);
console.log("Zero means they were never imported, so they cannot be a naming problem.");

console.log("\nREAD-ONLY: nothing was written.");
await c.end();
