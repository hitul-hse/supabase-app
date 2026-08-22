/**
 * Build ONE paste-ready SQL file from the two migrations, and a REST-based
 * verifier for afterwards.
 *
 * WHY. Applying this needs DDL, which the REST API cannot do, and there is no
 * database password, CLI token or management token available here. So the user
 * has to paste it. The least I can do is make that one paste instead of two,
 * ordered correctly, with the reason for the order stated in the file -- and
 * then verify the result myself over the REST API, which I DO have.
 */
import { readFileSync, writeFileSync } from "node:fs";

const FILES = [
  ["supabase/migrations/add_contract_periods.sql", "1 of 2 — contract periods"],
  ["supabase/migrations/add_budget_alert_visibility.sql", "2 of 2 — budget alert visibility"],
];

const header = `-- =============================================================================
-- HSE Hub: contract periods + budget alert visibility
-- Paste this whole file into the Supabase SQL editor and Run.
-- =============================================================================
--
-- ORDER MATTERS and is already correct below. The second migration ALTERs the
-- alert table and references time.project_contract_period, which the first one
-- creates.
--
-- SAFE TO RE-RUN. Both halves are idempotent, proven by executing each twice
-- against real Postgres (npm run check:contract-periods, 42 checks;
-- npm run check:budget-alerts, 59 checks).
--
-- ADDITIVE ONLY. New table, new view, new functions, new columns on the
-- existing alert table, new permission rows. Nothing is dropped and no
-- existing column is altered. In particular time.project.estimated_hours is
-- left alone -- it belongs to the TrackingTime sync, which is exactly why
-- contract terms live in their own table.
--
-- Each half is wrapped in its own BEGIN/COMMIT, so a failure rolls that half
-- back rather than leaving the schema half-applied.
--
-- AFTER RUNNING, tell the agent and it will verify over the REST API, or run:
--   node scripts/verify-migrations-applied.mjs
-- =============================================================================

`;

let out = header;
for (const [file, label] of FILES) {
  const sql = readFileSync(file, "utf8").replace(/\r\n/g, "\n");
  out += `\n\n-- ###########################################################################\n`;
  out += `-- ${label}\n`;
  out += `-- source: ${file}\n`;
  out += `-- ###########################################################################\n\n`;
  out += sql.trimEnd();
  out += "\n";
}

const target = "supabase/APPLY-IN-SQL-EDITOR.sql";
writeFileSync(target, out.split("\n").join("\r\n"));

const lines = out.split("\n").length;
console.log(`wrote ${target}`);
console.log(`  ${out.length} bytes, ${lines} lines, ${FILES.length} migrations in order`);
console.log(`  statements: ${(out.match(/^\s*(create|alter|insert|drop|grant|comment|do)\b/gim) || []).length}`);
console.log(`  transactions: ${(out.match(/^begin;/gim) || []).length} begin / ${(out.match(/^commit;/gim) || []).length} commit`);
