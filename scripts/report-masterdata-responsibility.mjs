/**
 * READ-ONLY report: what the masterdata workbook says about WHO IS RESPONSIBLE.
 *
 * WHY. The workbook names a responsible person (the "SiFa"/main-contact column)
 * and a replacement (Vertretung) for every order. Verified against
 * information_schema: no table in the database carries a responsible /
 * replacement / vertretung / betreuer column, so "who looks after this
 * customer" is unanswerable in the app. This report quantifies that gap before
 * anything is written.
 *
 * Parsing conventions are lifted verbatim from scripts/reconcile-masterdata.mjs
 * (ORDER_SHEETS, the /^\d{5}_/ order-number gate, the header-fragment column
 * lookup, and the zero-width-safe `norm`). Nothing is reinvented here.
 *
 * Usage: node scripts/report-masterdata-responsibility.mjs [--schema]
 */
import { readFileSync, existsSync } from "node:fs";
import * as XLSX from "xlsx";

const XL =
  "C:/Users/hitul/Downloads/HSE_Masterdata_Übersicht Kunden_verantwortlichkeiten_customer_responsible_2026_V2.xlsx";

/* ------------------------------------------------------------------- env/db */

export function loadEnv() {
  if (!existsSync(".env.local")) return process.env;
  for (const line of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
  return process.env;
}

export async function connect() {
  loadEnv();
  const { default: pg } = await import("pg");
  const connectionString = process.env.SUPABASE_DB_URL || process.env.DATABASE_URL;
  if (!connectionString) throw new Error("SUPABASE_DB_URL or DATABASE_URL is required");
  const client = new pg.Client({ connectionString, ssl: { rejectUnauthorized: false } });
  await client.connect();
  return client;
}

/* --------------------------------------------------- the Excel (reconcile-*) */

export const ORDER_SHEETS = [
  "DGUV V2 Sifa  Safety Engeineer",
  "SiGeKo  construction coordinati",
  "Enercon SiGeKo  construction co",
  "Projekt Health & Safety Consult",
  "Brandschutzbeauftragter (Fire S",
  "DGUV V2 Betriebsarzt  Company d",
];

/** Exact on a normalised name only. ADR-001: similarity is a review queue. */
export const norm = (s) =>
  String(s)
    .toLowerCase()
    .replace(/[\u200b-\u200d\ufeff]/g, "") // the Excel really does contain these
    .replace(/\s+/g, " ")
    .trim();

function num(v) {
  if (v === null || v === undefined) return null;
  const n = Number(String(v).replace(",", "."));
  return Number.isFinite(n) && n > 0 ? n : null;
}

export function readOrders(path = XL) {
  const wb = XLSX.read(readFileSync(path));
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
    const iMain = header.findIndex((h) => h.includes("sifa") || h.includes("main contact"));
    const iRepl = col("replacement");

    for (const r of rows.slice(1)) {
      const orderNo = String(r[iOrder] ?? "").trim();
      if (!/^\d{5}_/.test(orderNo)) continue; // formula-artifact padding rows
      orders.push({
        sheet: sheetName.trim(),
        orderNo,
        customer: String(r[iCust] ?? "").trim(),
        contractHours: num(r[iHours]),
        orderName: String(r[iName] ?? "").trim(),
        responsible: iMain >= 0 ? String(r[iMain] ?? "").trim() : "",
        replacement: iRepl >= 0 ? String(r[iRepl] ?? "").trim() : "",
        responsibleHeader: iMain >= 0 ? String(rows[0][iMain] ?? "") : null,
        replacementHeader: iRepl >= 0 ? String(rows[0][iRepl] ?? "") : null,
      });
    }
  }
  return orders;
}

/**
 * A cell may name more than one person ("Mathias / Hendryk", "Mathias, Björn").
 * Split, but keep the raw cell so nothing is silently reinterpreted.
 */
export function splitPeople(cell) {
  return String(cell ?? "")
    .split(/[\/,;&]|\bund\b|\+/i)
    .map((s) => s.replace(/\s+/g, " ").trim())
    .filter((s) => s && !/^(n\/?a|-{1,}|tbd|offen|k\.?a\.?)$/i.test(s));
}

/* -------------------------------------------------------------------- main */

if (import.meta.url === `file:///${process.argv[1].replace(/\\/g, "/")}`) {
  const client = await connect();
  try {
    const orders = readOrders();

    /* --- schema facts we depend on, printed so the reader can check them --- */
    const cols = await client.query(
      `select table_schema, table_name, column_name, data_type
         from information_schema.columns
        where table_schema in ('public')
          and table_name in ('projects', 'people')
        order by table_name, ordinal_position`,
    );
    const shape = {};
    for (const c of cols.rows) {
      (shape[c.table_name] ??= []).push(`${c.column_name}:${c.data_type}`);
    }
    if (process.argv.includes("--schema")) {
      console.log("=== SCHEMA ===");
      for (const [t, list] of Object.entries(shape)) console.log(`  public.${t}: ${list.join(", ")}`);
      const helper = await client.query(
        `select proname, pg_get_function_identity_arguments(oid) as args
           from pg_proc where proname = 'can_view_project'`,
      );
      console.log("  can_view_project:", JSON.stringify(helper.rows));
      const gap = await client.query(
        `select count(*)::int as n from information_schema.columns
          where column_name ~* 'responsib|replacement|vertretung|betreuer'`,
      );
      console.log(`  columns anywhere naming a responsible/replacement: ${gap.rows[0].n}`);
      console.log("");
    }

    /* ------------------------------------------------------ the excel facts */
    const withResp = orders.filter((o) => splitPeople(o.responsible).length > 0);
    const withRepl = orders.filter((o) => splitPeople(o.replacement).length > 0);

    const tally = (rows, key) => {
      const m = new Map();
      for (const o of rows) for (const p of splitPeople(o[key])) m.set(p, (m.get(p) ?? 0) + 1);
      return [...m.entries()].sort((a, b) => b[1] - a[1]);
    };
    const respTally = tally(orders, "responsible");
    const replTally = tally(orders, "replacement");
    const allNames = new Set([...respTally.map((x) => x[0]), ...replTally.map((x) => x[0])]);

    console.log("=== EXCEL: RESPONSIBILITY COVERAGE ===");
    console.log(`  orders parsed (${ORDER_SHEETS.length} service sheets): ${orders.length}`);
    console.log(`  orders carrying a responsible:  ${withResp.length}`);
    console.log(`  orders carrying a replacement:  ${withRepl.length}`);
    console.log(`  orders carrying neither:        ${orders.length - new Set([...withResp, ...withRepl]).size}`);
    console.log(`  distinct person names used:     ${allNames.size}`);

    console.log("\n  responsible, by person (order count):");
    for (const [name, n] of respTally) console.log(`    ${String(n).padStart(4)}  ${name}`);
    console.log("\n  replacement, by person (order count):");
    for (const [name, n] of replTally) console.log(`    ${String(n).padStart(4)}  ${name}`);

    /* ---------------------------------------------- do the names resolve? */
    const people = (
      await client.query(`select id, name, source from public.people order by id`)
    ).rows;
    const byId = new Map(people.map((p) => [p.id, p]));
    const byNorm = new Map();
    for (const p of people) {
      // 'md-mathias' -> the first name is the key sales actually writes down.
      for (const k of [norm(p.name), norm(String(p.id).replace(/^md-/, "")), norm(String(p.name).split(/\s+/)[0])]) {
        if (k && !byNorm.has(k)) byNorm.set(k, p);
      }
    }
    const resolveName = (name) => byId.get(`md-${norm(name)}`) ?? byNorm.get(norm(name)) ?? null;

    const resolved = [];
    const unresolved = [];
    for (const name of allNames) {
      const p = resolveName(name);
      (p ? resolved : unresolved).push(p ? { name, id: p.id, person: p.name, source: p.source } : { name });
    }

    console.log(`\n=== NAME -> public.people (${people.length} rows, ${people.filter((p) => p.source === "masterdata").length} source='masterdata') ===`);
    console.log(`  names resolving to a people row: ${resolved.length} / ${allNames.size}`);
    for (const r of resolved.sort((a, b) => a.name.localeCompare(b.name))) {
      console.log(`    ${r.name.padEnd(18)} -> ${r.id.padEnd(16)} ${r.person} [${r.source}]`);
    }
    if (unresolved.length) {
      console.log(`  UNRESOLVED (would be reported, never dropped silently):`);
      for (const u of unresolved) console.log(`    ${u.name}`);
    }

    /* ------------------------- how much of that can reach a live project? */
    const projects = (await client.query(`select id, name from public.projects`)).rows;
    const projByName = new Map();
    for (const p of projects) {
      const k = norm(p.name);
      if (!projByName.has(k)) projByName.set(k, []);
      projByName.get(k).push(p);
    }
    let matched = 0;
    let ambiguous = 0;
    let noMatch = 0;
    for (const o of orders) {
      const hits = o.orderName ? (projByName.get(norm(o.orderName)) ?? []) : [];
      if (hits.length === 1) matched++;
      else if (hits.length > 1) ambiguous++;
      else noMatch++;
    }
    console.log(`\n=== ORDER -> public.projects (${projects.length} projects, exact normalised name, ADR-001) ===`);
    console.log(`  matched 1:1: ${matched}   ambiguous: ${ambiguous}   no match: ${noMatch}`);

    console.log("\nREAD-ONLY: nothing was written.");
  } finally {
    await client.end().catch(() => {});
  }
}
