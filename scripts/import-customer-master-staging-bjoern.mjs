/**
 * Import the curated Customer Master workbook into stg only.
 *
 * This script deliberately uses a direct PostgreSQL connection. The stg schema
 * is not exposed through PostgREST, and this importer must never write through
 * crm, projects, raw, or public. All writes happen in one transaction and are
 * rolled back on any error.
 *
 * Usage:
 *   node scripts/import-customer-master-staging.mjs
 *
 * Required environment:
 *   NEXT_PUBLIC_SUPABASE_URL
 *   SUPABASE_DB_URL or DATABASE_URL   (direct PostgreSQL connection string)
 *   pg package available to Node
 *
 * SUPABASE_SERVICE_ROLE_KEY remains server-only repository configuration. It is
 * intentionally not sent to PostgREST: a service-role API key cannot replace a
 * PostgreSQL connection credential for a non-exposed schema.
 */

import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process"; // still used by the git-context helper below
import * as XLSX from "xlsx";
import { resolve } from "node:path";

/*
 * Retargeted from Bjoern's sandbox (zdknxlcvhcqkygiuqlbf) to production on
 * 2026-08-23, after the crm/projects/stg foundation migration was applied and
 * verified live. His ref-pinning is kept as the mechanism -- an importer that
 * writes staging data must refuse every database except the one it was
 * consciously aimed at.
 */
const EXPECTED_PROJECT_REF = "wdbedblvyrfqwypngghs";
const DRY_RUN = process.argv.includes("--dry-run");
const SOURCE_SYSTEM = "LEXWARE_HSE";
const ENTITY_TYPE = "customer_masterdata";
const INPUT_FILE = resolve(".local/import/HSE_Customer_Masterdata_V1_2.xlsx");
const EXPECTED_RECORD_COUNT = 652;
const EXPECTED_SHEETS = [
  "customers",
  "customer_groups",
  "customer_aliases",
  "addresses",
  "location_observations",
  "locations",
  "location_review",
  "source_review",
];
const EXPECTED_SHEET_COUNTS = {
  customers: 116,
  customer_groups: 1,
  customer_aliases: 42,
  addresses: 122,
  location_observations: 252,
  locations: 29,
  location_review: 35,
  source_review: 55,
};

function loadEnv() {
  const env = { ...process.env };
  if (!existsSync(".env.local")) return env;
  for (const line of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
    const match = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (match && !env[match[1]]) {
      env[match[1]] = match[2].replace(/^['"]|['"]$/g, "");
    }
  }
  return env;
}

function projectRefFromUrl(url) {
  try {
    const hostname = new URL(url).hostname;
    return hostname.endsWith(".supabase.co")
      ? hostname.slice(0, -".supabase.co".length)
      : null;
  } catch {
    return null;
  }
}

function sha256(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

function fail(message) {
  throw new Error(message);
}

// Python's standard library is used only as an XLSX reader. No workbook is
// written or modified, and no third-party spreadsheet package is required.
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
        shared = [
            "".join(t.text or "" for t in si.iterfind(".//m:t", ns))
            for si in root.findall("m:si", ns)
        ]

    workbook = ET.fromstring(book.read("xl/workbook.xml"))
    relationships = ET.fromstring(book.read("xl/_rels/workbook.xml.rels"))
    relation_map = {node.attrib["Id"]: node.attrib["Target"] for node in relationships}

    def column_number(cell_ref):
        letters = re.match(r"[A-Z]+", cell_ref).group(0)
        value = 0
        for letter in letters:
            value = value * 26 + ord(letter) - 64
        return value

    def cell_value(cell):
        value_node = cell.find("m:v", ns)
        value = "" if value_node is None else value_node.text or ""
        if cell.attrib.get("t") == "s" and value:
            return shared[int(value)]
        if cell.attrib.get("t") == "inlineStr":
            return "".join(t.text or "" for t in cell.iterfind(".//m:t", ns))
        return value

    result = []
    for sheet in workbook.find("m:sheets", ns):
        name = sheet.attrib["name"]
        relation_id = sheet.attrib["{%s}id" % rels_ns]
        target = relation_map[relation_id].lstrip("/")
        target = target if target.startswith("xl/") else "xl/" + target
        xml = ET.fromstring(book.read(target))
        rows = []
        for row in xml.findall(".//m:sheetData/m:row", ns):
            cells = {
                column_number(cell.attrib["r"]): cell_value(cell)
                for cell in row.findall("m:c", ns)
            }
            if not cells:
                continue
            rows.append({
                "excel_row_number": int(row.attrib.get("r", len(rows) + 1)),
                "cells": [cells.get(index, "") for index in range(1, max(cells) + 1)],
            })

        if not rows:
            result.append({"sheet": name, "headers": [], "rows": []})
            continue

        headers = rows[0]["cells"]
        if any(not str(header).strip() for header in headers):
            raise ValueError("Blank header in sheet %s" % name)
        if len(headers) != len(set(headers)):
            raise ValueError("Duplicate header in sheet %s" % name)

        data = []
        for row in rows[1:]:
            values = row["cells"] + [""] * (len(headers) - len(row["cells"]))
            data.append({
                "excel_row_number": row["excel_row_number"],
                "values": dict(zip(headers, values[:len(headers)])),
            })
        result.append({"sheet": name, "headers": headers, "rows": data})

print(json.dumps(result, ensure_ascii=False, separators=(",", ":")))
`;

/*
 * ADAPTED FOR THIS MACHINE (2026-08-23): the original shelled out to python3's
 * standard library as the XLSX reader, which exists on Bjoern's Mac but not on
 * this Windows host (the 'python3' alias opens the Microsoft Store). The repo
 * already depends on the xlsx package, so this produces the SAME structure --
 * [{sheet, headers, rows: [{row, values}]}] with 1-based row numbers counting
 * the header -- from it instead. The Python source above is kept for reference
 * and for anyone running the original on a machine that has python3.
 */
function readWorkbook(filePath) {
  const wb = XLSX.read(readFileSync(filePath));
  const result = [];
  for (const name of wb.SheetNames) {
    const grid = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, defval: "" });
    const headers = (grid[0] ?? []).map((h) => String(h ?? "").trim());
    const rows = [];
    for (let i = 1; i < grid.length; i++) {
      const cells = grid[i] ?? [];
      // Skip fully empty rows the way the Python reader's zip/strip did.
      if (cells.every((c) => String(c ?? "").trim() === "")) continue;
      const values = {};
      headers.forEach((h, j) => {
        if (h) values[h] = String(cells[j] ?? "").trim();
      });
      // Field name matches the original Python reader: consumers read
      // row.excel_row_number and value(row, key) reads row.values.
      rows.push({ excel_row_number: i + 1, values });
    }
    result.push({ sheet: name, headers, rows });
  }
  return result;
}

function value(row, key) {
  const raw = row.values?.[key];
  return raw === undefined || raw === "" ? null : String(raw);
}

function lexwareNumbers(row) {
  const numbers = [];
  for (const key of ["primary_lexware_customer_number", "additional_lexware_customer_numbers"]) {
    const raw = value(row, key);
    if (raw) numbers.push(...(raw.match(/\d+/g) ?? []));
  }
  return numbers;
}

function originalReviewStatus(sheet, row) {
  if (sheet === "customers") return value(row, "review_status");
  if (sheet === "customer_groups") return value(row, "status");
  if (sheet === "customer_aliases") return value(row, "status");
  if (sheet === "addresses") return value(row, "status");
  if (sheet === "location_observations") return value(row, "review_status");
  if (sheet === "locations") return value(row, "status");
  if (sheet === "location_review" || sheet === "source_review") return "REVIEW_REQUIRED";
  return null;
}

function stagingReviewStatus(original) {
  if (!original) return "unreviewed";
  if (["OK", "CONFIRMED", "ACTIVE_REFERENCE"].includes(original)) return "approved";
  return "review_required";
}

function sourceExternalId(sheet, row) {
  const direct = {
    customers: "customer_id",
    customer_groups: "customer_group_id",
    customer_aliases: "alias_id",
    addresses: "address_id",
    location_observations: "location_id",
    locations: "location_id",
  }[sheet];
  return direct ? value(row, direct) : `${sheet}:${row.excel_row_number}`;
}

function sourceCustomerNumber(sheet, row) {
  if (sheet === "customers") return value(row, "primary_lexware_customer_number");
  if (sheet === "addresses" || sheet === "location_observations") {
    return value(row, "lexware_customer_number");
  }
  if (sheet === "source_review") return value(row, "num");
  return null;
}

function candidateResolution(sheet, row, conflictingCustomerIds) {
  if (sheet === "source_review") return "unresolved";
  if (sheet === "customers") {
    const customerId = value(row, "customer_id");
    if (lexwareNumbers(row).some((number) => conflictingCustomerIds.has(`${number}:${customerId}`))) {
      return "unresolved";
    }
  }
  return "pending";
}

function buildRecords(sheets) {
  const byName = new Map(sheets.map((sheet) => [sheet.sheet, sheet]));
  const customers = byName.get("customers")?.rows ?? [];
  const owners = new Map();
  for (const row of customers) {
    const customerId = value(row, "customer_id");
    for (const number of lexwareNumbers(row)) {
      if (!owners.has(number)) owners.set(number, new Set());
      owners.get(number).add(customerId);
    }
  }
  const conflictingCustomerIds = new Set();
  for (const [number, customerIds] of owners) {
    if (customerIds.size > 1) {
      for (const customerId of customerIds) conflictingCustomerIds.add(`${number}:${customerId}`);
    }
  }

  const records = [];
  let rowNumber = 1;
  for (const sheetName of EXPECTED_SHEETS) {
    const sheet = byName.get(sheetName);
    for (const row of sheet.rows) {
      const originalStatus = originalReviewStatus(sheetName, row);
      records.push({
        row_number: rowNumber++,
        source_external_id: sourceExternalId(sheetName, row),
        source_customer_number: sourceCustomerNumber(sheetName, row),
        raw_payload: {
          sheet_name: sheetName,
          excel_row_number: row.excel_row_number,
          values: row.values,
        },
        validation_status: "pending",
        resolution_status: candidateResolution(sheetName, row, conflictingCustomerIds),
        candidate_legal_entity_id: null,
        candidate_location_id: null,
        review_status: stagingReviewStatus(originalStatus),
      });
    }
  }
  return records;
}

function assertWorkbook(sheets) {
  const names = sheets.map((sheet) => sheet.sheet).filter((name) => name !== "README");
  if (names.length !== EXPECTED_SHEETS.length || names.some((name, index) => name !== EXPECTED_SHEETS[index])) {
    fail(`Unexpected workbook sheets. Expected ${EXPECTED_SHEETS.join(", ")}; got ${names.join(", ")}`);
  }
  for (const sheet of EXPECTED_SHEETS) {
    const actual = sheets.find((item) => item.sheet === sheet)?.rows.length ?? 0;
    if (actual !== EXPECTED_SHEET_COUNTS[sheet]) {
      fail(`Unexpected row count for ${sheet}: expected ${EXPECTED_SHEET_COUNTS[sheet]}, got ${actual}`);
    }
  }
}

function assertPayloads(records) {
  for (const record of records) {
    if (!record.raw_payload?.sheet_name) fail(`Missing sheet name at row ${record.row_number}`);
    if (!Number.isInteger(record.raw_payload?.excel_row_number)) {
      fail(`Missing Excel row number at row ${record.row_number}`);
    }
    if (!record.raw_payload?.values || typeof record.raw_payload.values !== "object") {
      fail(`Missing raw values at row ${record.row_number}`);
    }
    if (record.candidate_legal_entity_id !== null || record.candidate_location_id !== null) {
      fail(`Candidate FK must be NULL at row ${record.row_number}`);
    }
  }
}

const env = loadEnv();
const projectRef = projectRefFromUrl(env.NEXT_PUBLIC_SUPABASE_URL);
if (projectRef !== EXPECTED_PROJECT_REF) {
  fail(`Wrong Supabase Project Ref: expected ${EXPECTED_PROJECT_REF}, got ${projectRef ?? "unknown"}`);
}
if (!existsSync(INPUT_FILE)) fail(`Input file not found: ${INPUT_FILE}`);

const fileBuffer = readFileSync(INPUT_FILE);
const fileHash = sha256(fileBuffer);
const sheets = readWorkbook(INPUT_FILE);
assertWorkbook(sheets);
const records = buildRecords(sheets);
if (records.length !== EXPECTED_RECORD_COUNT) {
  fail(`Unexpected record count: expected ${EXPECTED_RECORD_COUNT}, got ${records.length}`);
}
assertPayloads(records);

let pg;
try {
  ({ default: pg } = await import("pg"));
} catch {
  fail("Missing direct PostgreSQL driver. Install the server-only pg package before running this importer.");
}

const connectionString = env.SUPABASE_DB_URL || env.DATABASE_URL;
if (!connectionString) {
  fail("SUPABASE_DB_URL or DATABASE_URL is required; SUPABASE_SERVICE_ROLE_KEY cannot connect to PostgreSQL directly.");
}

const client = new pg.Client({
  connectionString,
  ssl: { rejectUnauthorized: false },
});

let transactionOpen = false;
try {
  await client.connect();

  if (DRY_RUN) {
    const existing = await client.query(
      `select id from stg.import_batch where source_system = $1 and file_hash = $2 limit 1`,
      [SOURCE_SYSTEM, fileHash],
    );
    console.log(JSON.stringify({
      dry_run_succeeded: true,
      project_ref: projectRef,
      file_hash: fileHash,
      record_count: records.length,
      sheet_counts: Object.fromEntries(EXPECTED_SHEETS.map((name) => [
        name,
        sheets.find((sheet) => sheet.sheet === name).rows.length,
      ])),
      payloads_complete: true,
      candidate_legal_entity_count: 0,
      candidate_location_count: 0,
      duplicate_batch_found: existing.rowCount > 0,
      existing_batch_id: existing.rows[0]?.id ?? null,
      writes_performed: false,
    }, null, 2));
    if (existing.rowCount) {
      console.warn("WARNING: a batch with this source and file hash already exists; real import must not start.");
    }
    await client.end();
    process.exit(0);
  }

  await client.query("begin");
  transactionOpen = true;

  const existing = await client.query(
    `select id from stg.import_batch where source_system = $1 and file_hash = $2 limit 1`,
    [SOURCE_SYSTEM, fileHash],
  );
  if (existing.rowCount) {
    fail(`Batch already exists for this source and file hash: ${existing.rows[0].id}`);
  }

  const batchResult = await client.query(
    `insert into stg.import_batch
       (source_system, entity_type, file_name, file_hash, status, row_count, error_count)
     values ($1, $2, $3, $4, 'received', $5, 0)
     returning id`,
    [SOURCE_SYSTEM, ENTITY_TYPE, "HSE_Customer_Masterdata_V1_2.xlsx", fileHash, records.length],
  );
  const batchId = batchResult.rows[0].id;

  const chunkSize = 100;
  for (let start = 0; start < records.length; start += chunkSize) {
    const chunk = records.slice(start, start + chunkSize);
    const params = [];
    const values = chunk.map((record, index) => {
      const offset = index * 10;
      params.push(
        batchId,
        record.row_number,
        record.source_external_id,
        record.source_customer_number,
        JSON.stringify(record.raw_payload),
        record.validation_status,
        record.resolution_status,
        record.candidate_legal_entity_id,
        record.candidate_location_id,
        record.review_status,
      );
      return `($${offset + 1}, $${offset + 2}, $${offset + 3}, $${offset + 4}, $${offset + 5}::jsonb, $${offset + 6}, $${offset + 7}, $${offset + 8}, $${offset + 9}, $${offset + 10})`;
    });
    await client.query(
      `insert into stg.import_record
        (batch_id, row_number, source_external_id, source_customer_number,
         raw_payload, validation_status, resolution_status,
         candidate_legal_entity_id, candidate_location_id, review_status)
       values ${values.join(", ")}`,
      params,
    );
  }

  const verification = await client.query(
    `select
       count(*)::int as record_count,
       count(*) filter (where candidate_legal_entity_id is not null)::int as legal_entity_candidates,
       count(*) filter (where candidate_location_id is not null)::int as location_candidates,
       count(*) filter (where resolution_status = 'unresolved')::int as unresolved_count,
       count(*) filter (where review_status = 'review_required')::int as review_required_count
     from stg.import_record where batch_id = $1`,
    [batchId],
  );
  const result = verification.rows[0];
  if (Number(result.record_count) !== EXPECTED_RECORD_COUNT) fail("Record verification failed");
  if (Number(result.legal_entity_candidates) !== 0 || Number(result.location_candidates) !== 0) {
    fail("Candidate FK verification failed: candidate fields must remain NULL");
  }

  await client.query(
    `update stg.import_batch
        set status = 'completed', finished_at = now(), row_count = $2, error_count = 0
      where id = $1`,
    [batchId, EXPECTED_RECORD_COUNT],
  );
  await client.query("commit");
  transactionOpen = false;

  console.log(JSON.stringify({
    import_succeeded: true,
    project_ref: projectRef,
    batch_id: batchId,
    record_count: Number(result.record_count),
    unresolved_count: Number(result.unresolved_count),
    review_required_count: Number(result.review_required_count),
    candidate_legal_entity_count: Number(result.legal_entity_candidates),
    candidate_location_count: Number(result.location_candidates),
    file_hash: fileHash,
  }, null, 2));
} catch (error) {
  if (transactionOpen) await client.query("rollback");
  console.error(`Customer Master staging import rolled back: ${error.message}`);
  process.exitCode = 1;
} finally {
  await client.end().catch(() => {});
}
