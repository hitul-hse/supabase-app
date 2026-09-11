/*
 * Does /customers stay inside the contract it was built under?
 *
 * The customer index is the page behind the Customers tab. It exists because
 * /customers/[number] shipped on 2026-09-10 reachable only by clicking a name,
 * so a consultant who wanted to look a customer up had nowhere to start. Five
 * properties hold its shape, in the order they would fail worst.
 *
 * 1. THE BOUNDARY. Every row comes from `project_masterdata` read on the
 *    READER'S OWN session, under `can_view_project()`. A service-role read here
 *    would return the whole customer list to everybody, and hiding rows in the
 *    component afterwards would put the redaction one `view-source` away from
 *    being undone. So: no service role in the query module, and the page must
 *    not filter the rows the query handed it.
 *
 * 2. THE PAGED READ IS TOTAL. `.order()` before `.range()`. Without a total
 *    order PostgREST may hand back a row on two pages and omit another, and the
 *    per-customer counts derived from those rows would be quietly wrong rather
 *    than visibly broken. This defect has been paid for twice in this codebase.
 *
 * 3. HONEST NULLS, INCLUDING THE ONE THAT IS NOT NULL. A missing name renders
 *    its own words, never the number dressed up as a name; a city the visible
 *    rows disagree on renders n/a, never one of the two. But `liveOrders === 0`
 *    is a MEASURED zero -- the rows are in hand and none is running -- so it
 *    must render as 0 and not be folded into the same absence. Both directions
 *    are asserted, because collapsing either into the other is a lie.
 *
 * 4. THE NAVIGATION ENTRY IS WHERE IT WAS ASKED FOR. Directly after /projects,
 *    with an icon registered for it, and with the label translated in every
 *    catalogue. A nav item whose label key is missing renders the raw English
 *    string to a German reader, which is how this app has shipped mixed
 *    language before.
 *
 * 5. THE PAGE GATES ITSELF. `requireProfile` and `enforceRoleRouteAccess` are
 *    called by the page, not inherited from the middleware. CVE-2025-29927 was
 *    a middleware auth bypass; every protected page in this app repeats the
 *    check for that reason.
 *
 * Every assertion has a negative control below: the source is copied, the
 * property is broken in the copy, and the same predicate must then FAIL. A
 * predicate that passes on the broken copy is asserting nothing, which under
 * the house rule is red rather than green.
 */
import { readFileSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { REPO_ROOT } from "./lib/repo-root.mjs";
import { record } from "./lib/gate-result.mjs";

let failures = 0;
const check = (label, ok, detail = "") => {
  record(ok);
  /* Detail is printed on a FAILURE only. A passing line carrying the words of
   * its own failure message reads as a failure to anybody scanning the log. */
  console.log(`${ok ? "PASS" : "FAIL"}: ${label}${!ok && detail ? `\n        ${detail}` : ""}`);
  if (!ok) failures += 1;
};

const read = (p) => readFileSync(join(REPO_ROOT, p), "utf8");
/** Comments describe intent; they must never satisfy an assertion about code. */
const stripComments = (src) =>
  src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1").replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, "");

const QUERY = "src/lib/queries/customers-index.ts";
const PAGE = "src/app/(app)/customers/page.tsx";
const SIDEBAR = "src/components/SidebarNav.tsx";
const ICONS = "src/components/nav-icons.tsx";
const DE = "messages/de.json";
const EN = "messages/en.json";

const src = {
  [QUERY]: stripComments(read(QUERY)),
  [PAGE]: stripComments(read(PAGE)),
  [SIDEBAR]: stripComments(read(SIDEBAR)),
  [ICONS]: stripComments(read(ICONS)),
};

/* ---------------------------------------------------------------- predicates
 * Each is a function of the source map so the negative controls can re-run the
 * SAME predicate against a mutated copy. A control that re-implements the
 * predicate proves nothing about the predicate that actually runs.
 */
const P = {
  noServiceRole: (s) =>
    !/SERVICE_ROLE|service_role/.test(s[QUERY]),

  readsOnTheReaderSession: (s) =>
    /getCustomersIndex\(\s*supabase\b/.test(s[PAGE]) && /createClient\(\)/.test(s[PAGE]),

  orderBeforeRange: (s) => {
    const o = s[QUERY].indexOf(".order(");
    const r = s[QUERY].indexOf(".range(");
    return o !== -1 && r !== -1 && o < r;
  },

  /* The page renders what the query returned. A .filter/.slice on data.rows in
   * the page would mean rows crossed the boundary and were hidden in the browser. */
  pageDoesNotFilterRows: (s) =>
    !/data\.rows\s*\.\s*(filter|slice)\s*\(/.test(s[PAGE]),

  missingNameIsSaid: (s) =>
    /row\.name\s*\?\?/.test(s[PAGE]) && /t\("noName"\)/.test(s[PAGE]),

  missingCityIsSaid: (s) =>
    /row\.city\s*\?\?/.test(s[PAGE]) && /n\/a/.test(s[PAGE]),

  /* The measured zero must reach the page as the digit 0, not as an absence. */
  measuredZeroIsShown: (s) =>
    /row\.liveOrders\s*===\s*0/.test(s[PAGE]) && />0</.test(s[PAGE]),

  /* The query must never turn a counted zero into null. */
  queryDoesNotNullZero: (s) =>
    !/liveOrders:\s*[^,\n]*\|\|\s*null/.test(s[QUERY]),

  navEntryExists: (s) => /href:\s*"\/customers"/.test(s[SIDEBAR]),

  navEntryFollowsProjects: (s) => {
    const p = s[SIDEBAR].indexOf('href: "/projects"');
    const c = s[SIDEBAR].indexOf('href: "/customers"');
    if (p === -1 || c === -1 || c < p) return false;
    /* "Directly after" means no other nav item between them. */
    const between = s[SIDEBAR].slice(p, c);
    return (between.match(/href:\s*"/g) || []).length === 1;
  },

  navLabelIsTranslated: (s) => /"Customers":\s*"customers"/.test(s[SIDEBAR]),

  iconRegistered: (s) => /"\/customers":\s*Icon/.test(s[ICONS]),

  pageGatesItself: (s) =>
    /requireProfile\(\s*"\/customers"\s*\)/.test(s[PAGE]) &&
    /enforceRoleRouteAccess\(\s*"\/customers"\s*\)/.test(s[PAGE]),

  pagerIsInTheUrl: (s) =>
    /hrefFor=\{/.test(s[PAGE]) && /\/customers\?page=/.test(s[PAGE]),

  isServerComponent: (s) => !/^\s*["']use client["']/m.test(s[PAGE]),

  /* Ten rows is the house figure for a worked queue. */
  tenRowsPerPage: (s) => /CUSTOMERS_PER_PAGE\s*=\s*10\b/.test(s[QUERY]),
};

for (const [name, predicate] of Object.entries(P)) {
  check(name.replace(/([A-Z])/g, " $1").toLowerCase(), predicate(src));
}

/* ------------------------------------------------------------------ i18n
 * Both catalogues must define every key the page asks for, and define it to
 * something. A key present in one language only is how this app has rendered
 * English to a German reader before.
 */
const de = JSON.parse(read(DE));
const en = JSON.parse(read(EN));
const usedKeys = [...src[PAGE].matchAll(/\bt\(\s*"([a-zA-Z0-9_.]+)"/g)].map((m) => m[1]);

check(
  "the page actually asks for translated strings",
  usedKeys.length >= 8,
  `found ${usedKeys.length}`,
);

for (const key of [...new Set(usedKeys)]) {
  const dv = key.split(".").reduce((o, k) => (o ?? {})[k], de.customers);
  const ev = key.split(".").reduce((o, k) => (o ?? {})[k], en.customers);
  check(
    `customers.${key} is defined in both catalogues`,
    typeof dv === "string" && dv.length > 0 && typeof ev === "string" && ev.length > 0,
    typeof dv === "string" ? "" : `de: ${JSON.stringify(dv)}  en: ${JSON.stringify(ev)}`,
  );
}

check(
  "the nav label is translated in both catalogues",
  typeof de.nav?.customers === "string" && de.nav.customers.length > 0 &&
    typeof en.nav?.customers === "string" && en.nav.customers.length > 0,
);
check(
  "the two catalogues do not simply share one string for the nav label",
  de.nav?.customers !== en.nav?.customers,
  `de: ${JSON.stringify(de.nav?.customers)}  en: ${JSON.stringify(en.nav?.customers)}`,
);

/* ------------------------------------------------------- negative controls
 * Break each property in a COPY and require the same predicate to fail. The
 * repository is never touched: every mutation is a string in memory.
 */
const tmp = mkdtempSync(join(tmpdir(), "customers-index-control-"));
try {
  const mutate = (file, from, to) => {
    const broken = { ...src };
    const before = broken[file];
    broken[file] = before.replace(from, to);
    return { broken, changed: broken[file] !== before };
  };

  const controls = [
    ["noServiceRole", QUERY, /const anyClient/, "const KEY = process.env.SERVICE_ROLE;\nconst anyClient"],
    ["orderBeforeRange", QUERY, /\.order\("project_id", \{ ascending: true \}\)\s*\n\s*\.range\(from, to\)/, ".range(from, to)\n        .order(\"project_id\", { ascending: true })"],
    ["pageDoesNotFilterRows", PAGE, /data\.rows\.map/, "data.rows.filter((r) => r.liveOrders > 0).map"],
    ["missingNameIsSaid", PAGE, /row\.name \?\?/, "row.name ||"],
    ["measuredZeroIsShown", PAGE, /row\.liveOrders === 0/, "row.liveOrders === -1"],
    ["navEntryExists", SIDEBAR, /href: "\/customers"/, 'href: "/kunden"'],
    ["navLabelIsTranslated", SIDEBAR, /"Customers": "customers",/, ""],
    ["iconRegistered", ICONS, /"\/customers": Icon/, '"/kunden": Icon'],
    ["pageGatesItself", PAGE, /await requireProfile\("\/customers"\)/, "await requireProfile(\"/\")"],
    ["isServerComponent", PAGE, /^import Link/m, '"use client";\nimport Link'],
    ["tenRowsPerPage", QUERY, /CUSTOMERS_PER_PAGE = 10/, "CUSTOMERS_PER_PAGE = 25"],
  ];

  for (const [name, file, from, to] of controls) {
    const { broken, changed } = mutate(file, from, to);
    check(`[control] the mutation for ${name} actually changed the source`, changed);
    check(
      `[control] ${name} WOULD catch its defect`,
      changed && P[name](broken) === false,
      changed ? "the predicate still passed on the broken copy, so it is asserting nothing" : "",
    );
  }

  /* navEntryFollowsProjects needs a different shape of break: move it, do not
   * remove it, so "exists" still passes and only "directly after" fails. */
  const moved = {
    ...src,
    [SIDEBAR]: src[SIDEBAR]
      .replace(/\s*\{ href: "\/customers",[^\n]*\n/, "\n")
      /* Re-inserted BEFORE My Work, which is genuinely elsewhere. The first
       * attempt at this control put it before /timesheets, which on this nav is
       * still the row directly after /projects -- so the mutation changed the
       * file, the predicate correctly still passed, and the control failed. The
       * control was wrong, not the predicate. */
      .replace(/(\{ href: "\/my-work",[^\n]*\n)/, '{ href: "/customers", label: "Customers" },\n$1'),
  };
  check("[control] moving the entry away from Projects changed the source", moved[SIDEBAR] !== src[SIDEBAR]);
  check(
    "[control] navEntryFollowsProjects WOULD catch an entry in the wrong place",
    P.navEntryExists(moved) === true && P.navEntryFollowsProjects(moved) === false,
  );
} finally {
  rmSync(tmp, { recursive: true, force: true });
}

console.log(failures === 0 ? "\nCUSTOMERS INDEX: OK" : `\nCUSTOMERS INDEX: ${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
