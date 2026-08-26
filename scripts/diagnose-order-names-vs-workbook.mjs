/*
 * The corrupted order names, looked up in the SOURCE workbook.
 *
 * diagnose-order-name-customer-conflict.mjs found orders whose name belongs to a
 * different company. Declining to GUESS a replacement was right; declining to
 * READ the source was not. The workbook now sits at a known path, so the correct
 * name may simply be in it.
 *
 * Column detection is by EXACT header text, taken from the headers this workbook
 * actually declares (scripts/tmp-headers.mjs dumped them):
 *   "Order-Number"  "Customer / Kunde"  "Order Name" | "Project Name"
 *
 * A first attempt matched headers by substring and reported names like "288" and
 * "Ja" -- contract hours and a yes/no flag. That was a bug in the matcher, and
 * publishing it as a finding about the data would have been worse than not
 * looking. Hence exact names only, and a loud complaint when a sheet lacks them.
 *
 * Also note: the per-person sheets (Stephan, Thorsten, ...) repeat the header as
 * their first DATA row, so a row whose order number is literally "Order-Number"
 * is skipped.
 *
 * READ-ONLY on both sides.
 */
import { existsSync, readFileSync } from "node:fs";
import pg from "pg";
import XLSX from "xlsx";

const XL = process.env.MASTERDATA_XLSX
  ?? ".local/import/HSE_Masterdata_Übersicht Kunden_verantwortlichkeiten_customer_responsible_2026_V2.xlsx";
if (!existsSync(XL)) {
  console.error(`workbook not found: ${XL}`);
  console.error("Set MASTERDATA_XLSX, or see scripts/import-masterdata-projects.mjs.");
  process.exit(1);
}

const env = Object.fromEntries(
  readFileSync("C:/Supabase/.env.local", "utf8").split(/\r?\n/)
    .filter((l) => l && !l.startsWith("#") && l.includes("="))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^"|"$/g, "")]; }));

/* --------------------------------------------- every order name in the book */

const wb = XLSX.readFile(XL);
const byOrder = new Map();      // order number -> [{sheet, row, name, customer}]
const skipped = [];

for (const sheetName of wb.SheetNames) {
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { header: 1, defval: null });
  if (!rows.length) continue;
  const hdr = (rows[0] ?? []).map((c) => String(c ?? "").trim());

  const iOrder = hdr.indexOf("Order-Number");
  // Two spellings exist across sheets, both exact.
  const iName = hdr.indexOf("Order Name") >= 0 ? hdr.indexOf("Order Name") : hdr.indexOf("Project Name");
  const iCust = hdr.indexOf("Customer / Kunde");

  if (iOrder < 0) { skipped.push(`${sheetName} (no "Order-Number" column)`); continue; }
  if (iName < 0) { skipped.push(`${sheetName} (no "Order Name"/"Project Name" column)`); continue; }

  for (let r = 1; r < rows.length; r += 1) {
    const order = String(rows[r]?.[iOrder] ?? "").trim();
    if (!order || order === "Order-Number") continue;   // repeated header row
    if (!byOrder.has(order)) byOrder.set(order, []);
    byOrder.get(order).push({
      sheet: sheetName,
      row: r + 1,
      name: String(rows[r][iName] ?? "").trim(),
      customer: iCust >= 0 ? String(rows[r][iCust] ?? "").trim() : "",
    });
  }
}

console.log(`workbook: ${XL}`);
console.log(`order numbers found: ${byOrder.size}`);
if (skipped.length) console.log(`sheets without order+name columns: ${skipped.length}`);

/* ---------------------------------------------------------- what the DB has */

const SUSPECT = [
  "10234_00103_104_01", "10738_00319_104_01", "10110_00375_205_01",
  "10361_00178_205_01", "10305_00327_104_01", "10822_00326_203_01",
  "10151_00369_403_01", "10940_00407_401_01",
];

const c = new pg.Client({ connectionString: env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
await c.connect();
const { rows: live } = await c.query(
  `select p.id, p.name, p.customer, p.contract_hours,
          coalesce(sum(e.duration_seconds)/3600.0, 0) as hours
     from public.projects p
     left join time.project tp on tp.hub_project_id = p.id
     left join time.entry e on e.project_id = tp.id and e.started_at::date <= current_date
    where p.id = any($1::text[])
    group by p.id, p.name, p.customer, p.contract_hours
    order by 5 desc`, [SUSPECT]);
await c.end();

/* -------------------------------------------------------------- the verdict */

const norm = (s) => String(s ?? "").toLowerCase().replace(/\s+/g, " ").trim();
const words = (s) => norm(s).replace(/[^a-z0-9äöüß ]/g, " ").split(/\s+/).filter((w) => w.length > 3);

let fixable = 0;
let sourceWrong = 0;

for (const row of live) {
  const hits = byOrder.get(row.id) ?? [];
  console.log("\n" + "=".repeat(78));
  console.log(`${row.id}   ${Number(row.hours).toFixed(1)}h logged, ${row.contract_hours}h contract`);
  console.log(`  db customer     ${JSON.stringify(row.customer)}`);
  console.log(`  db name         ${JSON.stringify(row.name)}`);

  if (hits.length === 0) {
    console.log("  workbook        NOT FOUND under this order number");
    sourceWrong += 1;
    continue;
  }

  // Distinct names the workbook offers for this order.
  const names = [...new Set(hits.map((h) => h.name).filter(Boolean))];
  for (const h of hits) {
    console.log(`  [${h.sheet} r${h.row}]  name=${JSON.stringify(h.name)}  customer=${JSON.stringify(h.customer)}`);
  }

  if (names.length === 0) {
    console.log("  -> the workbook's Order Name cell is EMPTY for this order.");
    console.log("     The db name was invented somewhere else. Needs a human.");
    sourceWrong += 1;
    continue;
  }

  const differs = names.some((n) => norm(n) !== norm(row.name));
  // Does any workbook name share a significant word with the order's customer?
  const custWords = words(row.customer);
  const agreeing = names.filter((n) => {
    const nw = words(n);
    return custWords.some((w) => nw.includes(w) || norm(n).includes(w));
  });

  if (differs && agreeing.length === 1) {
    console.log(`  -> FIXABLE: the workbook says ${JSON.stringify(agreeing[0])}, which names this`);
    console.log("     order's own customer. The db row is corrupted.");
    fixable += 1;
  } else if (differs && agreeing.length > 1) {
    console.log(`  -> the workbook offers ${agreeing.length} candidate names that fit the customer:`);
    for (const a of agreeing) console.log(`       ${JSON.stringify(a)}`);
    console.log("     Ambiguous. Needs a human to pick.");
    sourceWrong += 1;
  } else if (!differs) {
    console.log("  -> the workbook holds the SAME name. The corruption is UPSTREAM, in the");
    console.log("     source data. Nothing here can fix it.");
    sourceWrong += 1;
  } else {
    console.log("  -> the workbook name differs but still does not name this customer.");
    console.log("     Needs a human.");
    sourceWrong += 1;
  }
}

console.log("\n" + "=".repeat(78));
console.log(`mechanically fixable from the workbook: ${fixable}`);
console.log(`needs a human (source wrong or absent): ${sourceWrong}`);
console.log("\nREAD-ONLY: nothing was written.");
