/*
 * Run the REAL getOrderDetail against the live database, for both an order with
 * a TrackingTime link and one of the 54 orphans. Compiling the production
 * TypeScript rather than reimplementing the query is the point: a
 * reimplementation would not have caught the two-worlds keying problem.
 *
 * Follows the pattern in check-employee-ownership-live.mjs (commonjs + require,
 * because an absolute Windows path is not a valid ESM specifier).
 */
import { join, resolve } from "node:path";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { loadBindings, transform } from "next/dist/build/swc/index.js";
import { createClient } from "@supabase/supabase-js";
import { createRequire } from "node:module";

for (const line of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
  const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}

await loadBindings();
const dir = resolve(mkdtempSync(join("node_modules", ".order-detail-check-")));
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
const modFile = await compile("src/lib/queries/order-detail.ts", "order-detail.cjs", {
  "@/lib/database.types": posix(serverOnly),
  "server-only": posix(serverOnly),
});
const { getOrderDetail } = require(modFile);

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } },
);

let failures = 0;
const check = (label, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}: ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures += 1;
};

console.log("check-order-detail-live: does the order detail query work for BOTH worlds?\n");

// A linked order known to have stale stored hours, and a known orphan.
const LINKED = "10110_00358_104_01";
const ORPHAN = "10765_00316_701_01";

const linked = await getOrderDetail(supabase, LINKED);
check("a linked order resolves", linked !== null, LINKED);

if (linked) {
  console.log(`\n  ${linked.id}  "${linked.name}"`);
  console.log(`    customer   ${linked.customer}`);
  console.log(`    service    ${linked.service ?? `(none) fallback: ${linked.serviceFallback}`}`);
  console.log(`    contract   ${linked.contractHours}h`);
  console.log(`    stored     ${linked.loggedHoursStored}h`);
  console.log(`    live       ${linked.loggedHoursLive}h  (${linked.entryCount} entries)`);
  console.log(`    disagree   ${linked.hoursDisagree}`);
  console.log(`    responsible ${linked.responsible?.personName ?? "n/a"} (${linked.responsible?.source ?? "-"})`);
  console.log(`    replacement ${linked.replacement?.personName ?? "n/a"}`);
  console.log(`    assignees   ${linked.assignees.map((a) => `${a.personName}@${a.sharePercent}%`).join(", ")}`);
  console.log(`    customer services:`);
  for (const s of linked.customerServices) console.log(`      ${s.orders} order(s)  ${s.contractHours ?? "n/a"}h  ${s.service}`);

  check("it names a service", linked.service !== null, linked.service ?? "null");
  check("it resolves a responsible person", linked.responsible !== null, linked.responsible?.personName ?? "none");
  check("it reads live hours from time.entry", (linked.loggedHoursLive ?? 0) > 0, `${linked.loggedHoursLive}h`);
  check("it EXPOSES the stale-snapshot disagreement rather than hiding it",
    linked.hoursDisagree === true,
    `stored ${linked.loggedHoursStored} vs live ${linked.loggedHoursLive}`);
  check("person names resolve, not raw ids",
    linked.assignees.every((a) => a.personName !== a.personId),
    linked.assignees.map((a) => a.personName).join(", "));
  check("the customer's service mix is reported", linked.customerServices.length > 0, `${linked.customerServices.length} buckets`);
}

const orphan = await getOrderDetail(supabase, ORPHAN);
check("an ORPHAN order resolves (this is what /projects/[id] cannot show)", orphan !== null, ORPHAN);

if (orphan) {
  console.log(`\n  ${orphan.id}  "${orphan.name}"`);
  console.log(`    service    ${orphan.service ?? `(none) fallback: ${orphan.serviceFallback}`}`);
  console.log(`    contract   ${orphan.contractHours}h`);
  console.log(`    live       ${orphan.loggedHoursLive === null ? "n/a (no TrackingTime link)" : `${orphan.loggedHoursLive}h`}`);
  console.log(`    assignees   ${orphan.assignees.map((a) => `${a.personName}@${a.sharePercent}%`).join(", ") || "(none)"}`);

  check("the orphan has no time link, so live hours are an honest null",
    orphan.loggedHoursLive === null, `got ${orphan.loggedHoursLive}`);
  check("it does NOT claim a disagreement it cannot measure",
    orphan.hoursDisagree === false, `got ${orphan.hoursDisagree}`);
  check("contract_type still names the service for an orphan",
    orphan.serviceFallback !== null, orphan.serviceFallback ?? "null");
}

// A nonexistent id must be null, not a throw and not a partial object.
const missing = await getOrderDetail(supabase, "no-such-order-id");
check("an unknown id returns null rather than throwing", missing === null);

/*
 * Coverage: the whole reason for keying on the text id is that all 231 orders
 * become reachable. Sample across both populations to prove it.
 */
const { data: sample } = await supabase.from("projects").select("id").limit(40);
let ok = 0;
for (const row of sample ?? []) {
  const d = await getOrderDetail(supabase, row.id);
  if (d) ok += 1;
}
check("every sampled order resolves", ok === (sample ?? []).length, `${ok}/${(sample ?? []).length}`);

console.log(`\n${failures === 0 ? "PASS" : `FAIL (${failures})`}`);
rmSync(dir, { recursive: true, force: true });
process.exit(failures ? 1 : 0);
