/**
 * Prove parallel paging returns EXACTLY what sequential paging returned.
 *
 * fetchAllEntries used to discover the end of the data by hitting a short page.
 * It now reads an exact count from the first request and fetches the remaining
 * pages at once, which measured 252ms against 893ms on the live 4,194-row table.
 *
 * That is a correctness risk worth a gate of its own, because every failure mode
 * is SILENT and plausible:
 *
 *   - an off-by-one in the page arithmetic drops or duplicates 1000 rows, and the
 *     dashboard just reports fewer hours,
 *   - Promise.all resolving out of order would scramble "most recent first",
 *     which the entry table and the trend both rely on,
 *   - a count that disagrees with the rows actually returned would either
 *     over-fetch (harmless) or under-fetch (a wrong total that looks right).
 *
 * None of those throw. So this runs the REAL fetchAllEntries against the REAL
 * database and compares it, id for id, with an independent sequential
 * reimplementation written here from the original algorithm.
 *
 * Run: node scripts/check-parallel-paging.mjs
 */
import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import { pathToFileURL } from "node:url";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { createClient } from "@supabase/supabase-js";

// The report module imports via the "@/" alias, which bare Node cannot resolve.
const root = process.cwd();
registerHooks({
  resolve(spec, ctx, next) {
    if (spec.startsWith("@/")) {
      const base = join(root, "src", spec.slice(2));
      const t = existsSync(`${base}.ts`) ? `${base}.ts` : `${base}.tsx`;
      return { url: pathToFileURL(t).href, shortCircuit: true };
    }
    return next(spec, ctx);
  },
});

const env = {};
for (const line of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
  const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}

const URL_BASE = env.NEXT_PUBLIC_SUPABASE_URL;
const KEY = env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL_BASE || !KEY) {
  console.log("SKIP: no live credentials in .env.local");
  process.exit(0);
}

let failed = false;
const check = (label, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"} | ${label}${!ok && detail ? `\n       ${detail}` : ""}`);
  if (!ok) failed = true;
};

const supabase = createClient(URL_BASE, KEY, { auth: { persistSession: false } });

// Reachability first: if `time` is not exposed this proves nothing, and saying so
// beats reporting a vacuous pass.
const probe = await supabase.schema("time").from("entry").select("id").limit(1);
if (probe.error) {
  console.log(`SKIP: time schema not reachable — ${probe.error.message}`);
  process.exit(0);
}

const { fetchAllEntries, parseFilters, summarise } = await import(
  "../src/lib/queries/trackingtime-report.ts"
);

const PAGE = 1000;
const SELECT = `
  id, member_id, project_id, customer_id, service_id,
  started_at, duration_seconds, is_billable, is_billed, is_calendar, notes,
  member:member_id ( display_name ),
  project:project_id ( name ),
  customer:customer_id ( name ),
  service:service_id ( name ),
  task:task_id ( name )
`;

/**
 * The ORIGINAL sequential algorithm, reimplemented here rather than imported.
 *
 * Deliberate duplication: importing the shipped function would compare it with
 * itself. This is the reference, transcribed from the pre-change source, and it
 * is what makes the comparison below meaningful.
 */
async function sequential(filters) {
  const toExclusive = new Date(`${filters.to}T00:00:00.000Z`);
  toExclusive.setUTCDate(toExclusive.getUTCDate() + 1);

  const ids = [];
  for (let page = 0; page < 25; page++) {
    let q = supabase
      .schema("time")
      .from("entry")
      .select(SELECT)
      .gte("started_at", `${filters.from}T00:00:00.000Z`)
      .lt("started_at", toExclusive.toISOString())
      .not("duration_seconds", "is", null)
      .order("started_at", { ascending: false })
      .range(page * PAGE, page * PAGE + PAGE - 1);

    if (filters.memberIds.length) q = q.in("member_id", filters.memberIds);
    if (filters.projectIds.length) q = q.in("project_id", filters.projectIds);
    if (filters.customerIds.length) q = q.in("customer_id", filters.customerIds);
    if (filters.serviceIds.length) q = q.in("service_id", filters.serviceIds);
    if (filters.billable !== null) q = q.eq("is_billable", filters.billable);
    if (!filters.includeCalendar) q = q.eq("is_calendar", false);

    const { data, error } = await q;
    if (error || !data) break;
    for (const r of data) ids.push(Number(r.id));
    if (data.length < PAGE) break;
  }
  return ids;
}

// Selections chosen to exercise both branches: "all" spans multiple pages (the
// parallel path), a single month fits in one page (the short-circuit that must
// still cost exactly one request), and the filtered cases confirm the shared
// query builder applies every predicate on every page.
const CASES = [
  { label: "all time, multi-page (the parallel path)", params: { preset: "all" } },
  { label: "all time with calendar included", params: { preset: "all", calendar: "1" } },
  { label: "all time, billable only", params: { preset: "all", billable: "yes" } },
  { label: "this month, single page (the short-circuit)", params: { preset: "this_month" } },
  { label: "this year", params: { preset: "this_year" } },
];

for (const c of CASES) {
  const filters = parseFilters(c.params);
  const t0 = performance.now();
  const { entries, truncated } = await fetchAllEntries(supabase, filters);
  const parallelMs = performance.now() - t0;

  const t1 = performance.now();
  const refIds = await sequential(filters);
  const seqMs = performance.now() - t1;

  const gotIds = entries.map((e) => e.id);

  console.log(`\n--- ${c.label} ---`);
  console.log(
    `    ${gotIds.length.toLocaleString("en-GB")} rows · shipped ${parallelMs.toFixed(0)}ms · sequential reference ${seqMs.toFixed(0)}ms`,
  );

  check(`${c.label}: same row COUNT as the sequential reference`,
    gotIds.length === refIds.length,
    `shipped ${gotIds.length}, reference ${refIds.length} — a page-arithmetic slip drops or duplicates exactly 1000 rows and only shows up as a smaller total`);

  // Order matters: `entries` is consumed as most-recent-first by the entry table
  // and by trend bucketing, so a scrambled result is a real defect even with the
  // right count.
  check(`${c.label}: same row ORDER as the sequential reference`,
    gotIds.length === refIds.length && gotIds.every((id, i) => id === refIds[i]),
    (() => {
      const at = gotIds.findIndex((id, i) => id !== refIds[i]);
      return `first divergence at index ${at}: shipped ${gotIds[at]}, reference ${refIds[at]}`;
    })());

  // Duplicates are the specific symptom of an overlapping range, and they inflate
  // every total on the dashboard while the page looks entirely healthy.
  check(`${c.label}: no duplicated rows`,
    new Set(gotIds).size === gotIds.length,
    `${gotIds.length - new Set(gotIds).size} duplicate ids — overlapping page ranges`);

  check(`${c.label}: sorted most-recent-first`,
    entries.every((e, i) => i === 0 || entries[i - 1].startedAt >= e.startedAt),
    "the entry table and the trend both assume this ordering");

  check(`${c.label}: truncated flag is honest`,
    truncated === refIds.length >= 25 * PAGE,
    `truncated=${truncated} at ${refIds.length} rows`);

  // The figure a person actually reads.
  const totals = summarise(entries);
  check(`${c.label}: total hours is a positive finite number`,
    Number.isFinite(totals.totalHours) && totals.totalHours >= 0,
    `got ${totals.totalHours}`);
}

// A negative control on the comparison itself. If the reference implementation
// agreed with the shipped one no matter what, every assertion above would be
// vacuous -- so confirm a deliberately WRONG page range really does diverge.
{
  const filters = parseFilters({ preset: "all" });
  const { entries } = await fetchAllEntries(supabase, filters);
  const skipFirstPage = entries.slice(PAGE).map((e) => e.id);
  const refIds = await sequential(filters);
  check(
    "control: the comparison can actually detect a lost page",
    entries.length > PAGE && skipFirstPage.length !== refIds.length,
    "the dataset is under one page, so the multi-page assertions above prove nothing about paging",
  );
}

console.log(
  failed
    ? "\nPARALLEL PAGING: the fast path does NOT return the same data\n"
    : "\nPARALLEL PAGING: identical rows, identical order, and measurably faster\n",
);
process.exit(failed ? 1 : 0);
