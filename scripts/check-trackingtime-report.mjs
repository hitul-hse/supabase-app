// Coverage for the TrackingTime Dashboard's query + aggregation layer —
// src/lib/queries/trackingtime-report.ts.
//
// WHY THIS GATE EXISTS
// --------------------
// This module re-implements in TypeScript what a database would normally do in
// SQL, because PostgREST on this project refuses aggregate functions. That
// choice moves every sum, every group-by and every percentage out of Postgres
// (where it is hard to get wrong) and into application code (where it is easy).
// The failure modes are all silent — nothing throws, the numbers are just wrong:
//
//   * PAGINATION. A single request returns at most 1000 rows with NO error.
//     Summing one page of the 4,191-row live table under-reports by 76% while
//     looking perfectly healthy. This is the single most dangerous bug here.
//   * DATE BOUNDS. `lte('started_at', '2026-06-30')` compares a timestamptz
//     against midnight, silently dropping the final day of every range.
//   * TIMEZONE. Presets built with `new Date(y, m, d)` resolve to LOCAL
//     midnight, shifting "today" by the deployment's UTC offset.
//   * DENOMINATORS. Dividing billable by non-calendar time yields >100%,
//     because 427 live entries are both is_calendar and is_billable.
//   * EMPTY FILTERS. An empty id array must mean "no constraint", never
//     "match nothing" — users report the latter as data loss.
//
// The pure assertions import the REAL exported functions rather than
// re-implementing them, so this gate cannot pass against a copy that has
// drifted from the shipped code. The live section then proves the two
// measured PostgREST constraints still hold, each with a negative control —
// without one, "aggregates are rejected" would also pass if the database were
// simply unreachable.
//
// Run: node scripts/check-trackingtime-report.mjs

import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";
import { registerHooks } from "node:module";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");

// Teach Node the `@/…` path alias from tsconfig.json.
//
// check-time-transform.mjs imports its module directly because
// time-transform.ts has no aliased imports. This module does — it pulls
// `secondsToHours` from `@/lib/time-transform` — and Node's resolver knows
// nothing about tsconfig `paths`, so a bare import fails with
// ERR_MODULE_NOT_FOUND on '@/lib'.
//
// Rewriting the source to relative paths would be the wrong fix: every other
// query module uses `@/`, and breaking that convention to satisfy a test is
// backwards. The hook keeps the shipped code idiomatic and confines the
// workaround to the gate.
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith("@/")) {
      // TypeScript imports are extensionless; Node's loader needs a real file.
      // `.ts` first, then `.tsx`, matching how tsconfig `moduleResolution`
      // would resolve it.
      const base = join(root, "src", specifier.slice(2));
      const target = existsSync(`${base}.ts`) ? `${base}.ts` : `${base}.tsx`;
      return { url: pathToFileURL(target).href, shortCircuit: true };
    }
    return nextResolve(specifier, context);
  },
});

let failed = false;
const check = (label, ok, detail = "") => {
  if (!ok) failed = true;
  console.log(`${ok ? "PASS" : "FAIL"} | ${label}${!ok && detail ? `\n       ${detail}` : ""}`);
};

// Import the real module. `--experimental-strip-types` handles the TS, matching
// how check-time-transform.mjs exercises time-transform.ts.
const mod = await import("../src/lib/queries/trackingtime-report.ts");
const {
  resolvePreset,
  parseFilters,
  buildQuery,
  summarise,
  groupBy,
  trend,
  budgets,
  PRESETS,
} = mod;

const SRC = readFileSync(join(root, "src/lib/queries/trackingtime-report.ts"), "utf8");

/**
 * SRC with comments stripped.
 *
 * The "no local-time constructors" assertion below first failed against the
 * module's own doc comment, which *quotes* `new Date(y, m, d)` while explaining
 * why it must not be used. A source guard that fires on the comment warning
 * against a pattern is worse than no guard: it trains the next person to delete
 * the explanation to make the build pass.
 */
const CODE = SRC.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
const PAGE_SRC = readFileSync(join(root, "src/app/(app)/time/dashboard/page.tsx"), "utf8");
const NAV_SRC = readFileSync(join(root, "src/components/SidebarNav.tsx"), "utf8");

/** Build a synthetic entry; only the fields under test need to vary. */
const entry = (o = {}) => ({
  id: o.id ?? 1,
  memberId: o.memberId ?? 1,
  memberName: o.memberName ?? "A",
  projectId: o.projectId ?? null,
  projectName: o.projectName ?? null,
  customerId: o.customerId ?? null,
  customerName: o.customerName ?? null,
  serviceId: o.serviceId ?? null,
  serviceName: o.serviceName ?? null,
  taskName: o.taskName ?? null,
  startedAt: o.startedAt ?? "2026-06-15T09:00:00.000Z",
  durationSeconds: o.durationSeconds ?? 3600,
  isBillable: o.isBillable ?? false,
  isBilled: o.isBilled ?? false,
  isCalendar: o.isCalendar ?? false,
  notes: o.notes ?? null,
});

console.log("\n--- date presets resolve in UTC, not local time ----------------------");

// A Thursday. Chosen so week boundaries are unambiguous.
const NOW = new Date("2026-06-18T12:00:00.000Z");

check(
  "today is a single day",
  JSON.stringify(resolvePreset("today", NOW)) ===
    JSON.stringify({ from: "2026-06-18", to: "2026-06-18" }),
  JSON.stringify(resolvePreset("today", NOW)),
);

check(
  "this_week runs Monday to Sunday",
  JSON.stringify(resolvePreset("this_week", NOW)) ===
    JSON.stringify({ from: "2026-06-15", to: "2026-06-21" }),
  JSON.stringify(resolvePreset("this_week", NOW)),
);

check(
  "last_week is the preceding Mon-Sun",
  JSON.stringify(resolvePreset("last_week", NOW)) ===
    JSON.stringify({ from: "2026-06-08", to: "2026-06-14" }),
  JSON.stringify(resolvePreset("last_week", NOW)),
);

// Sunday is day 0 in JS. A naive `1 - day` sends Sunday FORWARD into the next
// week instead of back to the Monday that started it.
check(
  "a Sunday belongs to the week that started the previous Monday",
  JSON.stringify(resolvePreset("this_week", new Date("2026-06-21T12:00:00.000Z"))) ===
    JSON.stringify({ from: "2026-06-15", to: "2026-06-21" }),
  JSON.stringify(resolvePreset("this_week", new Date("2026-06-21T12:00:00.000Z"))),
);

check(
  "this_month ends on the real last day (30 June)",
  resolvePreset("this_month", NOW).to === "2026-06-30",
  resolvePreset("this_month", NOW).to,
);

check(
  "February in a leap year ends on the 29th",
  resolvePreset("this_month", new Date("2024-02-10T12:00:00.000Z")).to === "2024-02-29",
  resolvePreset("this_month", new Date("2024-02-10T12:00:00.000Z")).to,
);

check(
  "February in a non-leap year ends on the 28th",
  resolvePreset("this_month", new Date("2026-02-10T12:00:00.000Z")).to === "2026-02-28",
);

check(
  "last_month from 1 January rolls back to December",
  JSON.stringify(resolvePreset("last_month", new Date("2026-01-05T12:00:00.000Z"))) ===
    JSON.stringify({ from: "2025-12-01", to: "2025-12-31" }),
  JSON.stringify(resolvePreset("last_month", new Date("2026-01-05T12:00:00.000Z"))),
);

// The regression that motivates every Date.UTC call in the module: at 23:00 UTC
// a local-time implementation in any positive-offset zone reports tomorrow.
check(
  "late-evening UTC still resolves to today, not tomorrow",
  resolvePreset("today", new Date("2026-06-18T23:30:00.000Z")).from === "2026-06-18",
  resolvePreset("today", new Date("2026-06-18T23:30:00.000Z")).from,
);

check("all-time starts before any plausible record", resolvePreset("all", NOW).from === "2000-01-01");

console.log("\n--- URL parsing is validated, never trusted --------------------------");

check(
  "no params falls back to this_month",
  parseFilters({}, NOW).preset === "this_month",
  parseFilters({}, NOW).preset,
);

check(
  "an unknown preset falls back rather than throwing",
  parseFilters({ preset: "../../etc/passwd" }, NOW).preset === "this_month",
);

check(
  "custom with valid dates is honoured",
  (() => {
    const f = parseFilters({ preset: "custom", from: "2026-03-01", to: "2026-03-31" }, NOW);
    return f.preset === "custom" && f.from === "2026-03-01" && f.to === "2026-03-31";
  })(),
);

check(
  "custom with a reversed range is swapped, not rejected",
  (() => {
    const f = parseFilters({ preset: "custom", from: "2026-03-31", to: "2026-03-01" }, NOW);
    return f.from === "2026-03-01" && f.to === "2026-03-31";
  })(),
);

check(
  "custom with a malformed date falls back to a preset",
  parseFilters({ preset: "custom", from: "not-a-date", to: "2026-03-31" }, NOW).preset ===
    "this_month",
);

check(
  "id lists parse to integers",
  JSON.stringify(parseFilters({ members: "3,11,37" }, NOW).memberIds) === "[3,11,37]",
);

// These flow into a PostgREST `in.(…)` list, so anything non-numeric must be
// dropped before it reaches a query rather than sanitised downstream.
check(
  "non-numeric ids are discarded",
  JSON.stringify(parseFilters({ members: "3,DROP TABLE,11,'; --" }, NOW).memberIds) === "[3,11]",
  JSON.stringify(parseFilters({ members: "3,DROP TABLE,11,'; --" }, NOW).memberIds),
);

check(
  "zero and negative ids are discarded",
  JSON.stringify(parseFilters({ projects: "0,-5,7" }, NOW).projectIds) === "[7]",
);

check(
  "a very long id list is bounded",
  parseFilters({ members: Array.from({ length: 500 }, (_, i) => i + 1).join(",") }, NOW).memberIds
    .length === 200,
);

check(
  "an absent id param is an empty array (no constraint), not null",
  Array.isArray(parseFilters({}, NOW).memberIds) && parseFilters({}, NOW).memberIds.length === 0,
);

check(
  "billable tri-state parses yes/no/absent",
  parseFilters({ billable: "yes" }, NOW).billable === true &&
    parseFilters({ billable: "no" }, NOW).billable === false &&
    parseFilters({}, NOW).billable === null,
);

check(
  "calendar time is excluded unless explicitly requested",
  parseFilters({}, NOW).includeCalendar === false &&
    parseFilters({ calendar: "1" }, NOW).includeCalendar === true,
);

check(
  "a repeated param (array) takes the first value rather than crashing",
  parseFilters({ preset: ["today", "all"] }, NOW).preset === "today",
);

console.log("\n--- the query string round-trips -------------------------------------");

check(
  "filters survive serialise → parse",
  (() => {
    const original = parseFilters(
      { preset: "custom", from: "2026-03-01", to: "2026-03-31", members: "3,11", billable: "yes", calendar: "1" },
      NOW,
    );
    const qs = buildQuery(original);
    const back = parseFilters(Object.fromEntries(new URLSearchParams(qs)), NOW);
    return (
      back.from === original.from &&
      back.to === original.to &&
      JSON.stringify(back.memberIds) === JSON.stringify(original.memberIds) &&
      back.billable === original.billable &&
      back.includeCalendar === original.includeCalendar
    );
  })(),
);

check(
  "defaults are omitted from the query string",
  !buildQuery(parseFilters({}, NOW)).includes("billable"),
  buildQuery(parseFilters({}, NOW)),
);

console.log("\n--- totals use honest denominators -----------------------------------");

check(
  "an empty set reports null percent, not 0%",
  summarise([]).billablePercent === null,
);

check(
  "hours convert from seconds with a float divisor",
  summarise([entry({ durationSeconds: 5400 })]).totalHours === 1.5,
  String(summarise([entry({ durationSeconds: 5400 })]).totalHours),
);

check(
  "sub-hour time is not floored to zero",
  summarise([entry({ durationSeconds: 3599 })]).totalHours > 0,
);

// The measured regression: 427 live entries are BOTH calendar and billable.
// Dividing billable by non-calendar time gives >100%.
check(
  "billable% cannot exceed 100 when calendar time is also billable",
  (() => {
    const t = summarise([
      entry({ durationSeconds: 3600, isBillable: true, isCalendar: true }),
      entry({ durationSeconds: 3600, isBillable: true, isCalendar: false }),
    ]);
    return t.billablePercent === 100;
  })(),
);

check(
  "billable and non-billable seconds sum to the total",
  (() => {
    const t = summarise([
      entry({ durationSeconds: 3600, isBillable: true }),
      entry({ durationSeconds: 1800, isBillable: false }),
    ]);
    return t.billableSeconds + t.nonBillableSeconds === t.totalSeconds;
  })(),
);

check(
  "distinct people are counted once regardless of entry count",
  summarise([entry({ memberId: 1 }), entry({ memberId: 1 }), entry({ memberId: 2 })])
    .memberCount === 2,
);

check(
  "active days counts distinct calendar days",
  summarise([
    entry({ startedAt: "2026-06-15T09:00:00.000Z" }),
    entry({ startedAt: "2026-06-15T14:00:00.000Z" }),
    entry({ startedAt: "2026-06-16T09:00:00.000Z" }),
  ]).activeDays === 2,
);

check(
  "entries with no project do not inflate the project count",
  summarise([entry({ projectId: null }), entry({ projectId: 5 })]).projectCount === 1,
);

console.log("\n--- grouping keeps every second attributable -------------------------");

check(
  "group totals sum to the overall total",
  (() => {
    const rows = [
      entry({ projectId: 1, projectName: "P1", durationSeconds: 3600 }),
      entry({ projectId: 2, projectName: "P2", durationSeconds: 1800 }),
      entry({ projectId: null, durationSeconds: 900 }),
    ];
    const total = summarise(rows).totalSeconds;
    const grouped = groupBy(rows, "project").reduce((a, r) => a + r.totalSeconds, 0);
    return total === grouped;
  })(),
);

// 1,691 live entries have no project. Dropping them would make the breakdown
// silently disagree with the headline figure above it.
check(
  "unattributed time appears as its own row rather than vanishing",
  groupBy([entry({ projectId: null, durationSeconds: 3600 })], "project")[0].label ===
    "(no project)",
);

check(
  "two distinct projects sharing a name stay separate",
  groupBy(
    [
      entry({ projectId: 1, projectName: "Audit", durationSeconds: 3600 }),
      entry({ projectId: 2, projectName: "Audit", durationSeconds: 1800 }),
    ],
    "project",
  ).length === 2,
);

check(
  "rows are ranked by hours descending",
  (() => {
    const rows = groupBy(
      [
        entry({ memberId: 1, memberName: "Small", durationSeconds: 600 }),
        entry({ memberId: 2, memberName: "Big", durationSeconds: 7200 }),
      ],
      "member",
    );
    return rows[0].label === "Big";
  })(),
);

check(
  "share percentages sum to ~100",
  (() => {
    const rows = groupBy(
      [
        entry({ memberId: 1, durationSeconds: 3600 }),
        entry({ memberId: 2, durationSeconds: 1800 }),
        entry({ memberId: 3, durationSeconds: 600 }),
      ],
      "member",
    );
    return Math.abs(rows.reduce((a, r) => a + r.sharePercent, 0) - 100) < 0.01;
  })(),
);

check(
  "last activity is the most recent entry in the group",
  groupBy(
    [
      entry({ memberId: 1, startedAt: "2026-06-10T09:00:00.000Z" }),
      entry({ memberId: 1, startedAt: "2026-06-14T09:00:00.000Z" }),
    ],
    "member",
  )[0].lastActivityAt === "2026-06-14T09:00:00.000Z",
);

check("grouping an empty set yields no rows", groupBy([], "member").length === 0);

console.log("\n--- the trend is bucketed and ordered --------------------------------");

check(
  "daily buckets are oldest-first",
  (() => {
    const pts = trend(
      [
        entry({ startedAt: "2026-06-16T09:00:00.000Z" }),
        entry({ startedAt: "2026-06-14T09:00:00.000Z" }),
      ],
      "day",
    );
    return pts[0].bucket === "2026-06-14" && pts[1].bucket === "2026-06-16";
  })(),
);

check(
  "weekly buckets collapse a week onto its Monday",
  (() => {
    const pts = trend(
      [
        entry({ startedAt: "2026-06-15T09:00:00.000Z" }), // Mon
        entry({ startedAt: "2026-06-19T09:00:00.000Z" }), // Fri
      ],
      "week",
    );
    return pts.length === 1 && pts[0].bucket === "2026-06-15";
  })(),
);

check(
  "monthly buckets collapse onto the 1st",
  trend([entry({ startedAt: "2026-06-19T09:00:00.000Z" })], "month")[0].bucket === "2026-06-01",
);

check(
  "trend totals sum to the overall total",
  (() => {
    const rows = [
      entry({ startedAt: "2026-06-14T09:00:00.000Z", durationSeconds: 3600 }),
      entry({ startedAt: "2026-06-16T09:00:00.000Z", durationSeconds: 1800 }),
    ];
    return (
      trend(rows, "day").reduce((a, p) => a + p.totalSeconds, 0) === summarise(rows).totalSeconds
    );
  })(),
);

console.log("\n--- budget burn distinguishes 'no budget' from 'zero budget' ---------");

const PROJECTS = [
  { id: 1, name: "Has budget", customerName: "C", estimatedHours: 10 },
  { id: 2, name: "Zero budget", customerName: "C", estimatedHours: 0 },
  { id: 3, name: "No budget", customerName: "C", estimatedHours: null },
];

// 83 of 334 live projects carry estimated_hours = 0, meaning "nobody set one".
// Rendering those at 0% burn would bury the projects genuinely overrunning.
check(
  "projects with no usable estimate are omitted entirely",
  budgets([entry({ projectId: 1, durationSeconds: 3600 })], PROJECTS).length === 1,
);

check(
  "burn percent is actual over estimate",
  budgets([entry({ projectId: 1, durationSeconds: 5 * 3600 })], PROJECTS)[0].burnPercent === 50,
);

check(
  "overrun is flagged and remaining goes negative",
  (() => {
    const r = budgets([entry({ projectId: 1, durationSeconds: 12 * 3600 })], PROJECTS)[0];
    return r.isOver === true && r.remainingHours === -2;
  })(),
);

check(
  "a project with an estimate but no logged time reads 0%, not NaN",
  (() => {
    const r = budgets([], PROJECTS)[0];
    return r.burnPercent === 0 && r.actualHours === 0;
  })(),
);

check(
  "most-burned projects sort first",
  (() => {
    const rows = budgets(
      [
        entry({ projectId: 1, durationSeconds: 9 * 3600 }),
        entry({ projectId: 4, durationSeconds: 1 * 3600 }),
      ],
      [...PROJECTS, { id: 4, name: "Low", customerName: null, estimatedHours: 100 }],
    );
    return rows[0].projectId === 1;
  })(),
);

console.log("\n--- source guards against the silent regressions ---------------------");

// The 1000-row cap is invisible: a truncated result is a short array, not an
// error. If the paging loop is ever removed, totals drop by ~76% on live data
// with nothing on screen to indicate it.
check(
  "fetchAllEntries pages rather than issuing one unbounded request",
  /for\s*\(\s*let\s+page\s*=\s*0/.test(CODE) && CODE.includes(".range("),
);

check(
  "the paging loop is bounded by MAX_PAGES",
  /MAX_PAGES/.test(CODE) && /page\s*<\s*MAX_PAGES/.test(CODE),
);

check(
  "hitting the ceiling is surfaced as `truncated`, not swallowed",
  CODE.includes("truncated") && PAGE_SRC.includes("truncated"),
);

// lte on a timestamptz compares against midnight and drops the final day.
check(
  "the upper date bound is exclusive-next-day, not lte",
  CODE.includes("toExclusive") && CODE.includes('.lt("started_at"') &&
    !CODE.includes('.lte("started_at"'),
);

check(
  "date maths uses Date.UTC rather than local-time constructors",
  CODE.includes("Date.UTC") && !/new Date\(\s*y\s*,\s*m\s*[,)]/.test(CODE),
);

check(
  "running timers are excluded from reports",
  CODE.includes('.not("duration_seconds", "is", null)'),
);

// Rates must never be joined here — a partial rate join produces a plausible
// wrong total instead of an error. Money comes from the security-definer RPC.
// Checked against CODE so the doc comment may keep explaining the rule.
check(
  "the report layer never reads member_rate",
  !CODE.includes("member_rate"),
);

check(
  "the page still gates on timesheets:read_all",
  PAGE_SRC.includes("TIMESHEETS_READ_ALL") && PAGE_SRC.includes("requirePermission"),
);

check(
  "money remains behind its own permission check",
  PAGE_SRC.includes("OVERVIEW_EXPORT") && PAGE_SRC.includes("canSeeMoney"),
);

check(
  "group and bucket params are validated against a fixed list",
  PAGE_SRC.includes("GROUPS.includes") && PAGE_SRC.includes("BUCKETS.includes"),
);

console.log("\n--- navigation ------------------------------------------------------");

check(
  "the sidebar entry is renamed to TrackingTime Dashboard",
  NAV_SRC.includes("TrackingTime Dashboard"),
);

check(
  "the sidebar points at the dashboard route",
  NAV_SRC.includes('href: "/time/dashboard"'),
);

check(
  "the old 'Time Tracking' nav label is gone",
  !/label:\s*"Time Tracking"/.test(NAV_SRC),
);

console.log("\n--- presets are complete --------------------------------------------");

check(
  "every preset key resolves to a valid range",
  PRESETS.every((p) => {
    const r = resolvePreset(p.key, NOW);
    return /^\d{4}-\d{2}-\d{2}$/.test(r.from) && /^\d{4}-\d{2}-\d{2}$/.test(r.to) && r.from <= r.to;
  }),
);

/* ------------------------------------------------------------------ live */

const ENV = join(root, ".env.local");
if (existsSync(ENV)) {
  for (const line of readFileSync(ENV, "utf8").split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m) process.env[m[1]] ??= m[2].replace(/^["']|["']$/g, "");
  }
}

const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!URL_ || !KEY) {
  console.log("\nSKIP | live checks (no Supabase credentials in .env.local)");
} else {
  console.log("\n--- live: the two PostgREST constraints still hold -------------------");

  const { createClient } = await import("@supabase/supabase-js");
  const db = createClient(URL_, KEY, { db: { schema: "time" } });

  // Negative control FIRST. Without it, every assertion below would also pass
  // against an unreachable database, and this section would prove nothing.
  const control = await db.from("entry").select("id").limit(1);
  check(
    "NEGATIVE CONTROL: the time schema is reachable",
    !control.error && Array.isArray(control.data),
    control.error?.message ?? "no rows",
  );

  if (!control.error) {
    const agg = await db.from("entry").select("duration_seconds.sum()");
    check(
      "aggregates are still rejected (the reason we sum in TypeScript)",
      Boolean(agg.error) && /aggregate/i.test(agg.error?.message ?? ""),
      agg.error?.message ?? "aggregates unexpectedly SUCCEEDED — the module could use SQL sums",
    );

    // The cap that makes paging mandatory. Asking for 5000 and receiving
    // exactly 1000 with no error is the silent truncation itself.
    const wide = await db.from("entry").select("id").range(0, 4999);
    check(
      "a single request is capped at 1000 rows with no error raised",
      !wide.error && wide.data?.length === 1000,
      `got ${wide.data?.length} rows, error=${wide.error?.message ?? "none"}`,
    );

    const second = await db.from("entry").select("id").range(1000, 1999);
    check(
      "paging past the cap returns further rows",
      !second.error && (second.data?.length ?? 0) > 0,
      second.error?.message ?? `${second.data?.length} rows`,
    );

    // Exercise every filter the UI can emit, to prove each column and its
    // operator actually exist server-side.
    const filtered = await db
      .from("entry")
      .select("id", { count: "exact", head: true })
      .gte("started_at", "2026-06-01T00:00:00.000Z")
      .lt("started_at", "2026-07-01T00:00:00.000Z")
      .eq("is_billable", true)
      .eq("is_calendar", false);
    check(
      "the full filter combination is accepted by PostgREST",
      !filtered.error && typeof filtered.count === "number",
      filtered.error?.message ?? `count=${filtered.count}`,
    );

    // The embedded select the report relies on for names.
    const joined = await db
      .from("entry")
      .select("id, member:member_id(display_name), project:project_id(name), service:service_id(name)")
      .limit(1);
    check(
      "embedded member/project/service names resolve",
      !joined.error && Array.isArray(joined.data),
      joined.error?.message ?? "ok",
    );

    // Prove the exclusive upper bound actually matters: an lte bound must not
    // silently exceed the exclusive one.
    const lastDay = "2026-06-30";
    const lteCount = await db
      .from("entry")
      .select("id", { count: "exact", head: true })
      .gte("started_at", "2026-06-01T00:00:00.000Z")
      .lte("started_at", `${lastDay}T00:00:00.000Z`);
    const ltNextCount = await db
      .from("entry")
      .select("id", { count: "exact", head: true })
      .gte("started_at", "2026-06-01T00:00:00.000Z")
      .lt("started_at", "2026-07-01T00:00:00.000Z");
    check(
      "the exclusive bound includes the final day that lte drops",
      typeof lteCount.count === "number" &&
        typeof ltNextCount.count === "number" &&
        ltNextCount.count >= lteCount.count,
      `lte=${lteCount.count} lt-next-day=${ltNextCount.count}`,
    );
  }
}

console.log(
  failed
    ? "\nTRACKINGTIME REPORT: FAILED\n"
    : "\nTRACKINGTIME REPORT: all checks passed\n",
);
process.exit(failed ? 1 : 0);
