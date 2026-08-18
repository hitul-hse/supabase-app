/**
 * WHY are 1,008 events (1,971h) missing from our copy of this year's data?
 *
 * check-trackingtime-parity.mjs established the gap against the live API. This
 * isolates the cause, because the candidates imply completely different fixes:
 *
 *   H1 THE IMPORT WINDOW. import-trackingtime.mjs fetches
 *      `from = today - DAYS` to `today`. If DAYS is smaller than the year, every
 *      event before the window is simply never requested. Fix: widen the window /
 *      run the documented full sync.
 *
 *   H2 AN UNPAGINATED ENDPOINT. `/events/flat` is fetched with `get()`, not with
 *      `getAllPaged()` like /customers, /projects and /tasks. If the vendor caps a
 *      single response, everything past the cap is silently dropped -- the same
 *      class of bug as PostgREST's 1000-row ceiling, and the importer's own header
 *      comment claims /events/flat "returns everything". Fix: page it.
 *
 *   H3 UNRESOLVED MEMBERS. Entries whose TrackingTime user cannot be matched are
 *      skipped, because member_id is NOT NULL. The parity report named twelve real
 *      colleagues, so if those users ARE in time.member the skip is not the cause.
 *
 *   H4 DUPLICATE source_id COLLISION. The upsert keys on source_id; a collision
 *      would overwrite rather than insert.
 *
 * Each hypothesis is tested against the live API rather than reasoned about.
 *
 * Run: node scripts/diagnose-missing-events.mjs
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

const year = new Date().getUTCFullYear();
const FROM = `${year}-01-01`;
const TO = `${year}-12-31`;
const h = (s) => Math.round((s / 3600) * 10) / 10;
const secs = (e) => Number(e.Duration ?? e.duration ?? 0) || 0;

// ── H2 first: is /events/flat paginated or capped? ─────────────────────────
console.log("=== H2: is /events/flat capped in a single response? ===");
const oneShot = await tt(`/events/flat?filter=COMPANY&from=${FROM}&to=${TO}&include_custom_fields=true`);
console.log(`  one request, whole year:            ${oneShot.length} events, ${h(oneShot.reduce((a, e) => a + secs(e), 0))}h`);

// Ask for the same year in twelve monthly slices. If the monthly total EXCEEDS the
// single-shot total, the single request was silently truncated.
let monthTotal = 0, monthEvents = 0;
const perMonth = [];
for (let m = 1; m <= 12; m++) {
  const mm = String(m).padStart(2, "0");
  const last = new Date(Date.UTC(year, m, 0)).getUTCDate();
  const rows = await tt(
    `/events/flat?filter=COMPANY&from=${year}-${mm}-01&to=${year}-${mm}-${last}&include_custom_fields=true`,
  );
  const s = rows.reduce((a, e) => a + secs(e), 0);
  perMonth.push([`${year}-${mm}`, rows.length, h(s)]);
  monthTotal += s;
  monthEvents += rows.length;
}
console.log(`  twelve monthly requests, summed:    ${monthEvents} events, ${h(monthTotal)}h`);
for (const [mo, n, hrs] of perMonth) console.log(`      ${mo}  ${String(n).padStart(5)} events  ${String(hrs).padStart(8)}h`);

const capped = monthEvents > oneShot.length;
console.log(
  capped
    ? `  => CONFIRMED: the single request LOSES ${monthEvents - oneShot.length} events (${h(monthTotal - oneShot.reduce((a, e) => a + secs(e), 0))}h). /events/flat must be paged or sliced.`
    : `  => not capped: both routes agree, so H2 is not the cause.`,
);

// Is there an explicit page cap we can detect? Try an obviously large page_size.
const probe = await tt(`/events/flat?filter=COMPANY&from=${FROM}&to=${TO}&page_size=5000`);
console.log(`  with page_size=5000:                ${probe.length} events`);

// ── H1: what window does the importer actually request? ───────────────────
console.log("\n=== H1: the importer's rolling window ===");
const src = readFileSync("scripts/import-trackingtime.mjs", "utf8");
const daysDecl = /const DAYS\s*=\s*([^;]+);/.exec(src);
console.log(`  ${daysDecl ? `DAYS = ${daysDecl[1].trim()}` : "could not find DAYS declaration"}`);
const fullFlag = /--full/.test(src) ? "a --full flag exists" : "no --full flag";
console.log(`  ${fullFlag}`);
// How far back does this year's data actually go?
const earliest = perMonth.find(([, n]) => n > 0);
console.log(`  earliest month with data this year: ${earliest ? earliest[0] : "none"}`);
console.log(
  `  A 180-day window from today (${new Date().toISOString().slice(0, 10)}) reaches back to ` +
    `${new Date(Date.now() - 180 * 86400_000).toISOString().slice(0, 10)}, so anything earlier in ${year} is never requested.`,
);

// ── H3: are the named users actually in time.member? ─────────────────────
console.log("\n=== H3: are the 'missing' users resolvable? ===");
const ourRows = [];
for (let off = 0; ; off += 1000) {
  const { data } = await admin.schema("time").from("entry")
    .select("source_id").range(off, off + 999);
  if (!data?.length) break;
  ourRows.push(...data);
  if (data.length < 1000) break;
}
const ourIds = new Set(ourRows.map((r) => String(r.source_id)));
const missing = oneShot.filter((e) => !ourIds.has(String(e.ID ?? e.id)));

const missingUserIds = new Set(missing.map((e) => String(e["User Id"] ?? e.user_id)));
const { data: members } = await admin.schema("time").from("member").select("id,source_id,display_name");
const memberSourceIds = new Set((members ?? []).map((m) => String(m.source_id)));
const unresolvable = [...missingUserIds].filter((id) => !memberSourceIds.has(id));
console.log(`  distinct users among missing events: ${missingUserIds.size}`);
console.log(`  of those, NOT present in time.member: ${unresolvable.length}${unresolvable.length ? ` (${unresolvable.join(", ")})` : ""}`);
console.log(
  unresolvable.length === 0
    ? "  => H3 ruled out: every user is resolvable, so the skip-on-unknown-member path is not why these are absent."
    : "  => H3 contributes: those users must be imported first.",
);

// ── H4: duplicate source ids? ────────────────────────────────────────────
console.log("\n=== H4: duplicate source ids in the vendor response? ===");
const seen = new Set(), dupes = new Set();
for (const e of oneShot) {
  const id = String(e.ID ?? e.id);
  if (seen.has(id)) dupes.add(id);
  seen.add(id);
}
console.log(`  ${dupes.size} duplicate ids among ${oneShot.length} events`);
console.log(dupes.size ? "  => a collision could overwrite rows on upsert." : "  => H4 ruled out.");

// ── What the missing events look like, by date ────────────────────────────
console.log("\n=== the missing events, by month ===");
const byMonth = new Map();
for (const e of missing) {
  const d = String(e.Date ?? e.date ?? e.Start ?? "").slice(0, 7);
  byMonth.set(d, (byMonth.get(d) ?? 0) + secs(e));
}
for (const [mo, s] of [...byMonth.entries()].sort()) {
  console.log(`  ${mo || "(no date)"}  ${h(s)}h`);
}
console.log(
  "\nIf the missing hours cluster in the EARLY months of the year, the rolling import\n" +
    "window is the cause. If they are spread evenly, the endpoint is being truncated.",
);
