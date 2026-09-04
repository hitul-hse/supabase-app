/*
 * Import working links (chat room, board, folder) from the masterdata workbook
 * into public.project_link.
 *
 * WHICH SHEETS, AND WHY NOT THE OBVIOUS ONE
 * -----------------------------------------
 * It reads the PER-SERVICE sheets and deliberately SKIPS "Overview of all".
 * That sheet's header row is stale: it does not describe its own data. Measured
 * 2026-09-03, its row 2 carries the Google Chat URL under a header reading
 * "Notes", the TrackingTime URL under a blank header, and the person named as
 * Sifa under a header reading "Google Chatgroup" -- the data picked up four
 * extra columns at some point and the header was never moved. Importing by that
 * header would file every link under the wrong kind, silently and plausibly.
 * The per-service sheets are self-consistent and are the source of truth here.
 *
 * COLUMNS ARE FOUND BY HEADER TEXT, NEVER BY LETTER
 * -------------------------------------------------
 * Sheets differ in column order, so a fixed letter would import the wrong
 * column the day someone inserts one. Note the source spells it "TrackingTImelink"
 * -- the match is case-insensitive and space-insensitive for that reason.
 *
 * THE JOIN IS AN EXACT KEY (ADR-001)
 * ----------------------------------
 * Order-Number (e.g. 10110_00358_104_01) IS public.projects.id. A row whose
 * order number has no project is REPORTED, never fuzzily matched to a customer
 * or project name. ADR-001: name similarity may be shown to a human, never
 * acted on by code.
 *
 * ONLY REAL URLS ARE IMPORTED
 * ---------------------------
 * The "Drive : teams or google" column mostly holds folder NAMES, not links
 * (measured: ~85 non-empty, only 17 actual URLs). A name is not a link, and
 * storing one would produce a chip that navigates nowhere. Values that do not
 * parse as http(s) URLs are skipped and counted.
 *
 * Usage:
 *   node scripts/import-project-links.mjs            # dry run, writes nothing
 *   node scripts/import-project-links.mjs --write    # upserts
 *
 * Dry run is the DEFAULT here, unlike scripts/import-masterdata-projects.mjs
 * which writes unless given --dry-run. This one touches a table the UI reads
 * directly, so the safe mode is the one you get by accident.
 */
import { existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { createClient } from "@supabase/supabase-js";
import { loadEnv } from "./lib/gate-env.mjs";

const REPO = fileURLToPath(new URL("..", import.meta.url));
const WRITE = process.argv.includes("--write");

const WORKBOOK =
  process.env.MASTERDATA_XLSX ??
  join(REPO, ".local/import/HSE_Masterdata_Übersicht Kunden_verantwortlichkeiten_customer_responsible_2026_V2.xlsx");

/* Header text -> link kind. Matched loosely (lowercased, non-alphanumerics
 * stripped) because the source spelling is inconsistent, e.g. "TrackingTImelink"
 * and "Drive : teams or google". */
const KIND_BY_HEADER = [
  [/googlechatgroup|googlechat/, "google_chat"],
  [/driveteamsorgoogle|^drive/, "google_drive"],
  [/trackingtimelink/, "trackingtime"],
  [/asanalink|^asana$/, "asana"],
  [/microsoftteamslink/, "microsoft_teams"],
];

/* "Overview of all ..." is excluded by name -- see the header note above. */
const SKIP_SHEET = /^overview of all|^read me|^dashboard|^archiv|^sheet\d|^contacts/i;

// Python's standard library as an XLSX reader. No third-party spreadsheet
// package is required and none is installed (xlsx is not in package.json).
// Unlike the reader in import-customer-master-staging-bjoern.mjs this one
// TOLERATES blank and duplicate headers, because the per-service sheets have
// trailing empty columns and that is not an error here -- we only care about
// the handful of columns we can name.
const PYTHON_XLSX_READER = String.raw`
import json, re, sys, zipfile
import xml.etree.ElementTree as ET

path = sys.argv[1]
ns = {"m": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}
rels_ns = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"

with zipfile.ZipFile(path) as book:
    shared = []
    if "xl/sharedStrings.xml" in book.namelist():
        root = ET.fromstring(book.read("xl/sharedStrings.xml"))
        shared = ["".join(t.text or "" for t in si.iterfind(".//m:t", ns))
                  for si in root.findall("m:si", ns)]

    workbook = ET.fromstring(book.read("xl/workbook.xml"))
    relationships = ET.fromstring(book.read("xl/_rels/workbook.xml.rels"))
    relation_map = {node.attrib["Id"]: node.attrib["Target"] for node in relationships}

    def col_letters(ref):
        return re.match(r"[A-Z]+", ref).group(0)

    def cell_value(cell):
        node = cell.find("m:v", ns)
        value = "" if node is None else (node.text or "")
        if cell.attrib.get("t") == "s" and value:
            return shared[int(value)]
        if cell.attrib.get("t") == "inlineStr":
            return "".join(t.text or "" for t in cell.iterfind(".//m:t", ns))
        return value

    result = []
    for sheet in workbook.find("m:sheets", ns):
        name = sheet.attrib["name"]
        target = relation_map[sheet.attrib["{%s}id" % rels_ns]].lstrip("/")
        target = target if target.startswith("xl/") else "xl/" + target
        xml = ET.fromstring(book.read(target))
        rows = xml.findall(".//m:sheetData/m:row", ns)
        if not rows:
            result.append({"sheet": name, "headers": {}, "rows": []})
            continue
        headers = {col_letters(c.attrib["r"]): (cell_value(c) or "").strip()
                   for c in rows[0].findall("m:c", ns)}
        data = []
        for row in rows[1:]:
            cells = {col_letters(c.attrib["r"]): (cell_value(c) or "").strip()
                     for c in row.findall("m:c", ns)}
            if any(cells.values()):
                data.append(cells)
        result.append({"sheet": name, "headers": headers, "rows": data})

print(json.dumps(result, ensure_ascii=False, separators=(",", ":")))
`;

function readWorkbook(path) {
  const proc = spawnSync("python3", ["-c", PYTHON_XLSX_READER, path], {
    encoding: "utf8",
    maxBuffer: 256 * 1024 * 1024,
  });
  if (proc.status !== 0) {
    throw new Error(`python3 xlsx reader failed: ${proc.stderr?.slice(0, 400) ?? "no stderr"}`);
  }
  return JSON.parse(proc.stdout);
}

const norm = (s) => String(s ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");

function kindFor(header) {
  const n = norm(header);
  if (!n) return null;
  for (const [pattern, kind] of KIND_BY_HEADER) {
    if (pattern.test(n)) return kind;
  }
  return null;
}

/* A link is a link only if it is actually a URL. Folder names live in the same
 * column and must not become chips that navigate nowhere. */
function asUrl(value) {
  const v = String(value ?? "").trim();
  if (!/^https?:\/\//i.test(v)) return null;
  try {
    new URL(v);
    return v;
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------ main */

if (!existsSync(WORKBOOK)) {
  console.error(`Workbook not found: ${WORKBOOK}`);
  console.error("Put it there, or set MASTERDATA_XLSX to point at it.");
  console.error("It must be the ORDER workbook (Übersicht Kunden_verantwortlichkeiten),");
  console.error("NOT HSE_Customer_Masterdata_V1_2.xlsx, which carries no links.");
  process.exit(1);
}

console.log(`workbook: ${WORKBOOK}`);
console.log(WRITE ? "mode: WRITE" : "mode: DRY RUN (pass --write to commit)");

const sheets = readWorkbook(WORKBOOK);
const found = [];
const skippedNonUrl = {};
let sheetsRead = 0;

for (const { sheet, headers, rows } of sheets) {
  if (SKIP_SHEET.test(sheet)) continue;
  const orderCol = Object.entries(headers).find(([, h]) => /order-?\s*number/i.test(h))?.[0];
  const linkCols = Object.entries(headers)
    .map(([col, h]) => [col, kindFor(h)])
    .filter(([, kind]) => kind !== null);
  if (!orderCol || linkCols.length === 0) continue;

  sheetsRead += 1;
  for (const cells of rows) {
    const orderNo = (cells[orderCol] ?? "").trim();
    if (!orderNo) continue;
    for (const [col, kind] of linkCols) {
      const raw = cells[col];
      if (!raw) continue;
      const url = asUrl(raw);
      if (!url) {
        skippedNonUrl[kind] = (skippedNonUrl[kind] ?? 0) + 1;
        continue;
      }
      found.push({ project_id: orderNo, kind, url, label: sheet, source: "masterdata" });
    }
  }
}

// Same (project, kind, url) can legitimately appear on more than one sheet.
const deduped = [...new Map(found.map((r) => [`${r.project_id}|${r.kind}|${r.url}`, r])).values()];

const byKind = {};
for (const r of deduped) byKind[r.kind] = (byKind[r.kind] ?? 0) + 1;

console.log(`\nsheets read: ${sheetsRead}`);
console.log(`link rows found: ${deduped.length} (from ${found.length} before dedupe)`);
for (const kind of Object.keys(byKind).sort()) console.log(`  ${kind}: ${byKind[kind]}`);
const skippedTotal = Object.values(skippedNonUrl).reduce((a, b) => a + b, 0);
if (skippedTotal > 0) {
  console.log(`\nskipped (value present but not a URL): ${skippedTotal}`);
  for (const kind of Object.keys(skippedNonUrl).sort()) {
    console.log(`  ${kind}: ${skippedNonUrl[kind]}`);
  }
}

const env = loadEnv();
const url = env.NEXT_PUBLIC_SUPABASE_URL;
const key = env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("\nNEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required to check matches.");
  process.exit(1);
}
const db = createClient(url, key, { auth: { persistSession: false } });

// Which order numbers actually exist as projects? Reported, never guessed at.
const ids = [...new Set(deduped.map((r) => r.project_id))];
const known = new Set();
const CHUNK = 200;
for (let i = 0; i < ids.length; i += CHUNK) {
  const slice = ids.slice(i, i + CHUNK);
  const { data, error } = await db.from("projects").select("id").in("id", slice);
  if (error) {
    console.error(`\nlookup failed: ${error.message}`);
    process.exit(1);
  }
  for (const row of data ?? []) known.add(row.id);
}

const matched = deduped.filter((r) => known.has(r.project_id));
const unmatched = deduped.filter((r) => !known.has(r.project_id));
const unmatchedIds = [...new Set(unmatched.map((r) => r.project_id))].sort();

console.log(`\norder numbers seen: ${ids.length}`);
console.log(`  matched to a project: ${ids.length - unmatchedIds.length}`);
console.log(`  NOT matched: ${unmatchedIds.length}`);
if (unmatchedIds.length > 0) {
  console.log("  (these are reported, never fuzzy-matched — ADR-001)");
  for (const id of unmatchedIds.slice(0, 25)) console.log(`    ${id}`);
  if (unmatchedIds.length > 25) console.log(`    ... and ${unmatchedIds.length - 25} more`);
}
console.log(`\nlinks importable: ${matched.length}`);

if (!WRITE) {
  console.log("\nDRY RUN — nothing written. Re-run with --write to commit.");
  process.exit(0);
}

let written = 0;
for (let i = 0; i < matched.length; i += CHUNK) {
  const slice = matched.slice(i, i + CHUNK);
  const { error } = await db
    .from("project_link")
    .upsert(slice, { onConflict: "project_id,kind,url", ignoreDuplicates: true });
  if (error) {
    console.error(`\nupsert failed: ${error.message}`);
    process.exit(1);
  }
  written += slice.length;
}
console.log(`\nupserted ${written} link(s). Idempotent: a second run changes nothing.`);
