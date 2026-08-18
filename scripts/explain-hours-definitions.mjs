/**
 * Which number in our dashboard should equal the 7,498h TrackingTime shows?
 *
 * After the backfill, our database and the vendor agree EXACTLY on the raw data for
 * 2026: 8,263.4h across 5,218 events, zero missing, zero stale. So any remaining
 * difference is a DEFINITION difference, and the user deserves to know which
 * definition produces which number rather than being told to trust ours.
 *
 * The user reported seeing 7,498h in TrackingTime. That is neither our 8,263.4h
 * (everything) nor our 4,992.2h (the dashboard default, calendar excluded), so this
 * enumerates the plausible definitions and prints each total. The one that lands on
 * 7,498h tells us exactly what TrackingTime is counting, and therefore what our
 * dashboard should offer to match it.
 *
 * Run: node scripts/explain-hours-definitions.mjs
 */
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const env = {};
for (const line of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
  const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}
const {
  NEXT_PUBLIC_SUPABASE_URL: URL_BASE,
  SUPABASE_SERVICE_ROLE_KEY: SERVICE,
  TRACKINGTIME_AUTH: TT_AUTH,
  TRACKINGTIME_ACCOUNT_ID: TT_ACCOUNT,
} = env;
if (!URL_BASE || !SERVICE || !TT_AUTH || !TT_ACCOUNT) {
  console.log("SKIP: missing credentials");
  process.exit(0);
}

const admin = createClient(URL_BASE, SERVICE, { auth: { persistSession: false } });
const year = new Date().getUTCFullYear();
const FROM = `${year}-01-01`;
const TO = `${year}-12-31`;
const TARGET = 7498; // what the user sees in TrackingTime
const h = (s) => Math.round((s / 3600) * 10) / 10;

// Pull every 2026 entry with the flags each definition needs.
const rows = [];
{
  const toExcl = new Date(`${TO}T00:00:00.000Z`);
  toExcl.setUTCDate(toExcl.getUTCDate() + 1);
  for (let off = 0; ; off += 1000) {
    const { data, error } = await admin.schema("time").from("entry")
      .select("duration_seconds,is_billable,is_calendar,started_at,project_id,customer_id,service_id,member_id")
      .gte("started_at", `${FROM}T00:00:00.000Z`)
      .lt("started_at", toExcl.toISOString())
      .not("duration_seconds", "is", null)
      .range(off, off + 999);
    if (error) throw new Error(error.message);
    if (!data?.length) break;
    rows.push(...data);
    if (data.length < 1000) break;
  }
}
console.log(`our ${year} entries: ${rows.length}\n`);

// Archived members: TrackingTime's own reports may exclude people who have left.
const { data: members } = await admin.schema("time").from("member").select("id,is_archived,display_name");
const archived = new Set((members ?? []).filter((m) => m.is_archived).map((m) => m.id));

const sum = (pred) => rows.filter(pred).reduce((a, r) => a + (Number(r.duration_seconds) || 0), 0);

// Today, so "up to now" definitions can be evaluated. TrackingTime's UI may not
// count work dated in the future.
const todayIso = new Date().toISOString().slice(0, 10);

const DEFINITIONS = [
  ["everything (all entries, all types)", () => sum(() => true)],
  ["excluding calendar/GHOST  <- our dashboard default", () => sum((r) => !r.is_calendar)],
  ["only calendar/GHOST", () => sum((r) => r.is_calendar)],
  ["billable only", () => sum((r) => r.is_billable)],
  ["non-billable only", () => sum((r) => !r.is_billable)],
  ["everything, excluding archived members", () => sum((r) => !archived.has(r.member_id))],
  ["excluding calendar AND archived members", () => sum((r) => !r.is_calendar && !archived.has(r.member_id))],
  ["everything up to today (no future-dated work)", () => sum((r) => r.started_at.slice(0, 10) <= todayIso)],
  ["excluding calendar, up to today", () => sum((r) => !r.is_calendar && r.started_at.slice(0, 10) <= todayIso)],
  ["everything with a project assigned", () => sum((r) => r.project_id !== null)],
  ["everything with a customer assigned", () => sum((r) => r.customer_id !== null)],
  ["calendar + billable non-calendar", () => sum((r) => r.is_calendar || r.is_billable)],
  ["everything except non-billable calendar", () => sum((r) => !(r.is_calendar && !r.is_billable))],
];

console.log(`=== candidate definitions, against TrackingTime's ${TARGET}h ===\n`);
const scored = DEFINITIONS.map(([label, fn]) => {
  const hours = h(fn());
  return { label, hours, delta: Math.abs(hours - TARGET) };
}).sort((a, b) => a.delta - b.delta);

for (const s of scored) {
  const flag = s.delta <= 15 ? "  <== MATCHES" : s.delta <= 120 ? "  <- close" : "";
  console.log(`  ${String(s.hours).padStart(9)}h   ${s.label.padEnd(48)} off by ${String(s.hours - TARGET >= 0 ? "+" : "")}${(s.hours - TARGET).toFixed(1)}h${flag}`);
}

const best = scored[0];
console.log(`\n=== conclusion ===`);
if (best.delta <= 15) {
  console.log(`  TrackingTime's ${TARGET}h corresponds to: ${best.label} (${best.hours}h).`);
  console.log(`  Our dashboard's default shows ${h(sum((r) => !r.is_calendar))}h, which is a DIFFERENT definition.`);
  console.log(`  To reproduce TrackingTime's figure in our dashboard, apply that definition.`);
} else {
  console.log(`  No single definition lands on ${TARGET}h; the closest is "${best.label}" at ${best.hours}h (off by ${(best.hours - TARGET).toFixed(1)}h).`);
  console.log(`  That suggests TrackingTime's report is scoped by something our copy does not`);
  console.log(`  distinguish -- most likely a per-user or per-project filter left set in its UI,`);
  console.log(`  or a date range that is not exactly ${FROM}..${TO}.`);
}

// The date-range question, tested rather than assumed: what does each month
// contribute, so a range that starts or ends elsewhere can be spotted?
console.log("\n=== our hours by month (all entries), to check the range ===");
const byMonth = new Map();
for (const r of rows) {
  const k = r.started_at.slice(0, 7);
  byMonth.set(k, (byMonth.get(k) ?? 0) + (Number(r.duration_seconds) || 0));
}
let running = 0;
for (const [mo, s] of [...byMonth.entries()].sort()) {
  running += s;
  console.log(`  ${mo}  ${String(h(s)).padStart(8)}h   running ${String(h(running)).padStart(9)}h`);
}
console.log(
  `\n  If TrackingTime's ${TARGET}h matches one of the running totals above, its report\n` +
    `  is covering a shorter range than the full calendar year.`,
);
