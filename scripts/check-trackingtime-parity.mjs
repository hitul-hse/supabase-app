/**
 * Does our dashboard agree with TrackingTime's own numbers for the same period?
 *
 * The user reports that "This Year" shows different TOTAL HOURS, Revenue and Cost
 * in our app than TrackingTime does. This asks the vendor API and our database the
 * same question and prints every way they differ, because there are several
 * candidate explanations and only measurement separates them:
 *
 *   1. CALENDAR TIME. Our dashboard excludes `is_calendar` entries by default and
 *      says so; TrackingTime's own report includes them. On live data that is a
 *      large fraction, so this alone would explain a big gap.
 *   2. DATE-RANGE SEMANTICS. Our "This Year" is 1 Jan to 31 Dec of the current
 *      year in UTC. If TrackingTime interprets its range in the account's local
 *      timezone, entries near midnight on the boundary land in different buckets.
 *   3. SYNC FRESHNESS. Our figures come from the last import. Anything logged in
 *      TrackingTime since then is simply not here yet.
 *   4. DROPPED ROWS AT IMPORT. The importer warns about events referencing
 *      unresolved members and skips them. Those hours would be missing from ours
 *      permanently, which is a real bug rather than a definition difference.
 *   5. DURATION SEMANTICS. Whether we take the vendor's duration field or compute
 *      end-minus-start, and whether either counts breaks.
 *
 * Revenue and cost are OURS, not TrackingTime's: they come from time.member_rate,
 * which the vendor does not know about. If the user is comparing our revenue to a
 * TrackingTime figure, those are different quantities by construction -- but the
 * HOURS behind them must still agree, so hours are the diagnostic.
 *
 * Run: node scripts/check-trackingtime-parity.mjs
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
  console.log("SKIP: no TRACKINGTIME_AUTH / TRACKINGTIME_ACCOUNT_ID in .env.local");
  process.exit(0);
}

const admin = createClient(URL_BASE, SERVICE, { auth: { persistSession: false } });

// ── The same range the dashboard's "This Year" preset resolves to ───────────
// resolvePreset('this_year') is Jan 1 to Dec 31 of the current year, in UTC.
const now = new Date();
const year = now.getUTCFullYear();
const FROM = `${year}-01-01`;
const TO = `${year}-12-31`;
console.log(`comparing "This Year" = ${FROM} .. ${TO}\n`);

// ── 1. TrackingTime's own numbers ──────────────────────────────────────────
const BASE = "https://api.trackingtime.co/api/v4";
const headers = {
  Authorization: `Basic ${TT_AUTH}`,
  "TT-Account-Id": String(TT_ACCOUNT),
  Accept: "application/json",
};

async function tt(path) {
  const res = await fetch(`${BASE}${path}`, { headers });
  const text = await res.text();
  if (!res.ok) throw new Error(`TrackingTime ${res.status}: ${text.slice(0, 200)}`);
  const json = JSON.parse(text);
  return json.data ?? json;
}

const ttEvents = await tt(
  `/events/flat?filter=COMPANY&from=${FROM}&to=${TO}&include_custom_fields=true`,
);
console.log(`TrackingTime returned ${ttEvents.length} events for the range`);

/** Seconds from a TrackingTime flat event, using the same field the importer uses. */
const evSeconds = (e) => {
  const d = Number(e.Duration ?? e.duration ?? 0);
  return Number.isFinite(d) ? d : 0;
};
// GHOST events are calendar placeholders. The importer maps these to is_calendar.
const isCal = (e) => String(e.Type ?? e.type ?? "").toUpperCase() === "GHOST";

let ttAll = 0, ttCal = 0, ttBillable = 0;
for (const e of ttEvents) {
  const s = evSeconds(e);
  ttAll += s;
  if (isCal(e)) ttCal += s;
  const b = e.Billable ?? e.billable;
  if (b === true || b === "true" || b === 1 || b === "1") ttBillable += s;
}
const h = (sec) => Math.round((sec / 3600) * 10) / 10;

console.log(`  TrackingTime total (all events):        ${h(ttAll)}h`);
console.log(`  TrackingTime calendar/GHOST portion:    ${h(ttCal)}h`);
console.log(`  TrackingTime excluding calendar:        ${h(ttAll - ttCal)}h`);
console.log(`  TrackingTime billable:                  ${h(ttBillable)}h`);

// ── 2. Our database, same range ───────────────────────────────────────────
async function ourEntries() {
  const rows = [];
  const toExclusive = new Date(`${TO}T00:00:00.000Z`);
  toExclusive.setUTCDate(toExclusive.getUTCDate() + 1);
  for (let off = 0; ; off += 1000) {
    const { data, error } = await admin.schema("time").from("entry")
      .select("id,source_id,duration_seconds,is_billable,is_calendar,started_at,member_id")
      .gte("started_at", `${FROM}T00:00:00.000Z`)
      .lt("started_at", toExclusive.toISOString())
      .not("duration_seconds", "is", null)
      .range(off, off + 999);
    if (error) throw new Error(error.message);
    if (!data?.length) break;
    rows.push(...data);
    if (data.length < 1000) break;
  }
  return rows;
}

const ours = await ourEntries();
let ourAll = 0, ourCal = 0, ourBillable = 0;
for (const e of ours) {
  const s = Number(e.duration_seconds) || 0;
  ourAll += s;
  if (e.is_calendar) ourCal += s;
  if (e.is_billable) ourBillable += s;
}

console.log(`\nOur database returned ${ours.length} entries for the range`);
console.log(`  our total (all entries):                ${h(ourAll)}h`);
console.log(`  our calendar portion:                   ${h(ourCal)}h`);
console.log(`  our total EXCLUDING calendar  <-- what the dashboard shows by default: ${h(ourAll - ourCal)}h`);
console.log(`  our billable:                           ${h(ourBillable)}h`);

// ── 3. Where does the difference come from? ────────────────────────────────
console.log("\n=== differences, largest first ===");

const dashboardDefault = ourAll - ourCal;
const ttHeadline = ttAll;
console.log(
  `  dashboard default (${h(dashboardDefault)}h) vs TrackingTime headline (${h(ttHeadline)}h): ` +
    `${h(ttHeadline - dashboardDefault)}h apart`,
);
console.log(
  `    of which calendar exclusion explains: ${h(ourCal)}h ` +
    `(switch "Calendar time" on in the dashboard to include it)`,
);

const residual = ttAll - ourAll;
console.log(`\n  like-for-like (both INCLUDING calendar): ${h(ttAll)}h vs ${h(ourAll)}h -> ${h(residual)}h apart`);
console.log(`  event/entry count: ${ttEvents.length} vs ${ours.length} -> ${ttEvents.length - ours.length} rows apart`);

// Which specific events are missing from our side? source_id maps to the vendor ID.
const ourIds = new Set(ours.map((e) => String(e.source_id)));
const missing = ttEvents.filter((e) => !ourIds.has(String(e.ID ?? e.id)));
const missingSeconds = missing.reduce((a, e) => a + evSeconds(e), 0);
console.log(`\n  events TrackingTime has that we do NOT: ${missing.length} (${h(missingSeconds)}h)`);
if (missing.length) {
  const byUser = new Map();
  for (const e of missing) {
    const k = `${e["User Id"] ?? e.user_id ?? "?"} ${e.User ?? e.user ?? ""}`.trim();
    byUser.set(k, (byUser.get(k) ?? 0) + evSeconds(e));
  }
  console.log("    by user:");
  for (const [k, sec] of [...byUser.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12)) {
    console.log(`      ${k.padEnd(34)} ${h(sec)}h`);
  }
  console.log("    sample of the first few:");
  for (const e of missing.slice(0, 5)) {
    console.log(
      `      id=${e.ID ?? e.id} ${String(e.Date ?? e.date ?? "").slice(0, 10)} ` +
        `${h(evSeconds(e))}h type=${e.Type ?? e.type} user=${e.User ?? e.user}`,
    );
  }
}

// And the reverse: rows we hold that the vendor no longer reports (deletions).
const ttIds = new Set(ttEvents.map((e) => String(e.ID ?? e.id)));
const extra = ours.filter((e) => !ttIds.has(String(e.source_id)));
const extraSeconds = extra.reduce((a, e) => a + (Number(e.duration_seconds) || 0), 0);
console.log(`\n  entries we hold that TrackingTime no longer reports: ${extra.length} (${h(extraSeconds)}h)`);
if (extra.length) {
  console.log("    these are most likely deleted or edited in TrackingTime after our last import,");
  console.log("    and the importer does not remove them -- so our totals would run HIGH.");
}

// ── 4. How stale is our copy? ─────────────────────────────────────────────
const { data: runs } = await admin
  .from("sync_runs")
  .select("source,status,finished_at,record_count")
  .order("finished_at", { ascending: false })
  .limit(5);
console.log("\n=== sync freshness ===");
if (runs?.length) {
  for (const r of runs) {
    console.log(`  ${String(r.source).padEnd(14)} ${r.status.padEnd(8)} ${r.finished_at ?? "-"} ${r.record_count ?? ""}`);
  }
} else {
  console.log("  no sync_runs rows: the data came from a manual import, so its age is unknown");
}

// ── 5. Revenue and cost: ours only, and why ───────────────────────────────
console.log("\n=== revenue / cost ===");
console.log("  These are OUR figures, computed from time.member_rate, which TrackingTime does");
console.log("  not hold. TrackingTime's own money numbers use ITS rates, so the two can only");
console.log("  agree if both rate tables match. The comparable quantity is HOURS.");
const { data: rates } = await admin.schema("time").from("member_rate").select("member_id,hourly_rate,hourly_cost,valid_from,valid_to");
const { count: memberCount } = await admin.schema("time").from("member").select("id", { count: "exact", head: true }).eq("is_archived", false);
const withRate = new Set((rates ?? []).map((r) => r.member_id));
console.log(`  members with a rate on file: ${withRate.size} of ${memberCount ?? "?"} active members`);
if ((memberCount ?? 0) > withRate.size) {
  console.log(
    `  ${(memberCount ?? 0) - withRate.size} active members have NO rate, so their hours contribute`,
  );
  console.log("  0 to revenue and cost. That understates both, and is the most likely reason our");
  console.log("  money figures look low next to TrackingTime's.");
}

console.log("\n=== verdict ===");
console.log(`  1. Calendar time explains ${h(ourCal)}h of the gap; the dashboard excludes it by default and says so.`);
if (missing.length) {
  console.log(`  2. ${missing.length} events (${h(missingSeconds)}h) are in TrackingTime but NOT in our database -- a real import gap.`);
} else {
  console.log("  2. No events are missing from our copy for this range.");
}
if (extra.length) {
  console.log(`  3. ${extra.length} entries (${h(extraSeconds)}h) are in our copy but no longer in TrackingTime -- stale rows inflating our totals.`);
} else {
  console.log("  3. No stale rows on our side for this range.");
}
console.log("  4. Revenue/cost are computed from OUR rate table and are not comparable to TrackingTime's money figures.");
