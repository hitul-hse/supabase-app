/**
 * Import contract periods from the masterdata reconciliation -- but ONLY the
 * candidates whose date windows are coherent.
 *
 * The reconciliation found 14 orders with hours + both dates matched 1:1 to a
 * live TT project. TEN of them carry the Excel's known date defect: a "26/27"
 * contract with starts_on 2027-01-01 (the Start Date column often holds the
 * NEXT renewal date). Recording those as contract periods would make the
 * budget guard judge every 2026 booking as outside_contract -- warn-noise
 * built on a date nobody agreed. A contract term is a commercial fact; a
 * suspicious one is a review item, not an import.
 *
 * COHERENCE RULE: the window must span >= 6 months (a real term, not a
 * renewal-date artifact) AND start before today (the contract is running).
 * Everything else stays in the report for a human.
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";

const DRY = process.argv.includes("--dry-run");
const today = new Date().toISOString().slice(0, 10);

for (const line of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
  const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}
const timeDb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  db: { schema: "time" }, auth: { persistSession: false },
});

const report = JSON.parse(readFileSync(".context-bridge/masterdata-reconciliation.json", "utf8"));
const candidates = report.readyForContractPeriods;

const spanDays = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000);
const coherent = candidates.filter((c) => c.startsOn <= today && spanDays(c.startsOn, c.endsOn) >= 180);
const suspicious = candidates.filter((c) => !coherent.includes(c));

console.log(`candidates: ${candidates.length} | coherent: ${coherent.length} | suspicious (left for review): ${suspicious.length}`);
console.log("\nimporting:");
for (const c of coherent) console.log(`  project ${c.projectId}: ${c.budgetHours}h ${c.startsOn} -> ${c.endsOn}  ${c.projectName.slice(0, 44)}`);
console.log("\nleft for a human (renewal-date artifact suspected):");
for (const c of suspicious) console.log(`  project ${c.projectId}: ${c.budgetHours}h ${c.startsOn} -> ${c.endsOn}  ${c.projectName.slice(0, 44)}`);

if (DRY) { console.log("\nDRY RUN: nothing written."); process.exit(0); }

let written = 0;
for (const c of coherent) {
  // Skip if a period already exists for this project (idempotent re-run).
  const { data: existing } = await timeDb
    .from("project_contract_period")
    .select("id")
    .eq("project_id", c.projectId)
    .limit(1);
  if (existing?.length) { console.log(`  skip ${c.projectId}: already has a period`); continue; }

  const { error } = await timeDb.from("project_contract_period").insert({
    project_id: c.projectId,
    period_no: 1,
    budget_hours: Math.round(c.budgetHours * 100) / 100,
    starts_on: c.startsOn,
    ends_on: c.endsOn,
    warn_at_percent: 80,
    contract_reference: c.orderNo,
    notes: `Imported from HSE masterdata (${c.sheet.trim()}); responsible ${c.responsible || "n/a"}`,
  });
  if (error) throw new Error(`${c.projectName}: ${error.message}`);
  written += 1;
}
console.log(`\nrecorded ${written} contract periods. The budget guard now enforces sales' numbers on them.`);
