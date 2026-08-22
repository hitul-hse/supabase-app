import "server-only";

import { Pool } from "pg";

export type ReviewFilter = {
  status: "all" | "review_required";
  resolution: "all" | "unresolved";
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
  sheetCounts: { sheet_name: string; count: number }[];
  caseTypeCounts: { case_type: ReviewCase["case_type"]; count: number }[];
  error: string | null;
};

export type ReviewCase = {
  case_key: string;
  case_name: string;
  case_type:
    | "Lexware Cleanup Pending"
    | "Multiple Lexware References"
    | "Location Review"
    | "Source Review"
    | "Customer Master Review";
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

function customerId(record: ImportRecord) {
  const value = payloadValues(record).customer_id;
  return value === null || value === undefined || value === "" ? null : String(value);
}

function caseKey(record: ImportRecord) {
  if (record.source_customer_number) return `lexware:${record.source_customer_number}`;
  const id = customerId(record);
  if (id) return `customer:${id}`;
  return `${sheetName(record)}:${record.source_external_id ?? record.row_number}`;
}

function caseType(record: ImportRecord): ReviewCase["case_type"] {
  const text = JSON.stringify(record.raw_payload).toUpperCase();
  if (text.includes("MULTI_LOCATION_MULTI_LEXWARE") || text.includes("MULTIPLE LEXWARE")) {
    return "Multiple Lexware References";
  }
  if (text.includes("LEXWARE_CLEANUP_PENDING") || text.includes("LEXWARE CLEANUP")) {
    return "Lexware Cleanup Pending";
  }
  if (["locations", "location_review", "location_observations", "addresses"].includes(sheetName(record))) {
    return "Location Review";
  }
  if (sheetName(record) === "source_review") return "Source Review";
  return "Customer Master Review";
}

function caseName(record: ImportRecord) {
  const values = payloadValues(record);
  const name = values.canonical_name ?? values.name ?? values.alias ?? values.issue;
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
      if (existing.case_type === "Customer Master Review" || existing.case_type === "Location Review") {
        const nextType = caseType(record);
        if (nextType !== "Customer Master Review") existing.case_type = nextType;
      }
    } else {
      grouped.set(key, {
        case_key: key,
        case_name: caseName(record),
        case_type: caseType(record),
        records: [record],
        sheet_names: [sheetName(record)],
        review_statuses: [record.review_status],
        resolution_statuses: [record.resolution_status],
      });
    }
  }
  return [...grouped.values()].sort((a, b) => a.records[0].row_number - b.records[0].row_number);
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
        sheetCounts: [],
        caseTypeCounts: [],
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
      db.query<ImportRecord>(`
        select id, batch_id, row_number, source_external_id,
               source_customer_number, raw_payload, validation_status,
               resolution_status, candidate_legal_entity_id,
               candidate_location_id, review_status, review_reason
        from stg.import_record
        where batch_id = $1
          and ($2 = 'all' or review_status = $2)
          and ($3 = 'all' or resolution_status = $3)
          and ($4 = 'all' or raw_payload->>'sheet_name' = $4)
        order by row_number asc
        limit 1000
      `, [batch.id, filter.status, filter.resolution, filter.sheet]),
    ]);

    const cases = buildCases(recordsResult.rows);
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
      sheetCounts: sheetResult.rows,
      caseTypeCounts,
      error: null,
    };
  } catch {
    return {
      batch: null,
      metrics: { record_count: 0, review_required_count: 0, unresolved_count: 0, approved_count: 0 },
      cases: [],
      sheetCounts: [],
      caseTypeCounts: [],
      error: "Die Staging-Daten konnten nicht gelesen werden.",
    };
  }
}
