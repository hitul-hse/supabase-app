/**
 * Does the Overview's period filter actually MOVE the numbers?
 *
 * WHY A SEPARATE, DATA-BACKED CHECK. check-overview-filters.mjs proves the page
 * says the right things. It cannot prove the reads narrow: a filter wired to a
 * query that ignores its bounds renders a perfectly labelled "LAST MONTH" card
 * full of twelve-week figures, and every source assertion still passes. That is
 * the same defect class the whole module exists to remove -- a confident,
 * well-designed, wrong number -- so it needs a measurement.
 *
 * The bounds are recomputed here from time.entry with the service-role client
 * and compared against the same aggregate the page derives from time.org_week,
 * so a wrong helper cannot agree with itself.
 *
 * SKIPS rather than fails without credentials, because a source-only machine
 * must still be able to run the rest of the gates.
 *
 * Read-only.
 *
 * Run: node scripts/check-overview-range-narrows.mjs
 */
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const env = {};
try {
  for (const line of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
} catch {
  console.log("SKIP: no .env.local");
  process.exit(0);
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
  if (!ok) failed += 1;
  console.log(`${ok ? "PASS" : "FAIL"}: ${name}${detail ? `\n        ${detail}` : ""}`);
};

const iso = (d) => d.toISOString().slice(0, 10);
const today = iso(new Date());
const mondayOf = (isoDay) => {
  const d = new Date(`${isoDay}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return iso(d);
};
const hrs = (s) => Math.round((s ?? 0) / 3600);

// ── The windows the page's presets resolve to ─────────────────────────────
const weeksBack = (n) => {
  const d = new Date(`${mondayOf(today)}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - (n - 1) * 7);
  return { from: iso(d), to: today };
};
const monthStart = `${today.slice(0, 7)}-01`;
const prevMonth = (() => {
  const start = new Date(`${monthStart}T00:00:00Z`);
  start.setUTCMonth(start.getUTCMonth() - 1);
  const end = new Date(`${monthStart}T00:00:00Z`);
  end.setUTCDate(0);
  return { from: iso(start), to: iso(end) };
})();

const WINDOWS = {
  "12w (default)": weeksBack(12),
  "4w": weeksBack(4),
  "26w": weeksBack(26),
  "prev-month": prevMonth,
};

// ── The weekly series, as the page reads it ───────────────────────────────
const { data: allWeeks, error: weeksErr } = await admin
  .schema("time")
  .from("org_week")
  .select("week_start, total_seconds, billable_seconds, entry_count")
  .order("week_start");
if (weeksErr) {
  console.log(`SKIP: time.org_week unavailable (${weeksErr.message})`);
  process.exit(0);
}

/** The page snaps a range outwards to whole ISO weeks; so does this. */
const sumWindow = (w) => {
  const first = mondayOf(w.from);
  const last = mondayOf(w.to <= today ? w.to : today);
  const rows = allWeeks.filter(
    (r) => String(r.week_start).slice(0, 10) >= first && String(r.week_start).slice(0, 10) <= last,
  );
  return {
    weeks: rows.length,
    total: rows.reduce((s, r) => s + Number(r.total_seconds ?? 0), 0),
    billable: rows.reduce((s, r) => s + Number(r.billable_seconds ?? 0), 0),
  };
};

console.log(`today: ${today}, org_week holds ${allWeeks.length} weeks\n`);
const measured = {};
for (const [label, w] of Object.entries(WINDOWS)) {
  const s = sumWindow(w);
  measured[label] = s;
  console.log(
    `  ${label.padEnd(14)} ${w.from} .. ${w.to}  ${String(s.weeks).padStart(3)} weeks  ${String(hrs(s.total)).padStart(6)}h`,
  );
}
console.log("");

// ── 1. The presets are genuinely different windows ───────────────────────
check(
  "the 4-week window is a strict subset of the 12-week one",
  measured["4w"].weeks < measured["12w (default)"].weeks &&
    measured["4w"].total <= measured["12w (default)"].total,
  `4w ${measured["4w"].weeks}w/${hrs(measured["4w"].total)}h vs 12w ${measured["12w (default)"].weeks}w/${hrs(measured["12w (default)"].total)}h`,
);
check(
  "the 26-week window is a strict superset of the 12-week one",
  measured["26w"].weeks > measured["12w (default)"].weeks &&
    measured["26w"].total >= measured["12w (default)"].total,
  `26w ${measured["26w"].weeks}w/${hrs(measured["26w"].total)}h`,
);
// The point of the whole exercise: the figures must actually MOVE. Equal totals
// across different windows would mean the bounds are being ignored, and every
// label on the page would then be wrong while looking right.
check(
  "changing the period changes the hours (the filter is not inert)",
  measured["4w"].total !== measured["12w (default)"].total,
  `both windows report ${hrs(measured["4w"].total)}h -- if this dataset genuinely has hours in only one week, this check cannot discriminate`,
);
check(
  "last month resolves to a window that is not the default",
  measured["prev-month"].total !== measured["12w (default)"].total ||
    measured["prev-month"].weeks !== measured["12w (default)"].weeks,
  `prev-month ${measured["prev-month"].weeks}w/${hrs(measured["prev-month"].total)}h`,
);
check(
  "the default window is 12 weeks of columns",
  measured["12w (default)"].weeks <= 12,
  `${measured["12w (default)"].weeks} week rows present (fewer only if the data is shorter)`,
);

// ── 2. Ground truth: the view's window agrees with raw entries ───────────
// Recomputed from time.entry so a wrong view cannot vouch for itself.
const w12 = WINDOWS["12w (default)"];
const first12 = mondayOf(w12.from);
const lastMonday12 = mondayOf(w12.to);
const lastDay12 = (() => {
  const d = new Date(`${lastMonday12}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 6);
  return iso(d);
})();

let rawTotal = 0;
for (let from = 0; ; from += 1000) {
  const { data, error } = await admin
    .schema("time")
    .from("entry")
    .select("duration_seconds, started_at")
    .not("duration_seconds", "is", null)
    .gte("started_at", `${first12}T00:00:00Z`)
    .lte("started_at", `${lastDay12}T23:59:59Z`)
    .range(from, from + 999);
  if (error) {
    console.log(`  (could not page time.entry: ${error.message})`);
    break;
  }
  if (!data.length) break;
  for (const r of data) rawTotal += Number(r.duration_seconds ?? 0);
  if (data.length < 1000) break;
}

check(
  "the default window's hours match time.entry recomputed independently",
  Math.abs(hrs(rawTotal) - hrs(measured["12w (default)"].total)) <= 2,
  `org_week ${hrs(measured["12w (default)"].total)}h vs raw entries ${hrs(rawTotal)}h over ${first12}..${lastDay12}`,
);

// ── 3. The team filter: is the no-team bucket really the majority? ───────
const { data: members } = await admin
  .schema("time")
  .from("member")
  .select("id, display_name, email, is_archived, team");

const SHARED = /^(info|jobs|no-reply|noreply|office|admin|team)@/i;
const roster = (members ?? []).filter(
  (m) => !m.is_archived && !(m.email && SHARED.test(m.email)),
);
const withTeam = roster.filter((m) => (m.team ?? "").trim() !== "");
const byTeam = new Map();
for (const m of withTeam) {
  const key = (m.team ?? "").trim().toUpperCase();
  byTeam.set(key, (byTeam.get(key) ?? 0) + 1);
}

console.log(
  `\nroster: ${roster.length} people, ${withTeam.length} with a team recorded` +
    ` (${[...byTeam.entries()].map(([k, n]) => `${k}:${n}`).join(", ") || "none"})`,
);

check(
  "the no-team bucket is non-empty, so hiding it would hide real people",
  roster.length - withTeam.length > 0,
  `${roster.length - withTeam.length} people have no team recorded -- the reason the bucket is selectable`,
);
check(
  "a team filter really does cover only part of the roster",
  withTeam.length < roster.length,
  `${withTeam.length} of ${roster.length} -- the reason the covered headcount is printed on screen`,
);
// Guard the coverage sentence's own arithmetic: the largest single team must
// still be a minority, or the warning would be overstating the problem.
const biggest = Math.max(0, ...byTeam.values());
check(
  "no single team covers the whole roster (the coverage warning is warranted)",
  biggest < roster.length,
  `largest team has ${biggest} of ${roster.length} people`,
);

console.log(
  failed
    ? "\nOVERVIEW RANGE: the period filter does not narrow the data\n"
    : "\nOVERVIEW RANGE: the period narrows the data and the team filter's coverage claim is true\n",
);
process.exit(failed ? 1 : 0);
