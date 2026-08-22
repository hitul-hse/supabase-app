/**
 * Reconcile the HSE masterdata Excel against the live portal, READ-ONLY.
 *
 * WHY. The masterdata file is where sales' truth currently lives: contract
 * hours ("Stunden laut Vertrag"), contract windows (Start Date / Delivery
 * Date) and responsibles, per order. The portal now has a place for exactly
 * that truth (time.project_contract_period), and its budget guard falls back
 * to the vendor's estimate wherever no contract is recorded. This report
 * answers, without writing anything: how much of the Excel can be attached to
 * live projects automatically, where the two disagree, and what only a human
 * can decide.
 *
 * ADR-001 GOVERNS THE MATCHING. No fuzzy auto-merge: a row either matches a
 * live project by an exact, checkable key (the TrackingTime project link's
 * name, or an exact normalised name) or it is reported for MANUAL review.
 * "Aehnlicher Name" is a review queue, not a match.
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync, writeFileSync } from "node:fs";
import * as XLSX from "xlsx";

const XL =
  "C:/Users/hitul/Downloads/HSE_Masterdata_Übersicht Kunden_verantwortlichkeiten_customer_responsible_2026_V2.xlsx";

for (const line of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
  const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  db: { schema: "time" }, auth: { persistSession: false },
});

/* ------------------------------------------------------------- the Excel */

// The service sheets carry the per-order truth. The per-person sheets repeat
// the same orders per responsible, and "Overview of all" mixes services; the
// service sheets are the cleanest cut.
const ORDER_SHEETS = [
  "DGUV V2 Sifa  Safety Engeineer",
  "SiGeKo  construction coordinati",
  "Enercon SiGeKo  construction co",
  "Projekt Health & Safety Consult",
  "Brandschutzbeauftragter (Fire S",
  "DGUV V2 Betriebsarzt  Company d",
];

const wb = XLSX.read(readFileSync(XL));

/** Excel serial date -> ISO, or null. The file mixes serials and strings. */
function xlDate(v) {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "number" && v > 20000 && v < 60000) {
    const d = new Date(Math.round((v - 25569) * 86400 * 1000));
    return d.toISOString().slice(0, 10);
  }
  const m = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(String(v).trim());
  if (m) return `${m[3]}-${m[2]}-${m[1]}`;
  return null;
}

function num(v) {
  if (v === null || v === undefined) return null;
  const n = Number(String(v).replace(",", "."));
  return Number.isFinite(n) && n > 0 ? n : null;
}

const orders = [];
for (const sheetName of ORDER_SHEETS) {
  const ws = wb.Sheets[sheetName];
  if (!ws) continue;
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null });
  const header = rows[0].map((h) => String(h ?? "").toLowerCase());
  const col = (frag) => header.findIndex((h) => h.includes(frag));
  const iOrder = col("order-number");
  const iCust = col("kunde");
  const iHours = col("stunden laut vertrag");
  const iName = header.findIndex((h) => h.includes("order name") || h.includes("project name"));
  const iStart = col("start date");
  const iEnd = col("delivery date");
  const iMain = header.findIndex((h) => h.includes("sifa") || h.includes("main contact"));
  const iRepl = col("replacement");

  for (const r of rows.slice(1)) {
    const orderNo = String(r[iOrder] ?? "").trim();
    // The sheets are padded with formula-artifact rows (_0__0); real orders
    // start with a Lexware customer number.
    if (!/^\d{5}_/.test(orderNo)) continue;
    orders.push({
      sheet: sheetName.trim(),
      orderNo,
      customer: String(r[iCust] ?? "").trim(),
      contractHours: num(r[iHours]),
      orderName: String(r[iName] ?? "").trim(),
      startsOn: xlDate(r[iStart]),
      endsOn: xlDate(r[iEnd]),
      responsible: iMain >= 0 ? String(r[iMain] ?? "").trim() : "",
      replacement: iRepl >= 0 ? String(r[iRepl] ?? "").trim() : "",
    });
  }
}
console.log(`Excel: ${orders.length} orders across ${ORDER_SHEETS.length} service sheets`);

/* ---------------------------------------------------------- live projects */

const page = async (table, select) => {
  const out = [];
  for (let f = 0; ; f += 1000) {
    const { data, error } = await db.from(table).select(select).order("id").range(f, f + 999);
    if (error) throw new Error(`${table}: ${error.message}`);
    if (!data?.length) break;
    out.push(...data);
    if (data.length < 1000) break;
  }
  return out;
};
const projects = await page("project", "id, name, estimated_hours, is_archived, customer_id");
const periods = await page("project_contract_period", "id, project_id, budget_hours, starts_on, ends_on");
console.log(`live: ${projects.length} projects, ${periods.length} contract periods recorded\n`);

/* ------------------------------------------------------------ the matching */

// Exact on a normalised name only. ADR-001: similarity is a review queue.
const norm = (s) =>
  String(s).toLowerCase()
    .replace(/[\u200b-\u200d\ufeff]/g, "") // zero-width chars (the Excel has them: "W-1\u200b3\u200b019")
    .replace(/\s+/g, " ")
    .trim();

const byName = new Map();
for (const p of projects) {
  const k = norm(p.name);
  if (!byName.has(k)) byName.set(k, []);
  byName.get(k).push(p);
}

const matched = [];
const unmatchedExcel = [];
for (const o of orders) {
  const k = norm(o.orderName);
  const hits = k ? (byName.get(k) ?? []) : [];
  if (hits.length === 1) matched.push({ o, p: hits[0] });
  else unmatchedExcel.push({ o, ambiguous: hits.length > 1 });
}

const matchedProjectIds = new Set(matched.map((m) => m.p.id));
const unmatchedLive = projects.filter((p) => !p.is_archived && !matchedProjectIds.has(p.id));

console.log("=== MATCHING (exact normalised name only, per ADR-001) ===");
console.log(`  matched 1:1:                 ${matched.length}`);
console.log(`  Excel orders with no match:  ${unmatchedExcel.length} (manual review queue)`);
console.log(`  live projects with no order: ${unmatchedLive.length}`);

/* ------------------------------------------- what the matches would enable */

const ready = matched.filter(
  (m) => m.o.contractHours !== null && m.o.startsOn && m.o.endsOn && m.o.startsOn <= m.o.endsOn,
);
const hoursDisagree = matched.filter(
  (m) =>
    m.o.contractHours !== null &&
    m.p.estimated_hours !== null &&
    Number(m.p.estimated_hours) > 0 &&
    Math.abs(Number(m.p.estimated_hours) - m.o.contractHours) > 0.01,
);
const withPeriod = new Set(periods.map((x) => x.project_id));
const readyNew = ready.filter((m) => !withPeriod.has(m.p.id));

console.log(`\n=== WHAT THE EXCEL COULD FEED INTO CONTRACT PERIODS ===`);
console.log(`  matches with hours AND both dates:   ${ready.length}`);
console.log(`  of those, not yet having a period:   ${readyNew.length}  <- one-click candidates`);
console.log(`  matches where Excel hours != vendor estimate: ${hoursDisagree.length} (Excel is sales' number)`);

console.log(`\n  sample of one-click candidates (first 12):`);
for (const m of readyNew.slice(0, 12)) {
  console.log(
    `    ${String(m.o.contractHours).padStart(6)}h  ${m.o.startsOn} -> ${m.o.endsOn}  ` +
      `${m.o.responsible.padEnd(10).slice(0, 10)} ${m.p.name.slice(0, 52)}`,
  );
}

console.log(`\n  sample of disagreements (Excel vs vendor estimate):`);
for (const m of hoursDisagree.slice(0, 8)) {
  console.log(
    `    excel ${String(m.o.contractHours).padStart(6)}h vs tt ${String(m.p.estimated_hours).padStart(6)}h  ${m.p.name.slice(0, 56)}`,
  );
}

console.log(`\n  manual review queue (first 10 of ${unmatchedExcel.length}):`);
for (const { o, ambiguous } of unmatchedExcel.slice(0, 10)) {
  console.log(`    ${ambiguous ? "AMBIGUOUS" : "no match "}  ${o.orderNo}  ${(o.orderName || o.customer).slice(0, 60)}`);
}

/* ---------------------------------------------------------------- persist */

const report = {
  generatedAt: new Date().toISOString(),
  excelOrders: orders.length,
  liveProjects: projects.length,
  matched: matched.length,
  readyForContractPeriods: readyNew.map((m) => ({
    projectId: m.p.id,
    projectName: m.p.name,
    orderNo: m.o.orderNo,
    budgetHours: m.o.contractHours,
    startsOn: m.o.startsOn,
    endsOn: m.o.endsOn,
    responsible: m.o.responsible,
    replacement: m.o.replacement,
    sheet: m.o.sheet,
  })),
  hoursDisagreements: hoursDisagree.map((m) => ({
    projectId: m.p.id, projectName: m.p.name,
    excelHours: m.o.contractHours, vendorEstimate: Number(m.p.estimated_hours),
  })),
  manualReview: unmatchedExcel.map(({ o, ambiguous }) => ({
    orderNo: o.orderNo, orderName: o.orderName, customer: o.customer, ambiguous,
  })),
};
writeFileSync(".context-bridge/masterdata-reconciliation.json", JSON.stringify(report, null, 2));
console.log(`\nfull report: .context-bridge/masterdata-reconciliation.json`);
console.log("READ-ONLY: nothing was written to the database.");
