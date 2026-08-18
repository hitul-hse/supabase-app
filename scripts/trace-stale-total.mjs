/**
 * The user now reports seeing 6,292h. Where does that number come from?
 *
 * It is almost certainly STALE, and that matters more than another definition
 * argument: before the backfill, check-trackingtime-parity reported our 2026 total
 * (all entries, calendar included) as exactly 6292h. Matching to 0.1h is not a
 * coincidence.
 *
 * So the question is not "which definition gives 6,292h" but "why is a stale number
 * still on screen". Candidates, each with a different fix:
 *
 *   A) A CACHED PAGE. If the route is cached anywhere -- Next.js full route cache,
 *      a CDN, or the client's RSC cache -- a reload might still serve the render
 *      made before the backfill.
 *   B) PRODUCTION RUNS OLD CODE. The 15 unpushed commits include the year-to-date
 *      fix. But the DATA lives in the shared database, so production should already
 *      show the corrected hours even on old code. If it does not, it may point at a
 *      different Supabase project.
 *   C) A DIFFERENT SUPABASE PROJECT for production than the one I backfilled.
 *   D) The user is looking at a screenshot or tab from before the backfill.
 *
 * This prints every current total so we can say definitively whether 6,292h is
 * reachable today, then checks the caching posture of the route.
 *
 * Run: node scripts/trace-stale-total.mjs
 */
import { readFileSync, existsSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const env = {};
for (const line of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
  const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}
const { NEXT_PUBLIC_SUPABASE_URL: URL_BASE, SUPABASE_SERVICE_ROLE_KEY: SERVICE } = env;
if (!URL_BASE || !SERVICE) { console.log("SKIP: no credentials"); process.exit(0); }

const admin = createClient(URL_BASE, SERVICE, { auth: { persistSession: false } });
const TARGET = 6292;
const h = (s) => Math.round((s / 3600) * 10) / 10;
const year = new Date().getUTCFullYear();
const TODAY = new Date().toISOString().slice(0, 10);

console.log(`Supabase project this repo talks to: ${URL_BASE}`);
console.log(`looking for a CURRENT total of ${TARGET}h\n`);

// Every 2026 entry.
const rows = [];
{
  for (let off = 0; ; off += 1000) {
    const { data, error } = await admin.schema("time").from("entry")
      .select("duration_seconds,is_billable,is_calendar,started_at,member_id,project_id")
      .gte("started_at", `${year}-01-01T00:00:00.000Z`)
      .lt("started_at", `${year + 1}-01-01T00:00:00.000Z`)
      .not("duration_seconds", "is", null)
      .range(off, off + 999);
    if (error) throw new Error(error.message);
    if (!data?.length) break;
    rows.push(...data);
    if (data.length < 1000) break;
  }
}
const sum = (pred) => rows.filter(pred).reduce((a, r) => a + (Number(r.duration_seconds) || 0), 0);

const { data: members } = await admin.schema("time").from("member").select("id,is_archived");
const archived = new Set((members ?? []).filter((m) => m.is_archived).map((m) => m.id));

const CANDIDATES = [
  ["full year, everything", () => sum(() => true)],
  ["full year, excluding calendar", () => sum((r) => !r.is_calendar)],
  ["year to date, everything  <- 'This Year' now", () => sum((r) => r.started_at.slice(0, 10) <= TODAY)],
  ["year to date, excluding calendar  <- the default", () => sum((r) => !r.is_calendar && r.started_at.slice(0, 10) <= TODAY)],
  ["year to date, billable only", () => sum((r) => r.is_billable && r.started_at.slice(0, 10) <= TODAY)],
  ["year to date, excluding archived members", () => sum((r) => !archived.has(r.member_id) && r.started_at.slice(0, 10) <= TODAY)],
  ["year to date, with a project assigned", () => sum((r) => r.project_id !== null && r.started_at.slice(0, 10) <= TODAY)],
];

console.log("=== every total our data can currently produce for this year ===");
let match = null;
for (const [label, fn] of CANDIDATES) {
  const hrs = h(fn());
  const near = Math.abs(hrs - TARGET) <= 20;
  if (near) match = label;
  console.log(`  ${String(hrs).padStart(9)}h   ${label}${near ? "   <== matches 6,292h" : ""}`);
}

console.log("\n=== verdict ===");
if (match) {
  console.log(`  6,292h IS reachable today: "${match}".`);
} else {
  console.log(`  6,292h is NOT reachable from our current data by any definition above.`);
  console.log(`  Before the backfill, our full-year total was exactly 6292h -- so a screen showing`);
  console.log(`  6,292h is rendering PRE-BACKFILL data. It is a staleness problem, not a`);
  console.log(`  definition problem.`);
}

// Total row count now vs then, as corroboration.
console.log(`\n  entries we now hold for ${year}: ${rows.length} (it was 4,210 before the backfill)`);

// ── Is the route cached anywhere? ─────────────────────────────────────────
console.log("\n=== caching posture of /time/dashboard ===");
const pageSrc = readFileSync("src/app/(app)/time/dashboard/page.tsx", "utf8");
for (const [label, re] of [
  ["export const dynamic", /export const dynamic\s*=\s*["']([^"']+)["']/],
  ["export const revalidate", /export const revalidate\s*=\s*(\d+|false)/],
  ["export const fetchCache", /export const fetchCache\s*=\s*["']([^"']+)["']/],
]) {
  const m = re.exec(pageSrc);
  console.log(`  ${label.padEnd(26)} ${m ? m[1] : "(not set)"}`);
}
const usesCookies = /createClient\(\)/.test(pageSrc) || /requireProfile/.test(pageSrc);
console.log(`  reads auth cookies:        ${usesCookies ? "yes -- which forces dynamic rendering in Next.js" : "no"}`);
console.log(
  "  A page that reads cookies cannot be statically cached by Next.js, so a stale\n" +
    "  render on a fresh request would have to come from a CDN or the browser.",
);

// ── Does production point at the same database? ───────────────────────────
console.log("\n=== which project would production use? ===");
if (existsSync(".vercel/project.json")) {
  const p = JSON.parse(readFileSync(".vercel/project.json", "utf8"));
  console.log(`  linked Vercel project: ${p.projectId ? `${p.projectId.slice(0, 12)}…` : "?"} (org ${p.orgId ? `${p.orgId.slice(0, 10)}…` : "?"})`);
} else {
  console.log("  no .vercel/project.json in this checkout");
}
console.log(
  "  NEXT_PUBLIC_SUPABASE_URL is a BUILD-TIME constant, so production talks to whatever\n" +
    `  project was set in its own environment. If that is not ${new URL(URL_BASE).hostname},\n` +
    "  production is reading a different database and the backfill has not touched it.",
);

console.log(
  "\n=== what to do ===\n" +
    "  1. Hard-reload the dashboard (Ctrl+Shift+R). The page is dynamic, so a fresh\n" +
    "     request must return the new numbers.\n" +
    "  2. Confirm the range shown under the title reads " + `${year}-01-01 → ${TODAY}.\n` +
    "     If it still reads " + `${year}-12-31, the deployment is running pre-fix code.\n` +
    "  3. Production is 15 commits behind this checkout, including the year-to-date fix,\n" +
    "     so it needs a deploy to agree with what I verified locally.",
);
