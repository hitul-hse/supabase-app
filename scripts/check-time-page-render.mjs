/**
 * Do the /time components RENDER the right figures?
 *
 * check-time-page-data.mjs proves the database returns the right seconds, and
 * check-time-rls.mjs proves who may read them. Neither observes what a person
 * actually SEES -- and that is exactly where this module's most dangerous bug
 * class lives. Durations are seconds here while the Hub stores hours, so a
 * component formatting with the wrong divisor renders "210:00" where the answer
 * is "3:30", and passes every other gate in this repo.
 *
 * The real .tsx is compiled with Next's own SWC and rendered to HTML, so the
 * assertions are made against markup a user would actually receive rather than
 * against a reimplementation that can drift from what ships.
 *
 * createElement is used instead of JSX so this harness needs no build step of
 * its own; the components under test are the compiled originals either way.
 */
import { readFileSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { createRequire } from "node:module";
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { loadBindings, transform } from "next/dist/build/swc/index.js";

// SWC's native bindings are loaded lazily; transform() throws "bindings not
// loaded yet" without this.
await loadBindings();

let failed = false;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}: ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failed = true;
};

// Compiled output goes inside the project, not the OS temp dir: a module in
// %TEMP% cannot resolve "react/jsx-runtime", because Node walks up from the
// file's own location and never reaches ./node_modules.
const dir = resolve(mkdtempSync(join("node_modules", ".time-render-")));
const require = createRequire(import.meta.url);
const posix = (p) => p.replace(/\\/g, "/");

/**
 * Compile one source file to CommonJS and return its path.
 *
 * `rewrites` redirects the "@/..." aliases to the already-compiled real files,
 * so the formatSeconds() under test is the shipped implementation rather than a
 * stub -- which matters, because the unit conversion is the thing most worth
 * verifying.
 */
async function compile(srcPath, outName, rewrites = {}) {
  let code = readFileSync(srcPath, "utf8");
  for (const [from, to] of Object.entries(rewrites)) {
    code = code.split(`"${from}"`).join(`"${to}"`);
  }
  const out = await transform(code, {
    filename: srcPath,
    jsc: {
      parser: { syntax: "typescript", tsx: true },
      transform: { react: { runtime: "automatic" } },
      target: "es2022",
    },
    module: { type: "commonjs" },
  });
  const file = join(dir, outName);
  writeFileSync(file, out.code);
  return file;
}

const transformFile = await compile("src/lib/time-transform.ts", "time-transform.cjs");
// Types-only imports vanish at compile time, so pointing "@/lib/queries/time"
// at the same module is harmless and avoids pulling in the Supabase client.
// The card vocabulary is compiled for real: the strip renders StatTiles and
// the assertions below run against their markup.
const cardFile = await compile("src/components/ui/Card.tsx", "card.cjs");
const alias = {
  "@/lib/time-transform": posix(transformFile),
  "@/lib/queries/time": posix(transformFile),
  "@/components/ui/Card": posix(cardFile),
};

const { TimeTotalsStrip } = require(
  await compile("src/app/(app)/time/TimeTotalsStrip.tsx", "TimeTotalsStrip.cjs", alias),
);
const { TimeEntryList } = require(
  await compile("src/app/(app)/time/TimeEntryList.tsx", "TimeEntryList.cjs", alias),
);
const { WeekSummaryTable } = require(
  await compile("src/app/(app)/time/WeekSummaryTable.tsx", "WeekSummaryTable.cjs", alias),
);

const render = (Component, props) => renderToStaticMarkup(h(Component, props));

// ── The totals strip ────────────────────────────────��──────────────────────
// The same figures check-time-page-data.mjs seeds into Postgres:
// 2h billable + 30m non-billable + 1h calendar = 3h30m logged, 57% billable.
const totals = {
  totalSeconds: 12600,
  billableSeconds: 7200,
  calendarSeconds: 3600,
  entryCount: 3,
  totalHours: 3.5,
  billableHours: 2,
  billablePercent: 57,
};

const totalsHtml = render(TimeTotalsStrip, { totals });

check(
  "logged total renders 3:30, not 210:00 (seconds misread as minutes)",
  totalsHtml.includes("3:30") && !totalsHtml.includes("210:00"),
);
check("billable renders 2:00", totalsHtml.includes("2:00"));
check("calendar renders 1:00", totalsHtml.includes("1:00"));
check("the decimal figure for invoicing renders 3.50", totalsHtml.includes("3.50"));
check("the billable share renders 57% of logged", totalsHtml.includes("57% of logged"));
check("3 entries is pluralised", totalsHtml.includes("3 entries"));

const emptyHtml = render(TimeTotalsStrip, {
  totals: {
    totalSeconds: 0,
    billableSeconds: 0,
    calendarSeconds: 0,
    entryCount: 0,
    totalHours: 0,
    billableHours: 0,
    billablePercent: null,
  },
});
check(
  "an empty week shows a dash for billable share, never '0% of logged'",
  !emptyHtml.includes("0% of logged") && emptyHtml.includes("—"),
);
check("an empty week reads '0 entries'", emptyHtml.includes("0 entries"));
check("one entry reads '1 entry', singular", render(TimeTotalsStrip, {
  totals: { ...totals, entryCount: 1 },
}).includes("1 entry"));

// ── The entry list ─────────────────────────────────────────────────────────
const entry = (over = {}) => ({
  id: 1,
  memberId: 1,
  memberName: "Anna Beck",
  taskName: "Site inspection",
  projectName: "DGUV V2 Betreuung",
  customerName: "Muster GmbH",
  serviceName: "Risk Assessment",
  startedAt: "2026-08-17T08:00:00.000Z",
  endedAt: "2026-08-17T10:00:00.000Z",
  durationSeconds: 7200,
  duration: "2:00",
  isBillable: true,
  isBilled: false,
  isCalendar: false,
  isRunning: false,
  notes: "Inspection walkthrough",
  ...over,
});

const days = [
  { date: "2026-08-17", entries: [entry()], totalSeconds: 7200 },
  // groupByDay returns all seven days; one with nothing tracked must not render.
  { date: "2026-08-18", entries: [], totalSeconds: 0 },
];

const listHtml = render(TimeEntryList, { days, showMember: false });
check("the task name is rendered", listHtml.includes("Site inspection"));
check("the customer is rendered", listHtml.includes("Muster GmbH"));
check("the project is rendered", listHtml.includes("DGUV V2 Betreuung"));
check("the service is rendered", listHtml.includes("Risk Assessment"));
check("the entry duration renders 2:00", listHtml.includes("2:00"));
check("the start and end clock times are rendered", listHtml.includes("08:00") && listHtml.includes("10:00"));
check("the day heading names the weekday", listHtml.includes("Monday"));
check("a day with no entries is omitted, not rendered empty", !listHtml.includes("Tuesday"));
check(
  "own-time view omits the redundant column of your own name",
  !listHtml.includes("Anna Beck"),
);
check(
  "team view does render the member name",
  render(TimeEntryList, { days, showMember: true }).includes("Anna Beck"),
);

// A calendar placeholder legitimately has no task, customer or project. Each
// absence must read as a stated fact, not a blank cell that looks broken.
const ghostHtml = render(TimeEntryList, {
  days: [
    {
      date: "2026-08-19",
      entries: [
        entry({
          taskName: null,
          customerName: null,
          projectName: null,
          serviceName: null,
          isCalendar: true,
          isBillable: false,
          notes: null,
        }),
      ],
      totalSeconds: 3600,
    },
  ],
});
check("an untitled calendar entry says 'Untitled entry'", ghostHtml.includes("Untitled entry"));
check("a missing customer reads 'No customer'", ghostHtml.includes("No customer"));
check("a missing project reads 'No project'", ghostHtml.includes("No project"));
check("calendar-sourced time is labelled", ghostHtml.includes("calendar"));
check("a non-billable entry carries no billable pill", !/>billable</.test(ghostHtml));

const runningHtml = render(TimeEntryList, {
  days: [
    {
      date: "2026-08-20",
      entries: [entry({ endedAt: null, durationSeconds: null, duration: "—", isRunning: true })],
      totalSeconds: 0,
    },
  ],
});
check("a running timer is labelled running", runningHtml.includes("running"));
check(
  "a running timer shows a dash, never 0:00 (which reads as 'logged nothing')",
  runningHtml.includes("—") && !runningHtml.includes("0:00"),
);
check("a running timer's end time is an ellipsis", runningHtml.includes("…"));

// The complementary case, so the dash above cannot over-apply: a finished entry
// of genuinely zero length is really zero and must still read "0:00". Without
// this, "show a dash when the total is 0" would silently hide real zero days.
const zeroLengthHtml = render(TimeEntryList, {
  days: [
    {
      date: "2026-08-21",
      entries: [entry({ durationSeconds: 0, duration: "0:00", endedAt: "2026-08-21T08:00:00.000Z" })],
      totalSeconds: 0,
    },
  ],
});
check(
  "a finished zero-length day still reads 0:00, not a dash",
  zeroLengthHtml.includes("0:00"),
);

// ── The week summary ───────────────────────────────────────────────────────
const summaryHtml = render(WeekSummaryTable, {
  weekStart: "2026-08-17",
  rows: [
    {
      memberId: 1,
      memberName: "Anna Beck",
      weekStart: "2026-08-17",
      totalSeconds: 12600,
      billableSeconds: 7200,
      calendarSeconds: 3600,
      contractedSeconds: 144000,
      utilisationPercent: 9,
    },
    {
      memberId: 2,
      memberName: "Zero Contract",
      weekStart: "2026-08-17",
      totalSeconds: 3600,
      billableSeconds: 0,
      calendarSeconds: 0,
      contractedSeconds: 0,
      utilisationPercent: null,
    },
    {
      memberId: 3,
      memberName: "Over Worked",
      weekStart: "2026-08-17",
      totalSeconds: 180000,
      billableSeconds: 180000,
      calendarSeconds: 0,
      contractedSeconds: 144000,
      utilisationPercent: 125,
    },
  ],
});

check("the summary renders 3:30 logged", summaryHtml.includes("3:30"));
check("the summary renders the 40:00 contract", summaryHtml.includes("40:00"));
check("utilisation renders 9%", summaryHtml.includes("9%"));
check("a member with no contract renders a dash, not 0%", summaryHtml.includes("—"));
check(
  "over-contract utilisation is reported honestly as 125%, not clamped",
  summaryHtml.includes("125%"),
);
check(
  "the utilisation bar is capped so 125% cannot overflow its track",
  !/width:\s*125%/.test(summaryHtml),
);
check("the member count is pluralised", summaryHtml.includes("3 MEMBERS"));
check(
  "calendar time is explained rather than silently folded into the total",
  /shown separately/i.test(summaryHtml),
);

// time.member_rate is exec-only in the database. A cost figure appearing in a
// team-visible table is precisely the leak that policy exists to prevent, so the
// component must not render one even if a caller passes it.
check(
  "no rate or cost figure appears in the team summary",
  !/hourly|€|EUR/i.test(summaryHtml.replace(/class="[^"]*"/g, "")),
);

// A failing assertion above must not leave a compiled scratch directory behind
// inside node_modules. It is gitignored, so it would never be committed, but it
// would accumulate one directory per failed run.
try {
  rmSync(dir, { recursive: true, force: true });
} catch {
  // Windows can hold a lock on a just-required .cjs; a leftover scratch dir in
  // gitignored node_modules is not worth failing the gate over.
}

console.log(
  failed
    ? "\nTIME PAGE RENDER: the page would show wrong figures"
    : "\nTIME PAGE RENDER: all checks passed",
);
process.exit(failed ? 1 : 0);
