/*
 * Run the REAL getEmployeeOwnershipOverview against the LIVE database and
 * print what the table will render. This is the closed loop for the
 * replacement fix: compiled from the actual TS source (swc), fed by the
 * service-role client (the query is read-only), so the numbers below are the
 * numbers the page computes.
 */
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
const dir = resolve(mkdtempSync(join("node_modules", ".ownership-check-")));
const posix = (p) => p.replace(/\\/g, "/");
const require = createRequire(import.meta.url);

async function compile(srcPath, outName, rewrites = {}) {
  // `import "server-only"` is a bare side-effect import (no `from`), so the
  // from-based rewrite misses it; strip it explicitly.
  let code = readFileSync(srcPath, "utf8").replace(/^import "server-only";\r?\n/m, "");
  for (const [from, to] of Object.entries(rewrites)) {
    code = code.split(`from "${from}"`).join(`from "${to}"`);
  }
  if (outName === "mapping.cjs") code = code.replace("max: 3,", "max: 3, allowExitOnIdle: true,");
  const out = await transform(code, {
    filename: srcPath,
    jsc: { parser: { syntax: "typescript", tsx: false }, target: "es2022" },
    module: { type: "commonjs" },
  });
  const file = join(dir, outName);
  writeFileSync(file, out.code);
  return file;
}

// Stubs for the app-only imports.
const serverOnly = join(dir, "server-only.cjs");
writeFileSync(serverOnly, "module.exports = {};");
const pagedFile = await compile("src/lib/queries/paged.ts", "paged.cjs");
const contractFile = await compile("src/lib/queries/management-contract-hours.ts", "contract.cjs", {
  "@/lib/database.types": posix(serverOnly),
  "@/lib/queries/paged": posix(pagedFile),
  "server-only": posix(serverOnly),
});
// allowExitOnIdle: the module holds a pg Pool this gate cannot reach to end;
// without it, process.exit trips a libuv teardown assert on Windows.
const mappingFile = await compile("src/lib/queries/management-customer-mapping.ts", "mapping.cjs", {
  "server-only": posix(serverOnly),
});
const ownershipFile = await compile("src/lib/queries/management-employee-ownership.ts", "ownership.cjs", {
  "@/lib/database.types": posix(serverOnly),
  "@/lib/queries/paged": posix(pagedFile),
  "@/lib/queries/management-contract-hours": posix(contractFile),
  "@/lib/queries/management-customer-mapping": posix(mappingFile),
  "server-only": posix(serverOnly),
});

const { getEmployeeOwnershipOverview } = require(ownershipFile);
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

const rows = await getEmployeeOwnershipOverview(supabase);
let failed = 0;
const check = (name, ok, detail = "") => {
  if (!ok) failed += 1;
  console.log(`${ok ? "PASS" : "FAIL"}: ${name}${detail ? ` — ${detail}` : ""}`);
};

console.log("PERSON | OPEN | HOURS | COVERAGE% | WITHOUT-REPL | MAPPING-ISSUES");
for (const r of rows) {
  console.log(
    `${r.person.padEnd(10)} | ${String(r.openProjects).padStart(4)} | ${r.contractHours.toFixed(1).padStart(7)} | ${
      r.replacementCoveragePercent === null ? "  n/a" : String(r.replacementCoveragePercent).padStart(5)
    } | ${r.projectsWithoutReplacement === null ? "n/a" : r.projectsWithoutReplacement} | ${r.customerMappingIssues}`
  );
}

const withProjects = rows.filter((r) => r.openProjects > 0);
check("at least one person has open projects", withProjects.length > 0, `${withProjects.length} people`);
check(
  "replacement data flows (some coverage > 0)",
  withProjects.some((r) => (r.replacementCoveragePercent ?? 0) > 0),
);
check(
  "coverage is never fabricated for empty portfolios (0 projects -> null)",
  rows.filter((r) => r.openProjects === 0).every((r) => r.replacementCoveragePercent === null),
);
const sampleProjects = withProjects[0]?.projects ?? [];
const withRepl = sampleProjects.filter((p) => p.replacementPerson !== null).length;
check("drilldown projects carry replacement names", withRepl > 0, `${withRepl}/${sampleProjects.length} for ${withProjects[0]?.person}`);
const totalMappingIssues = rows.reduce((s, r) => s + r.customerMappingIssues, 0);
const totalOpen = rows.reduce((s, r) => s + r.openProjects, 0);
check(
  "customer mapping is no longer all-missing",
  totalOpen > 0 && totalMappingIssues < totalOpen,
  `${totalMappingIssues} issues over ${totalOpen} open assignments`,
);

rmSync(dir, { recursive: true, force: true });
console.log(failed === 0 ? "\nOWNERSHIP QUERY: live data flows correctly" : `\nOWNERSHIP QUERY: ${failed} FAILURES`);
process.exit(failed === 0 ? 0 : 1);
