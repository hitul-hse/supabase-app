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
  };
  records: ImportRecord[];
  sheetCounts: { sheet_name: string; count: number }[];
  error: string | null;
};

type CountRow = {
  record_count: number;
  review_required_count: number;
  unresolved_count: number;
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
        metrics: { record_count: 0, review_required_count: 0, unresolved_count: 0 },
        records: [],
        sheetCounts: [],
        error: null,
      };
    }

    const [metricsResult, sheetResult, recordsResult] = await Promise.all([
      db.query<CountRow>(`
        select count(*)::int as record_count,
               count(*) filter (where review_status = 'review_required')::int
                 as review_required_count,
               count(*) filter (where resolution_status = 'unresolved')::int
                 as unresolved_count
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

    return {
      batch,
      metrics: metricsResult.rows[0] ?? {
        record_count: 0,
        review_required_count: 0,
        unresolved_count: 0,
      },
      records: recordsResult.rows,
      sheetCounts: sheetResult.rows,
      error: null,
    };
  } catch {
    return {
      batch: null,
      metrics: { record_count: 0, review_required_count: 0, unresolved_count: 0 },
      records: [],
      sheetCounts: [],
      error: "Die Staging-Daten konnten nicht gelesen werden.",
    };
  }
}
