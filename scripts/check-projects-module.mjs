/**
 * Does the Projects module tell the truth about budgets?
 *
 * WHAT THIS GUARDS, AND WHY IT IS NOT COVERED ELSEWHERE
 * -----------------------------------------------------
 * /projects previously rendered ONE hardcoded row from a five-row demo table,
 * with a burn-down whose SVG coordinates were literals. It now reads all 334
 * live projects. The dangerous failure of the new version is not a crash — it
 * is a CONFIDENT WRONG NUMBER, and there are three specific ones:
 *
 *  1. **A project with no budget rendered as 0%.** 83 of 334 live projects carry
 *     `estimated_hours = 0`, which means "nobody set a budget", not "the budget
 *     is zero". Painting those green at 0% is a false claim of health about a
 *     quarter of the portfolio, and it is invisible: the page looks fine.
 *
 *  2. **Null sorting to the top of a burn-ordered list.** A naive numeric
 *     comparator treats null as 0 and floats 83 unbudgeted projects ABOVE a
 *     project at 140% — inverting the exact signal the sort exists to surface.
 *
 *  3. **A month bucket computed in local time.** Entries are timestamptz. Using
 *     `new Date(y, m, d)` on a Berlin server files an entry logged at 23:30 on
 *     the 31st into the following month, and only for some deployments.
 *
 * Each is asserted below against the SHIPPED implementation — the real
 * `projects-live.ts` and the real `ProjectPanels.tsx`, compiled with Next's own
 * SWC and rendered to HTML. A reimplementation here could drift from what
 * ships, which would make this gate worse than useless.
 *
 * The live half is skipped without .env.local so CI stays green on a fork.
 */
import { readFileSync, readdirSync, existsSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { createRequire } from "node:module";
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { loadBindings, transform } from "next/dist/build/swc/index.js";

await loadBindings();

let failed = false;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}: ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failed = true;
};

// Inside node_modules so "react/jsx-runtime" resolves — a module in %TEMP%
// cannot, because Node walks up from the file's own location.
const dir = resolve(mkdtempSync(join("node_modules", ".projects-gate-")));
const require = createRequire(import.meta.url);
const posix = (p) => p.replace(/\\/g, "/");

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

try {
  const transformFile = await compile("src/lib/time-transform.ts", "time-transform.cjs");

  // The report layer is imported by projects-live for fetchAllEntries. Only the
  // TYPES are used by the pure functions under test, and a type import vanishes
  // at compile time — but the runtime `require` does not, so it is redirected to
  // a stub rather than pulling in the Supabase client.
  const stub = join(dir, "report-stub.cjs");
  writeFileSync(stub, "module.exports = { fetchAllEntries: async () => ({ entries: [], truncated: false }) };");

  // next/link needs a router context that does not exist outside a request, so
  // it is replaced with a plain <a>. The href is what this gate asserts on, and
  // the real Link renders exactly that attribute.
  const linkStub = join(dir, "link-stub.cjs");
  writeFileSync(
    linkStub,
    `const { createElement } = require("react");
module.exports = { __esModule: true, default: ({ href, children, ...rest }) => createElement("a", { href, ...rest }, children) };`,
  );

  const live = require(
    await compile("src/lib/queries/projects-live.ts", "projects-live.cjs", {
      "@/lib/time-transform": posix(transformFile),
      "./trackingtime-report": posix(stub),
    }),
  );

  const panelsFile = await compile("src/app/(app)/projects/ProjectPanels.tsx", "ProjectPanels.cjs", {
    "@/lib/queries/projects-live": posix(stub),
    "next/link": posix(linkStub),
  });
  const panels = require(panelsFile);

  // The ledger is a client component. `renderToStaticMarkup` runs it as a plain
  // function, so useState returns its INITIAL value — which is exactly what
  // this gate wants to assert: what the reader sees before touching anything.
  const ledger = require(
    await compile("src/app/(app)/projects/ProjectsLedger.tsx", "ProjectsLedger.cjs", {
      "@/lib/queries/projects-live": posix(stub),
      "next/link": posix(linkStub),
      "./ProjectPanels": posix(panelsFile),
      "@/components/EmptyState": posix(
        await compile("src/components/EmptyState.tsx", "EmptyState.cjs", { "next/link": posix(linkStub) }),
      ),
      "@/components/ui/Button": posix(
        await compile("src/components/ui/Button.tsx", "Button.cjs", { "next/link": posix(linkStub) }),
      ),
      "@/components/ui/Field": posix(
        await compile("src/components/ui/Field.tsx", "Field.cjs", { "next/link": posix(linkStub) }),
      ),
    }),
  );

  const render = (C, props) => renderToStaticMarkup(h(C, props));

  /* ─────────────────────────── the pure aggregation ─────────────────────── */

  const E = (projectId, hours, memberId, startedAt, isBillable = true) => ({
    projectId,
    durationSeconds: hours * 3600,
    memberId,
    memberName: `M${memberId}`,
    startedAt,
    isBillable,
    taskName: null,
  });

  const projects = [
    { id: 1, name: "Overrun", estimatedHours: 10, customerName: "ACME", isArchived: false },
    { id: 2, name: "ZeroBudget", estimatedHours: 0, customerName: null, isArchived: false },
    { id: 3, name: "NullBudget", estimatedHours: null, customerName: null, isArchived: false },
    { id: 4, name: "Healthy", estimatedHours: 100, customerName: "ACME", isArchived: false },
    { id: 5, name: "Untouched", estimatedHours: 50, customerName: null, isArchived: false },
  ];

  const entries = [
    E(1, 14, 10, "2026-03-05T09:00:00Z"),
    E(2, 5, 10, "2026-03-06T09:00:00Z"),
    E(3, 3, 11, "2026-01-06T09:00:00Z"),
    E(4, 25, 11, "2026-02-01T09:00:00Z", false),
    E(4, 25, 12, "2026-06-01T09:00:00Z"),
    // An entry with no project: must not be attributed to anyone.
    E(null, 9, 12, "2026-06-01T09:00:00Z"),
  ];

  const rows = live.summariseProjects(projects, entries);
  const by = (n) => rows.find((r) => r.name === n);

  console.log("The aggregation:\n");

  check("every project is kept, including untouched ones", rows.length === 5, `${rows.length} rows`);
  check("an untouched project reads 0h, not missing", by("Untouched").actualHours === 0);
  check("an over-budget project burns above 100%", by("Overrun").burnPercent === 140, `${by("Overrun").burnPercent}%`);
  check(
    "remaining hours go NEGATIVE on an overrun (the number a lead needs)",
    by("Overrun").remainingHours === -4,
    `${by("Overrun").remainingHours}h`,
  );

  check(
    "REGRESSION 1: estimated_hours = 0 gives burn NULL, never 0%",
    by("ZeroBudget").burnPercent === null,
    `got ${JSON.stringify(by("ZeroBudget").burnPercent)}`,
  );
  check(
    "estimated_hours = null likewise gives burn NULL",
    by("NullBudget").burnPercent === null,
    `got ${JSON.stringify(by("NullBudget").burnPercent)}`,
  );
  check("a project with no budget is never flagged over budget", by("ZeroBudget").isOver === false);

  check("distinct contributors are counted, not entries", by("Healthy").memberCount === 2);
  check("billable hours exclude non-billable time", by("Healthy").billableHours === 25);
  check("total hours include both", by("Healthy").actualHours === 50);
  check("last activity is the most recent entry", by("Healthy").lastActivity === "2026-06-01");
  check(
    "an entry with no project is attributed to nobody",
    rows.reduce((s, r) => s + r.entryCount, 0) === 5,
  );

  // Untouched has a real 50h budget and 0 logged, so its burn is a genuine 0% —
  // it belongs ABOVE the two that have no budget at all. That distinction is
  // the whole point: "0% consumed" and "no budget to consume" are different
  // facts, and only the latter sorts to the bottom.
  const burnOrder = live.sortProjects(rows, "burn").map((r) => r.name);
  const unbudgeted = new Set(["ZeroBudget", "NullBudget"]);
  check(
    "REGRESSION 2: burn sort puts the overrun FIRST and no-budget LAST",
    burnOrder[0] === "Overrun" &&
      unbudgeted.has(burnOrder[3]) &&
      unbudgeted.has(burnOrder[4]) &&
      !unbudgeted.has(burnOrder[2]),
    burnOrder.join(" > "),
  );
  check(
    "a real 0% burn outranks a project with no budget at all",
    burnOrder.indexOf("Untouched") < burnOrder.indexOf("ZeroBudget"),
    burnOrder.join(" > "),
  );

  const hoursOrder = live.sortProjects(rows, "hours").map((r) => r.name);
  check("hours sort leads with the most-logged project", hoursOrder[0] === "Healthy", hoursOrder.join(" > "));

  /* ──────────────────────────────── burndown ────────────────────────────── */

  console.log("\nThe hours curve:\n");

  const burn = live.burndown([
    E(4, 10, 1, "2026-01-15T09:00:00Z"),
    E(4, 10, 1, "2026-04-15T09:00:00Z"),
  ]);
  check("empty months between activity are filled, not compressed", burn.length === 4, `${burn.length} buckets`);
  check(
    "the cumulative total never decreases",
    burn.every((p, i) => i === 0 || p.cumulativeHours >= burn[i - 1].cumulativeHours),
    burn.map((p) => p.cumulativeHours).join(" → "),
  );
  check("a month with no work holds its running total", burn[1].hours === 0 && burn[1].cumulativeHours === 10);

  const edge = live.burndown([E(1, 1, 1, "2026-01-31T23:30:00Z")]);
  check(
    "REGRESSION 3: 23:30 on 31 Jan UTC stays in January",
    edge[0].date === "2026-01-01",
    edge[0].date,
  );

  check("a project with no entries yields no curve at all", live.burndown([]).length === 0);

  /* ─────────────────────────────── the markup ───────────────────────────── */

  console.log("\nWhat a person actually sees:\n");

  const tableHtml = render(ledger.ProjectsLedger, { rows: live.sortProjects(rows, "burn") });

  // Exactly two rows are unbudgeted, and each must say "n/a". A genuine 0% (the
  // Untouched project, which HAS a 50h budget) is correct and must survive —
  // asserting "no 0% anywhere" would have demanded the wrong behaviour.
  //
  // Doubled because the ledger renders BOTH layouts into the markup — a mobile
  // card list and a desktop grid, one hidden by CSS at any viewport. Counting
  // raw occurrences without accounting for that reads as a bug in the page when
  // it is really a bug in the assertion.
  const naCount = (tableHtml.match(/n\/a/g) ?? []).length;
  check(
    "a project without a budget renders 'n/a', not '0%'",
    naCount === 4,
    `${naCount} occurrences across the mobile and desktop layouts (2 rows × 2)`,
  );
  check(
    "a genuine 0% burn is still shown as 0%, not hidden as n/a",
    tableHtml.includes("0%"),
  );
  check("the overrun's percentage is on screen", tableHtml.includes("140%"));
  check(
    "every row links to its own record",
    projects.every((p) => tableHtml.includes(`/projects/${p.id}`)),
  );
  check(
    "the unbudgeted rows are drawn in the muted colour, not the healthy one",
    tableHtml.includes("var(--text-faint)"),
  );
  check(
    "an over-budget row is drawn in the critical colour",
    tableHtml.includes("var(--critical)"),
  );

  /* ────────────────────── density: the reason for the rebuild ───────────── */

  console.log("\nReaching a project without scrolling for it:\n");

  // 334 rows at ~41px was ~13,700px — roughly fifteen full screens. The three
  // fixes are asserted separately because only one of them (paging) does the
  // heavy lifting, and a future change could silently drop it while leaving
  // the other two in place.

  check(
    "REGRESSION 4: the list is searchable",
    /type="search"/.test(tableHtml),
    "no search input rendered",
  );

  check(
    "the search box is reachable by screen reader, not a bare box",
    /aria-label="Search projects/.test(tableHtml),
  );

  // Every facet chip must carry a COUNT. A chip that does not say how many rows
  // it would bring in cannot be judged before clicking, which is the whole
  // reason to have one rather than a plain filter dropdown.
  for (const [facet, label] of [
    ["over", "OVER BUDGET"],
    ["risk", "AT RISK"],
    ["nobudget", "NO BUDGET"],
    ["idle", "NO ACTIVITY"],
  ]) {
    check(`the '${label}' filter is offered`, tableHtml.includes(label), facet);
  }

  check(
    "filter chips announce their pressed state",
    (tableHtml.match(/aria-pressed="false"/g) ?? []).length >= 4,
    "chips must be real buttons with aria-pressed, not styled divs",
  );

  // The pure predicates, exercised directly. These are what the chips call, and
  // the boundaries are the part that silently misclassifies a project.
  const F = (burnPercent, actualHours = 1) => ({ burnPercent, actualHours });
  check(
    "'over budget' means strictly over 100%, not 100% itself",
    ledger.matchesFacet(F(100.1), "over") && !ledger.matchesFacet(F(100), "over"),
  );
  check(
    "'at risk' spans 85% to 100% inclusive",
    ledger.matchesFacet(F(85), "risk") &&
      ledger.matchesFacet(F(100), "risk") &&
      !ledger.matchesFacet(F(84.9), "risk"),
  );
  check(
    "'no budget' catches null burn, never a real 0%",
    ledger.matchesFacet(F(null), "nobudget") && !ledger.matchesFacet(F(0), "nobudget"),
  );
  check(
    "'over budget' and 'at risk' can never both match one project",
    [0, 84.9, 85, 100, 100.1, 140].every(
      (p) => !(ledger.matchesFacet(F(p), "over") && ledger.matchesFacet(F(p), "risk")),
    ),
  );

  /* ─────────────────────── REGRESSION 5: paging is real ─────────────────── */

  // The measurement that forced this work. With 120 projects the first render
  // must NOT contain all of them, or the page is back to fifteen screens.
  const many = Array.from({ length: 120 }, (_, i) => ({
    id: 1000 + i,
    name: `Bulk project ${String(i).padStart(3, "0")}`,
    customerName: "ACME",
    code: null,
    estimatedHours: 10,
    actualHours: i,
    billableHours: 0,
    entryCount: 1,
    memberCount: 1,
    lastActivity: "2026-01-01",
    burnPercent: i,
    remainingHours: 0,
    isOver: false,
    isBillable: true,
    isArchived: false,
    serviceName: null,
    customerId: 1,
  }));

  const manyHtml = render(ledger.ProjectsLedger, { rows: many });
  // UNIQUE ids, not raw href occurrences: each row appears twice in the markup
  // (mobile card + desktop grid), so a naive count doubles every number here.
  const linkCount = new Set(
    [...manyHtml.matchAll(/href="\/projects\/(1\d\d\d)"/g)].map((m) => m[1]),
  ).size;

  check(
    "REGRESSION 5: 120 projects do not all render at once",
    linkCount < 120,
    `${linkCount} distinct projects in the first paint`,
  );
  check(
    "the first page is a useful size, not a token handful",
    linkCount >= 40 && linkCount <= 60,
    `${linkCount} rows`,
  );
  check(
    "the reader is told how many rows are hidden",
    /SHOWING \d+ OF 120/.test(manyHtml),
    "no 'showing N of M' summary",
  );
  check(
    "there is a way to see the rest",
    manyHtml.includes("Show 50 more") && manyHtml.includes("Show all"),
  );
  check(
    "a short list gets no pager at all",
    !tableHtml.includes("SHOWING"),
    "5 rows must not render a pager",
  );

  /* ─────────────────── REGRESSION 6: the row got shorter ────────────────── */

  // py-1 rather than py-2.5. Asserted on the shipped source rather than the
  // rendered HTML because Tailwind classes are the only place the value lives.
  const ledgerSrc = readFileSync("src/app/(app)/projects/ProjectsLedger.tsx", "utf8");
  const rowClass = /grid min-w-\[900px\] grid-cols-12 items-center[^"]*/.exec(ledgerSrc)?.[0] ?? "";
  check(
    "REGRESSION 6: the desktop row keeps its compact vertical padding",
    /\bpy-1\b/.test(rowClass) && !/\bpy-2\.5\b/.test(rowClass),
    rowClass.slice(0, 90),
  );
  check(
    "the project name keeps its readable size despite the tighter row",
    /text-\[12\.5px\]/.test(rowClass),
    "the one column people actually read must not shrink",
  );
  check(
    "the header row sticks so columns stay identifiable down a long list",
    /sticky top-0/.test(ledgerSrc),
  );

  // REGRESSION 9. `position: sticky` resolves against the nearest SCROLL
  // CONTAINER, and any `overflow` other than `visible` creates one. The desktop
  // wrapper used to carry `overflow-x-auto`, which silently defeated the sticky
  // header while leaving the class in place — measured in a browser: the header
  // sat at top 324px and moved to -276px after scrolling 600px, i.e. it scrolled
  // away exactly like a static element. Source review cannot see this.
  const desktopWrapper = /className="hidden[^"]*sm:block"/.exec(ledgerSrc)?.[0] ?? "";
  check(
    "REGRESSION 9: the desktop wrapper creates no scroll container",
    desktopWrapper !== "" && !/overflow-/.test(desktopWrapper),
    `${desktopWrapper} — an overflow value here silently kills the sticky header`,
  );

  /* ───────────────── REGRESSION 7: result count is announced ─────────────── */

  check(
    "REGRESSION 7: the filtered result count is announced politely",
    /aria-live="polite"/.test(tableHtml) && /role="status"/.test(tableHtml),
    "a sighted user sees the table shrink; a screen-reader user must be told",
  );

  /* ────────── REGRESSION 8: the CLIENT sort pins nulls in both directions ── */

  // Sorting moved from the server (`live.sortProjects`, asserted above) into the
  // ledger, so the null-pinning rule now has TWO implementations. This exercises
  // the client one directly: without it, a mutation that coerces null to 0 in
  // `sortRows` passes every other check in this file.
  const sortable = [
    { name: "Overrun", burnPercent: 140, actualHours: 70, estimatedHours: 50, lastActivity: "2026-08-01", memberCount: 2 },
    { name: "Healthy", burnPercent: 20, actualHours: 10, estimatedHours: 50, lastActivity: "2026-07-01", memberCount: 1 },
    { name: "NoBudgetA", burnPercent: null, actualHours: 12, estimatedHours: 0, lastActivity: "2026-06-01", memberCount: 1 },
    { name: "NoBudgetB", burnPercent: null, actualHours: 3, estimatedHours: null, lastActivity: null, memberCount: 0 },
  ];

  const descNames = ledger.sortRows(sortable, "burn", "desc").map((r) => r.name);
  const ascNames = ledger.sortRows(sortable, "burn", "asc").map((r) => r.name);

  check(
    "the client burn sort leads with the overrun",
    descNames[0] === "Overrun",
    descNames.join(" > "),
  );
  check(
    "REGRESSION 8: reversing the client sort does NOT promote unbudgeted rows",
    ascNames[0] === "Healthy" &&
      ascNames.slice(-2).every((n) => n.startsWith("NoBudget")),
    ascNames.join(" > "),
  );
  check(
    "unbudgeted rows stay last in the descending direction too",
    descNames.slice(-2).every((n) => n.startsWith("NoBudget")),
    descNames.join(" > "),
  );
  check(
    "a measured zero is NOT treated as missing data",
    ledger.sortRows(
      [
        { name: "Zero", burnPercent: 0, actualHours: 0, estimatedHours: 10, lastActivity: null, memberCount: 0 },
        { name: "Null", burnPercent: null, actualHours: 0, estimatedHours: 0, lastActivity: null, memberCount: 0 },
      ],
      "burn",
      "asc",
    )[0].name === "Zero",
    "0% burned is a fact; no budget is the absence of one",
  );
  check(
    "the client sort does not mutate the array it was given",
    (() => {
      const before = sortable.map((r) => r.name).join(",");
      ledger.sortRows(sortable, "hours", "desc");
      return sortable.map((r) => r.name).join(",") === before;
    })(),
  );

  const stripHtml = render(panels.ProjectTotalsStrip, {
    projectCount: 5,
    totalHours: 0,
    billableHours: 0,
    overBudget: 0,
    noBudget: 2,
  });
  check(
    "a zero-hour selection shows '—' for billable share, never 'NaN%'",
    stripHtml.includes("—") && !stripHtml.includes("NaN"),
  );

  // The budget line must stay on-canvas even at 300% burn, or the chart quietly
  // stops showing the thing it exists to compare against.
  const chartHtml = render(panels.BurnChart, {
    points: live.burndown([E(1, 30, 1, "2026-01-15T09:00:00Z")]),
    estimatedHours: 10,
  });
  check("the burn chart draws the logged curve", chartHtml.includes("polyline"));
  check("the budget reference line is present", chartHtml.includes("BUDGET"));
  check(
    "the budget line is inside the viewBox at 300% burn",
    (() => {
      const m = /<line[^>]*y1="([\d.]+)"/.exec(chartHtml);
      if (!m) return false;
      const y = Number(m[1]);
      return y >= 0 && y <= 170;
    })(),
    "y within 0..170",
  );

  const emptyChart = render(panels.BurnChart, { points: [], estimatedHours: 10 });
  check(
    "a project with no time says so rather than drawing an empty axis",
    emptyChart.includes("No time has been logged"),
  );

  const noBudgetChart = render(panels.BurnChart, {
    points: live.burndown([E(1, 5, 1, "2026-01-15T09:00:00Z")]),
    estimatedHours: 0,
  });
  check(
    "no budget means no budget line is drawn at all",
    !noBudgetChart.includes("<line"),
  );

  /* ───────────────────────────────── the wiring ─────────────────────────── */

  console.log("\nThe wiring:\n");

  // Strip block comments before asserting on source: the file's own header
  // DESCRIBES what was removed ("previously rendered getProjectDetail(…,
  // 'prj-1')"), and a naive substring search would match the explanation and
  // report the old code as still present.
  const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  const listSrc = stripComments(readFileSync("src/app/(app)/projects/page.tsx", "utf8"));
  const detailSrc = stripComments(readFileSync("src/app/(app)/projects/[id]/page.tsx", "utf8"));

  check(
    "the list no longer reads the five-row demo table",
    !listSrc.includes("getProjectDetail") && !listSrc.includes('"prj-1"'),
  );
  check("the list reads the live project query layer", listSrc.includes("getProjectList"));
  check(
    "the list is gated on projects:read_all",
    listSrc.includes("PROJECTS_READ_ALL"),
  );
  check(
    "a role without that permission is EXPLAINED, not bounced to /",
    listSrc.includes("EmptyState") && !/redirect\("\/"\)/.test(listSrc),
  );
  check(
    "the detail route validates its id before querying",
    /\^\\d\+\$/.test(detailSrc) && detailSrc.includes("notFound"),
  );
  check(
    "the freshness banner is on the list, so stale data says so",
    listSrc.includes("FreshnessBanner"),
  );

  // The dashboard's budget rows link through to these project records — but
  // that link lives in the DASHBOARD's files, not this module's, and those are
  // being actively refactored (the tables moved from ReportPanels.tsx to
  // ReportTables.tsx when they gained sorting state).
  //
  // So it is REPORTED here rather than asserted. This gate has to pass on the
  // Projects module ALONE: failing it because a neighbouring file is mid-
  // refactor, or not yet committed, would make it noise rather than signal, and
  // a gate people learn to ignore protects nothing. The dashboard's own gate
  // owns that assertion.
  const dashboardDir = "src/app/(app)/time/dashboard";
  const dashboardSrc = readdirSync(dashboardDir)
    .filter((f) => f.endsWith(".tsx"))
    .map((f) => readFileSync(join(dashboardDir, f), "utf8"))
    .join("\n");
  console.log(
    dashboardSrc.includes("href={`/projects/${r.projectId}`}")
      ? "  note: dashboard budget rows DO link through to these project records."
      : "  note: dashboard budget rows do not link to project records yet.",
  );

  /* ──────────────────────────────── live probe ──────────────────────────── */

  if (!existsSync(".env.local")) {
    console.log("\nSKIPPED the live probe — no .env.local (expected in CI).");
  } else {
    const env = { ...process.env };
    for (const line of readFileSync(".env.local", "utf8").split("\n")) {
      const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
      if (m && !env[m[1]]) env[m[1]] = m[2].trim();
    }

    if (!env.NEXT_PUBLIC_SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
      console.log("\nSKIPPED the live probe — credentials absent.");
    } else {
      const { createClient } = await import("@supabase/supabase-js");
      const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
        auth: { persistSession: false },
      });

      console.log(`\nThe live project — ${env.NEXT_PUBLIC_SUPABASE_URL}:\n`);

      const { count } = await db
        .schema("time")
        .from("project")
        .select("*", { count: "exact", head: true });
      check("there are real projects to show", (count ?? 0) > 0, `${count} projects`);

      const { count: zero } = await db
        .schema("time")
        .from("project")
        .select("*", { count: "exact", head: true })
        .or("estimated_hours.is.null,estimated_hours.eq.0");
      console.log(
        `  ${zero} of ${count} live projects have no budget — each MUST read "n/a", never 0%.`,
      );
      check(
        "the unbudgeted share is real, so regression 1 matters here",
        (zero ?? 0) > 0,
        `${zero} projects`,
      );
    }
  }
} finally {
  rmSync(dir, { recursive: true, force: true });
}

console.log(
  failed
    ? "\nPROJECTS MODULE: a budget figure is wrong — see the failures above"
    : "\nPROJECTS MODULE: budgets, sorting and the hours curve are honest",
);
process.exit(failed ? 1 : 0);
