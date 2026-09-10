/*
 * The masterdata Google Sheet, read the way the warehouse needs it.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * On 2026-09-10 the business side handed over "V1 HSE-Masterdata Kundenliste",
 * a Google Sheet that becomes the single source for customers, service orders,
 * responsibilities and the operational links the My Work tab shows. hitul's
 * rule for it: the sheet is never edited from our side; Supabase mirrors it
 * through staging, review and promotion, exactly as the earlier customer-master
 * workbook was handled (scripts/import-customer-master-staging.mjs).
 *
 * This module holds everything about the sheet that is PURE -- the column
 * contract, the parsers, the key derivation and the row classification -- so
 * that the importer (scripts/import-masterdata-sheet-staging.mjs) and the gate
 * (scripts/check-masterdata-sheet-import.mjs) share one definition and the gate
 * can exercise it without a database or a network.
 *
 * WHAT THE SHEET LOOKS LIKE (measured 2026-09-10, see the vault note
 * "Masterdata sheet V1 — structure read 2026-09-10")
 * ------------------------------------------------------------------
 *   tab "V1 Kunden-Services": row 1 = seven merged group headers, row 2 = 43
 *     column names, data from row 3. 247 service rows. Two columns are both
 *     called "Kunde" (A: display name, K: legal name at the location), so
 *     columns are addressed BY POSITION and the header text is asserted.
 *   tab "Kontakte": row 1 = 35 column names, data from row 2. 835 customers,
 *     Kundennummer unique.
 *   the other three tabs (RMF, Kunden-Services, Copy of Kunden-Services) are a
 *     legend and templates; they are never read.
 *
 * STORAGE TYPES ARE NOT WHAT THE COLUMN LOOKS LIKE. Kundennummer is a number in
 * 196 cells and text in 51; dates are text in three shapes plus real dates;
 * hours carry German decimals ("26,5") and "-" for n/a; phone numbers are
 * sometimes numbers (leading zero lost). Every parser here takes the cell as
 * the reader delivers it and returns either a typed value or null -- never a
 * plausible zero (house rule: honest nulls).
 *
 * THE KEYS
 * --------
 *   customer: Kundennummer, the five-digit Lexware customer number (text).
 *   service order: "Order-Number NEU" = Kundennummer_AB(5 digits)_ServiceNummer.Sprache_Teilprojekt(2 digits),
 *     re-derived here from its five parts and compared with the sheet's formula
 *     column; a difference is a review case, never silently accepted.
 *   person: first name, normalised, against public.people -- the rule the August
 *     importer set; ambiguity is unmatched, never a guess.
 *   legacy: "Order-Number ALT (OLD)" -- the key the warehouse holds today
 *     (public.projects.code / projects.project_order.order_number, 231 of 232
 *     match exactly). It bridges the two worlds and is carried as an alias.
 */

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";

export const SERVICE_TAB = "V1 Kunden-Services";
export const CONTACT_TAB = "Kontakte";
export const SERVICE_SHEET_NAME = "service_orders";   // raw_payload.sheet_name for service rows
export const CONTACT_SHEET_NAME = "contacts";          // raw_payload.sheet_name for customer rows

// Column contract for "V1 Kunden-Services". `purple` marks the columns the
// sheet's owner coloured magenta in the header row -- hitul confirmed on
// 2026-09-10 that these are what an operations person sees in My Work.
export const SERVICE_COLUMNS = [
  ["A", "Kunde", "customer_display_name", true],
  ["B", "Order-Number ALT (OLD)", "order_number_old", false],
  ["C", "Order-Number NEU", "order_number_sheet", false],
  ["D", "Kundennummer / Customer Number", "customer_number", true],
  ["E", "Service Name", "service_name", false],
  ["F", "Auftragsbestätigungsnummer / Order Confirmation", "order_confirmation_number", false],
  ["G", "Service Nummer", "service_number", false],
  ["H", "Sprache (1= Deutsch; 2= Englisch)", "language", true],
  ["I", "Teilprojektnummer / Jahresvertragsnummer", "subproject_number", false],
  ["J", "Unternehmensverband", "corporate_group", false],
  ["K", "Kunde", "customer_name", false],
  ["L", "Postleitzahl", "postal_code", true],
  ["M", "Ort", "city", true],
  ["N", "Straße / Hausnummer", "street", true],
  ["O", "Auftragsname", "order_name", false],
  ["P", "Vertragsstatus", "contract_status", false],
  ["Q", "Startdatum", "contract_start", true],
  ["R", "Vertragsende", "contract_end", true],
  ["S", "Vertragsstunden (abrechenbar)", "contract_hours", true],
  ["T", "Geplante abrechenbare Stunden", "planned_hours", false],
  ["U", "Vor-Ort-Faktor", "onsite_factor", false],
  ["V", "Vor-Ort-Stunden", "onsite_hours", false],
  ["W", "Remote-Stunden", "remote_hours", false],
  ["X", "Nutzer Reteach (nur fuer Reteach Services)", "reteach_users", false],
  ["Y", "Serviceverantwortliche Person", "responsible_name", true],
  ["Z", "Rolle / Funktion", "role", true],
  ["AA", "Vertretung", "replacement_name", true],
  ["AB", "mindestens Zeit vor Ort", "min_onsite_time", true],
  ["AC", "Pauschale Anfahrt", "travel_flat_rate", true],
  ["AD", "Reisezeit als Projektzeit", "travel_as_project_time", true],
  ["AE", "Name (Ansprechpartner 1)", "contact1_name", true],
  ["AF", "Telefonnummer (Ansprechpartner 1)", "contact1_phone", true],
  ["AG", "E-Mail-Adresse (Ansprechpartner 1)", "contact1_email", true],
  ["AH", "Name (Ansprechpartner 2)", "contact2_name", true],
  ["AI", "Telefonnummer (Ansprechpartner 2)", "contact2_phone", true],
  ["AJ", "E-Mail-Adresse (Ansprechpartner 2)", "contact2_email", true],
  ["AK", "Google-Chatgruppe", "link_google_chat", true],
  ["AL", "Dateiablage", "file_storage", true],
  ["AM", "Zeiterfassungslink", "link_trackingtime", true],
  ["AN", "Asana-Link", "link_asana", true],
  ["AO", "Google-Link", "link_google_drive", true],
  ["AP", "Microsoft-Teams-Link", "link_microsoft_teams", true],
  ["AQ", "Notizen", "notes", false],
];
// The header is found by content, not by a fixed row number: the sheet's
// first rows are a merged group band and, measured on 2026-09-10, the column
// names sit on sheet row 4 (rows 1-2 blank, row 3 the band). An inserted blank
// row must not break the import; a renamed column must.
export const SERVICE_HEADER_ANCHOR = ["B", "Order-Number ALT (OLD)"];

export const CONTACT_COLUMNS = [
  ["A", "Kundennummer", "customer_number"],
  ["B", "Lieferantennummer", "supplier_number"],
  ["C", "Firmenname", "company_name"],
  ["D", "Anrede", "salutation"],
  ["E", "Kontakt", "contact_name"],
  ["F", "Vorname", "first_name"],
  ["G", "Nachname", "last_name"],
  ["H", "Steuernummer", "tax_number"],
  ["I", "Umsatzsteuer ID", "vat_id"],
  ["J", "Adresszusatz 1", "address_extra"],
  ["K", "Straße 1", "street"],
  ["L", "PLZ 1", "postal_code"],
  ["M", "Ort 1", "city"],
  ["N", "Land 1", "country_code"],
  ["O", "Adresszusatz 2", "address_extra_2"],
  ["P", "Straße 2", "street_2"],
  ["Q", "PLZ 2", "postal_code_2"],
  ["R", "Ort 2", "city_2"],
  ["S", "Land 2", "country_code_2"],
  ["T", "Telefon 1", "phone_1"],
  ["U", "Telefon 2", "phone_2"],
  ["V", "E-Mail 1", "email_1"],
  ["W", "E-Mail 2", "email_2"],
  ["X", "Ansprechpartner 1", "contact1_name"],
  ["Y", "Ansprechpartner 1 Anrede", "contact1_salutation"],
  ["Z", "Ansprechpartner 1 Vorname", "contact1_first_name"],
  ["AA", "Ansprechpartner 1 Nachname", "contact1_last_name"],
  ["AB", "Ansprechpartner 1 E-Mail", "contact1_email"],
  ["AC", "Ansprechpartner 1 Telefon", "contact1_phone"],
  ["AD", "Ansprechpartner 2", "contact2_name"],
  ["AE", "Ansprechpartner 2 Anrede", "contact2_salutation"],
  ["AF", "Ansprechpartner 2 Vorname", "contact2_first_name"],
  ["AG", "Ansprechpartner 2 Nachname", "contact2_last_name"],
  ["AH", "Ansprechpartner 2 E-Mail", "contact2_email"],
  ["AI", "Ansprechpartner 2 Telefon", "contact2_phone"],
];
export const CONTACT_HEADER_ANCHOR = ["A", "Kundennummer"];

export const PURPLE_KEYS = SERVICE_COLUMNS.filter((c) => c[3]).map((c) => c[2]);

// ---------------------------------------------------------------- reading

// The workbook reader is Python's zipfile + ElementTree, the same choice as
// import-customer-master-staging.mjs: no npm dependency, and the rig and CI
// both carry python3. Cells come back typed -- numbers as numbers, dates (by
// number format) as ISO strings, everything else as text -- addressed by
// column letter, with the sheet row number preserved.
const PYTHON_XLSX_READER = String.raw`
import json, re, sys, zipfile, datetime
import xml.etree.ElementTree as ET
ns = {"m": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}
rns = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
path, wanted = sys.argv[1], json.loads(sys.argv[2])
z = zipfile.ZipFile(path)
wb = ET.fromstring(z.read("xl/workbook.xml"))
rels = ET.fromstring(z.read("xl/_rels/workbook.xml.rels"))
rid = {r.get("Id"): r.get("Target") for r in rels}
shared = []
if "xl/sharedStrings.xml" in z.namelist():
    shared = ["".join(t.text or "" for t in si.iter("{%s}t" % ns["m"]))
              for si in ET.fromstring(z.read("xl/sharedStrings.xml")).findall("m:si", ns)]
styles = ET.fromstring(z.read("xl/styles.xml"))
numfmts = {nf.get("numFmtId"): nf.get("formatCode") or "" for nf in styles.iter("{%s}numFmt" % ns["m"])}
cellxfs = styles.find("m:cellXfs", ns)
xfs = [xf.get("numFmtId") for xf in cellxfs] if cellxfs is not None else []
BUILTIN_DATES = {"14", "15", "16", "17", "22"}
def is_date(style):
    if style is None or int(style) >= len(xfs): return False
    fid = xfs[int(style)]
    if fid in BUILTIN_DATES: return True
    code = numfmts.get(fid, "").lower()
    return bool(re.search(r"[dmy]", code)) and "general" not in code and "#" not in code and "0" not in code
def col_letters(ref): return re.match(r"[A-Z]+", ref).group(0)
out = {}
for s in wb.find("m:sheets", ns):
    name = s.get("name")
    if name not in wanted: continue
    target = rid[s.get("{%s}id" % rns)].lstrip("/")
    root = ET.fromstring(z.read(target if target.startswith("xl/") else "xl/" + target))
    rows = []
    for row in root.iter("{%s}row" % ns["m"]):
        cells = {}
        for c in row.findall("m:c", ns):
            v = c.find("m:v", ns); t = c.get("t")
            if v is None or v.text is None: continue
            if t == "s": val = shared[int(v.text)]
            elif t == "inlineStr": val = "".join(x.text or "" for x in c.iter("{%s}t" % ns["m"]))
            elif t in ("str", "e"): val = v.text
            elif t == "b": val = v.text == "1"
            else:
                if is_date(c.get("s")):
                    try: val = (datetime.date(1899, 12, 30) + datetime.timedelta(days=float(v.text))).isoformat()
                    except Exception: val = v.text
                else:
                    x = float(v.text); val = int(x) if x == int(x) else x
            if isinstance(val, str) and val.strip() == "": continue
            cells[col_letters(c.get("r"))] = val
        if cells: rows.append({"r": int(row.get("r")), "cells": cells})
    out[name] = rows
json.dump(out, sys.stdout, ensure_ascii=False)
`;

export function sha256(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

/** Read the two data tabs. Returns { [tabName]: [{ r, cells: { A: value } }] } and the file hash. */
export function readWorkbook(filePath) {
  if (!existsSync(filePath)) {
    throw new Error(`Masterdata sheet export not found: ${filePath} (export the Google Sheet as xlsx and put it there, or set MASTERDATA_SHEET_XLSX)`);
  }
  const bytes = readFileSync(filePath);
  const run = spawnSync("python3", ["-c", PYTHON_XLSX_READER, filePath, JSON.stringify([SERVICE_TAB, CONTACT_TAB])], {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  if (run.status !== 0) {
    throw new Error(`workbook reader failed: ${run.stderr || run.error?.message || `exit ${run.status}`}`);
  }
  const tabs = JSON.parse(run.stdout);
  for (const tab of [SERVICE_TAB, CONTACT_TAB]) {
    if (!tabs[tab]) throw new Error(`tab "${tab}" is missing from the workbook -- the sheet's tab names are part of the contract; refuse rather than guess`);
  }
  return { tabs, fileHash: sha256(bytes), bytes: bytes.length };
}

// ---------------------------------------------------------------- headers

const squash = (s) => String(s ?? "").replace(/\s+/g, " ").trim();

/** The sheet row number carrying the column names: the first row (within the top 10) whose anchor cell matches. */
export function findHeaderRow(rows, anchor) {
  const [letter, expected] = anchor;
  const hit = rows.find((row) => row.r <= 10 && squash(row.cells[letter]) === squash(expected));
  return hit ? hit.r : null;
}

/** Assert every expected header sits where the contract says. Returns { headerRow, drift[] }. */
export function headerDrift(rows, anchor, columns) {
  const headerRow = findHeaderRow(rows, anchor);
  if (!headerRow) return { headerRow: null, drift: [`no header row found: no cell ${anchor[0]} equal to "${anchor[1]}" in the first 10 rows`] };
  const header = rows.find((row) => row.r === headerRow);
  const drift = [];
  for (const [letter, expected] of columns) {
    const actual = squash(header.cells[letter]);
    if (actual !== squash(expected)) drift.push(`column ${letter}: expected "${expected}", found "${actual || "(empty)"}"`);
  }
  const extra = Object.keys(header.cells).filter((letter) => !columns.some((c) => c[0] === letter) && squash(header.cells[letter]));
  for (const letter of extra) drift.push(`column ${letter}: unexpected header "${squash(header.cells[letter])}"`);
  return { headerRow, drift };
}

/** Data rows are everything below the header row. */
export function dataRows(rows, headerRow) {
  return rows.filter((row) => row.r > headerRow);
}

// ---------------------------------------------------------------- parsers

const isBlank = (v) => v === null || v === undefined || (typeof v === "string" && v.trim() === "");
const NA = new Set(["-", "–", "—", "n/a", "na", "k.a.", "keine"]);
const isNa = (v) => typeof v === "string" && NA.has(v.trim().toLowerCase());

/** Five-digit Lexware customer number as text, or null. Numbers and text both occur in the sheet. */
export function parseCustomerNumber(v) {
  if (isBlank(v)) return null;
  const digits = String(v).trim().replace(/\.0$/, "");
  return /^\d{5}$/.test(digits) ? digits : null;
}

/** ISO date or null. Accepts ISO (what the reader returns for real dates), dd.mm.yyyy, and n/a markers. Returns { value, error }. */
export function parseDate(v) {
  if (isBlank(v) || isNa(v)) return { value: null, error: null };
  const s = String(v).trim();
  let m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (m) return checkDate(m[1], m[2], m[3], s);
  m = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/.exec(s);
  if (m) return checkDate(m[3], m[2].padStart(2, "0"), m[1].padStart(2, "0"), s);
  return { value: null, error: `unparsable date "${s}"` };
}
function checkDate(y, mo, d, raw) {
  const date = new Date(Date.UTC(+y, +mo - 1, +d));
  const ok = date.getUTCFullYear() === +y && date.getUTCMonth() === +mo - 1 && date.getUTCDate() === +d;
  return ok ? { value: `${y}-${mo}-${d}`, error: null } : { value: null, error: `impossible date "${raw}"` };
}

/** Hours as a number or null. "26,5" is 26.5; "-" is null (n/a), never 0. Returns { value, error }. */
export function parseHours(v) {
  if (isBlank(v) || isNa(v)) return { value: null, error: null };
  if (typeof v === "number") return Number.isFinite(v) ? { value: v, error: null } : { value: null, error: "non-finite number" };
  const s = String(v).trim().replace(/\s/g, "");
  if (/^-?\d+(?:[.,]\d+)?$/.test(s)) return { value: Number(s.replace(",", ".")), error: null };
  return { value: null, error: `unparsable hours "${String(v).trim()}"` };
}

/** "Ja"/"Nein" as a boolean; anything else keeps its text and yields null. */
export function parseYesNo(v) {
  if (isBlank(v)) return { value: null, text: null };
  const s = String(v).trim();
  if (/^ja$/i.test(s)) return { value: true, text: null };
  if (/^nein$/i.test(s)) return { value: false, text: null };
  return { value: null, text: s };
}

/** A URL or null. The sheet's placeholder "Link einfügen" and any other text are null. */
export function parseLink(v) {
  if (isBlank(v)) return null;
  const s = String(v).trim();
  return /^https?:\/\/\S+$/i.test(s) ? s : null;
}

/** Phone as text. A numeric cell lost its leading zero in the sheet; that is flagged, not repaired. */
export function parsePhone(v) {
  if (isBlank(v)) return { value: null, storedAsNumber: false };
  if (typeof v === "number") return { value: String(v), storedAsNumber: true };
  return { value: String(v).trim(), storedAsNumber: false };
}

export function parseLanguage(v) {
  if (isBlank(v)) return null;
  const n = Number(String(v).trim());
  return n === 1 || n === 2 ? n : null;
}

export function parseInteger(v) {
  if (isBlank(v) || isNa(v)) return null;
  const n = Number(String(v).trim());
  return Number.isInteger(n) ? n : null;
}

const text = (v) => (isBlank(v) ? null : String(v).trim());
const textNa = (v) => (isBlank(v) || isNa(v) ? null : String(v).trim());

/**
 * "DOC" and "OTHER" in the responsible/replacement columns are not people:
 * DOC is the company doctor (Betriebsarzt) for the occupational-medicine
 * services, OTHER means "someone else / not assigned here". Measured
 * 2026-09-10: 133 DOC and 13 OTHER cells against 294 real names. They must not
 * be looked up as people, and they are information for the reviewer, not a
 * defect of the row.
 */
export function personSentinel(name) {
  const s = String(name ?? "").trim().toUpperCase();
  if (s === "DOC") return "doctor";
  if (s === "OTHER") return "other";
  return null;
}

// ---------------------------------------------------------------- keys

/** Kundennummer_AB(5)_Service.Sprache_Teilprojekt(2), or null when a part is missing. */
export function deriveOrderNumber({ customer_number, order_confirmation_number, service_number, language, subproject_number }) {
  if (!customer_number || !order_confirmation_number || service_number === null || language === null || subproject_number === null) return null;
  const ab = String(order_confirmation_number).replace(/\D/g, "");
  if (!ab) return null;
  return `${customer_number}_${ab.padStart(5, "0")}_${service_number}.${language}_${String(subproject_number).padStart(2, "0")}`;
}

// The warehouse holds one legacy key with an empty service part ("10905_00357__01")
// and one with single digits ("10634_0_4_01"); exact-key matching means the string
// is taken as it is, so the shape check is deliberately loose in the middle.
export const OLD_KEY = /^\d{5}_\d*_\d*_\d{2}$/;
export const NEW_KEY = /^\d{5}_\d{5}_\d{4}\.[12]_\d{2}$/;

const prefix = (key) => (key ? key.split("_").slice(0, 2).join("_") : null);

// ---------------------------------------------------------------- rows

/** One service row -> { values, source_values, errors } with every column parsed. */
export function normaliseServiceRow(row) {
  const cells = row.cells;
  const source_values = {};
  for (const [letter, header] of SERVICE_COLUMNS) if (cells[letter] !== undefined) source_values[header] = cells[letter];
  const raw = Object.fromEntries(SERVICE_COLUMNS.map(([letter, , key]) => [key, cells[letter] ?? null]));
  const errors = [];
  const flags = [];
  const take = (parsed, label) => {
    if (parsed.error) errors.push(`${label}: ${parsed.error}`);
    return parsed.value;
  };
  const start = take(parseDate(raw.contract_start), "contract_start");
  const end = take(parseDate(raw.contract_end), "contract_end");
  const travelFlat = parseYesNo(raw.travel_flat_rate);
  const travelTime = parseYesNo(raw.travel_as_project_time);
  const phone1 = parsePhone(raw.contact1_phone);
  const phone2 = parsePhone(raw.contact2_phone);
  if (phone1.storedAsNumber || phone2.storedAsNumber) flags.push("PHONE_STORED_AS_NUMBER");
  const values = {
    sheet_row: row.r,
    customer_display_name: text(raw.customer_display_name),
    order_number_old: OLD_KEY.test(String(raw.order_number_old ?? "").trim()) ? String(raw.order_number_old).trim() : null,
    order_number_sheet: textNa(raw.order_number_sheet),
    customer_number: parseCustomerNumber(raw.customer_number),
    service_name: text(raw.service_name),
    order_confirmation_number: text(raw.order_confirmation_number),
    service_number: parseInteger(raw.service_number),
    language: parseLanguage(raw.language),
    subproject_number: parseInteger(raw.subproject_number),
    corporate_group: textNa(raw.corporate_group),
    customer_name: text(raw.customer_name),
    postal_code: textNa(raw.postal_code),
    city: textNa(raw.city),
    street: textNa(raw.street),
    order_name: text(raw.order_name),
    contract_status: text(raw.contract_status),
    contract_start: start,
    contract_end: end,
    contract_hours: take(parseHours(raw.contract_hours), "contract_hours"),
    planned_hours: take(parseHours(raw.planned_hours), "planned_hours"),
    onsite_factor: take(parseHours(raw.onsite_factor), "onsite_factor"),
    onsite_hours: take(parseHours(raw.onsite_hours), "onsite_hours"),
    remote_hours: take(parseHours(raw.remote_hours), "remote_hours"),
    reteach_users: parseInteger(raw.reteach_users),
    responsible_name: text(raw.responsible_name),
    role: text(raw.role),
    replacement_name: text(raw.replacement_name),
    min_onsite_time: textNa(raw.min_onsite_time),
    travel_flat_rate: travelFlat.value,
    travel_flat_rate_text: travelFlat.text,
    travel_as_project_time: travelTime.value,
    travel_as_project_time_text: travelTime.text,
    contact1_name: text(raw.contact1_name),
    contact1_phone: phone1.value,
    contact1_email: text(raw.contact1_email),
    contact2_name: text(raw.contact2_name),
    contact2_phone: phone2.value,
    contact2_email: text(raw.contact2_email),
    link_google_chat: parseLink(raw.link_google_chat),
    file_storage: text(raw.file_storage),
    link_trackingtime: parseLink(raw.link_trackingtime),
    link_asana: parseLink(raw.link_asana),
    link_google_drive: parseLink(raw.link_google_drive),
    link_microsoft_teams: parseLink(raw.link_microsoft_teams),
    notes: text(raw.notes),
  };
  if (raw.order_number_old && !values.order_number_old && !isNa(raw.order_number_old)) errors.push(`order_number_old: unrecognised shape "${String(raw.order_number_old).trim()}"`);
  values.order_number = deriveOrderNumber(values);
  if (raw.customer_number !== null && values.customer_number === null) errors.push(`customer_number: not five digits "${String(raw.customer_number).trim()}"`);
  if (values.order_number && values.order_number_sheet && values.order_number !== values.order_number_sheet) flags.push("KEY_FORMULA_MISMATCH");
  if (values.order_number && !values.order_number_sheet) flags.push("KEY_MISSING_IN_SHEET");
  if (values.language === null) flags.push("MISSING_LANGUAGE");
  if (values.order_number_old && values.order_number && prefix(values.order_number_old) !== prefix(values.order_number)) flags.push("KEY_PREFIX_MISMATCH");
  if (!values.order_number_old) flags.push("NEW_SERVICE");
  if (!values.responsible_name) flags.push("NO_RESPONSIBLE");
  if (values.contract_end && values.contract_status && /^offen$/i.test(values.contract_status) && values.contract_end < todayIso()) flags.push("ENDED_BUT_OPEN");
  // the page groups by these; keep the names the review page already understands
  values.customer_id = values.customer_number;
  return { values, source_values, errors, flags };
}

export function normaliseContactRow(row) {
  const cells = row.cells;
  const source_values = {};
  for (const [letter, header] of CONTACT_COLUMNS) if (cells[letter] !== undefined) source_values[header] = cells[letter];
  const raw = Object.fromEntries(CONTACT_COLUMNS.map(([letter, , key]) => [key, cells[letter] ?? null]));
  const errors = [];
  const flags = [];
  const phones = {};
  for (const key of ["phone_1", "phone_2", "contact1_phone", "contact2_phone"]) {
    const p = parsePhone(raw[key]);
    phones[key] = p.value;
    if (p.storedAsNumber && !flags.includes("PHONE_STORED_AS_NUMBER")) flags.push("PHONE_STORED_AS_NUMBER");
  }
  const values = {
    sheet_row: row.r,
    customer_number: parseCustomerNumber(raw.customer_number),
    supplier_number: text(raw.supplier_number),
    company_name: text(raw.company_name),
    salutation: text(raw.salutation),
    contact_name: text(raw.contact_name),
    first_name: text(raw.first_name),
    last_name: text(raw.last_name),
    tax_number: text(raw.tax_number),
    vat_id: text(raw.vat_id),
    address_extra: text(raw.address_extra),
    street: text(raw.street),
    postal_code: text(raw.postal_code),
    city: text(raw.city),
    country_code: text(raw.country_code),
    address_extra_2: text(raw.address_extra_2),
    street_2: text(raw.street_2),
    postal_code_2: text(raw.postal_code_2),
    city_2: text(raw.city_2),
    country_code_2: text(raw.country_code_2),
    ...phones,
    email_1: text(raw.email_1),
    email_2: text(raw.email_2),
    contact1_name: text(raw.contact1_name),
    contact1_salutation: text(raw.contact1_salutation),
    contact1_first_name: text(raw.contact1_first_name),
    contact1_last_name: text(raw.contact1_last_name),
    contact1_email: text(raw.contact1_email),
    contact2_name: text(raw.contact2_name),
    contact2_salutation: text(raw.contact2_salutation),
    contact2_first_name: text(raw.contact2_first_name),
    contact2_last_name: text(raw.contact2_last_name),
    contact2_email: text(raw.contact2_email),
  };
  if (raw.customer_number !== null && values.customer_number === null) errors.push(`customer_number: not five digits "${String(raw.customer_number).trim()}"`);
  if (!values.company_name) flags.push("NO_COMPANY_NAME");
  values.customer_id = values.customer_number;
  values.customer_name = values.company_name;
  return { values, source_values, errors, flags };
}

let clock = () => new Date();
export function setClock(fn) { clock = fn; }
export function todayIso() { return clock().toISOString().slice(0, 10); }

// ---------------------------------------------------------------- sheet-level checks

/** Flags that need the whole tab: duplicate keys. Mutates each entry's flags. */
export function flagDuplicateKeys(serviceRows) {
  const byNew = new Map();
  const byOld = new Map();
  for (const entry of serviceRows) {
    const { order_number, order_number_old } = entry.values;
    if (order_number) byNew.set(order_number, (byNew.get(order_number) ?? 0) + 1);
    if (order_number_old) byOld.set(order_number_old, (byOld.get(order_number_old) ?? 0) + 1);
  }
  for (const entry of serviceRows) {
    const { order_number, order_number_old } = entry.values;
    if (order_number && byNew.get(order_number) > 1) entry.flags.push("DUPLICATE_ORDER_KEY");
    if (order_number_old && byOld.get(order_number_old) > 1) entry.flags.push("DUPLICATE_OLD_KEY");
  }
  return serviceRows;
}

// Flags that block promotion. Everything else is information the reviewer
// sees but does not have to act on. NEW_SERVICE is deliberately NOT blocking
// (hitul, 2026-09-10: "new data should be live too"): a service row that is
// clean in every other respect -- key derivable, customer known to the
// warehouse, hours stated -- is inserted by the hourly promote without a
// reviewer. What blocks a new row is a real defect in it, not its newness.
export const BLOCKING_FLAGS = new Set([
  "DUPLICATE_ORDER_KEY",
  "DUPLICATE_OLD_KEY",
  "MISSING_LANGUAGE",
  "KEY_FORMULA_MISMATCH",
  "KEY_PREFIX_MISMATCH",
  "UNKNOWN_OLD_KEY",
  "UNMATCHED_RESPONSIBLE",
  "UNMATCHED_RESPONSIBLE_AMBIGUOUS",
  "UNMATCHED_REPLACEMENT",
  "UNMATCHED_REPLACEMENT_AMBIGUOUS",
  "CUSTOMER_NOT_IN_WAREHOUSE",
]);

/**
 * Decide the staging statuses for one row from its errors and flags.
 *   validation_status: invalid when a cell could not be read as what it must be
 *   resolution_status: matched when the customer resolves to a legal entity, else unresolved
 *   review_status:     review_required when anything blocks promotion, else unreviewed
 */
export function classify({ errors, flags, candidateLegalEntityId }) {
  const blocking = flags.filter((f) => BLOCKING_FLAGS.has(f));
  const validation_status = errors.length ? "invalid" : "valid";
  const resolution_status = candidateLegalEntityId ? "matched" : "unresolved";
  const review_status = errors.length || blocking.length ? "review_required" : "unreviewed";
  const review_reason = [...errors, ...flags].join(" · ") || null;
  return { validation_status, validation_error: errors.join("; ") || null, resolution_status, review_status, review_reason };
}
