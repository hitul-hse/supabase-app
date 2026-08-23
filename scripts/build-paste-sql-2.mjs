/**
 * Build the round-2 paste file: Bjoern's three migrations, in dependency
 * order, ready for the Supabase SQL editor.
 *
 * Order matters and is encoded here rather than trusted to filenames:
 *   1. customer-master foundation (creates crm/projects/stg schemas)
 *   2. legal-entity fields (ALTERs crm.legal_entity)
 *   3. project change control (independent, but grouped so one paste
 *      completes the whole dashboard)
 */
import { readFileSync, writeFileSync } from "node:fs";

const FILES = [
  ["supabase/migrations/20260822130000_create_customer_master_foundation.sql", "1 of 3 — customer master foundation (crm/projects/stg)"],
  ["supabase/migrations/20260822140000_add_customer_master_legal_entity_fields.sql", "2 of 3 — legal entity fields"],
  ["supabase/migrations/20260823090000_add_project_change_control.sql", "3 of 3 — project change control (four-eyes)"],
];

let out = `-- =============================================================================
-- HSE Hub round 2: customer master foundation + change control
-- Paste this whole file into the Supabase SQL editor and Run.
-- =============================================================================
--
-- WHAT THIS ENABLES, per empty surface on the dashboard:
--   - Customer Master tab: the crm/projects/stg schemas it reads
--   - Multi-Service Matrix + Customer Portfolio: the order->legal-entity
--     mapping both group by
--   - Verantwortlichenwechsel: request/approve with four-eyes control
--
-- SECURITY, verified by executing on real Postgres (check-customer-master-
-- foundation.mjs, 10 checks; check-change-control.mjs, 11 checks):
--   - RLS on all 17 new tables
--   - crm/projects readable+writable by EXEC ONLY; stg has no API access at
--     all (importer-only over a direct pg connection)
--   - anon has nothing
--   - change-control tables cannot be written directly; only the SECURITY
--     DEFINER functions mutate them, and self-approval is refused
--
-- SAFE TO RE-RUN: all three are idempotent (executed twice in the gates).
--
-- After running, tell the agent; it verifies over REST and then loads the
-- curated customer masterdata into staging.
-- =============================================================================
`;

for (const [file, label] of FILES) {
  const sql = readFileSync(file, "utf8").replace(/\r\n/g, "\n");
  out += `\n\n-- ###########################################################################\n`;
  out += `-- ${label}\n-- source: ${file}\n`;
  out += `-- ###########################################################################\n\n${sql.trimEnd()}\n`;
}

writeFileSync("supabase/APPLY-IN-SQL-EDITOR-2.sql", out.split("\n").join("\r\n"));
console.log(`wrote supabase/APPLY-IN-SQL-EDITOR-2.sql (${out.length} bytes)`);
console.log(`statements: ${(out.match(/^\s*(create|alter|insert|drop|grant|comment|do|revoke)\b/gim) || []).length}`);
