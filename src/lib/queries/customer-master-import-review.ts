import "server-only";

import { Pool } from "pg";

export type ReviewFilter = {
  priority: "all" | ReviewPriority;
  caseType: "all" | ReviewCaseType;
  status: "all" | ReviewStatus;
  sheet: string;
};

export type ImportBatch = {
  id: string;
  source_system: string;
  entity_type: string;
  file_name: string | null;
  file_hash: string;
  received_at: string;
  finished_at: string | null;
  status: string;
  row_count: number;
  error_count: number;
};

export type ImportRecord = {
  id: string;
  batch_id: string;
  row_number: number;
  source_external_id: string | null;
  source_customer_number: string | null;
  raw_payload: Record<string, unknown>;
  validation_status: string;
  resolution_status: string;
  candidate_legal_entity_id: string | null;
  candidate_location_id: string | null;
  review_status: string;
  review_reason: string | null;
};

export type ImportReviewData = {
  batch: ImportBatch | null;
  metrics: {
    record_count: number;
    review_required_count: number;
    unresolved_count: number;
    approved_count: number;
  };
  cases: ReviewCase[];
  documentedCases: ReviewCase[];
  sheetCounts: { sheet_name: string; count: number }[];
  caseTypeCounts: { case_type: ReviewCase["case_type"]; count: number }[];
  /*
   * Honest counts (UI-CONVENTIONS rule 6). The read model is built from the
   * records actually read, so the page must be able to say when that is not
   * all of them, and how many clean rows it deliberately left out of the queue.
   */
  recordsRead: number;
  recordsCapped: boolean;
  cleanRecords: number;
  error: string | null;
};

/*
 * How many records the read model will hold at most. The earlier version read
 * `limit 1000` in one query and said nothing: the first masterdata sheet batch
 * had 1,082 records and the page showed 962 as if that were all of them. Now
 * the records are read page by page until the batch is exhausted, and only a
 * batch beyond this ceiling is cut -- visibly, through recordsCapped.
 */
const RECORD_PAGE = 1000;
const RECORD_CEILING = 20000;

export type ReviewPriority = "P0" | "P1" | "P2";
export type ReviewCaseType =
  | "LEXWARE_REFERENCE_CONFLICT"
  | "ALIAS_REVIEW"
  | "PROJECT_LOCATION_CANDIDATE"
  | "MULTI_LOCATION_CUSTOMER"
  | "HISTORICAL_SOURCE_REVIEW"
  | "CUSTOMER_MASTER_REVIEW"
  /*
   * The four below exist for the masterdata sheet batches (source
   * MASTERDATA_SHEET_V1, 2026-09-10). Their records carry raw_payload.flags,
   * written by scripts/import-masterdata-sheet-staging.mjs, and the flags say
   * exactly why a row cannot be promoted. ORDER_KEY_REVIEW is a service row
   * whose key is not usable (duplicate, missing language, old and new key
   * naming different customers, or an old key the warehouse never saw);
   * PERSON_REVIEW is a responsible or replacement name that matched nobody or
   * two people; CUSTOMER_NOT_IN_WAREHOUSE is a Lexware number with services
   * but no legal entity; PARKED_CONTACT is a customer from the contacts tab
   * with no service and no warehouse row -- kept, not reviewed. A row that is
   * merely NEW is not a case since 2026-09-10: the promote inserts a clean new
   * service without a reviewer, so newness alone never reaches this queue.
   */
  | "ORDER_KEY_REVIEW"
  | "PERSON_REVIEW"
  | "CUSTOMER_NOT_IN_WAREHOUSE"
  | "PARKED_CONTACT";
export type ReviewStatus = "OPEN" | "IN_REVIEW" | "RESOLVED" | "DEFERRED" | "REJECTED";
export type ResolutionStatus = Lowercase<ReviewStatus>;

export type ReviewCase = {
  case_key: string;
  case_name: string;
  priority: ReviewPriority;
  resolution_state: "open" | "documented";
  resolution_note: string | null;
  case_type: ReviewCaseType;
  status: ReviewStatus;
  title: string;
  description: string;
  source_records: string[];
  created_at: string;
  updated_at: string;
  resolution_status: ResolutionStatus;
  review_reason: string;
  location_source: string | null;
  project_references: string[];
  customer_name: string | null;
  location_address: string | null;
  project_count: number;
  records: ImportRecord[];
  sheet_names: string[];
  review_statuses: string[];
  resolution_statuses: string[];
};

type CountRow = {
  record_count: number;
  review_required_count: number;
  unresolved_count: number;
  approved_count: number;
};

type SheetCountRow = { sheet_name: string; count: number };

let pool: Pool | undefined;

function getPool() {
  const connectionString = process.env.SUPABASE_DB_URL || process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("Customer Master review database is not configured.");
  }

  pool ??= new Pool({
    connectionString,
    max: 3,
    ssl: { rejectUnauthorized: false },
  });
  return pool;
}

function payloadValues(record: ImportRecord) {
  const values = record.raw_payload.values;
  return values && typeof values === "object" ? values as Record<string, unknown> : {};
}

function sheetName(record: ImportRecord) {
  return String(record.raw_payload.sheet_name ?? "unknown");
}

/** The importer's verdict flags on a masterdata-sheet record; [] for every other batch. */
function sheetFlags(record: ImportRecord): string[] {
  const flags = record.raw_payload.flags;
  return Array.isArray(flags) ? flags.map(String) : [];
}

/** Records staged from the masterdata sheet carry a flags array, even when empty. */
function isSheetRecord(record: ImportRecord) {
  return Array.isArray(record.raw_payload.flags);
}

const ORDER_KEY_FLAGS = ["DUPLICATE_ORDER_KEY", "DUPLICATE_OLD_KEY", "MISSING_LANGUAGE", "KEY_FORMULA_MISMATCH", "KEY_PREFIX_MISMATCH", "UNKNOWN_OLD_KEY"];
const PERSON_FLAGS = ["UNMATCHED_RESPONSIBLE", "UNMATCHED_RESPONSIBLE_AMBIGUOUS", "UNMATCHED_REPLACEMENT", "UNMATCHED_REPLACEMENT_AMBIGUOUS"];
/*
 * The importer's blocking set (scripts/lib/masterdata-sheet.mjs BLOCKING_FLAGS),
 * copied here because a server query module does not import from scripts/.
 * check-import-review-honesty.mjs asserts the two lists are identical, so the
 * page cannot drift from the promote step's idea of what blocks a row.
 * CUSTOMER_NOT_IN_WAREHOUSE counts only while the record has no legal-entity
 * candidate: the promote re-judges it against the customers that exist now.
 */
const BLOCKING_FLAGS = [...ORDER_KEY_FLAGS, ...PERSON_FLAGS, "CUSTOMER_NOT_IN_WAREHOUSE"];

function blockingFlagsOf(record: ImportRecord) {
  return sheetFlags(record).filter((flag) => BLOCKING_FLAGS.includes(flag) && !(flag === "CUSTOMER_NOT_IN_WAREHOUSE" && record.candidate_legal_entity_id));
}

/** A contacts-tab row with no service in the sheet and no warehouse row: kept, not a decision. Only a VALID row can be parked. */
function isParkedContact(record: ImportRecord) {
  return isSheetRecord(record) && record.validation_status === "valid" && sheetFlags(record).includes("NO_SERVICE_ROW") && !record.candidate_legal_entity_id;
}

/**
 * A sheet record that resolved cleanly is not a case: nothing about it needs
 * a person. It stays counted (the page says how many were left out) but it
 * does not sit in the queue between the rows that do need a decision.
 */
function isCleanSheetRecord(record: ImportRecord) {
  if (!isSheetRecord(record)) return false;
  if (record.validation_status !== "valid") return false;
  // rejected / in_review are a person's decisions; review_required is the
  // importer's own stamp and is re-judged from the flags, as the promote does.
  if (record.review_status === "rejected" || record.review_status === "in_review") return false;
  if (isParkedContact(record)) return false; // parked, shown as such
  return blockingFlagsOf(record).length === 0;
}

function isOperationalLocationRecord(record: ImportRecord) {
  return ["location_observations", "locations"].includes(sheetName(record));
}

function isBillingOnlyRecord(record: ImportRecord) {
  return ["addresses", "billing_address"].includes(sheetName(record));
}

function projectReferences(records: ImportRecord[]) {
  const keys = ["project_id", "project_number", "project_name", "order_id", "order_number", "order_name"];
  return [...new Set(records.flatMap((record) => keys.map((key) => payloadValues(record)[key]).filter((value) => value !== null && value !== undefined && value !== "").map(String)))];
}

function customerNameFor(records: ImportRecord[]) {
  const keys = ["canonical_name", "customer_name", "company_name", "name"];
  for (const record of records) {
    const values = payloadValues(record);
    const value = keys.map((key) => values[key]).find((candidate) => candidate !== null && candidate !== undefined && candidate !== "");
    if (value) return String(value);
  }
  return null;
}

function locationAddressFor(records: ImportRecord[]) {
  const keys = ["address", "address_line", "street", "street_address", "postal_code", "zip", "city", "location_name"];
  const values = records.flatMap((record) => {
    const payload = payloadValues(record);
    return keys.map((key) => payload[key]).filter((value) => value !== null && value !== undefined && value !== "").map(String);
  });
  return [...new Set(values)].join(", ") || null;
}

function customerId(record: ImportRecord) {
  const value = payloadValues(record).customer_id;
  return value === null || value === undefined || value === "" ? null : String(value);
}

function caseKey(record: ImportRecord) {
  // A sheet service row is its own case: its defects (a duplicate key, a
  // missing language) belong to that row, not to every service of the customer.
  if (isSheetRecord(record) && sheetName(record) === "service_orders") {
    return `order:${record.source_external_id ?? record.row_number}`;
  }
  if (isOperationalLocationRecord(record)) {
    const id = customerId(record) ?? record.source_customer_number;
    if (id) return `location-customer:${id}`;
  }
  if (record.source_customer_number) return `lexware:${record.source_customer_number}`;
  const id = customerId(record);
  if (id) return `customer:${id}`;
  return `${sheetName(record)}:${record.source_external_id ?? record.row_number}`;
}

function hasLexwareReferenceConflict(records: ImportRecord[]) {
  const customerIdsByNumber = new Map<string, Set<string>>();
  for (const record of records) {
    if (!record.source_customer_number) continue;
    const ids = customerIdsByNumber.get(record.source_customer_number) ?? new Set<string>();
    ids.add(customerId(record) ?? `record:${record.id}`);
    customerIdsByNumber.set(record.source_customer_number, ids);
  }
  return [...customerIdsByNumber.values()].some((ids) => ids.size > 1);
}

function caseType(records: ImportRecord[]): ReviewCase["case_type"] {
  if (records.some(isSheetRecord)) {
    const blocking = new Set(records.flatMap(blockingFlagsOf));
    if (ORDER_KEY_FLAGS.some((flag) => blocking.has(flag))) return "ORDER_KEY_REVIEW";
    if (blocking.has("CUSTOMER_NOT_IN_WAREHOUSE")) return "CUSTOMER_NOT_IN_WAREHOUSE";
    if (PERSON_FLAGS.some((flag) => blocking.has(flag))) return "PERSON_REVIEW";
    if (records.every(isParkedContact)) return "PARKED_CONTACT";
    return "CUSTOMER_MASTER_REVIEW";
  }
  const text = JSON.stringify(records).toUpperCase();
  const locationRecords = records.filter(isOperationalLocationRecord);
  if (locationRecords.length > 0 && !text.includes("LEXWARE_REFERENCE_CONFLICT")) {
    return locationRecords.length > 1 ? "MULTI_LOCATION_CUSTOMER" : "PROJECT_LOCATION_CANDIDATE";
  }
  if (
    hasLexwareReferenceConflict(records) ||
    text.includes("LEXWARE_REFERENCE_CONFLICT") ||
    text.includes("MULTIPLE LEGAL ENTITY") ||
    text.includes("MULTIPLE_LEGAL_ENTITY")
  ) return "LEXWARE_REFERENCE_CONFLICT";
  if (records.some((record) => sheetName(record) === "source_review") || text.includes("HISTORICAL") || text.includes("UNMAPPED")) {
    return "HISTORICAL_SOURCE_REVIEW";
  }
  if (records.some((record) => sheetName(record) === "customer_aliases") || text.includes("ALIAS") || text.includes("HISTORICAL_NAME")) {
    return "ALIAS_REVIEW";
  }
  return "CUSTOMER_MASTER_REVIEW";
}

function hasUnclearLegalEntity(record: ImportRecord) {
  const text = `${JSON.stringify(record.raw_payload)} ${record.review_reason ?? ""}`.toUpperCase();
  return [
    "LEGAL_ENTITY_UNCLEAR",
    "LEGAL ENTITY UNCLEAR",
    "LEGAL_ENTITY_AMBIGUOUS",
    "LEGAL ENTITY AMBIGUOUS",
    "LEGAL_ENTITY_REVIEW",
    "LEGAL ENTITY REVIEW",
  ].some((signal) => text.includes(signal));
}

function priorityFor(reviewCase: Pick<ReviewCase, "case_type" | "records">): ReviewPriority {
  if (reviewCase.case_type === "ORDER_KEY_REVIEW") return "P0";
  if (reviewCase.case_type === "PERSON_REVIEW" || reviewCase.case_type === "CUSTOMER_NOT_IN_WAREHOUSE") return "P1";
  if (reviewCase.case_type === "PARKED_CONTACT") return "P2";
  const text = JSON.stringify(reviewCase.records).toUpperCase();
  if (
    reviewCase.case_type === "LEXWARE_REFERENCE_CONFLICT" ||
    reviewCase.records.some(hasUnclearLegalEntity) ||
    text.includes("LEXWARE_CLEANUP_PENDING") ||
    text.includes("LEXWARE CLEANUP") ||
    text.includes("MULTIPLE LEGAL ENTITY") ||
    text.includes("MULTIPLE_LEGAL_ENTITY")
  ) return "P0";
  if (reviewCase.case_type === "PROJECT_LOCATION_CANDIDATE" || reviewCase.case_type === "MULTI_LOCATION_CUSTOMER" || reviewCase.case_type === "HISTORICAL_SOURCE_REVIEW") return "P2";
  return "P1";
}

function statusFor(reviewCase: Pick<ReviewCase, "resolution_state" | "records" | "review_statuses" | "case_type">): ReviewStatus {
  if (reviewCase.resolution_state === "documented") return "RESOLVED";
  if (reviewCase.case_type === "PARKED_CONTACT") return "DEFERRED";
  if (reviewCase.records.some((record) => record.resolution_status === "unresolved")) return "OPEN";
  if (reviewCase.review_statuses.some((status) => status === "in_review")) return "IN_REVIEW";
  return "OPEN";
}

function reviewReasonFor(reviewCase: Pick<ReviewCase, "case_type" | "resolution_state" | "resolution_note" | "records">) {
  if (reviewCase.resolution_state === "documented" && reviewCase.resolution_note) return reviewCase.resolution_note;
  if (reviewCase.case_type === "ORDER_KEY_REVIEW") {
    return `Auftragsschlüssel nicht verwendbar: ${[...new Set(reviewCase.records.flatMap(sheetFlags).filter((flag) => ORDER_KEY_FLAGS.includes(flag)))].join(" · ")} — im Sheet korrigieren, dann erneut importieren.`;
  }
  if (reviewCase.case_type === "PERSON_REVIEW") {
    return `Verantwortliche Person oder Vertretung konnte keiner Person zugeordnet werden: ${[...new Set(reviewCase.records.flatMap(sheetFlags).filter((flag) => PERSON_FLAGS.includes(flag)))].join(" · ")} — Namen im Sheet oder in den Personen prüfen.`;
  }
  if (reviewCase.case_type === "CUSTOMER_MASTER_REVIEW" && reviewCase.records.some(isSheetRecord)) {
    // the importer wrote the exact errors and flags; a canned sentence would be less true
    return reviewCase.records.map((record) => record.review_reason).filter(Boolean).join(" · ") || "Zeile aus dem Stammdatenblatt konnte nicht verarbeitet werden.";
  }
  if (reviewCase.case_type === "CUSTOMER_NOT_IN_WAREHOUSE") return "Lexware-Kundennummer hat Services im Sheet, aber keine Legal Entity im Warehouse. Kunde anlegen oder Nummer prüfen.";
  if (reviewCase.case_type === "PARKED_CONTACT") return "Kontakt ohne Service im Sheet und ohne Warehouse-Zeile — geparkt, keine Entscheidung nötig.";
  if (reviewCase.case_type === "LEXWARE_REFERENCE_CONFLICT") return "Eine Lexware-Kundennummer verweist auf mehrere Legal-Entity-Kandidaten.";
  if (reviewCase.case_type === "ALIAS_REVIEW") return "Namensvariante oder historische Firmierung fachlich prüfen.";
  if (reviewCase.case_type === "PROJECT_LOCATION_CANDIDATE") return "Projekt-/Auftragsbezug enthält einen potenziell operativen Standort.";
  if (reviewCase.case_type === "MULTI_LOCATION_CUSTOMER") return "Kunde besitzt mehrere operative Standortbezüge.";
  if (reviewCase.case_type === "CUSTOMER_MASTER_REVIEW") return "Allgemeine Legal-Entity-Prüfung fachlich abschließen.";
  if (reviewCase.case_type === "HISTORICAL_SOURCE_REVIEW") return "Alte oder nicht zuordenbare Quelle fachlich prüfen.";
  return reviewCase.records.map((record) => record.review_reason).filter(Boolean).join(" · ") || "Fachliche Resolution erforderlich.";
}

function documentedResolution(reviewCase: Pick<ReviewCase, "case_name" | "case_key" | "records">) {
  // The notes below record decisions taken on the August workbook. A sheet row
  // whose customer name merely contains one of those names is not decided by
  // them -- deciding anything by name similarity is what ADR-001 forbids.
  if (reviewCase.records.some(isSheetRecord)) return null;
  const text = `${reviewCase.case_name} ${reviewCase.case_key} ${JSON.stringify(reviewCase.records)}`.toUpperCase();
  if (text.includes("PBS GERMANY OPERATIONS") && (text.includes("10284") || text.includes("10285"))) {
    return "PBS Germany Operations GmbH: eine Legal Entity; Lexware-Referenzen 10284 und 10285 bleiben erhalten.";
  }
  if (text.includes("YPOG") && (text.includes("10305") || text.includes("10938"))) {
    return "YPOG GmbH & Co. KG: 10305 führend; 10938 als Cleanup/Historie dokumentiert.";
  }
  if (text.includes("10305") && (text.includes("INURU") || text.includes("SUSELL"))) {
    return "Lexware-Referenz 10305: Inuru / Susell als dokumentierter Konflikt; keine neue Merge-Entscheidung.";
  }
  if (text.includes("YPOG") || text.includes("GEPLAHN-T")) {
    if (text.includes("YPOG")) return "YPOG GmbH & Co. KG: Cleanup/Historie dokumentiert; keine neue Merge-Entscheidung.";
    return "GEPLAHN-T GmbH: Legal Entity bleibt bestehen; Cleanup statt Merge.";
  }
  if (text.includes("CLOSER GO GERMANY") && text.includes("STUTTGART")) {
    return "Closer Go Germany GmbH – Stuttgart: eigene Legal Entity; Unternehmensverbund separat.";
  }
  if (text.includes("ENERCON")) {
    return "ENERCON GmbH: Rahmenvertragsthema; kein Customer Merge.";
  }
  return null;
}

const PRIORITY_RANK: Record<ReviewPriority, number> = { P0: 0, P1: 1, P2: 2 };

function caseName(record: ImportRecord) {
  const values = payloadValues(record);
  if (isSheetRecord(record) && sheetName(record) === "service_orders") {
    const order = values.order_name ?? values.service_name ?? "Service";
    const customer = values.customer_display_name ?? values.customer_name ?? record.source_customer_number ?? "Kunde";
    return `${String(order)} · ${String(customer)} · ${record.source_external_id ?? `row ${record.row_number}`}`;
  }
  const name = values.canonical_name ?? values.company_name ?? values.name ?? values.alias ?? values.issue;
  if (record.source_customer_number) return `${name ? String(name) : "Lexware customer"} · ${record.source_customer_number}`;
  if (customerId(record)) return `${name ? String(name) : "Customer Master case"} · ${customerId(record)}`;
  return `${sheetName(record)} · ${record.source_external_id ?? `row ${record.row_number}`}`;
}

function buildCases(records: ImportRecord[]) {
  const grouped = new Map<string, ReviewCase>();
  for (const record of records) {
    const key = caseKey(record);
    const existing = grouped.get(key);
    if (existing) {
      existing.records.push(record);
      existing.sheet_names = [...new Set([...existing.sheet_names, sheetName(record)])];
      existing.review_statuses = [...new Set([...existing.review_statuses, record.review_status])];
      existing.resolution_statuses = [...new Set([...existing.resolution_statuses, record.resolution_status])];
    } else {
      grouped.set(key, {
        case_key: key,
        case_name: caseName(record),
        priority: "P1",
        resolution_state: "open",
        resolution_note: null,
        status: "OPEN",
        title: caseName(record),
        description: "",
        source_records: [record.id],
        created_at: "",
        updated_at: "",
        resolution_status: "open",
        review_reason: "",
        location_source: null,
        project_references: [],
        customer_name: null,
        location_address: null,
        project_count: 0,
        case_type: "ALIAS_REVIEW",
        records: [record],
        sheet_names: [sheetName(record)],
        review_statuses: [record.review_status],
        resolution_statuses: [record.resolution_status],
      });
    }
  }
  return [...grouped.values()]
    .map((reviewCase) => {
      const resolution_note = documentedResolution(reviewCase);
      const normalizedCaseType = caseType(reviewCase.records);
      const normalizedCase = { ...reviewCase, case_type: normalizedCaseType };
      const status = statusFor({ ...normalizedCase, resolution_state: resolution_note ? "documented" : "open" });
      const review_reason = reviewReasonFor({ ...normalizedCase, resolution_state: resolution_note ? "documented" : "open", resolution_note });
      const locationRecords = normalizedCase.records.filter(isOperationalLocationRecord);
      const projects = projectReferences(locationRecords);
      return {
        ...normalizedCase,
        priority: priorityFor(normalizedCase),
        resolution_state: resolution_note ? "documented" as const : "open" as const,
        resolution_note,
        status,
        title: normalizedCase.case_name,
        description: review_reason,
        source_records: normalizedCase.records.map((record) => record.id),
        resolution_status: status.toLowerCase() as ResolutionStatus,
        review_reason,
        location_source: locationRecords.length > 0 ? [...new Set(locationRecords.map(sheetName))].join(" · ") : null,
        project_references: projects,
        customer_name: locationRecords.length > 0 ? customerNameFor(locationRecords) : null,
        location_address: locationRecords.length > 0 ? locationAddressFor(locationRecords) : null,
        project_count: projects.length,
      };
    })
    .sort((a, b) => PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] || a.records[0].row_number - b.records[0].row_number);
}

function matchesFilter(reviewCase: ReviewCase, filter: ReviewFilter) {
  return (
    (filter.priority === "all" || reviewCase.priority === filter.priority) &&
    (filter.caseType === "all" || reviewCase.case_type === filter.caseType) &&
    (filter.status === "all" || reviewCase.status === filter.status) &&
    (filter.sheet === "all" || reviewCase.sheet_names.includes(filter.sheet))
  );
}

/**
 * Every record of the batch, read RECORD_PAGE at a time in row order until a
 * page comes back short. A batch beyond RECORD_CEILING is cut there and says
 * so through `capped`; nothing is cut silently.
 */
async function readAllRecords(db: Pool, batchId: string): Promise<{ records: ImportRecord[]; capped: boolean }> {
  const records: ImportRecord[] = [];
  for (let offset = 0; offset < RECORD_CEILING; offset += RECORD_PAGE) {
    const page = await db.query<ImportRecord>(`
      select id, batch_id, row_number, source_external_id,
             source_customer_number, raw_payload, validation_status,
             resolution_status, candidate_legal_entity_id,
             candidate_location_id, review_status, review_reason
      from stg.import_record
      where batch_id = $1
      order by row_number asc
      limit $2 offset $3
    `, [batchId, RECORD_PAGE, offset]);
    records.push(...page.rows);
    if (page.rows.length < RECORD_PAGE) return { records, capped: false };
  }
  return { records, capped: true };
}

export async function getCustomerMasterImportReview(
  filter: ReviewFilter,
): Promise<ImportReviewData> {
  try {
    const db = getPool();
    const batchResult = await db.query<ImportBatch>(`
      select id, source_system, entity_type, file_name, file_hash,
             received_at, finished_at, status, row_count, error_count
      from stg.import_batch
      order by received_at desc
      limit 1
    `);
    const batch = batchResult.rows[0] ?? null;

    if (!batch) {
      return {
        batch: null,
        metrics: { record_count: 0, review_required_count: 0, unresolved_count: 0, approved_count: 0 },
        cases: [],
        documentedCases: [],
        sheetCounts: [],
        caseTypeCounts: [],
        recordsRead: 0,
        recordsCapped: false,
        cleanRecords: 0,
        error: null,
      };
    }

    const [metricsResult, sheetResult, recordsResult] = await Promise.all([
      db.query<CountRow>(`
        select count(*)::int as record_count,
               count(*) filter (where review_status = 'review_required')::int
                 as review_required_count,
               count(*) filter (where resolution_status = 'unresolved')::int
                 as unresolved_count,
               count(*) filter (where review_status = 'approved')::int
                 as approved_count
        from stg.import_record
        where batch_id = $1
      `, [batch.id]),
      db.query<SheetCountRow>(`
        select coalesce(raw_payload->>'sheet_name', 'unknown') as sheet_name,
               count(*)::int as count
        from stg.import_record
        where batch_id = $1
        group by 1
        order by 1
      `, [batch.id]),
      readAllRecords(db, batch.id),
    ]);
    const { records, capped } = recordsResult;
    // A staging verdict is as old as its batch. Customers the warehouse did not
    // know at staging time may exist now (the promote creates them from the
    // contacts tab), so the legal-entity link is completed from the customer
    // master as it is NOW -- in memory only; stg is never written by this page.
    const unresolvedNumbers = [...new Set(records.filter((r) => isSheetRecord(r) && !r.candidate_legal_entity_id && r.source_customer_number).map((r) => String(r.source_customer_number)))];
    if (unresolvedNumbers.length) {
      const known = await db.query<{ customer_number: string; legal_entity_id: string | null }>(
        `select customer_number, legal_entity_id from crm.lexware_customer where customer_number = any($1::text[])`,
        [unresolvedNumbers],
      );
      const byNumber = new Map(known.rows.map((r) => [String(r.customer_number), r.legal_entity_id]));
      for (const r of records) {
        const entity = byNumber.get(String(r.source_customer_number ?? ""));
        if (isSheetRecord(r) && !r.candidate_legal_entity_id && entity) { r.candidate_legal_entity_id = entity; r.resolution_status = "matched"; }
      }
    }
    const notBilling = records.filter((record) => !isBillingOnlyRecord(record));
    const reviewRecords = notBilling.filter((record) => !isCleanSheetRecord(record));
    const cleanRecords = notBilling.length - reviewRecords.length;
    const allCases = buildCases(reviewRecords).map((reviewCase) => ({
      ...reviewCase,
      created_at: batch.received_at,
      updated_at: batch.finished_at ?? batch.received_at,
    }));
    const visibleCases = allCases.filter((reviewCase) => matchesFilter(reviewCase, filter));
    const cases = visibleCases.filter((reviewCase) => reviewCase.resolution_state === "open");
    const documentedCases = visibleCases.filter((reviewCase) => reviewCase.resolution_state === "documented");
    const caseTypeCounts = [...new Set(cases.map((reviewCase) => reviewCase.case_type))]
      .map((case_type) => ({ case_type, count: cases.filter((reviewCase) => reviewCase.case_type === case_type).length }))
      .sort((a, b) => b.count - a.count);

    return {
      batch,
      metrics: metricsResult.rows[0] ?? {
        record_count: 0,
        review_required_count: 0,
        unresolved_count: 0,
        approved_count: 0,
      },
      cases,
      documentedCases,
      sheetCounts: sheetResult.rows,
      caseTypeCounts,
      recordsRead: records.length,
      // A batch of exactly RECORD_CEILING rows fills every page and is complete;
      // without the measured total, a full read cannot be called complete.
      recordsCapped: capped && (metricsResult.rows[0]?.record_count === undefined || records.length < Number(metricsResult.rows[0].record_count)),
      cleanRecords,
      error: null,
    };
  } catch {
    return {
      batch: null,
      metrics: { record_count: 0, review_required_count: 0, unresolved_count: 0, approved_count: 0 },
      cases: [],
      documentedCases: [],
      sheetCounts: [],
      caseTypeCounts: [],
      recordsRead: 0,
      recordsCapped: false,
      cleanRecords: 0,
      error: "Die Staging-Daten konnten nicht gelesen werden.",
    };
  }
}
