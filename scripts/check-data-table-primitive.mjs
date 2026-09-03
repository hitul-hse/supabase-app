// Renders the shared DataTable primitive to HTML and asserts the MARKUP a
// browser and a screen reader would receive.
//
// A green `next build` proves the promoted component compiles. It does not
// prove the promotion preserved behaviour, nor that the two new opt-in features
// are actually opt-in. Both are markup-level claims, so they are checked here
// against real server-rendered output rather than by reading the file.
//
// What this is designed to catch:
//   1. A regression at the existing call site: /time/dashboard's ReportTables
//      is compiled and rendered through the moved primitive, so a broken import
//      or a changed prop contract fails here rather than in production.
//   2. Semantics quietly turning into divs, or losing `scope`/`aria-sort`.
//   3. freezeFirstColumn or maxBodyHeight leaking into call sites that did not
//      ask for them -- the whole point of both being opt-in.
//
// Run: node scripts/check-data-table-primitive.mjs
import { createTranslator } from "next-intl";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve as resolvePath } from "node:path";
import { pathToFileURL } from "node:url";
import ts from "typescript";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

const require_ = createRequire(pathToFileURL(resolvePath("scripts/_x.cjs")));

let failed = false;
const check = (label, ok, detail = "") => {
  if (!ok) failed = true;
  console.log(`${ok ? "PASS" : "FAIL"} | ${label}${!ok && detail ? `\n       ${detail}` : ""}`);
};

/**
 * Minimal TSX loader: transpile with the real TypeScript compiler and resolve
 * "@/..." the way tsconfig does. Next's own loader is not reachable from a bare
 * Node script, and the alternative -- asserting on source text -- would prove
 * nothing about what actually renders.
 */
const cache = new Map();
function load(file) {
  const abs = resolvePath(file);
  if (cache.has(abs)) return cache.get(abs);
  const out = ts.transpileModule(readFileSync(abs, "utf8"), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      jsx: ts.JsxEmit.React,
      esModuleInterop: true,
    },
    fileName: abs,
  }).outputText;

  const module_ = { exports: {} };
  cache.set(abs, module_.exports);
  const localRequire = (spec) => {
    if (spec === "react") return React;
    // DataTable reads its own chrome (search box, row counts, page sizes, the
    // CSV button) from the catalogue, so it calls useTranslations. The hook
    // needs a provider that only exists inside a Next request; here it gets a
    // translator over the real English messages, so the assertions below read
    // the same words the page renders.
    if (spec === "next-intl") {
      const messages = JSON.parse(readFileSync(resolvePath("messages/en.json"), "utf8"));
      return {
        __esModule: true,
        useTranslations: (namespace) => createTranslator({ locale: "en", messages, namespace }),
        useLocale: () => "en",
      };
    }
    if (spec.startsWith("@/")) return loadAny(resolvePath("src", spec.slice(2)));
    if (spec.startsWith(".")) return loadAny(resolvePath(dirname(abs), spec));
    return require_(spec);
  };
  // `jsx: React` emits bare `React.createElement(...)` calls, but these sources
  // never `import React` -- the Next/React 19 automatic runtime makes that
  // import unnecessary in the app itself. Injecting React as a scope parameter
  // is what keeps the classic emit runnable here; without it every component
  // throws "React is not defined" at render time, not at transpile time.
  new Function("require", "module", "exports", "React", out)(
    localRequire, module_, module_.exports, React,
  );
  cache.set(abs, module_.exports);
  return module_.exports;
}

function loadAny(base) {
  for (const ext of [".tsx", ".ts", "/index.ts", "/index.tsx"]) {
    try {
      readFileSync(base + ext);
      return load(base + ext);
    } catch {
      /* try the next extension */
    }
  }
  throw new Error(`cannot resolve ${base}`);
}

const { DataTable, cmpNum, cmpText, DEFAULT_MAX_BODY_HEIGHT } = load(
  "src/components/data-table/DataTable.tsx",
);
const barrel = loadAny(resolvePath("src/components/data-table"));

console.log("--- the promotion itself ---------------------------------------------");

check("primitive exports DataTable, cmpNum, cmpText", [DataTable, cmpNum, cmpText].every(
  (f) => typeof f === "function",
));
check(`house body cap is ~60vh (got "${DEFAULT_MAX_BODY_HEIGHT}")`, DEFAULT_MAX_BODY_HEIGHT === "60vh");
check("barrel re-exports the same DataTable", barrel.DataTable === DataTable);

// Nulls must sort last in BOTH directions -- the one rule the header comment
// calls out. Asserted on the exported comparator, not on rendered rows.
check("cmpNum keeps null last ascending and descending",
  cmpNum(null, 5) > 0 && cmpNum(5, null) < 0 && cmpNum(null, null) === 0);
check("cmpText treats null as empty", cmpText(null, "a") < 0);

console.log("\n--- the existing call site still renders -----------------------------");

// The real /time/dashboard tables, compiled and rendered through the MOVED
// primitive. This is the regression guard for the refactor.
const RT = load("src/app/(app)/time/dashboard/ReportTables.tsx");
const exported = Object.keys(RT).filter((k) => typeof RT[k] === "function");
check(`ReportTables compiles against the moved import (${exported.length} components)`,
  exported.length > 0, JSON.stringify(exported));

// Fixtures match the exported row types field for field (GroupRow and BudgetRow
// in trackingtime-report.ts, EntryRow in ReportTables). A near-miss shape does
// not fail loudly -- it throws deep inside a `.toLocaleString()` on an absent
// number, which reads like a broken component rather than a bad fixture.
const groupRows = [
  { key: "g1", id: 1, label: "Northwind GmbH", secondary: "4 projects",
    totalSeconds: 23400, billableSeconds: 23400, entryCount: 3,
    totalHours: 6.5, billableHours: 6.5, sharePercent: 68.4, billablePercent: 100,
    lastActivityAt: "2026-08-01T09:00:00Z" },
  { key: "g2", id: 2, label: "Contoso AG", secondary: null,
    totalSeconds: 10800, billableSeconds: 0, entryCount: 1,
    totalHours: 3, billableHours: 0, sharePercent: 31.6, billablePercent: 0,
    lastActivityAt: null },
];

// Props are the REAL signatures, not a guess. A generic probe shape renders the
// empty state instead of a table, which passes "it did not throw" while proving
// nothing -- and BreakdownTable throws outright without `dimension`.
const probes = {
  BreakdownTable: { rows: groupRows, dimension: "customer", period: "last 30 days" },
  BudgetTable: {
    rows: [{ projectId: 1, projectName: "Roof survey", customerName: "Northwind GmbH",
      estimatedHours: 40, actualHours: 30, remainingHours: 10, burnPercent: 75, isOver: false }],
    period: "last 30 days",
  },
  EntriesTable: {
    rows: [{ id: 1, startedAt: "2026-08-01T09:00:00Z", memberName: "Mathias",
      projectName: "Roof survey", customerName: "Northwind GmbH", taskName: null,
      serviceName: null, durationSeconds: 3600, isBillable: true, isCalendar: false, notes: null }],
    period: "last 30 days",
  },
};

// Three of the four panels ship COLLAPSED (`defaultOpen={false}`) and correctly
// emit a header with a row-count summary and no <table> at all. Demanding table
// markup from them asserts the opposite of the intended design, so the claim is
// "it rendered its panel, and its row count is still stated while shut".
const panels = [];
for (const name of exported) {
  const props = probes[name];
  if (!props) continue;
  try {
    const html = renderToStaticMarkup(React.createElement(RT[name], props));
    const open = html.includes('aria-expanded="true"');
    const hasTable = html.includes("<table");
    // A closed panel must still state how many rows it is hiding; an open one
    // must produce real table markup.
    const honest = open ? hasTable : /\d+\s+(project|entry|entries|row)/i.test(html);
    panels.push({ name, open, hasTable, honest });
  } catch (error) {
    panels.push({ name, error: String(error.message).slice(0, 140) });
  }
}

for (const p of panels) {
  if (p.error) {
    check(`${p.name} renders through the moved primitive`, false, p.error);
    continue;
  }
  check(
    `${p.name} renders ${p.open ? "an open table" : "a closed panel that still states its row count"}`,
    p.honest,
    p.open
      ? "open panel produced no <table> -- the promotion changed behaviour"
      : "closed panel hides its row count, so the data is invisible AND uncounted",
  );
}
check(`all ${Object.keys(probes).length} probed ReportTables panels rendered`,
  panels.length === Object.keys(probes).length && panels.every((p) => p.honest));

console.log("\n--- semantics and accessibility --------------------------------------");

const rows = Array.from({ length: 40 }, (_, i) => ({
  id: i,
  name: `Row ${i}`,
  value: i % 7 === 0 ? null : i * 10,
}));

const columns = [
  { key: "name", header: "Customer", cell: (r) => r.name, compare: (a, b) => cmpText(a.name, b.name),
    search: (r) => r.name, csv: (r) => r.name },
  { key: "value", header: "Value", align: "right", descFirst: true,
    cell: (r) => (r.value === null ? "—" : r.value), compare: (a, b) => cmpNum(a.value, b.value),
    csv: (r) => r.value ?? "" },
  { key: "bar", header: "Share", cell: () => "▇▇▁▁" },
];

const render = (extra = {}) =>
  renderToStaticMarkup(
    React.createElement(DataTable, {
      rows, columns, rowKey: (r) => r.id, title: "Multi-Service Matrix",
      initialSort: "value", exportName: "matrix", ...extra,
    }),
  );

const plain = render();

check("renders a real <table>, not divs", plain.includes("<table") && plain.includes("<tbody"));
check("every header carries scope=\"col\"",
  (plain.match(/<th[^>]*scope="col"/g) ?? []).length === columns.length,
  `found ${(plain.match(/<th[^>]*scope="col"/g) ?? []).length} of ${columns.length}`);
check("sortable headers expose aria-sort, active one is descending",
  plain.includes('aria-sort="descending"') && (plain.match(/aria-sort=/g) ?? []).length === columns.length);
check("the unsortable column is aria-sort=\"none\"", plain.includes('aria-sort="none"'));
check("sort controls are real <button>s, so they are keyboard reachable",
  (plain.match(/<button/g) ?? []).length >= columns.length - 1);
check("the search box has a label", plain.includes("<label") && plain.includes("sr-only"));
check("page-size controls report state via aria-pressed", plain.includes('aria-pressed="true"'));
check("a missing number renders as an em dash, never 0", plain.includes("—"));
check("default page size is 25 rows of the 40 supplied",
  (plain.match(/<tr/g) ?? []).length === 26, // 25 body rows + the header row
  `got ${(plain.match(/<tr/g) ?? []).length} <tr> including the header`);

console.log("\n--- the two new features are OFF unless asked ------------------------");

check("no frozen column by default", !plain.includes("sticky left-0"));
check("no inline max-height by default", !/style="[^"]*max-height/i.test(plain));
check("header is still sticky by default (that behaviour predates this change)",
  plain.includes("sticky top-0"));

const frozen = render({ freezeFirstColumn: true });
const firstThFrozen = /<th[^>]*class="[^"]*sticky left-0/.test(frozen);
const firstTdFrozen = /<td[^>]*class="[^"]*sticky left-0/.test(frozen);
check("freezeFirstColumn pins the header cell of column 1", firstThFrozen);
check("freezeFirstColumn pins the body cells of column 1", firstTdFrozen);
check("exactly one column per row is frozen",
  (frozen.match(/sticky left-0/g) ?? []).length === 26, // 25 body rows + 1 header
  `got ${(frozen.match(/sticky left-0/g) ?? []).length} frozen cells`);
check("the frozen cell is opaque, or the columns sliding under it show through",
  /sticky left-0[^"]*bg-\[var\(--surface\)\]/.test(frozen));
check("the frozen cell keeps the row-hover tint via group-hover",
  frozen.includes("group-hover:bg-[var(--surface-hover)]") && /<tr class="group /.test(frozen));
check("freezing does not disturb the header stickiness", frozen.includes("sticky top-0"));
check("freezing changes no semantics: same th/td counts as the plain table",
  (frozen.match(/<th/g) ?? []).length === (plain.match(/<th/g) ?? []).length &&
    (frozen.match(/<td/g) ?? []).length === (plain.match(/<td/g) ?? []).length);

const capped = render({ maxBodyHeight: true });
check(`maxBodyHeight: true applies the ${DEFAULT_MAX_BODY_HEIGHT} house cap`,
  /style="max-height:60vh"/.test(capped.replace(/\s*:\s*/g, ":")),
  capped.match(/style="[^"]*"/)?.[0] ?? "no style attribute rendered");
check("the capped body scrolls vertically inside the card", capped.includes("overflow-y-auto"));

check("a number is read as px", /max-height:\s*420px/.test(render({ maxBodyHeight: 420 })));
check("a string is passed through as a CSS length",
  /max-height:\s*32rem/.test(render({ maxBodyHeight: "32rem" })));

// The cap must bound the BODY, not the data: paging still governs row count,
// so a bounded card cannot silently hide rows the pager claims to be showing.
check("capping the body does not change how many rows are rendered",
  (capped.match(/<tr/g) ?? []).length === (plain.match(/<tr/g) ?? []).length);

// A short table asks for a cap and gets one -- that is the caller's explicit
// choice -- but must not get one by accident.
const short = renderToStaticMarkup(
  React.createElement(DataTable, {
    rows: rows.slice(0, 4), columns, rowKey: (r) => r.id, title: "Small",
  }),
);
check("a 4-row table gets no scrollbar of its own",
  !short.includes("overflow-y-auto") && !/style="[^"]*max-height/i.test(short));

console.log("\n--- collapsed panels still admit their rows exist --------------------");

const shut = render({ collapsible: true, defaultOpen: false, summary: "84 services across 12 columns" });
check("a collapsed panel states its summary", shut.includes("84 services across 12 columns"));
check("a collapsed panel renders no rows", !shut.includes("<tbody"));
check("a collapsed panel is a button with aria-expanded", shut.includes('aria-expanded="false"'));

console.log(
  failed
    ? "\nDATA TABLE PRIMITIVE: FAILURES ABOVE\n"
    : "\nDATA TABLE PRIMITIVE: all checks passed\n",
);
process.exit(failed ? 1 : 0);
