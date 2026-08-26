/*
 * Found while diagnosing 64 "unlawful" TT links: two orders carry a NAME that
 * belongs to a different customer entirely.
 *
 *   10234_00103_104_01  customer "Netto ApS & Co. KG"      name "Mirantis Safety Engineer 2026/2027"
 *   10738_00319_104_01  customer "Unity Technologies GmbH"  name "Intel GmbH / SiFa"
 *
 * The Lexware prefix (10234 = Netto, 10738 = Unity) agrees with the CUSTOMER, so
 * the TrackingTime link is correct and the project NAME is the corrupted field --
 * almost certainly an off-by-one row shift while reading the workbook.
 *
 * This matters: 398h of Netto's work displays under a Mirantis order name. Anyone
 * reading the projects ledger sees the wrong client against real billable hours.
 *
 * This script quantifies the blast radius: how many of the 231 orders carry a name
 * whose leading company word cannot be reconciled with their own customer field.
 *
 * READ-ONLY.
 */
import { readFileSync } from "node:fs";
import pg from "pg";

const env = Object.fromEntries(
  readFileSync("C:/Supabase/.env.local", "utf8").split(/\r?\n/)
    .filter((l) => l && !l.startsWith("#") && l.includes("="))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^"|"$/g, "")]; }));

const c = new pg.Client({ connectionString: env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
await c.connect();

const { rows } = await c.query(`
  select p.id, p.name, p.customer, p.contract_hours, p.logged_hours,
         le.legal_name
    from public.projects p
    left join crm.legal_entity le on le.id = p.customer_legal_entity_id
   order by p.id`);

// Deliberately crude and generous: strip the order-number prefix the names
// sometimes carry, then compare significant words. The goal is to find names
// that share NOTHING with their customer, not to score similarity.
const stop = new Set(["gmbh", "co", "kg", "ag", "ug", "ohg", "inc", "llp", "ev", "mbh",
  "und", "der", "die", "das", "the", "and", "für", "fur", "de", "sl", "sa", "bv", "ltd",
  "sifa", "sifa&ba", "ba", "gu", "gbu", "bsb", "kk", "sigeko", "safety", "engineer",
  "sicherheitstechnische", "betreuung", "support", "basic", "instruction", "risk",
  "assessment", "occupational", "health", "grundunterweisung", "arbeitsschutz",
  "dguv", "v2", "technical", "supervision", "related", "im", "monat", "stunden"]);

const words = (s) => new Set(String(s ?? "")
  .toLowerCase()
  .replace(/^\d{5}_/, "")           // leading Lexware number
  .replace(/\d{2,4}\s*\/\s*\d{2,4}/g, " ")  // 25/26, 2025/2026
  .replace(/[^a-zäöüß\s]/g, " ")
  .split(/\s+/)
  .filter((w) => w.length > 2 && !stop.has(w)));

const conflicts = [];
for (const r of rows) {
  const nw = words(r.name);
  const cw = new Set([...words(r.customer), ...words(r.legal_name)]);
  if (nw.size === 0 || cw.size === 0) continue;      // nothing to judge on
  const shared = [...nw].filter((w) => cw.has(w));
  // Also accept a shared prefix of >=4 chars, so "Mbition"/"MBition GmbH" and
  // "CreativeDock"/"Creative Dock" are not reported as conflicts.
  const prefixMatch = [...nw].some((a) => [...cw].some((b) =>
    a.slice(0, 4) === b.slice(0, 4) || a.includes(b) || b.includes(a)));
  if (shared.length === 0 && !prefixMatch) conflicts.push({ ...r, nw: [...nw], cw: [...cw] });
}

console.log(`orders examined: ${rows.length}`);
console.log(`orders whose NAME shares no company word with their own CUSTOMER: ${conflicts.length}\n`);

for (const k of conflicts) {
  const logged = k.logged_hours == null ? "null" : `${k.logged_hours}h`;
  console.log("=".repeat(78));
  console.log(`${k.id}`);
  console.log(`  name      ${JSON.stringify(k.name)}`);
  console.log(`  customer  ${JSON.stringify(k.customer)}`);
  console.log(`  crm entity ${JSON.stringify(k.legal_name)}`);
  console.log(`  contract ${k.contract_hours}h   logged ${logged}`);
  console.log(`  name words ${JSON.stringify(k.nw)}`);
  console.log(`  cust words ${JSON.stringify(k.cw)}`);
  // Does another order in the book legitimately own this name? That is the
  // signature of a row shift rather than a typo.
  const owner = rows.filter((o) => o.id !== k.id && [...words(o.customer)].some((w) => k.nw.includes(w)));
  if (owner.length) {
    console.log(`  this name's words belong to ${owner.length} other order(s), e.g.:`);
    for (const o of owner.slice(0, 3)) console.log(`     ${o.id}  cust=${JSON.stringify(o.customer)}  name=${JSON.stringify(o.name)}`);
  }
}

await c.end();
console.log("\nREAD-ONLY: nothing was written.");
