import "server-only";

import { Pool } from "pg";

export type ManagementCustomerEntity = {
  id: string;
  legalName: string;
};

export type ManagementCustomerMappings = {
  available: boolean;
  entityByOrderNumber: Map<string, ManagementCustomerEntity>;
  entities: Map<string, ManagementCustomerEntity>;
};

let pool: Pool | undefined;

function getPool() {
  const connectionString = process.env.SUPABASE_DB_URL || process.env.DATABASE_URL;
  if (!connectionString) return null;

  pool ??= new Pool({
    connectionString,
    max: 3,
    ssl: { rejectUnauthorized: false },
  });
  return pool;
}

/**
 * Reads the stable Customer Master relation without relying on PostgREST
 * schema exposure. The join is deliberately order-number based: public.projects.code
 * is populated from the source Order Number and projects.project_order.order_number
 * is the canonical project key. No customer free-text field participates.
 */
export async function readManagementCustomerMappings(): Promise<ManagementCustomerMappings> {
  const database = getPool();
  if (!database) return { available: false, entityByOrderNumber: new Map(), entities: new Map() };

  try {
    const result = await database.query<{ order_number: string; entity_id: string; legal_name: string }>(`
      select
        po.order_number,
        le.id as entity_id,
        le.legal_name
      from projects.project_order po
      join crm.legal_entity le on le.id = po.legal_entity_id
      where po.order_number is not null
        and po.legal_entity_id is not null
    `);

    const entities = new Map<string, ManagementCustomerEntity>();
    const entityByOrderNumber = new Map<string, ManagementCustomerEntity>();
    for (const row of result.rows) {
      const entity = { id: row.entity_id, legalName: row.legal_name };
      entities.set(entity.id, entity);
      entityByOrderNumber.set(row.order_number, entity);
    }

    return { available: true, entityByOrderNumber, entities };
  } catch {
    return { available: false, entityByOrderNumber: new Map(), entities: new Map() };
  }
}
