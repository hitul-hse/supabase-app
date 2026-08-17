/**
 * Integration-boundary test: what does the REAL query layer do against the REAL
 * live API when the `time` schema is not exposed?
 *
 * This tests a design decision I asserted repeatedly and never verified. The
 * query layer wraps every read in try/catch and returns [] rather than throwing,
 * on the stated grounds that "the schema is not applied yet is a real state, and
 * an empty module beats an exception screen". That claim was never exercised
 * against an actual PGRST106 -- only against PGlite, where the schema always
 * exists and the error can never occur.
 *
 * If the claim is wrong, /time throws a 500 in production instead of rendering an
 * empty state, which is a materially different and much worse failure.
 *
 * The failure being exercised depends on the project's state, and BOTH matter:
 *
 *   - schema not exposed  -> 406 PGRST106 "Invalid schema: time"
 *   - schema exposed, but anon lacks USAGE -> 401 42501 "permission denied"
 *
 * An earlier version of this file asserted the first case in its comments. When the
 * schema was exposed it kept passing on the second, so the assertions were sound
 * while the explanation had quietly become false. It now detects and reports which
 * condition it is testing, because a gate that passes for an unstated reason is one
 * nobody can reason about later.
 *
 * Read-only: SELECTs against the live project, no writes, no auth users created.
 */
import { readFileSync, mkdtempSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { createRequire } from "node:module";

// The credential check has to happen BEFORE react/next are imported. With those
// as static imports the module graph is resolved first, so running without them
// installed crashed with ERR_MODULE_NOT_FOUND instead of skipping -- which is a
// hard failure for exactly the environment the skip exists to protect. Caught by
// running this in a bare directory.
if (!existsSync(".env.local")) {
  console.log("SKIP: no .env.local — nothing to probe");
  process.exit(0);
}

const env = readFileSync(".env.local", "utf8");
const get = (k) => (env.match(new RegExp(`^${k}=(.+)$`, "m")) || [])[1]?.trim();
const url = get("NEXT_PUBLIC_SUPABASE_URL");
const anon = get("NEXT_PUBLIC_SUPABASE_ANON_KEY");

if (!url || !anon) {
  console.log("SKIP: no Supabase URL/key in .env.local");
  process.exit(0);
}

const { createElement: h } = await import("react");
const { renderToStaticMarkup } = await import("react-dom/server");
const { loadBindings, transform } = await import("next/dist/build/swc/index.js");

let failed = false;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}: ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failed = true;
};

await loadBindings();
const dir = resolve(mkdtempSync(join("node_modules", ".time-integration-")));
const require = createRequire(import.meta.url);
const posix = (p) => p.replace(/\\/g, "/");

async function compile(src, out, rewrites = {}) {
  let code = readFileSync(src, "utf8");
  for (const [from, to] of Object.entries(rewrites)) code = code.split(`"${from}"`).join(`"${to}"`);
  const res = await transform(code, {
    filename: src,
    jsc: {
      parser: { syntax: "typescript", tsx: true },
      transform: { react: { runtime: "automatic" } },
      target: "es2022",
    },
    module: { type: "commonjs" },
  });
  const file = join(dir, out);
  writeFileSync(file, res.code);
  return file;
}

const transformFile = await compile("src/lib/time-transform.ts", "time-transform.cjs");
const alias = {
  "@/lib/time-transform": posix(transformFile),
  "@/lib/database.types": posix(transformFile), // types only; erased at compile time
};

// The REAL query layer, not a copy of it.
const queries = require(await compile("src/lib/queries/time.ts", "queries-time.cjs", alias));

// A real Supabase browser client against the real project, anonymous — exactly
// what a signed-out visitor's session would carry before auth.
const { createClient } = await import("@supabase/supabase-js");
const supabase = createClient(url, anon);

console.log(`live project: ${url}`);

// Establish WHICH boundary failure the anon key currently hits, rather than
// assuming. This is the difference between a gate that means something and one that
// merely passes.
const probe = await fetch(`${url}/rest/v1/entry?select=id&limit=1`, {
  headers: { apikey: anon, Authorization: `Bearer ${anon}`, "Accept-Profile": "time" },
});
const probeBody = await probe.json().catch(() => ({}));
const condition =
  probe.status === 200
    ? "readable"
    : probeBody.code === "PGRST106"
      ? "schema not exposed (406 PGRST106)"
      : probeBody.code === "42501"
        ? "schema exposed but anon lacks USAGE (401 42501)"
        : `${probe.status} ${probeBody.code ?? "unknown"}`;

console.log(`anon sees: ${condition}`);
console.log(
  condition === "readable"
    ? "the reads below should return live rows\n"
    : "every read below hits that failure and must degrade to an empty state\n",
);

// ── The claim under test: these must resolve, not reject ───────────────────
const week = queries.currentTimeWeek();

let entries, summary, lookups, memberId, running;
let threw = null;
try {
  [entries, summary, lookups, memberId] = await Promise.all([
    queries.getEntriesForWeek(supabase, week),
    queries.getWeekSummary(supabase, week),
    queries.getTimeLookups(supabase),
    queries.getCurrentMemberId(supabase),
  ]);
  running = await queries.getRunningEntry(supabase, 1);
} catch (e) {
  threw = e;
}

check(
  "no read throws when the schema is unexposed (the page would 500 otherwise)",
  threw === null,
  threw ? `${threw.name}: ${threw.message}` : "all five reads resolved",
);

if (threw) {
  rmSync(dir, { recursive: true, force: true });
  process.exit(1);
}

check("getEntriesForWeek returns an empty array", Array.isArray(entries) && entries.length === 0);
check("getWeekSummary returns an empty array", Array.isArray(summary) && summary.length === 0);
check("getCurrentMemberId returns null, not 0", memberId === null, `got ${JSON.stringify(memberId)}`);
check("getRunningEntry returns null", running === null);
check(
  "getTimeLookups returns the empty shape, not undefined",
  lookups && ["customers", "projects", "services", "tasks"].every((k) => Array.isArray(lookups[k])),
  JSON.stringify(Object.fromEntries(Object.entries(lookups ?? {}).map(([k, v]) => [k, v.length]))),
);

// ── Derived values must also survive the empty case ────────────────────────
const totals = queries.summariseEntries(entries);
check("summariseEntries on empty data gives 0 seconds", totals.totalSeconds === 0);
check(
  "billablePercent is null on empty data, not NaN or 0",
  totals.billablePercent === null,
  `got ${JSON.stringify(totals.billablePercent)}`,
);

const days = queries.groupByDay(entries, week);
check("groupByDay still returns all 7 days", days.length === 7, `${days.length} days`);
check(
  "every day is empty with a zero total",
  days.every((d) => d.entries.length === 0 && d.totalSeconds === 0),
);

// ── And the page's components must render that state, not crash ────────────
const { TimeTotalsStrip } = require(
  await compile("src/app/(app)/time/TimeTotalsStrip.tsx", "TimeTotalsStrip.cjs", {
    ...alias,
    "@/lib/queries/time": posix(transformFile),
  }),
);
const { TimeEntryList } = require(
  await compile("src/app/(app)/time/TimeEntryList.tsx", "TimeEntryList.cjs", {
    ...alias,
    "@/lib/queries/time": posix(transformFile),
  }),
);

let renderThrew = null;
let html = "";
try {
  html =
    renderToStaticMarkup(h(TimeTotalsStrip, { totals })) +
    renderToStaticMarkup(h(TimeEntryList, { days, showMember: false }));
} catch (e) {
  renderThrew = e;
}

check(
  "the totals strip and list render the live-empty state without throwing",
  renderThrew === null,
  renderThrew ? renderThrew.message : "",
);
check("the empty strip shows 0:00 rather than a blank", html.includes("0:00"));
check("the empty strip shows a dash for billable share", html.includes("—"));
check(
  "no day cards are rendered for a week with nothing in it",
  !html.includes("Monday") && !html.includes("Sunday"),
);

rmSync(dir, { recursive: true, force: true });

console.log(
  failed
    ? "\nTIME INTEGRATION: the unexposed-schema path is NOT handled as claimed"
    : "\nTIME INTEGRATION: a missing schema degrades to an empty state, exactly as designed",
);
process.exit(failed ? 1 : 0);
