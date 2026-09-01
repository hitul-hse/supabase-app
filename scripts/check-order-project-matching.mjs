// Gate: every live workbook order must reach exactly one public.projects row.
//
// report-masterdata-responsibility.mjs already COUNTS the outcome but never
// names the rows, so the failures have stayed abstract and unfixable. This names
// them and fails if the count grows.
//
// It reads the SAME seven sheets the importer reads
// (import-masterdata-projects.mjs:89-97) and detects columns the same way
// (header row, `order name` or `project name`). That matters: scanning every
// sheet instead sweeps in the Archiv / Archiv Closed history and the
// "Overview of all" sheet whose Project Name column holds hour figures, which
// produces a large, meaningless failure count. The gate must measure the live
// order set the importer actually acts on.
//
// ADR-001: matching is by EXACT normalised name only, never similarity. A
// renamed project must be relinked deliberately.
//
// READ-ONLY.
import { readFileSync } from "node:fs";
import { loadEnv } from "./lib/gate-env.mjs";
import pg from "pg";
import xlsx from "xlsx";

const WB = "C:/Users/hitul/Downloads/HSE_Masterdata_Übersicht Kunden_verantwortlichkeiten_customer_responsible_2026_V2.xlsx";

// Mirrors import-masterdata-projects.mjs:89-97. Archive and overview sheets are
// deliberately excluded: they are history and aggregates, not the order book.
const ORDER_SHEETS = [
  "DGUV V2 Sifa  Safety Engeineer",
  "SiGeKo  construction coordinati",
  "Enercon SiGeKo  construction co",
  "Projekt Health & Safety Consult",
  "Brandschutzbeauftragter (Fire S",
  "DGUV V2 Betriebsarzt  Company d",
  "Reteach Trainings",
];

// Known, accepted failures, measured 2026-08-26. Tightening these must be a
// deliberate edit, which is the point of pinning them.
//
// The 2 ambiguous are genuine name collisions in public.projects: two rows named
// "Intel GmbH / SiFa" (one belonging to Unity Technologies, already flagged as a
// corrupted name) and two named literally "missing".
//
// Of the 6 unmatched, 5 carry an order number that cannot link at all: three
// `_0_2_01` and one `_0_701_01`, where the customer-number segment is empty, plus
// one literal `#N/A` left by a broken spreadsheet formula. The identity is absent
// at source, so no code change can resolve them. Exactly 1 is a genuine gap: a
// well-formed order (10443_00253_104_01, "RISE FX GmbH / 25-26 SiFa Stuttgart")
// pointing at a project the database does not have.
const KNOWN_AMBIGUOUS = 2;
const KNOWN_NO_MATCH = 6;
const KNOWN_MALFORMED = 5;

// Credentials via the shared loader (process.env first, then .env.local found by
// walking up); the old C:/Supabase/.env.local read only worked on one machine.
const env = loadEnv();

// The importer's own normaliser (import-masterdata-projects.mjs:115). Matching
// the DB the same way it was written is the point.
const norm = (s) =>
  String(s ?? "").toLowerCase().replace(/[\u200b-\u200d\ufeff]/g, "").replace(/\s+/g, " ").trim();

console.log("check-order-project-matching: does every live order reach exactly one project?\n");

let wb;
try { wb = xlsx.read(readFileSync(WB)); }
catch (e) {
  // The workbook lives outside the repo, so its absence is BLOCKED, not a pass.
  console.log(`BLOCKED: cannot read the source workbook.\n  ${e.message}\n`);
  console.log("This gate compares the workbook against the database, so without it");
  console.log("nothing can be proven. Restore the file, or update WB if it moved.");
  process.exit(2);
}

const orders = [];
const missingSheets = [];
for (const sheetName of ORDER_SHEETS) {
  const ws = wb.Sheets[sheetName];
  if (!ws) { missingSheets.push(sheetName); continue; }
  const rows = xlsx.utils.sheet_to_json(ws, { header: 1, defval: null });
  if (!rows.length) continue;
  const header = rows[0].map((h) => String(h ?? "").toLowerCase());
  const iName = header.findIndex((h) => h.includes("order name") || h.includes("project name"));
  const iOrder = header.findIndex((h) => h.includes("order-number"));
  if (iName < 0) { missingSheets.push(`${sheetName} (no name column)`); continue; }
  for (const r of rows.slice(1)) {
    const name = String(r[iName] ?? "").trim();
    if (!name || name.toLowerCase() === "order name") continue;
    orders.push({ sheet: sheetName, name, orderNo: iOrder >= 0 ? String(r[iOrder] ?? "").trim() : "" });
  }
}

const failures = [];
const check = (ok, label, detail) => {
  console.log(`${ok ? "  ok  " : " FAIL "} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures.push(label);
};

// A renamed or removed sheet silently shrinks the order set, which would make
// every other assertion here weaker without saying so.
check(missingSheets.length === 0,
  "all seven order sheets are present and carry a name column",
  missingSheets.length ? `problem with: ${missingSheets.join("; ")}` : "all found");

const c = new pg.Client({ connectionString: env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
await c.connect();
const { rows: projects } = await c.query(`select id, name, customer, status from public.projects`);
await c.end();

const byName = new Map();
for (const p of projects) {
  const k = norm(p.name);
  if (!byName.has(k)) byName.set(k, []);
  byName.get(k).push(p);
}

const matched = [];
const ambiguous = [];
const noMatch = [];
const seen = new Set();
for (const o of orders) {
  const k = norm(o.name);
  if (seen.has(k)) continue; // the same order appears on a per-person sheet too
  seen.add(k);
  const hits = byName.get(k) ?? [];
  if (hits.length === 1) matched.push({ ...o, project: hits[0] });
  else if (hits.length > 1) ambiguous.push({ ...o, hits });
  else noMatch.push(o);
}

console.log(`\n${orders.length} order rows across ${ORDER_SHEETS.length} sheets, ${seen.size} distinct names`);
console.log(`  matched 1:1 ${matched.length}   ambiguous ${ambiguous.length}   no match ${noMatch.length}\n`);

if (ambiguous.length) {
  console.log("AMBIGUOUS — one workbook name, several projects. Pick the id, or rename:");
  for (const a of ambiguous) {
    console.log(`  "${a.name}"${a.orderNo ? `  (order ${a.orderNo})` : ""}`);
    for (const h of a.hits) console.log(`      ${h.id}  cust="${h.customer}"  status=${h.status}`);
  }
  console.log("");
}

if (noMatch.length) {
  console.log("NO MATCH — the workbook names a project the database does not have:");
  for (const n of noMatch) console.log(`  "${n.name}"${n.orderNo ? `  (order ${n.orderNo})` : ""}   [${n.sheet}]`);
  console.log("");
}

check(matched.length > 0, "the matcher resolves anything at all", `${matched.length} orders reach exactly one project`);

check(ambiguous.length <= KNOWN_AMBIGUOUS,
  `ambiguous matches have not grown beyond the known ${KNOWN_AMBIGUOUS}`,
  `${ambiguous.length} names hit more than one project`);

check(noMatch.length <= KNOWN_NO_MATCH,
  `unmatched orders have not grown beyond the known ${KNOWN_NO_MATCH}`,
  `${noMatch.length} names reach no project`);

if (ambiguous.length < KNOWN_AMBIGUOUS) console.log(`  note  ambiguous SHRANK to ${ambiguous.length}; lower KNOWN_AMBIGUOUS to lock it in.`);
if (noMatch.length < KNOWN_NO_MATCH) console.log(`  note  no-match SHRANK to ${noMatch.length}; lower KNOWN_NO_MATCH to lock it in.`);

// Separate the two causes, because they need different people. A malformed
// order number cannot link no matter what the code does: the identity is absent
// at source. A well-formed number that still misses is a genuine data gap.
const MALFORMED = /^$|#n\/a|^_|_0_/i;
const malformed = noMatch.filter((n) => MALFORMED.test(n.orderNo));
const wellFormedMisses = noMatch.filter((n) => !MALFORMED.test(n.orderNo));

console.log(`\n  of the ${noMatch.length} unmatched: ${malformed.length} have a malformed order number (data entry), ${wellFormedMisses.length} are genuine gaps`);
if (wellFormedMisses.length) {
  console.log("  genuine gaps, i.e. a valid order pointing at a project that does not exist:");
  for (const n of wellFormedMisses) console.log(`    ${n.orderNo}  "${n.name}"`);
}

// This is the assertion that can actually improve: fixing a malformed order
// number in the workbook is a concrete, bounded task.
check(malformed.length <= KNOWN_MALFORMED,
  `malformed order numbers have not grown beyond the known ${KNOWN_MALFORMED}`,
  `${malformed.length} orders carry an unusable identifier at source`);

if (malformed.length < KNOWN_MALFORMED) console.log(`  note  malformed SHRANK to ${malformed.length}; lower KNOWN_MALFORMED to lock it in.`);

// Surface the underlying cause: two projects sharing a normalised name is what
// makes any match ambiguous, whether or not an order currently hits it.
const collisions = [...byName.entries()].filter(([, v]) => v.length > 1);
if (collisions.length) {
  console.log(`  note  ${collisions.length} normalised project name(s) are shared by several rows, which is what creates ambiguity:`);
  for (const [, v] of collisions) console.log(`          "${v[0].name}" -> ${v.map((p) => p.id).join(", ")}`);
}

console.log(`\n${failures.length === 0 ? "PASS" : `FAIL (${failures.length})`}`);
if (failures.length) for (const f of failures) console.log(`  - ${f}`);
process.exit(failures.length ? 1 : 0);
