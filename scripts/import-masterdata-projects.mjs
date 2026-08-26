/**
 * Fill public.projects and public.person_assignments with the REAL portfolio,
 * derived from the HSE masterdata Excel plus live TrackingTime hours.
 *
 * WHY THIS EXISTS. Bjoern's management dashboard reads public.projects -- the
 * Hub's own planning table -- which in production still held the original five
 * demo rows ("Nordwerk AG", "prj-1"), so the dashboard rendered fiction. In
 * his sandbox it showed real data because he imported the masterdata Excel.
 * His own importer cannot be reused here: it writes to the stg.* schema, which
 * exists only in his sandbox (the crm/stg foundation migration is merged as a
 * file but deliberately not applied).
 *
 * WHAT IT WRITES, and where each field comes from:
 *   public.projects           one row per Excel ORDER (the contract-level
 *                             grain his dashboard expects)
 *     contract_hours          "Stunden laut Vertrag" -- sales' number
 *     billable_hours+logged   summed live from time.entry via the TT project
 *                             link, inside the contract window when dates exist
 *     owner_person_id         the responsible person, resolved against
 *                             public.people by first name (the Excel uses
 *                             first names; ambiguity aborts rather than guesses)
 *     status                  derived from consumption: CRITICAL >= 95%,
 *                             WARNING >= 80% (mirrors the demo rows' semantics)
 *   public.people             upserted from the Excel's responsibles that are
 *                             missing (source='masterdata')
 *   public.person_assignments responsible + replacement per project
 *
 * ADR-001 GOVERNS THE MATCHING. TrackingTime projects attach by exact
 * normalised name only; anything else lands in the report as unmatched. No
 * name-similarity merging, ever.
 *
 * THE DEMO ROWS ARE DELETED. prj-1..prj-5 and emp-1..emp-8 are the seed
 * fiction this replaces. check-no-mock-data.mjs documents them as sample rows;
 * keeping them alongside real orders would corrupt every aggregate on the
 * dashboard.
 *
 * Idempotent: rows key on the Excel order number, so re-running refreshes.
 * --dry-run reports everything and writes nothing.
 */
import { createClient } from "@supabase/supabase-js";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import * as XLSX from "xlsx";

/*
 * The order workbook. Repo-relative by default, overridable with MASTERDATA_XLSX.
 *
 * This was hardcoded to C:/Users/hitul/Downloads/... until 26 Aug 2026, which
 * meant the portfolio import could not be reproduced or verified on any other
 * machine -- and the file committed under .local/import/ was a DIFFERENT
 * workbook (the customer master, which yields 0 orders through readOrders()).
 * Anyone re-running this to check the 231 orders would have silently imported
 * nothing.
 *
 * .local/ is gitignored on purpose and that stays true: this workbook carries
 * customer names and named personnel, so it belongs beside the repo rather than
 * in it. What changes is that the path is now conventional and stated, so a
 * second machine drops the file in one known place instead of reading someone
 * else's Downloads folder.
 */
const XL =
  process.env.MASTERDATA_XLSX ??
  ".local/import/HSE_Masterdata_Übersicht Kunden_verantwortlichkeiten_customer_responsible_2026_V2.xlsx";

// Fail loudly and usefully. An unreadable workbook previously surfaced as a
// stack trace from deep inside the xlsx reader, or worse, as a successful run
// over the wrong file.
if (!existsSync(XL)) {
  console.error(`Order workbook not found: ${XL}`);
  console.error("Put it at that path, or set MASTERDATA_XLSX to point at it.");
  console.error("It is the 22-sheet 'Übersicht Kunden_verantwortlichkeiten' file,");
  console.error("NOT HSE_Customer_Masterdata_V1_2.xlsx (that one yields 0 orders).");
  process.exit(1);
}
const DRY = process.argv.includes("--dry-run");

for (const line of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
  const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});
const timeDb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  db: { schema: "time" }, auth: { persistSession: false },
});

/* --------------------------------------------------------------- the Excel */

const ORDER_SHEETS = [
  ["DGUV V2 Sifa  Safety Engeineer", "DGUV V2: Sifa"],
  ["SiGeKo  construction coordinati", "SiGeKo"],
  ["Enercon SiGeKo  construction co", "SiGeKo (Enercon)"],
  ["Projekt Health & Safety Consult", "H&S Consulting"],
  ["Brandschutzbeauftragter (Fire S", "Brandschutz"],
  ["DGUV V2 Betriebsarzt  Company d", "Betriebsarzt"],
  ["Reteach Trainings", "Reteach Training"],
];

const wb = XLSX.read(readFileSync(XL));

function xlDate(v) {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "number" && v > 20000 && v < 60000) {
    return new Date(Math.round((v - 25569) * 86400 * 1000)).toISOString().slice(0, 10);
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
const norm = (s) =>
  String(s ?? "").toLowerCase().replace(/[\u200b-\u200d\ufeff]/g, "").replace(/\s+/g, " ").trim();

const orders = [];
for (const [sheetName, serviceLabel] of ORDER_SHEETS) {
  const ws = wb.Sheets[sheetName];
  if (!ws) continue;
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null });
  const header = rows[0].map((h) => String(h ?? "").toLowerCase());
  const col = (frag) => header.findIndex((h) => h.includes(frag));
  const iOrder = col("order-number") >= 0 ? col("order-number") : col("kundennummer");
  const iCust = col("kunde");
  const iHours = col("stunden laut vertrag") >= 0 ? col("stunden laut vertrag") : col("user laut vertrag");
  const iName = header.findIndex((h) => h.includes("order name") || h.includes("project name"));
  const iStart = col("start date");
  const iEnd = col("delivery date");
  const iMain = header.findIndex((h) => h.includes("sifa") || h.includes("main contact"));
  const iRepl = col("replacement");

  for (const r of rows.slice(1)) {
    const orderNo = String(r[iOrder] ?? "").trim();
    if (!/^\d{5}_/.test(orderNo)) continue; // padding rows (_0__0) and repeats
    orders.push({
      orderNo,
      service: serviceLabel,
      customer: String(r[iCust] ?? "").trim(),
      contractHours: num(r[iHours]),
      orderName: String(r[iName] ?? "").trim() || `${String(r[iCust] ?? "").trim()} / ${serviceLabel}`,
      startsOn: xlDate(r[iStart]),
      endsOn: xlDate(r[iEnd]),
      responsible: iMain >= 0 ? String(r[iMain] ?? "").trim() : "",
      replacement: iRepl >= 0 ? String(r[iRepl] ?? "").trim() : "",
    });
  }
}
// One row per order number: the per-person sheets repeat orders, and even the
// service sheets can. Last write wins within a sheet; first sheet wins across.
const byOrder = new Map();
for (const o of orders) if (!byOrder.has(o.orderNo)) byOrder.set(o.orderNo, o);
const uniqueOrders = [...byOrder.values()];
console.log(`Excel: ${orders.length} order rows -> ${uniqueOrders.length} unique orders`);

/* ------------------------------------------------- live TrackingTime hours */

const page = async (client, table, select, tweak) => {
  const out = [];
  for (let f = 0; ; f += 1000) {
    let q = client.from(table).select(select).order("id").range(f, f + 999);
    if (tweak) q = tweak(q);
    const { data, error } = await q;
    if (error) throw new Error(`${table}: ${error.message}`);
    if (!data?.length) break;
    out.push(...data);
    if (data.length < 1000) break;
  }
  return out;
};

const ttProjects = await page(timeDb, "project", "id, name, is_billable");
const entries = await page(timeDb, "entry", "id, project_id, duration_seconds, started_at, is_billable", (q) =>
  q.not("duration_seconds", "is", null),
);
console.log(`live: ${ttProjects.length} TT projects, ${entries.length} entries`);

const ttByName = new Map();
for (const p of ttProjects) {
  const k = norm(p.name);
  if (!ttByName.has(k)) ttByName.set(k, []);
  ttByName.get(k).push(p);
}

/* -------------------------------------------------------------- people map */

const livePeople = await page(db, "people", "id, name, is_active");
// The Excel uses FIRST NAMES (Hendryk, Mathias, ...). Resolve against people
// by first name; if two people share one, abort rather than guess (ADR-001).
const firstName = (full) => norm(full).split(" ")[0];
const peopleByFirst = new Map();
for (const p of livePeople) {
  const f = firstName(p.name);
  if (!peopleByFirst.has(f)) peopleByFirst.set(f, []);
  peopleByFirst.get(f).push(p);
}

const responsibles = new Set();
for (const o of uniqueOrders) {
  if (o.responsible && !/^[\d\s.,-]+$/.test(o.responsible.trim())) responsibles.add(o.responsible);
  if (o.replacement && !/n\/a|keine/i.test(o.replacement)) responsibles.add(o.replacement);
}

const resolvePerson = (label) => {
  // An Excel cell sometimes holds a NUMBER where a name belongs (a stray id
  // like 156082). A number is not a person; treat it as unassigned.
  if (/^[\d\s.,-]+$/.test(String(label).trim())) return null;
  const f = firstName(label);
  if (!f) return null;
  const hits = peopleByFirst.get(f) ?? [];
  if (hits.length > 1) throw new Error(`ambiguous first name '${label}': ${hits.map((h) => h.name).join(", ")}`);
  return hits[0] ?? null;
};

const newPeople = [];
const seenIds = new Set();
for (const label of [...responsibles].sort()) {
  if (resolvePerson(label)) continue;
  const id = `md-${firstName(label).replace(/[^a-z]/g, "")}`;
  // "Mustafa " and "Mustafa" are the same person with a stray space in one
  // sheet; both normalise to one id, and a batch upsert must not carry the
  // same key twice (Postgres: "cannot affect row a second time").
  if (seenIds.has(id)) continue;
  seenIds.add(id);
  // source='masterdata', as this script's header states. It wrote "seed" --
  // the same label the eight mockup rows carry -- so real colleagues from the
  // Excel were indistinguishable from fiction by the one column that exists to
  // separate them, and every gate reasoning about "mockup rows" swept them in.
  newPeople.push({ id, name: label.trim(), is_active: true, source: "masterdata", role: "Consultant" });
}

/* ------------------------------------------------------------ build rows */

const projectRows = [];
const assignmentRows = [];
const report = { matchedTT: 0, unmatchedTT: [], noResponsible: 0 };

for (const o of uniqueOrders) {
  // Live hours: exact-name TT match, summed inside the contract window when
  // both dates exist (the same rule the budget guard uses).
  const hits = ttByName.get(norm(o.orderName)) ?? [];
  /*
   * measured=false means no TrackingTime project resolved for this order, so we
   * know NOTHING about its hours. That is not 'worked zero hours'. Writing 0 for
   * it made the 54 orders with no TT link read consumed_percent=0 / status=NORMAL
   * across 1,724 contract hours -- unmeasured work presented as on budget. The
   * 113 LINKED orders that also sit at 0 are measured and keep their honest zero.
   * House rule: honest nulls, never a plausible 0. Every hour-derived column
   * below is null when measured is false.
   */
  const measured = hits.length === 1;
  let logged = 0;
  let billable = 0;
  if (measured) {
    report.matchedTT += 1;
    for (const e of entries) {
      if (e.project_id !== hits[0].id) continue;
      const d = String(e.started_at).slice(0, 10);
      /*
       * Window only when the dates are coherent. Many Excel rows carry
       * Start Date 2027-01-01 next to Delivery 2026-12-31 (the start column
       * appears to hold the NEXT renewal date), and a reversed window would
       * filter out every entry -- which is exactly what the first dry run
       * showed: 0h logged on all 231 orders. Incoherent dates mean all-time.
       */
      const windowValid = o.startsOn && o.endsOn && o.startsOn <= o.endsOn;
      if (windowValid && (d < o.startsOn || d > o.endsOn)) continue;
      logged += (Number(e.duration_seconds) || 0) / 3600;
      if (e.is_billable) billable += (Number(e.duration_seconds) || 0) / 3600;
    }
  } else {
    report.unmatchedTT.push(o.orderName);
  }

  const contract = o.contractHours;
  // Unmeasured, or no contract to measure against, means there is no percentage
  // to state and no budget status to claim. Both stay null.
  const consumed = measured && contract ? Math.round((logged / contract) * 100) : null;
  const status =
  // null, not a sentinel string: the migration writes NULL for the same case, and
  // management-project-risks flags unknown status via !project.status, which a
  // truthy "UNKNOWN" would silently escape.
    consumed === null ? null : consumed >= 95 ? "CRITICAL" : consumed >= 80 ? "WARNING" : "NORMAL";

  const owner =
    (o.responsible && (resolvePerson(o.responsible) ?? newPeople.find((p) => firstName(p.name) === firstName(o.responsible)))) || null;
  if (!owner) report.noResponsible += 1;

  projectRows.push({
    id: o.orderNo,
    code: o.orderNo,
    name: o.orderName,
    customer: o.customer,
    lead: o.responsible || "n/a",
    status,
    contract_hours: contract ?? 0,
    billable_hours: measured ? Math.round(billable * 10) / 10 : null,
    logged_hours: measured ? Math.round(logged * 10) / 10 : null,
    remaining_hours: measured && contract ? Math.round((contract - logged) * 10) / 10 : null,
    consumed_percent: consumed,
    due: o.endsOn ?? "n/a",
    contract_type: o.service,
    owner_person_id: owner?.id ?? null,
  });

  if (owner) {
    assignmentRows.push({
      person_id: owner.id,
      project_id: o.orderNo,
      project_name: o.orderName,
      share_percent: 100,
      // NOT NULL columns on this table; real hours live in time.entry and the
      // dashboard reads them from the project row, so these carry the project totals.
      logged_hours: Math.round(logged * 10) / 10,
      tasks_count: 0,
      sort_order: 0,
    });
  }
  const repl = o.replacement && !/n\/a|keine/i.test(o.replacement) ? resolvePerson(o.replacement) : null;
  if (repl) {
    assignmentRows.push({
      person_id: repl.id,
      project_id: o.orderNo,
      project_name: o.orderName,
      share_percent: 0, // replacement: assigned, not carrying the load
      logged_hours: 0,
      tasks_count: 0,
      sort_order: 1,
    });
  }
}

console.log(`\nprepared: ${projectRows.length} projects, ${assignmentRows.length} assignments, ${newPeople.length} new people`);
console.log(`TT hour matches: ${report.matchedTT}; without TT link: ${report.unmatchedTT.length}; without responsible: ${report.noResponsible}`);

writeFileSync(
  ".context-bridge/masterdata-import-report.json",
  JSON.stringify({ generatedAt: new Date().toISOString(), ...report, projects: projectRows.length }, null, 2),
);

if (DRY) {
  console.log("\nDRY RUN: nothing written. Sample rows:");
  for (const r of projectRows.slice(0, 8)) {
    const lg = r.logged_hours === null ? "n/a" : String(r.logged_hours);
    const pc = r.consumed_percent === null ? "n/a" : `${r.consumed_percent}%`;
    console.log(`  ${r.id}  ${String(r.contract_hours).padStart(6)}h contract, ${lg.padStart(7)}h logged (${pc})  ${r.name.slice(0, 48)}`);
  }
  process.exit(0);
}

/* ------------------------------------------------------------- the write */

// Demo rows out first: keeping fiction next to real orders corrupts every sum.
const { error: delAssign } = await db.from("person_assignments").delete().like("project_id", "prj-%");
const { error: delProj } = await db.from("projects").delete().like("id", "prj-%");
/*
 * The demo PEOPLE cannot be deleted: timesheet_entries holds FK references to
 * them (measured on the live run). Deactivating strips them from every
 * is_active surface -- including his dashboard's people picker -- while the
 * referencing timesheets stay intact.
 */
const { error: deactPeople } = await db.from("people").update({ is_active: false }).like("id", "emp-%");
if (delAssign || delProj || deactPeople) {
  console.log("demo cleanup:", delAssign?.message ?? "", delProj?.message ?? "", deactPeople?.message ?? "");
}

if (newPeople.length) {
  const { error } = await db.from("people").upsert(newPeople, { onConflict: "id" });
  if (error) throw new Error(`people: ${error.message}`);
  console.log(`people: +${newPeople.length}`);
}

for (let i = 0; i < projectRows.length; i += 200) {
  const { error } = await db.from("projects").upsert(projectRows.slice(i, i + 200), { onConflict: "id" });
  if (error) throw new Error(`projects: ${error.message}`);
}
console.log(`projects: ${projectRows.length} upserted`);

// Assignments have no natural key column pair enforced; replace per import.
const ids = projectRows.map((r) => r.id);
for (let i = 0; i < ids.length; i += 100) {
  await db.from("person_assignments").delete().in("project_id", ids.slice(i, i + 100));
}
for (let i = 0; i < assignmentRows.length; i += 200) {
  const { error } = await db.from("person_assignments").insert(assignmentRows.slice(i, i + 200));
  if (error) throw new Error(`person_assignments: ${error.message}`);
}
console.log(`person_assignments: ${assignmentRows.length} inserted`);

console.log("\nDone. The management dashboard now reads the real portfolio.");
