/**
 * The masterdata sheet is read the way the warehouse needs it, and nothing
 * about it is guessed.
 *
 * WHY THIS GATE EXISTS. The sheet "V1 HSE-Masterdata Kundenliste" (2026-09-10)
 * is hand-maintained by the business side and is never edited by us, so every
 * quirk in it is permanent until its owner changes it: two columns called
 * "Kunde", customer numbers that are numbers in 196 cells and text in 51, dates
 * in three shapes, hours with German decimals and "-" for n/a, phone numbers
 * stored as numbers. The importer (import-masterdata-sheet-staging.mjs) parses
 * all of that through scripts/lib/masterdata-sheet.mjs. This gate pins the
 * behaviour that matters for correctness:
 *
 *   - the header contract: a renamed or moved column REFUSES the import
 *   - the keys: the new order number is derived from its five parts and equals
 *     the sheet's formula; the legacy key is carried as-is
 *   - honest nulls: "-" and "" are null, never 0; "26,5" is 26.5
 *   - the flags that decide review: duplicates, missing language, prefix
 *     mismatch, new services, unmatched people are review_required; ended-but-
 *     open and phone-as-number are information only
 *
 * It is a static gate on purpose: no database, no network, no credentials, so
 * it runs on every unattended cycle. Live resolution (customer in the
 * warehouse, person by name) is the importer's job and is checked in dry-run
 * output, not here.
 */
import { record } from "./lib/gate-result.mjs";
import {
  SERVICE_COLUMNS, CONTACT_COLUMNS, SERVICE_HEADER_ANCHOR, CONTACT_HEADER_ANCHOR, PURPLE_KEYS,
  headerDrift, dataRows, normaliseServiceRow, normaliseContactRow, flagDuplicateKeys, classify,
  parseCustomerNumber, parseDate, parseHours, parseYesNo, parseLink, parsePhone, deriveOrderNumber, OLD_KEY, NEW_KEY, setClock, personSentinel,
} from "./lib/masterdata-sheet.mjs";

let failures = 0;
const check = (ok, label, detail = "") => {
  record(ok);
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
};
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
setClock(() => new Date("2026-09-10T09:00:00Z"));

// ---- header contract
const serviceHeader = { r: 4, cells: Object.fromEntries(SERVICE_COLUMNS.map(([l, h]) => [l, h])) };
const band = { r: 3, cells: { B: "Service und Auftragskennungen" } };
const good = headerDrift([band, serviceHeader], SERVICE_HEADER_ANCHOR, SERVICE_COLUMNS);
check(good.headerRow === 4 && good.drift.length === 0, "header row is found by content below the merged band", JSON.stringify(good));
const renamed = { r: 4, cells: { ...serviceHeader.cells, S: "Stunden" } };
const drift = headerDrift([band, renamed], SERVICE_HEADER_ANCHOR, SERVICE_COLUMNS);
check(drift.drift.length === 1 && /column S/.test(drift.drift[0]), "a renamed column is reported as drift", drift.drift.join("; "));
const shifted = { r: 4, cells: Object.fromEntries(SERVICE_COLUMNS.map(([, h], i) => [SERVICE_COLUMNS[(i + 1) % SERVICE_COLUMNS.length][0], h])) };
const shiftedResult = headerDrift([shifted], SERVICE_HEADER_ANCHOR, SERVICE_COLUMNS);
check(shiftedResult.headerRow === null && shiftedResult.drift.length === 1, "a shifted layout is refused, not remapped", shiftedResult.drift.join("; "));
check(headerDrift([band], SERVICE_HEADER_ANCHOR, SERVICE_COLUMNS).headerRow === null, "no header row means no header row");
const contactHeader = { r: 1, cells: Object.fromEntries(CONTACT_COLUMNS.map(([l, h]) => [l, h])) };
check(headerDrift([contactHeader], CONTACT_HEADER_ANCHOR, CONTACT_COLUMNS).drift.length === 0, "Kontakte header contract holds");
check(eq(dataRows([band, serviceHeader, { r: 5, cells: { A: "x" } }], 4).map((r) => r.r), [5]), "data rows are the rows below the header");
check(SERVICE_COLUMNS.length === 43 && CONTACT_COLUMNS.length === 35 && PURPLE_KEYS.length === 27, "contract sizes: 43 service columns, 35 contact columns, 27 purple");

// ---- parsers: honest nulls
check(parseCustomerNumber(10275) === "10275" && parseCustomerNumber("10275") === "10275" && parseCustomerNumber(" 10275 ") === "10275", "customer number: number or text becomes five-digit text");
check(parseCustomerNumber("1027") === null && parseCustomerNumber("On Cloud") === null && parseCustomerNumber(null) === null, "customer number: anything but five digits is null");
check(eq(parseDate("01.03.2026"), { value: "2026-03-01", error: null }) && eq(parseDate("2026-03-01"), { value: "2026-03-01", error: null }), "dates: dd.mm.yyyy and ISO both parse");
check(eq(parseDate("-"), { value: null, error: null }) && eq(parseDate(""), { value: null, error: null }), "dates: '-' is null, not an error");
check(parseDate("31.02.2026").error !== null && parseDate("soon").error !== null, "dates: impossible or free text is an error");
check(eq(parseHours(120), { value: 120, error: null }) && eq(parseHours("26,5"), { value: 26.5, error: null }) && eq(parseHours("160,1"), { value: 160.1, error: null }), "hours: numbers and German decimals");
check(eq(parseHours("-"), { value: null, error: null }) && parseHours("").value === null && parseHours("-").value !== 0, "hours: '-' is null, never 0");
check(parseHours("pauschal").error !== null, "hours: text is an error");
check(parseYesNo("Ja").value === true && parseYesNo("Nein").value === false && eq(parseYesNo("pro Kilometer bis zu 200"), { value: null, text: "pro Kilometer bis zu 200" }), "yes/no keeps free text instead of guessing");
check(parseLink("https://chat.google.com/room/x") === "https://chat.google.com/room/x" && parseLink("Link einfügen") === null && parseLink("Google Drive") === null, "links: only URLs survive");
check(eq(parsePhone(1701234567), { value: "1701234567", storedAsNumber: true }) && eq(parsePhone("0170 1234567"), { value: "0170 1234567", storedAsNumber: false }), "phones: numeric cells are flagged, not repaired");

check(personSentinel("DOC") === "doctor" && personSentinel(" other ") === "other" && personSentinel("Mathias Schwenteit") === null, "DOC and OTHER are placeholders, not people to look up");

// ---- keys
check(deriveOrderNumber({ customer_number: "10275", order_confirmation_number: "AB0123", service_number: 1001, language: 1, subproject_number: 1 }) === "10275_00123_1001.1_01", "new key = Kundennummer_AB(5)_Service.Sprache_Teilprojekt(2)");
check(deriveOrderNumber({ customer_number: "10275", order_confirmation_number: "AB0123", service_number: 1001, language: null, subproject_number: 1 }) === null, "new key is null without a language");
check(NEW_KEY.test("10275_00123_1001.1_01") && !NEW_KEY.test("10275_00123_104_01") && OLD_KEY.test("10275_00123_104_01") && OLD_KEY.test("10905_00357__01") && OLD_KEY.test("10634_0_4_01"), "key shapes: the warehouse's odd legacy keys are accepted as-is");

// ---- rows
const cells = (o) => ({ r: 10, cells: o });
const base = {
  A: "Beispielwerk", B: "10275_00123_104_01", C: "10275_00123_1001.1_01", D: 10275, E: "1000 DGUV V2: Safety", F: "AB0123", G: 1001, H: 1, I: 1,
  J: "Beispiel Holding", K: "Beispielwerk Berlin GmbH", L: "10115", M: "Berlin", N: "Musterstraße 10", O: "Regelbetreuung 2026", P: "Offen",
  Q: "01.01.2026", R: "2027-12-31", S: 120, T: "116,00", U: 1.25, V: 72, W: 44, X: "-", Y: "Mathias Muster", Z: "Sifa", AA: "Erika Ersatz",
  AB: "2h", AC: "Ja", AD: "Nein", AE: "Kontakt Eins", AF: 1701234567, AG: "k1@example.com", AK: "Link einfügen", AL: "Google Drive",
  AM: "https://tt.example/1", AN: "https://asana.example/1", AO: "https://drive.example/1", AQ: "note",
};
const row = normaliseServiceRow(cells(base));
check(row.errors.length === 0, "a well-formed row has no errors", row.errors.join("; "));
check(row.values.order_number === "10275_00123_1001.1_01" && row.values.order_number === row.values.order_number_sheet, "derived key equals the sheet's formula column");
check(row.values.customer_number === "10275" && row.values.customer_id === "10275", "customer number is text and doubles as the review page's customer_id");
check(row.values.contract_start === "2026-01-01" && row.values.contract_end === "2027-12-31" && row.values.contract_hours === 120 && row.values.planned_hours === 116, "dates and hours parsed into typed values");
check(row.values.reteach_users === null && row.values.link_google_chat === null && row.values.link_asana === "https://asana.example/1", "'-' and placeholders are null; real links survive");
check(eq(row.flags, ["PHONE_STORED_AS_NUMBER"]), "a clean row carries only the phone-as-number note", row.flags.join(","));
check(eq(Object.keys(row.source_values).slice(0, 2), ["Kunde", "Order-Number ALT (OLD)"]), "source_values keep the sheet's own headers");

const ended = normaliseServiceRow(cells({ ...base, R: "01.02.2026" }));
check(ended.flags.includes("ENDED_BUT_OPEN"), "Offen with a past Vertragsende is flagged as information");
const noLang = normaliseServiceRow(cells({ ...base, H: null, C: null }));
check(noLang.values.order_number === null && noLang.flags.includes("MISSING_LANGUAGE"), "no language: no key, flagged");
const prefixMismatch = normaliseServiceRow(cells({ ...base, B: "10305_00327_104_01" }));
check(prefixMismatch.flags.includes("KEY_PREFIX_MISMATCH"), "old and new key naming different customers is flagged");
const fresh = normaliseServiceRow(cells({ ...base, B: "-" }));
check(fresh.values.order_number_old === null && fresh.flags.includes("NEW_SERVICE") && fresh.errors.length === 0, "'-' as old key is a new service, not an error");
const badHours = normaliseServiceRow(cells({ ...base, S: "pauschal" }));
check(badHours.errors.some((e) => /contract_hours/.test(e)) && badHours.values.contract_hours === null, "unparsable hours are an error and null, never 0");
const formulaOff = normaliseServiceRow(cells({ ...base, C: "10275_00123_1001.2_01" }));
check(formulaOff.flags.includes("KEY_FORMULA_MISMATCH"), "a sheet formula that disagrees with the parts is flagged");
const noResp = normaliseServiceRow(cells({ ...base, Y: null }));
check(noResp.flags.includes("NO_RESPONSIBLE"), "a service without a responsible person is flagged");

const dup = flagDuplicateKeys([normaliseServiceRow(cells(base)), normaliseServiceRow({ r: 11, cells: base }), normaliseServiceRow(cells({ ...base, F: "AB0999", B: "10275_00999_104_01", C: "10275_00999_1001.1_01" }))]);
check(dup[0].flags.includes("DUPLICATE_ORDER_KEY") && dup[1].flags.includes("DUPLICATE_ORDER_KEY") && !dup[2].flags.includes("DUPLICATE_ORDER_KEY"), "duplicate new keys are flagged on both rows only");
check(dup[0].flags.includes("DUPLICATE_OLD_KEY") && !dup[2].flags.includes("DUPLICATE_OLD_KEY"), "duplicate legacy keys are flagged too");

const contact = normaliseContactRow({ r: 2, cells: { A: 10399, C: "Firma AB", K: "Straße 1", L: "746 30", M: "Bålsta", N: "SE", V: "mail@example.com", AC: 4912345 } });
check(contact.values.customer_number === "10399" && contact.values.customer_name === "Firma AB" && contact.values.postal_code === "746 30" && contact.values.contact1_phone === "4912345", "contact row: number to text, company name doubles as customer_name");
check(contact.flags.includes("PHONE_STORED_AS_NUMBER") && !contact.flags.includes("NO_COMPANY_NAME"), "contact flags");
const badContact = normaliseContactRow({ r: 357, cells: { A: "Privatkunde Muster" } });
check(badContact.errors.length === 1 && badContact.flags.includes("NO_COMPANY_NAME"), "a customer number that is not five digits is an error");

// ---- classification
check(eq(classify({ errors: [], flags: ["PHONE_STORED_AS_NUMBER", "ENDED_BUT_OPEN"], candidateLegalEntityId: "uuid" }), { validation_status: "valid", validation_error: null, resolution_status: "matched", review_status: "unreviewed", review_reason: "PHONE_STORED_AS_NUMBER · ENDED_BUT_OPEN" }), "information-only flags do not require review");
check(classify({ errors: [], flags: ["DUPLICATE_ORDER_KEY"], candidateLegalEntityId: "uuid" }).review_status === "review_required", "a duplicate key requires review");
check(classify({ errors: [], flags: ["NEW_SERVICE"], candidateLegalEntityId: "uuid" }).review_status === "unreviewed", "a clean new service needs no reviewer: new data goes live (hitul, 2026-09-10)");
check(classify({ errors: [], flags: ["NEW_SERVICE", "CUSTOMER_NOT_IN_WAREHOUSE"], candidateLegalEntityId: null }).review_status === "review_required", "a new service for an unknown customer still waits for review");
check(classify({ errors: [], flags: [], candidateLegalEntityId: null }).resolution_status === "unresolved", "no legal entity candidate means unresolved");
check(classify({ errors: ["contract_hours: unparsable"], flags: [], candidateLegalEntityId: "uuid" }).validation_status === "invalid", "a parse error makes the row invalid");

console.log(failures ? `FAIL (${failures})` : "PASS");
process.exit(failures ? 1 : 0);
