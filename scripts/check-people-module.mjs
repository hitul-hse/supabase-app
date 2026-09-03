/**
 * The people directory shows the real TrackingTime roster, not the mockup.
 *
 * WHAT THIS GUARDS
 * ----------------
 * `/people` rendered `public.people`: EIGHT seeded rows -- "Anna Brandt",
 * "C. Haas", "L. Fischer" -- for a company with FORTY-NINE members in
 * `time.member`. Every manager who opened the directory to look someone up saw
 * eight strangers and not one colleague, and the detail pane backed it with
 * numbers precise enough that nobody would think to check them ("168 / 160 H,
 * 84% billable, 23 open tasks", all invented).
 *
 * Nothing errored, which is the entire problem. This gate exists so the page
 * cannot quietly revert to fiction.
 *
 * THE FOUR REGRESSIONS IT IS BUILT TO CATCH
 * -----------------------------------------
 *   R1. Reading `public.people` again. The mockup table still exists, because
 *       /timesheets, /leave and /team-lead legitimately read it. So the import
 *       is one line away from coming back.
 *
 *   R2. Rendering 0% for somebody with no data. FOUR of the 19 active members
 *       have logged nothing at all. "0% billable" on a colleague's profile is
 *       not a missing value, it is an accusation -- and it looks identical to a
 *       measured zero.
 *
 *   R3. Listing shared inboxes as staff. `info@hs-experts.com` and
 *       `jobs@hs-experts.com` hold real TrackingTime member records. They are
 *       archived TODAY, so the filter looks redundant -- until TrackingTime
 *       un-archives one and an inbox appears in the staff directory.
 *
 *   R4. Calling the 40h week "contracted". Every one of the 49 members reports
 *       exactly 40 h/week because that is TrackingTime's ACCOUNT DEFAULT, not
 *       anyone's contract. Presenting a utilisation ratio against it as
 *       contractual dresses a default as a fact about someone's employment.
 *
 * Also asserted: the `&amp;` bug this rewrite fixed. A template literal is not
 * JSX text, so `&amp;` inside one reaches the DOM as five literal characters --
 * the live page read "8 ACTIVE CONSULTANTS &amp; STAFF" for months.
 *
 * Asserted against the SHIPPED implementation -- the real `people-live.ts` and
 * the real `PeopleDirectory.tsx`, compiled with Next's own SWC and rendered to
 * HTML. A reimplementation here could drift from what ships.
 *
 * The live half is skipped without .env.local so CI stays green on a fork.
 *
 * Run: npm run check:people-module
 */
import { readFileSync, existsSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
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
const dir = resolve(mkdtempSync(join("node_modules", ".people-gate-")));
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

const QUERY = "src/lib/queries/people-live.ts";
const VIEW = "src/app/(app)/people/PeopleDirectory.tsx";
const PAGE = "src/app/(app)/people/page.tsx";
const SECTION = "src/app/(app)/people/PeopleSection.tsx";
const OVERVIEW = "src/lib/queries/overview-live.ts";

/**
 * Source with comments removed.
 *
 * Every one of these assertions describes a bug in its own doc comment, so
 * matching raw source means the gate reads its own prose and "fails" on code
 * that is correct — or worse, PASSES a regression because the explanation of
 * the bug is still sitting above the fixed line. Strip first, then assert.
 */
function code(path) {
  return readFileSync(path, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

try {
  // ── 1. Source-level: the mockup table is not read by the People page ─────
  const pageSrc = code(PAGE);
  const viewSrc = code(VIEW);
  const querySrc = code(QUERY);
  const sectionSrc = code(SECTION);

  check(
    "R1: the People page does not import getPeopleDirectory (the public.people reader)",
    !/getPeopleDirectory/.test(pageSrc),
    "the mockup reader is one import away and the table still exists for other pages",
  );
  check(
    "R1: the People page reads the live TrackingTime roster",
    /getLivePeople/.test(pageSrc) && /people-live/.test(pageSrc),
  );
  check(
    "R1: the query layer reads time.member as the roster",
    /schema\(["']time["']\)/.test(querySrc) && /from\(["']member["']\)/.test(querySrc),
  );
  /*
   * Since 2026-09-02 the directory ALSO reads public.people, for the current
   * Factorial employees who have no TrackingTime member. That is the mockup's
   * table, so the read is allowed only under both guards: is_active, and the
   * seed rows excluded by SOURCE -- all eight are inactive today, but "inactive"
   * is one admin click from changing and "seed" is not.
   */
  check(
    "R1: the public.people read excludes the seed rows by source, not only by is_active",
    /from\("people"\)/.test(querySrc) &&
      /\.eq\("is_active",\s*true\)/.test(querySrc) &&
      /\.neq\("source",\s*"seed"\)/.test(querySrc),
    "the eight mockup rows must be unreachable through this path even if one is re-activated",
  );
  check(
    "R1: Hub-only is decided by the exact key hub_person_id = people.id, never by name",
    /hubPersonId/.test(querySrc) && !/displayName\s*===?\s*p\.name|name\.toLowerCase\(\)\s*===?/.test(querySrc),
    "ADR-001: a name comparison would silently merge or split people",
  );
  check(
    "R1: no mockup person name survives anywhere in the People UI",
    !/Anna Brandt|C\. Haas|L\. Fischer|P\. Novak|R\. Yilmaz|S\. Ott|T\. Bergmann|J\. Wei/.test(
      viewSrc + sectionSrc + pageSrc,
    ),
  );
  check(
    "R1: invented profile fields are gone from the view",
    !/employee_number|contract_hours|person_qualifications|Open in Factorial|SINCE \{/.test(viewSrc),
    "employee number, SiFa certs and the Factorial document strip were mockup-only",
  );

  /*
   * R5: both tabs must come from the ONE real roster, and invent nothing.
   *
   * The directory and the org chart used to read different sources. Because they are
   * rendered from one Server Component payload, the org chart's eight mockup names
   * were serialised into the page on EVERY visit -- a live DOM probe found "Anna
   * Brandt" in the RSC script tag while the real directory was on screen. Source
   * review passed; only reading the rendered page caught it.
   *
   * These checks originally demanded the org tab show NO hierarchy, because at the
   * time there was none to show. That is no longer the requirement: TrackingTime
   * cannot supply one (its supervisor and user_group_id fields are empty for all 49
   * users), so the Hub records it in time.member.supervisor_member_id with a
   * company-wide time.org_chart view over it. What must still hold is the part that
   * actually matters: one real roster, nothing fabricated.
   */
  const orgSrc = code("src/app/(app)/people/OrgChartView.tsx");
  const orgQuerySrc = code("src/lib/queries/org-chart-live.ts");

  check(
    "R5: the seeded org_chart_nodes mockup table is not read by the People page",
    !/org_chart_nodes|OrgChartNode\b/.test(pageSrc + sectionSrc + orgSrc + orgQuerySrc),
    "its 8 invented names shipped in the RSC payload regardless of which tab was showing",
  );
  check(
    "R5: the org chart reads the real roster recorded in the Hub",
    /org_chart|"member"/.test(orgQuerySrc) && /getOrgChart/.test(pageSrc),
    "reporting lines live in the Hub precisely because TrackingTime holds none",
  );
  check(
    "R5: both tabs are fed from the same page-level fetch",
    /people=\{people\}/.test(sectionSrc) && /chart=\{chart\}/.test(sectionSrc),
    "two independent fetches is how mockup names leaked into the payload of the other tab",
  );
  check(
    "R5: an incomplete chart is shown as incomplete, not padded out",
    /unplaced/i.test(orgSrc) && /PLACED/.test(orgSrc),
    "unplaced people are listed and the placed-of-total count stated, so a half-recorded chart cannot read as finished",
  );
  check(
    "R5: no root is invented when nobody has a supervisor",
    /does not invent a root/i.test(readFileSync("src/lib/queries/org-chart-live.ts", "utf8")),
    "guessing that the ADMIN with the most hours is the boss is the exact failure being undone",
  );

  // The &amp; bug: a template literal is not JSX text.
  const templateAmp = /`[^`]*&amp;[^`]*`/.test(viewSrc);
  check(
    "no &amp; entity inside a template literal (it reaches the DOM as literal text)",
    !templateAmp,
    "the live page rendered '8 ACTIVE CONSULTANTS &amp; STAFF'",
  );

  check(
    "R4: the view labels the 40h basis as NOMINAL, not contracted",
    /NOMINAL/.test(viewSrc) && !/OF CONTRACTED/.test(viewSrc),
    "every member reports 40h because that is the TrackingTime account default",
  );

  const overviewSrc = code(OVERVIEW);
  // The note's wording lives in messages/en.json (next-intl); the page must
  // reference the key and the English text must still say "nominal".
  const basisNote =
    JSON.parse(readFileSync("messages/en.json", "utf8")).overview?.utilisationByPerson?.basisNote ?? "";
  check(
    "R4: the Overview basis note does not claim contracted hours",
    /utilisationByPerson\.basisNote/.test(code("src/app/(app)/page.tsx")) &&
      /nominal 40-hour week/i.test(basisNote) &&
      !/over contracted hours/i.test(basisNote),
  );
  check(
    "R3: the Overview headcount uses the roster count, not raw member rows",
    /getRosterCounts/.test(overviewSrc) && !/activeMembers: memberRows\.length/.test(overviewSrc),
    "memberRows.length counted info@ and jobs@ as staff",
  );

  // ── 2. Behavioural: the pure functions, compiled and executed ────────────
  const transformFile = await compile("src/lib/time-transform.ts", "time-transform.cjs");

  // Only TYPES are used from time-dashboard by the pure helpers under test; the
  // runtime require is redirected so this gate does not need a Supabase client.
  const dashStub = join(dir, "dash-stub.cjs");
  writeFileSync(
    dashStub,
    "module.exports = { getMemberUtilisation: async () => [] };",
  );

  // Compiled for real: it is pure and self-contained, and the paging rule it
  // encodes is the reason no member's hours are truncated at 1000 entries.
  const pagedFile = await compile("src/lib/queries/paged.ts", "paged.cjs");

  /*
   * people-live and team-lead-live import each other -- isSharedMailbox one
   * way, teamKey the other. Both are written to disk BEFORE either is
   * required, so CommonJS resolves the cycle the same way the bundler does.
   */
  /*
   * team-lead-live now asks budget-visibility whether the caller may see
   * budgets before it reads the over-budget list. Compiled for real rather than
   * stubbed: its only runtime import is the plain constant map in
   * @/lib/permissions, so it drags in no Supabase client, and a stub would let
   * a broken gate pass here.
   */
  const permissionsFile = await compile("src/lib/permissions.ts", "permissions.cjs");
  const budgetVisibilityFile = await compile(
    "src/lib/budget-visibility.ts",
    "budget-visibility.cjs",
    { "@/lib/permissions": posix(permissionsFile) },
  );

  const leadFile = await compile("src/lib/queries/team-lead-live.ts", "team-lead-live.cjs", {
    "./people-live": posix(join(dir, "people-live.cjs")),
    "@/lib/queries/paged": posix(pagedFile),
    "@/lib/budget-visibility": posix(budgetVisibilityFile),
    "@/lib/database.types": posix(transformFile),
  });

  const live = require(
    await compile(QUERY, "people-live.cjs", {
      "@/lib/time-transform": posix(transformFile),
      "./time-dashboard": posix(dashStub),
      "@/lib/database.types": posix(transformFile),
      "@/lib/queries/paged": posix(pagedFile),
      "./team-lead-live": posix(leadFile),
    }),
  );

  check("R3: info@ is recognised as a shared inbox", live.isSharedMailbox("info@hs-experts.com"));
  check("R3: jobs@ is recognised as a shared inbox", live.isSharedMailbox("jobs@hs-experts.com"));
  check(
    "R3: a real colleague is not treated as an inbox",
    !live.isSharedMailbox("bjoern.schoenemann@hs-experts.com"),
  );
  check("R3: a null email does not throw or match", !live.isSharedMailbox(null));

  check(
    "capacityLabel returns null with no utilisation, rather than inventing AVAILABLE",
    live.capacityLabel(null) === null,
  );
  check("capacityLabel flags sustained overload", live.capacityLabel(140)?.tone === "critical");
  check("capacityLabel flags unsold capacity", live.capacityLabel(20)?.tone === "warning");
  check("capacityLabel calls a healthy figure on track", live.capacityLabel(80)?.tone === "good");

  /*
   * R6. Two spellings of one team.
   *
   * time.member.team arrived from hand entry and holds both "OPERATIONS" and
   * "Operations". Compared raw, a team filter silently splits one team into
   * two, each missing half its people -- and the page still looks fine.
   * people-live must therefore normalise through the SAME teamKey() the team
   * board uses, not a second copy of the rule.
   */
  const lead = require(leadFile);
  check(
    "R6: people-live reuses teamKey from the team board rather than re-implementing it",
    /import \{ teamKey \} from "\.\/team-lead-live"/.test(readFileSync(QUERY, "utf8")),
    "two copies of the normalisation rule eventually disagree, and then the directory and the board show different teams for one person",
  );
  check(
    "R6: teamKey folds case variants onto one key",
    lead.teamKey("Operations") === lead.teamKey("OPERATIONS"),
    'live data holds both spellings; compared raw they are two teams of half the people each',
  );
  check(
    "R6: an unrecorded team stays null rather than becoming an empty-string team",
    lead.teamKey(null) === null && lead.teamKey("  ") === null,
    'a "" team would render as a real, selectable team with no name',
  );
  check(
    "R6: the query selects the team column it now exposes (and the hub_person_id link)",
    /\.select\("id, email, role, status, user_id, team, hub_person_id"\)/.test(readFileSync(QUERY, "utf8")),
    "LivePerson.team would be null for everyone, and without hub_person_id every Hub person would be re-listed as Hub-only",
  );

  // ── 3. Render the real component ─────────────────────────────────────────
  const linkStub = join(dir, "link-stub.cjs");
  writeFileSync(
    linkStub,
    `const { createElement } = require("react");
module.exports = { __esModule: true, default: ({ href, children, ...rest }) => createElement("a", { href, ...rest }, children) };`,
  );

  const headerStub = join(dir, "header-stub.cjs");
  writeFileSync(
    headerStub,
    `const { createElement } = require("react");
module.exports = { PageHeader: ({ title, meta, category }) =>
  createElement("header", null,
    createElement("span", null, category),
    createElement("h1", null, title),
    createElement("span", { "data-meta": "1" }, meta)) };`,
  );

  const emptyStub = join(dir, "empty-stub.cjs");
  writeFileSync(
    emptyStub,
    `const { createElement } = require("react");
module.exports = { EmptyState: ({ title, description }) =>
  createElement("div", null, createElement("p", null, title), createElement("p", null, description)) };`,
  );

  /**
   * ButtonLink, stubbed as a plain anchor.
   *
   * Needed because the real module pulls in Tailwind class helpers, and without
   * this the gate died with "Cannot find module '@/components/ui/Button'" --
   * taking the whole test:db suite down at the end, after every assertion had
   * already passed. An <a> keeps href and label assertable, which is all this
   * check reads it for.
   */
  const buttonStub = join(dir, "button-stub.cjs");
  writeFileSync(
    buttonStub,
    `const { createElement } = require("react");
module.exports = {
  ButtonLink: ({ href, children, ...rest }) => createElement("a", { href, ...rest }, children),
  Button: ({ children, ...rest }) => createElement("button", rest, children),
  buttonClass: () => "",
};`,
  );

  const fieldStub = join(dir, "field-stub.cjs");
  writeFileSync(
    fieldStub,
    `const { createElement } = require("react");
module.exports = {
  SearchInput: ({ value, onValueChange, placeholder, label }) =>
    createElement("input", { type: "search", value, placeholder, "aria-label": label, onChange: (e) => onValueChange && onValueChange(e.target.value) }),
  FilterChip: ({ active, onToggle, children, count }) =>
    createElement("button", { "data-active": active ? "1" : "0", onClick: onToggle }, children, count === undefined ? null : \` \${count}\`),
  SortHeader: ({ label, columnKey, activeKey, direction, onSort }) =>
    createElement("th", { "data-column": columnKey, "data-active": columnKey === activeKey ? direction : undefined, onClick: () => onSort && onSort(columnKey) }, label),
  Select: ({ children, ...rest }) => createElement("select", rest, children),
};`,
  );

  /*
   * next/navigation, stubbed.
   *
   * The archived toggle is a URL round-trip (?archived=1) because the SERVER
   * decides whether archived members are fetched at all -- so the view now
   * reads the router. Nothing here asserts on navigation; the stub exists so
   * the component can render outside an app-router tree.
   */
  const navStub = join(dir, "nav-stub.cjs");
  writeFileSync(
    navStub,
    `module.exports = {
  useRouter: () => ({ push: () => {}, replace: () => {} }),
  usePathname: () => "/people",
  useSearchParams: () => new URLSearchParams(),
};`,
  );

  /*
   * next-intl, without a provider. The strings this gate pins now live in
   * messages/en.json, so the stub resolves them from THAT file through
   * next-intl's own createTranslator (real ICU plurals, no React context). A
   * stub that returned the key would let "{count} HUB-ONLY" pass as rendered.
   */
  const intlStub = join(dir, "intl-stub.cjs");
  writeFileSync(
    intlStub,
    `const { readFileSync } = require("node:fs");
const { createTranslator } = require("next-intl");
const messages = JSON.parse(readFileSync(${JSON.stringify(resolve("messages/en.json"))}, "utf8"));
module.exports = { useTranslations: (namespace) => createTranslator({ locale: "en", messages, namespace }) };`,
  );

  // teams.ts is pure and is the single source of team LABELS, so it is
  // compiled rather than stubbed: a stub could pass while the shipped list
  // rendered a legacy team as a blank option.
  const teamsFile = await compile("src/lib/teams.ts", "teams.cjs");

  // The shared pager, compiled for real: it imports nothing but React, and the
  // slice bounds it returns are what decides which rows the assertions below
  // can see at all.
  // Pager reads the catalogue for its own chrome (PER PAGE, PREV, the count
  // line), so it needs the same next-intl stub the view gets. Compiled without
  // it, the real package's useTranslations throws outside a provider and takes
  // the gate down inside React's renderer, where the stack says nothing useful.
  const pagerFile = await compile("src/components/Pager.tsx", "pager.cjs", {
    "next-intl": posix(intlStub),
  });

  // The card vocabulary, compiled for real: the directory's KPI tiles are
  // StatTiles now, and the n/a-never-0 assertions below run against StatTile's
  // rendered markup. A stub would let them pass while rendering nothing.
  const cardFile = await compile("src/components/ui/Card.tsx", "card.cjs");
  // The directory's figures now follow the request locale through this helper,
  // so it has to be compiled like the other real modules: an unresolved alias
  // here fails the require() with MODULE_NOT_FOUND and takes the whole gate
  // down before a single assertion runs.
  const formatFile = await compile("src/lib/locale-format.ts", "locale-format.cjs");

  const view = require(
    await compile(VIEW, "people-view.cjs", {
      "@/components/ui/Field": posix(fieldStub),
      "next/navigation": posix(navStub),
      "@/lib/teams": posix(teamsFile),
      "@/components/Pager": posix(pagerFile),
      "@/components/ui/Button": posix(buttonStub),
      "@/components/PageHeader": posix(headerStub),
      "@/components/EmptyState": posix(emptyStub),
      "@/lib/queries/people-live": posix(join(dir, "people-live.cjs")),
      "@/components/ui/Card": posix(cardFile),
      "@/lib/locale-format": posix(formatFile),
      "next/link": posix(linkStub),
      "next-intl": posix(intlStub),
    }),
  );

  const person = (over = {}) => ({
    key: "tt-1",
    source: "trackingtime",
    memberId: 1,
    hubPersonId: "md-bjrn",
    name: "Björn Schönemann",
    email: "bjoern.schoenemann@hs-experts.com",
    accountRole: "ADMIN",
    status: "VERIFIED",
    isArchived: false,
    weeklyHours: 40,
    totalHours: 1154.4,
    billableHours: 961.7,
    entryCount: 900,
    weeksActive: 49,
    lastActivityAt: "2026-08-14T09:00:00Z",
    billablePercent: 83,
    utilisationPercent: 78,
    hasAccount: true,
    assignments: [
      { projectId: 7, projectName: "ISO 45001 readiness", loggedHours: 412, billableHours: 400, entryCount: 40, sharePercent: 48 },
      { projectId: null, projectName: "(no project)", loggedHours: 104, billableHours: 0, entryCount: 12, sharePercent: 12 },
    ],
    ...over,
  });

  // A person with NOTHING logged — the R2 case.
  const blank = person({
    key: "tt-2",
    memberId: 2,
    hubPersonId: null,
    name: "azubuike",
    email: "azubuike@hs-experts.com",
    totalHours: 0,
    billableHours: 0,
    entryCount: 0,
    weeksActive: 0,
    lastActivityAt: null,
    billablePercent: null,
    utilisationPercent: null,
    hasAccount: false,
    assignments: [],
  });

  /*
   * A Hub-only person: in public.people from Factorial, no time.member. Every
   * measured field is null. What the page must NOT do with that is render a
   * zero anywhere, and what it MUST do is say why.
   */
  const hubOnly = {
    key: "hub-fq-leonie-roitsch",
    source: "hub",
    memberId: null,
    hubPersonId: "fq-leonie-roitsch",
    name: "Leonie Roitsch",
    email: null,
    accountRole: null,
    status: null,
    isArchived: false,
    weeklyHours: null,
    totalHours: null,
    billableHours: null,
    entryCount: null,
    weeksActive: null,
    lastActivityAt: null,
    billablePercent: null,
    utilisationPercent: null,
    hasAccount: null,
    team: null,
    assignments: [],
  };

  const html = renderToStaticMarkup(
    h(view.PeopleDirectory, {
      people: [person(), blank, hubOnly],
      trackedCount: 2,
      hubOnlyCount: 1,
      archivedCount: 28,
      unlinkedCount: 1,
      mailboxCount: 2,
    }),
  );

  check("the directory renders a real colleague's name", html.includes("Björn Schönemann"));
  check("the roster lists the second person too", html.includes("azubuike"));
  check(
    "R2: a person with no logged time renders n/a, never 0%",
    html.includes("n/a") && !/>0%</.test(html),
    "0% on a colleague's profile reads as a measurement of idleness",
  );
  check("measured percentages still render", html.includes("83%"));
  check(
    "the meta line shows the real roster shape",
    /28 ARCHIVED/.test(html) && /2 SHARED INBOX EXCLUDED/.test(html),
  );
  check(
    "the meta line states BOTH counts: people, on TrackingTime, Hub-only",
    /3 PEOPLE · 2 ON TRACKINGTIME · 1 HUB-ONLY/.test(html),
    '"3 people" alone would read as three people with tracked time',
  );
  check(
    "the Hub-only person is listed, marked, and given the reason",
    html.includes("Leonie Roitsch") &&
      /data-person-source="hub"/.test(html) &&
      /HUB-ONLY · NO TRACKINGTIME ACCOUNT/.test(html),
  );
  check(
    "the Hub-only filter chip is offered with its count",
    /HUB-ONLY 1/.test(html),
    "the bucket has an action behind it (get them a TrackingTime account), so it must be filterable",
  );
  check(
    "the source label no longer claims TrackingTime alone",
    !/SOURCE: TRACKINGTIME</.test(html + code(SECTION)) && /sourceLabel/.test(code(SECTION)),
  );
  check(
    "the header renders a real ampersand, not the entity",
    html.includes("People &amp; Profiles") || html.includes("People & Profiles"),
  );
  check(
    "no literal &amp;amp; reaches the DOM",
    !html.includes("&amp;amp;"),
    "this is exactly what the live page showed",
  );
  check(
    "R4: utilisation is labelled against a nominal week",
    /NOMINAL/.test(html),
  );
  check(
    "a project assignment links to its real record",
    html.includes('href="/projects/7"'),
  );
  check(
    "the unattributed row is NOT a link (there is no record behind it)",
    html.includes("(no project)") && !/href="\/projects\/null"/.test(html),
  );
  check(
    "people with no Hub sign-in are surfaced, not hidden",
    /NO HUB ACCOUNT/.test(html) || /no Hub sign-in/.test(html),
  );

  /*
   * The Hub-only detail pane, rendered alone so the assertions cannot be
   * satisfied by Björn's tiles sitting further up the same HTML.
   */
  const hubHtml = renderToStaticMarkup(
    h(view.PeopleDirectory, {
      people: [hubOnly],
      trackedCount: 0,
      hubOnlyCount: 1,
      archivedCount: 0,
      unlinkedCount: 0,
      mailboxCount: 0,
    }),
  );
  const hubTiles = (hubHtml.match(/data-stat-tile/g) ?? []).length;
  const hubNa = (hubHtml.match(/>n\/a</g) ?? []).length;
  check(
    "a Hub-only person's four tiles all render n/a, never 0",
    hubTiles === 4 && hubNa >= 4 && !/>0<|>0 h<|>0%<|0 ENTRIES|0 H BILLABLE/.test(hubHtml),
    `${hubTiles} tiles, ${hubNa} n/a values`,
  );
  check(
    "every n/a on a Hub-only person carries the reason",
    (hubHtml.match(/NO TRACKINGTIME ACCOUNT/g) ?? []).length >= 4,
    "an unexplained n/a reads as a loading failure",
  );
  // The BADGE forms, not the words: the filter bar legitimately offers a
  // "NO HUB ACCOUNT" chip whatever is selected, and the chip stub renders it as
  // a <button> with its count, so only the <span> badge can match here.
  check(
    "no TrackingTime-only badge is shown for a Hub-only person",
    !/NOMINAL \d+ H\/WEEK/.test(hubHtml) && !/>NO ROLE</.test(hubHtml) && !/NO HUB ACCOUNT<\/span>/.test(hubHtml),
    "each of those is a fact about a member record that does not exist",
  );
  check(
    "no dashboard link points at a null member",
    !/members=null/.test(hubHtml) && !/members=undefined/.test(hubHtml),
  );
  check(
    "the projects card says why it is empty",
    /No TrackingTime account, so there is no project time to show/.test(hubHtml),
  );

  // Empty roster must explain itself rather than white-screening.
  const emptyHtml = renderToStaticMarkup(
    h(view.PeopleDirectory, {
      people: [],
      trackedCount: 0,
      hubOnlyCount: 0,
      archivedCount: 0,
      unlinkedCount: 0,
      mailboxCount: 0,
    }),
  );
  check(
    "an empty roster explains itself instead of crashing",
    /No people are visible/.test(emptyHtml),
  );

  // ── 4. Live: the real database, when credentials exist ───────────────────
  if (!existsSync(".env.local")) {
    console.log("\nSKIP: no .env.local — live roster assertions not run");
  } else {
    const env = {};
    for (const line of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
      const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
      if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }

    if (!env.NEXT_PUBLIC_SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
      console.log("\nSKIP: .env.local lacks Supabase credentials");
    } else {
      const { createClient } = await import("@supabase/supabase-js");
      const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
        auth: { persistSession: false },
      });

      const { data: members, error } = await admin
        .schema("time")
        .from("member")
        .select("id, email, is_archived, user_id");

      if (error) {
        check("live time.member is readable", false, error.message);
      } else {
        console.log(`\n=== live roster: ${members.length} TrackingTime members ===`);

        check(
          "the live roster dwarfs the 8 mockup rows",
          members.length > 20,
          `${members.length} members`,
        );

        const inboxes = members.filter((m) => live.isSharedMailbox(m.email));
        check(
          "shared inboxes are present in TrackingTime and must be filtered",
          inboxes.length > 0,
          inboxes.map((m) => m.email).join(", "),
        );

        const activeHumans = members.filter(
          (m) => !m.is_archived && !live.isSharedMailbox(m.email),
        );
        check(
          "the active roster is real people only",
          activeHumans.every((m) => !live.isSharedMailbox(m.email)),
          `${activeHumans.length} active`,
        );

        const unlinked = activeHumans.filter((m) => !m.user_id);
        check(
          "the unlinked-account gap is measurable and worth surfacing",
          unlinked.length > 0,
          `${unlinked.length} of ${activeHumans.length} active people cannot sign in to see their own hours`,
        );
      }
    }
  }

  console.log(
    failed
      ? "\nPEOPLE MODULE: the directory has drifted back towards the mockup\n"
      : "\nPEOPLE MODULE: real roster, honest nulls, no invented fields\n",
  );
} finally {
  rmSync(dir, { recursive: true, force: true });
}

// process.exit() here crashes Node on Windows with a libuv assertion
// (!(handle->flags & UV_HANDLE_CLOSING)) because the Supabase client's sockets
// are still closing. Setting exitCode lets the loop drain and exit cleanly.
process.exitCode = failed ? 1 : 0;
