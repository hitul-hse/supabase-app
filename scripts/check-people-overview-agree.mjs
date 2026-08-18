/**
 * Do per-person hours agree with the organisation total?
 *
 * WHY THIS EXISTS. The People and Overview tabs sit one click apart and report
 * the same underlying hours. If they disagree, neither number can be defended,
 * and the disagreement is invisible from either page alone -- you only see it by
 * adding one page up and comparing it to the other.
 *
 * There is a specific way they came apart. `getOrgWeeks` bounds its window with
 * `lte(today)` because TrackingTime stores PLANNED entries months ahead: 19 of 53
 * weeks are future-dated. The per-member view `time.member_utilisation` had no
 * such bound, so building People on it showed 8.263h against the Overview's
 * 7.592h -- a 671h (9%) overstatement, with Björn Schönemann reading 1.154h
 * against 694h actually worked, and a "last active" date of 2026-12-31.
 *
 * That also corrupts utilisation, not just totals: tracked / (weekly_hours ×
 * weeks_active) inflates the numerator with unworked time, so a person can read
 * as over capacity on work they have not done.
 *
 * WHAT IS ASSERTED, and why it is a real test rather than a restatement: the
 * per-member figures are compared against time.entry recomputed HERE, bounded and
 * unbounded, so the check can tell "the view is bounded" apart from "the view
 * happens to agree". A dataset with no future entries would make this vacuous, so
 * the presence of future-dated time is asserted first -- if that ever stops being
 * true, this check says so instead of passing silently.
 *
 * Read-only.
 *
 * Run: npm run check:people-overview-agree
 */
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const env = {};
for (const line of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
  const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}
if (!env.NEXT_PUBLIC_SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
  console.log("SKIP: need NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY");
  process.exit(0);
}
const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

let failed = 0;
const check = (name, ok, detail = "") => {
  if (!ok) failed++;
  console.log(`${ok ? "PASS" : "FAIL"}: ${name}${detail ? `\n        ${detail}` : ""}`);
};

/** A read that refuses to look like an empty result when it actually errored. */
async function must(label, query) {
  const { data, error } = await query;
  if (error) {
    console.log(`FATAL: ${label} -- ${error.message}`);
    process.exit(1);
  }
  return data;
}

const today = new Date().toISOString().slice(0, 10);
const hrs = (s) => Math.round((s ?? 0) / 3600);

// ── Ground truth from raw entries: bounded and unbounded ──────────────────
// Paged with .range(): a single .limit() silently caps at 1000 and would
// undercount both the members and the hours.
const perMemberAll = new Map();
const perMemberBounded = new Map();
let entryRows = 0;
for (let from = 0; ; from += 1000) {
  const page = await must(
    "page time.entry",
    admin
      .schema("time")
      .from("entry")
      // started_at, NOT date -- selecting a column that does not exist fails the
      // whole request and reads as an empty array.
      .select("member_id, duration_seconds, started_at")
      .range(from, from + 999),
  );
  if (!page.length) break;
  entryRows += page.length;
  for (const r of page) {
    if (!r.member_id) continue;
    const secs = Number(r.duration_seconds ?? 0);
    perMemberAll.set(r.member_id, (perMemberAll.get(r.member_id) ?? 0) + secs);
    if ((r.started_at ?? "").slice(0, 10) <= today) {
      perMemberBounded.set(r.member_id, (perMemberBounded.get(r.member_id) ?? 0) + secs);
    }
  }
  if (page.length < 1000) break;
}

const totalAll = [...perMemberAll.values()].reduce((a, b) => a + b, 0);
const totalBounded = [...perMemberBounded.values()].reduce((a, b) => a + b, 0);

console.log(`today: ${today}`);
console.log(`time.entry: ${entryRows} rows, ${perMemberAll.size} members with time`);
console.log(`raw hours: ${hrs(totalAll)}h all-time, ${hrs(totalBounded)}h bounded at today\n`);

// ── Is this dataset even capable of exposing the bug? ────────────────────
const futureMembers = [...perMemberAll.keys()].filter(
  (id) => (perMemberAll.get(id) ?? 0) !== (perMemberBounded.get(id) ?? 0),
);
check(
  "the dataset contains future-dated (planned) time, so this comparison is meaningful",
  futureMembers.length > 0,
  futureMembers.length > 0
    ? `${futureMembers.length} members carry planned work worth ${hrs(totalAll - totalBounded)}h -- exactly what an unbounded figure would report as logged`
    : "no future-dated entries found: this check can no longer detect the bug it exists for, so treat a PASS below as unproven",
);

// ── The per-member view the People tab reads ─────────────────────────────
const view = await must(
  "read time.member_utilisation",
  admin
    .schema("time")
    .from("member_utilisation")
    .select("member_id, display_name, total_seconds, last_activity_at"),
);

let matchesBounded = 0;
const overstated = [];
for (const v of view) {
  const boundedSecs = perMemberBounded.get(v.member_id) ?? 0;
  const allSecs = perMemberAll.get(v.member_id) ?? 0;
  if (hrs(v.total_seconds) === hrs(boundedSecs)) matchesBounded++;
  else if (hrs(v.total_seconds) === hrs(allSecs) && allSecs !== boundedSecs) {
    overstated.push({ name: v.display_name, shown: hrs(allSecs), real: hrs(boundedSecs) });
  }
}

check(
  "per-member hours exclude planned future work",
  overstated.length === 0,
  overstated.length
    ? `${overstated.length} members overstated: ` +
      overstated
        .sort((a, b) => b.shown - b.real - (a.shown - a.real))
        .slice(0, 5)
        .map((o) => `${o.name} ${o.shown}h vs ${o.real}h actual`)
        .join("; ") +
      "\n        The view counts entries dated after today. Bound it at current_date, or label the figure as including planned work."
    : `all ${matchesBounded} member rows match hours bounded at today`,
);

// ── The headline agreement: People's sum vs the org total ────────────────
const viewTotal = view.reduce((s, r) => s + Number(r.total_seconds ?? 0), 0);
const weeks = await must(
  "read time.org_week",
  admin.schema("time").from("org_week").select("week_start, total_seconds"),
);
const orgBounded = weeks
  .filter((w) => w.week_start <= today)
  .reduce((s, w) => s + Number(w.total_seconds ?? 0), 0);

// Weekly buckets round per week, so a small residue is expected; 1% is far
// tighter than the 9% the real bug produced.
const drift = Math.abs(viewTotal - orgBounded);
const tolerance = orgBounded * 0.01;
check(
  "the sum of per-person hours agrees with the organisation total",
  drift <= tolerance,
  `people ${hrs(viewTotal)}h vs overview ${hrs(orgBounded)}h -- ${hrs(drift)}h apart (${Math.round((drift / orgBounded) * 100)}%), tolerance ${hrs(tolerance)}h`,
);

// ── "Last active" must not be in the future ─────────────────────────────
const futureActivity = view.filter((v) => (v.last_activity_at ?? "").slice(0, 10) > today);
check(
  "no member's last activity is dated in the future",
  futureActivity.length === 0,
  futureActivity.length
    ? futureActivity
        .slice(0, 4)
        .map((v) => `${v.display_name} ${v.last_activity_at?.slice(0, 10)}`)
        .join(", ") + ` -- a 'last active' date after ${today} is a planned entry, not activity`
    : "all last-activity dates are today or earlier",
);

console.log(
  failed
    ? "\nPEOPLE/OVERVIEW AGREEMENT: the two tabs would report different hours\n"
    : "\nPEOPLE/OVERVIEW AGREEMENT: per-person hours reconcile with the org total\n",
);
process.exit(failed ? 1 : 0);
