// I told the user 5 orders "cannot link at any price" because the identity is
// absent at source. Before that stands as a handoff instruction, check whether
// the customer number is genuinely missing or merely in a different column.
//
// If it is recoverable from the same row, my claim is wrong and the fix is code,
// not data entry. That distinction decides whether a human has to touch the
// workbook at all.
// READ-ONLY.
import { readFileSync } from "node:fs";
import pg from "pg";
import xlsx from "xlsx";

const WB = "C:/Users/hitul/Downloads/HSE_Masterdata_Übersicht Kunden_verantwortlichkeiten_customer_responsible_2026_V2.xlsx";

const TARGETS = [
  "BBH Sicherheitsteschnische Betreuung 2026",
  "PBS Neu Isenburg / company doctor 2025/2026",
  "Trinity Bet Malta / company doctor 2025/2026",
  "PBS Berlin / company doctor 2025/2026",
  "Quantica3D / Basic instruction 2025/2026",
];

const env = Object.fromEntries(
  readFileSync("C:/Supabase/.env.local", "utf8").split(/\r?\n/)
    .filter((l) => l && !l.startsWith("#") && l.includes("="))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^"|"$/g, "")]; }));

const ORDER_SHEETS = [
  "DGUV V2 Sifa  Safety Engeineer",
  "SiGeKo  construction coordinati",
  "Enercon SiGeKo  construction co",
  "Projekt Health & Safety Consult",
  "Brandschutzbeauftragter (Fire S",
  "DGUV V2 Betriebsarzt  Company d",
  "Reteach Trainings",
];

const wb = xlsx.read(readFileSync(WB));
const norm = (s) => String(s ?? "").toLowerCase().replace(/\s+/g, " ").trim();

console.log("Are the 5 'unfixable' orders really missing their identity at source?\n");

const found = [];
for (const sheetName of ORDER_SHEETS) {
  const ws = wb.Sheets[sheetName];
  if (!ws) continue;
  const rows = xlsx.utils.sheet_to_json(ws, { header: 1, defval: null });
  const header = rows[0].map((h) => String(h ?? "").toLowerCase());
  const iName = header.findIndex((h) => h.includes("order name") || h.includes("project name"));
  const iOrder = header.findIndex((h) => h.includes("order-number"));
  const iCustNo = header.findIndex((h) => h.includes("kundennummer"));
  const iCust = header.findIndex((h) => h.includes("kunde"));
  const iAB = header.findIndex((h) => h.includes("ab- nummer"));
  const iSvc = header.findIndex((h) => h.includes("service- nummer"));
  const iArt = header.findIndex((h) => h.includes("artikel- nummer"));
  const iTeil = header.findIndex((h) => h.includes("teilprojekt"));

  for (const r of rows.slice(1)) {
    const name = String(r[iName] ?? "").trim();
    if (!TARGETS.some((t) => norm(t) === norm(name))) continue;
    found.push({
      sheet: sheetName,
      name,
      orderNo: iOrder >= 0 ? String(r[iOrder] ?? "").trim() : "(no col)",
      custNo: iCustNo >= 0 ? String(r[iCustNo] ?? "").trim() : "(no col)",
      customer: iCust >= 0 ? String(r[iCust] ?? "").trim() : "(no col)",
      ab: iAB >= 0 ? String(r[iAB] ?? "").trim() : "(no col)",
      svc: iSvc >= 0 ? String(r[iSvc] ?? "").trim() : "(no col)",
      art: iArt >= 0 ? String(r[iArt] ?? "").trim() : "(no col)",
      teil: iTeil >= 0 ? String(r[iTeil] ?? "").trim() : "(no col)",
    });
  }
}

for (const f of found) {
  console.log(`--- "${f.name}"  [${f.sheet}]`);
  console.log(`      Order-Number : "${f.orderNo}"`);
  console.log(`      Kundennummer : "${f.custNo}"      Kunde: "${f.customer}"`);
  console.log(`      AB / Service / Artikel / Teilprojekt : "${f.ab}" / "${f.svc}" / "${f.art}" / "${f.teil}"`);
  // The order number is built as customer_AB_service_artikel per the id shape
  // 10443_00253_104_01. If the segments are present, the number is derivable.
  const derivable = f.custNo && f.custNo !== "(no col)" && !/^#|^$/.test(f.custNo);
  console.log(`      => customer number present? ${derivable ? "YES — the id IS derivable, my claim was wrong" : "no — genuinely absent"}`);
}

if (!found.length) console.log("Found none of the 5 by name; the column detection differs from the gate's.");

// Cross-check: does a project with that customer already exist in the DB?
const c = new pg.Client({ connectionString: env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
await c.connect();
console.log("\nDoes the database already know these customers?");
for (const f of found) {
  if (!f.customer || f.customer === "(no col)") continue;
  const { rows } = await c.query(
    `select id, name, customer from public.projects where customer ilike $1 limit 4`,
    [`%${f.customer.split(/\s+/)[0]}%`],
  );
  console.log(`  "${f.customer}" -> ${rows.length} project(s)`);
  for (const r of rows) console.log(`        ${r.id}  "${String(r.name).slice(0, 46)}"  cust="${r.customer}"`);
}
await c.end();

console.log("\nREAD-ONLY: nothing was written.");
