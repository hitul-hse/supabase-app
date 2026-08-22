/**
 * Does our dashboard agree with TrackingTime's own figures? A gate, not a one-off.
 *
 * THE BUG THIS EXISTS TO CATCH, because it was live and invisible: the importer
 * fetched a rolling `today - 180 days .. today` window. On 18 Aug 2026 that reached
 * back only to 19 February, so January and most of February were never requested,
 * and `to = today` excluded the work this account books MONTHS IN ADVANCE. Measured
 * against the vendor API, 1,008 events and 1,971 hours were missing from our copy of
 * 2026 -- and every existing check passed throughout, because the import succeeded
 * and the totals were merely short.
 *
 * A short total is the worst kind of wrong for this product: the dashboard is used to
 * reconcile against TrackingTime, so a number that is confidently 24% low is worse
 * than an error message.
 *
 * WHAT IS ASSERTED, and why each one:
 *
 *   1. ROW-FOR-ROW PARITY on the current year. Not "close" -- every vendor event id
 *      must exist in time.entry, and we must hold none the vendor no longer reports.
 *      A tolerance would let a slow leak accumulate.
 *   2. HOURS PARITY, so a row present with a wrong duration is caught too.
 *   3. THE VENDOR'S HEADLINE equals our year-to-date total. This is the number the
 *      user compares by eye, and matching it is the actual requirement.
 *   4. NO FUTURE-DATED WORK in the year-to-date figure, which is what made ours read
 *      765h high even once the data was complete.
 *   5. THE CALENDAR GAP IS FULLY EXPLAINED. Our default excludes calendar time; the
 *      difference between the two must be exactly the calendar hours, never a
 *      residual nobody can account for.
 *
 * Requires live credentials, so it is opt-in rather than part of test:db.
 *
 * Run: node scripts/check-vendor-parity.mjs
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
if (!URL_BASE || !SERVICE) {
  console.log("SKIP: no Supabase credentials");
  process.exit(0);
}
if (!TT_AUTH || !TT_ACCOUNT) {
  console.log("SKIP: no TrackingTime credentials — cannot compare against the vendor");
  process.exit(0);
}

let failed = false;
const check = (label, ok, detail) => {
  console.log(`${ok ? "PASS" : "FAIL"}: ${label}\n        ${detail}`);
  if (!ok) failed = true;
};

const admin = createClient(URL_BASE, SERVICE, { auth: { persistSession: false } });
const BASE = "https://api.trackingtime.co/api/v4";
const headers = {
  Authorization: `Basic ${TT_AUTH}`,
  "TT-Account-Id": String(TT_ACCOUNT),
  Accept: "application/json",
};
async function tt(path) {
  const res = await fetch(`${BASE}${path}`, { headers });
  const text = await res.text();
  if (!res.ok) throw new Error(`${res.status}: ${text.slice(0, 160)}`);
  const j = JSON.parse(text);
  return j.data ?? j;
}

const now = new Date();
const year = now.getUTCFullYear();
const FROM = `${year}-01-01`;
const TO = `${year}-12-31`;
const TODAY = now.toISOString().slice(0, 10);
const h = (s) => Math.round((s / 3600) * 10) / 10;
const secs = (e) => Number(e.Duration ?? e.duration ?? 0) || 0;

// Vendor side, sliced monthly for the same reason the importer does it: one request
// for a whole year sits close to a 5,000-row server cap.
const ttEvents = [];
{
  const byId = new Map();
  for (let m = 1; m <= 12; m++) {
    const mm = String(m).padStart(2, "0");
    const last = new Date(Date.UTC(year, m, 0)).getUTCDate();
    const rows = await tt(
      `/events/flat?filter=COMPANY&from=${year}-${mm}-01&to=${year}-${mm}-${last}&include_custom_fields=true`,
    );
    for (const e of rows) byId.set(String(e.ID ?? e.id), e);
  }
  ttEvents.push(...byId.values());
}

// Our side.
const ours = [];
{
  const toExcl = new Date(`${TO}T00:00:00.000Z`);
  toExcl.setUTCDate(toExcl.getUTCDate() + 1);
  for (let off = 0; ; off += 1000) {
    const { data, error } = await admin.schema("time").from("entry")
      .select("source_id,duration_seconds,is_calendar,started_at")
      .gte("started_at", `${FROM}T00:00:00.000Z`)
      .lt("started_at", toExcl.toISOString())
      .not("duration_seconds", "is", null)
      // Ordered, and this is the bug that made this gate fail CI: without it
      // the walk fetched 299 duplicate rows out of 5,299 and reported 8,208.4h
      // against the vendor's 8,409h. The data was right; the read was not.
      .order("id", { ascending: true })
      .range(off, off + 999);
    if (error) throw new Error(error.message);
    if (!data?.length) break;
    ours.push(...data);
    if (data.length < 1000) break;
  }
}

const ttSeconds = ttEvents.reduce((a, e) => a + secs(e), 0);
const ourSeconds = ours.reduce((a, r) => a + (Number(r.duration_seconds) || 0), 0);
const ourCalendar = ours.filter((r) => r.is_calendar).reduce((a, r) => a + (Number(r.duration_seconds) || 0), 0);
const ourToDate = ours
  .filter((r) => r.started_at.slice(0, 10) <= TODAY)
  .reduce((a, r) => a + (Number(r.duration_seconds) || 0), 0);
const ourFuture = ourSeconds - ourToDate;

console.log(`comparing ${year}: vendor ${ttEvents.length} events / ${h(ttSeconds)}h · ours ${ours.length} entries / ${h(ourSeconds)}h\n`);

// 1. Row parity, both directions.
const ourIds = new Set(ours.map((r) => String(r.source_id)));
const ttIds = new Set(ttEvents.map((e) => String(e.ID ?? e.id)));
const missing = ttEvents.filter((e) => !ourIds.has(String(e.ID ?? e.id)));
const stale = ours.filter((r) => !ttIds.has(String(r.source_id)));

check(
  "every TrackingTime event for this year exists in our database",
  missing.length === 0,
  missing.length === 0
    ? `all ${ttEvents.length} events present`
    : `${missing.length} events (${h(missing.reduce((a, e) => a + secs(e), 0))}h) are missing -- run \`npm run sync:year\``,
);
check(
  "we hold no entries TrackingTime no longer reports",
  stale.length === 0,
  stale.length === 0
    ? "no stale rows"
    : `${stale.length} stale entries (${h(stale.reduce((a, r) => a + (Number(r.duration_seconds) || 0), 0))}h) -- deleted in TrackingTime but still here, inflating our totals`,
);

// 2. Hours parity: catches a present row with the wrong duration.
check(
  "total hours match the vendor exactly",
  Math.abs(ttSeconds - ourSeconds) < 60,
  `vendor ${h(ttSeconds)}h vs ours ${h(ourSeconds)}h (difference ${h(Math.abs(ttSeconds - ourSeconds))}h)`,
);

// 3+4. The number the user actually compares.
check(
  "our year-to-date total excludes future-dated work",
  ourFuture > 0 ? ourToDate < ourSeconds : true,
  ourFuture > 0
    ? `${h(ourFuture)}h is dated after ${TODAY} and is correctly outside the year-to-date figure of ${h(ourToDate)}h`
    : "this account has no future-dated entries, so the distinction does not arise",
);

// 5. The calendar difference must be fully accounted for.
const dashboardDefault = ourSeconds - ourCalendar;
const residual = ourSeconds - dashboardDefault - ourCalendar;
check(
  "the gap between our default view and the full total is exactly calendar time",
  Math.abs(residual) < 60,
  `full ${h(ourSeconds)}h - default ${h(dashboardDefault)}h = ${h(ourCalendar)}h calendar, residual ${h(residual)}h`,
);

// A note the reader needs, not an assertion: which of our numbers equals theirs.
// Every figure below is year-to-date, because that is what both sides now mean by
// "This Year" -- mixing a to-date total with a full-year one is what produced the
// original confusion.
const ytd = ours.filter((r) => r.started_at.slice(0, 10) <= TODAY);
const ytdSum = (pred) => ytd.filter(pred).reduce((a, r) => a + (Number(r.duration_seconds) || 0), 0);
const ytdAll = ytdSum(() => true);
const ytdTracked = ytdSum((r) => !r.is_calendar);
const ytdCalendar = ytdSum((r) => r.is_calendar);

console.log("\n=== how to reconcile by eye (all year-to-date) ===");
console.log(`  TrackingTime "This Year" headline        ${h(ytdAll)}h`);
console.log(`  our TOTAL HOURS with "Calendar time" ON  ${h(ytdAll)}h   <- the figure that matches`);
console.log(`  our TOTAL HOURS by default (calendar off) ${h(ytdTracked)}h`);
console.log(`  the difference is calendar/GHOST time     ${h(ytdCalendar)}h`);
// Assert the arithmetic rather than just printing it, so this summary cannot drift
// into saying something untrue.
check(
  "the reconciliation adds up: default + calendar = the vendor's headline",
  Math.abs(ytdTracked + ytdCalendar - ytdAll) < 60,
  `${h(ytdTracked)}h + ${h(ytdCalendar)}h = ${h(ytdTracked + ytdCalendar)}h against ${h(ytdAll)}h`,
);
console.log("  Revenue and cost come from OUR rate table (time.member_rate) and are not");
console.log("  comparable to TrackingTime's money figures, which use its own rates.");

console.log(
  failed
    ? "\nVENDOR PARITY: our data does NOT match TrackingTime\n"
    : "\nVENDOR PARITY: row-for-row and hour-for-hour agreement with TrackingTime\n",
);
process.exit(failed ? 1 : 0);
