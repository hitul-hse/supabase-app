// Widening PEOPLE changed getManagementContractHours too: it is the service grid
// and the utilisation outlook on the same management page. Verify the two newly
// added names land correctly there and that nothing regressed for the original
// seven.
//
// This compiles and runs the REAL production TypeScript, following the pattern
// established in check-employee-ownership-live.mjs (commonjs + require, because
// an absolute Windows path is not a valid ESM specifier), so it tests what the
// page renders rather than a reimplementation of it.
import { join, resolve } from "node:path";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { loadBindings, transform } from "next/dist/build/swc/index.js";
import { createClient } from "@supabase/supabase-js";

for (const line of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
  const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}

await loadBindings();
const dir = resolve(mkdtempSync(join("node_modules", ".contract-hours-check-")));
const posix = (p) => p.replace(/\\/g, "/");
const require = createRequire(import.meta.url);

async function compile(srcPath, outName, rewrites = {}) {
  let code = readFileSync(srcPath, "utf8").replace(/^import "server-only";\r?\n/m, "");
  for (const [from, to] of Object.entries(rewrites)) {
    code = code.split(`from "${from}"`).join(`from "${to}"`);
  }
  const out = await transform(code, {
    filename: srcPath,
    jsc: { parser: { syntax: "typescript", tsx: false }, target: "es2022" },
    module: { type: "commonjs" },
  });
  const file = join(dir, outName);
  writeFileSync(file, out.code);
  return file;
}

const serverOnly = join(dir, "server-only.cjs");
writeFileSync(serverOnly, "module.exports = {};");
const pagedFile = await compile("src/lib/queries/paged.ts", "paged.cjs");
const contractFile = await compile("src/lib/queries/management-contract-hours.ts", "contract.cjs", {
  "@/lib/database.types": posix(serverOnly),
  "@/lib/queries/paged": posix(pagedFile),
  "server-only": posix(serverOnly),
});

const { getManagementContractHours, PEOPLE } = require(contractFile);

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } },
);

const model = await getManagementContractHours(supabase);

const failures = [];
const check = (ok, label, detail) => {
  console.log(`${ok ? "  ok  " : " FAIL "} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures.push(label);
};

console.log("check-management-contract-hours-live: does the service grid include everyone?\n");
console.log(`PEOPLE (${PEOPLE.length}): ${PEOPLE.join(", ")}\n`);

console.log("utilisation outlook:");
for (const row of model.utilisationOutlook) {
  console.log(`  ${String(row.person).padEnd(16)} ${String(row.boundContractHours).padStart(9)}h bound  ${String(row.utilisationPercent).padStart(6)}%  ${row.status}`);
}
console.log("");

// Every allowlist name must have a cell in every service row, or the grid is
// ragged and Object.fromEntries produced a partial record.
const gridNames = new Set();
for (const row of model.rows) for (const k of Object.keys(row.cells)) gridNames.add(k);
const missingFromGrid = PEOPLE.filter((p) => !gridNames.has(p));
check(missingFromGrid.length === 0,
  "every allowlist name has a cell in the service grid",
  missingFromGrid.length ? `missing: ${missingFromGrid.join(", ")}` : `all ${PEOPLE.length} present`);

check(model.utilisationOutlook.length === PEOPLE.length,
  "the utilisation outlook covers exactly the allowlist",
  `${model.utilisationOutlook.length} rows vs ${PEOPLE.length} names`);

const drilldownNames = Object.keys(model.drilldown);
const missingDrilldown = PEOPLE.filter((p) => !drilldownNames.includes(p));
check(missingDrilldown.length === 0,
  "every allowlist name has a drilldown entry",
  missingDrilldown.length ? `missing: ${missingDrilldown.join(", ")}` : `all ${PEOPLE.length} present`);

// The two newly added people must resolve to real data, otherwise adding them
// produced an empty column that merely looks complete.
for (const name of ["Rency Sebastian", "Björn"]) {
  if (!PEOPLE.includes(name)) { check(false, `${name} is on the allowlist`, "absent"); continue; }
  const projects = model.drilldown[name] ?? [];
  const bound = model.utilisationOutlook.find((r) => r.person === name)?.boundContractHours ?? 0;
  check(projects.length > 0 || bound > 0,
    `${name} resolves to real data, not an empty column`,
    `${projects.length} drilldown projects, ${Math.round(bound * 10) / 10}h bound`);
}

// Totals must reconcile: the grid cells must sum to the outlook's bound hours.
let reconciled = true;
for (const row of model.utilisationOutlook) {
  const fromGrid = model.rows.reduce((sum, r) => sum + (r.cells[row.person] ?? 0), 0);
  if (Math.abs(fromGrid - row.boundContractHours) > 0.05) {
    reconciled = false;
    check(false, `${row.person}: grid cells reconcile with the outlook`,
      `grid ${Math.round(fromGrid * 10) / 10} vs outlook ${Math.round(row.boundContractHours * 10) / 10}`);
  }
}
if (reconciled) check(true, "grid cells reconcile with the utilisation outlook for every person", `all ${PEOPLE.length} checked`);

// Honest nulls: someone with no bound hours must read 0 and stay visible, never
// be silently dropped from the table.
const zeroed = model.utilisationOutlook.filter((r) => r.boundContractHours === 0);
if (zeroed.length) console.log(`  note  ${zeroed.length} shown as an honest 0 rather than hidden: ${zeroed.map((r) => r.person).join(", ")}`);

console.log(`\n${failures.length === 0 ? "PASS" : `FAIL (${failures.length})`}`);
if (failures.length) for (const f of failures) console.log(`  - ${f}`);
rmSync(dir, { recursive: true, force: true });
process.exit(failures.length ? 1 : 0);
