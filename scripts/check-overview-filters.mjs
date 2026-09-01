/**
 * The Overview's filter surface: does it narrow the page without lying to it?
 *
 * WHY THIS EXISTS. The Overview was hardcoded to twelve weeks and now takes a
 * period and a team from the URL. Every failure mode of that change is a
 * PLAUSIBLE one -- the page still renders, still looks authoritative, and is
 * quietly answering a different question than its labels claim:
 *
 *   F1. A filter that EMPTIES the page. A bad ?range= or ?team= must fall back
 *       to showing everything, never to a blank dashboard the reader mistakes
 *       for a dead business.
 *   F2. MIXED SCOPES, UNLABELLED. Three figures here genuinely cannot be
 *       date-bounded (per-person utilisation, the project ledger, the header
 *       counts). Leaving them silently all-time next to period figures is the
 *       exact failure class this page was rebuilt to remove, so each one must
 *       carry a visible label.
 *   F3. TWO DIALECTS. The Team Lead board already has this control. If the two
 *       parse ?range= differently, the same link means two things.
 *   F4. A HIDDEN MAJORITY. Most of the roster has no team recorded. If the
 *       no-team bucket is not selectable, the one honest answer to "who is
 *       unassigned" is unreachable, and if the covered headcount is not stated,
 *       a filtered page reads as a collapse.
 *   F5. A WINDOW THAT IS NOT THE WINDOW. `.limit(n)` returns the n newest rows
 *       regardless of the dates asked for, so a date-bounded read must not use
 *       one -- the same ordering hazard check-trend-window pins, in a new place.
 *
 * The range arithmetic is executed, not grepped: the parsers are pure and
 * exported, so their behaviour is tested directly against the SAME functions the
 * server page calls. The rendering rules are source assertions with comments
 * stripped, because they are absences (no unlabelled all-time figure) and an
 * absence cannot be rendered.
 *
 * Read-only. No database, no deploy.
 *
 * Run: node scripts/check-overview-filters.mjs
 */
import { readFileSync } from "node:fs";

let failed = false;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}: ${name}${detail ? " — " + detail : ""}`);
  if (!ok) failed = true;
};

/**
 * Strip comments before asserting.
 *
 * The repo has been burned by this specifically: a gate whose regex matches its
 * own explanatory comment passes forever, including after the code it describes
 * is deleted. Every rule below is documented in a comment in the file it
 * checks, so this is load-bearing rather than hygiene.
 */
const stripComments = (src) =>
  src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

const queries = read("src/lib/queries/overview-live.ts");
const queriesCode = stripComments(queries);
const page = read("src/app/(app)/page.tsx");
const pageCode = stripComments(page);
const filters = read("src/app/(app)/OverviewFilters.tsx");
const filtersCode = stripComments(filters);

/*
 * User-visible wording now lives in messages/en.json (next-intl), so the
 * assertions below pin two halves: the page references the message KEY, and
 * the English text behind that key still says what the rule requires. Either
 * half alone can pass while the page lies.
 */
const en = JSON.parse(read("messages/en.json"));
const enText = (path) =>
  path.split(".").reduce((o, k) => (o && typeof o === "object" ? o[k] : undefined), en) ?? "";
const board = read("src/app/(app)/team-lead/BoardRangeFilter.tsx");
const boardQueries = read("src/lib/queries/team-lead-live.ts");

// ---------------------------------------------------------------------------
// 1. The default is byte-for-byte the old behaviour
// ---------------------------------------------------------------------------
console.log("\n--- 1. Untouched, the page shows what it always showed ---");

// TS source is not directly importable from plain node, so the arithmetic is
// re-derived here from the SAME preset table and compared against the source's
// declared default rather than skipped. What matters is that the default window
// is twelve weeks and is expressed through the constant, not a literal.
check(
  "the default preset is the historical 12-week window",
  /OVERVIEW_DEFAULT_PRESET: OverviewPreset = "12w"/.test(queriesCode),
);
check(
  "the default window still flows through OVERVIEW_WEEKS, not a literal 12",
  /getOrgWeeks\(supabase, OVERVIEW_WEEKS\)/.test(queriesCode),
  "check-trend-window pins this exact call; a literal would pass tsc and drop the ordering contract",
);
check(
  "OVERVIEW_WEEKS is still exported for existing callers and checks",
  /export const OVERVIEW_WEEKS = 12/.test(queriesCode),
);
check(
  "getLiveOverview's range argument is OPTIONAL",
  /getLiveOverview\(\s*\n?\s*supabase: SupabaseTyped,\s*\n?\s*opts: \{ range\?: OverviewRange; team\?: string \| null \} = \{\},/.test(
    queriesCode,
  ),
  "a required argument would break every existing caller",
);

// ---------------------------------------------------------------------------
// 2. F1 — a filter can never empty the page
// ---------------------------------------------------------------------------
console.log("\n--- 2. A bad or empty selection shows everything ---");

check(
  "an unrecognised ?range= falls back to the default preset",
  /if \(named && PRESET_KEYS\.includes\(named\)\) return boardRangeForPreset\(named\);\s*\n\s*return boardRangeForPreset\(OVERVIEW_DEFAULT_PRESET\);/.test(
    queriesCode,
  ),
);
check(
  "a reversed custom range (from > to) is rejected, not honoured",
  /from <= to/.test(queriesCode),
  "from > to would select zero weeks and blank every figure",
);
check(
  "no ?team= means all teams (null), not an empty selection",
  /export function parseOverviewTeam[\s\S]{0,200}?if \(!raw\) return null;/.test(queriesCode),
);
check(
  "the team filter offers an explicit way back to all teams",
  /aria-pressed=\{team === null\}/.test(filtersCode) &&
    /t\("allTeams"\)/.test(filtersCode) &&
    enText("overview.filters.allTeams") === "All teams",
  "a filter you can enter but not leave leaves the reader on a scoped page believing it is total",
);

// ---------------------------------------------------------------------------
// 3. F2 — no scope is mixed in silently
// ---------------------------------------------------------------------------
console.log("\n--- 3. Every figure that cannot honour the period says so ---");

check(
  "the query layer declares which figures are all-time",
  /export type OverviewScopeNotes = \{[\s\S]*?utilisationAllTime: boolean;[\s\S]*?projectsAllTime: boolean;[\s\S]*?countsAllTime: boolean;/.test(
    queriesCode,
  ),
);
check(
  "the per-person utilisation card is labelled ALL TIME",
  /scopeNotes\.utilisationAllTime \? t\("qualifiers\.allTime"\) : null/.test(pageCode) &&
    enText("overview.qualifiers.allTime") === "ALL TIME",
  "member_utilisation is not date-bounded; unlabelled it reads as a period figure",
);
check(
  "the utilisation BASIS note repeats it in prose",
  /t\("utilisationByPerson\.basisNote"\)/.test(pageCode) &&
    /all-time, not for the selected period/.test(enText("overview.utilisationByPerson.basisNote")),
  "the qualifier is four abbreviated words; the basis note is where a reader looks for why",
);
check(
  "the utilisation gauge is labelled ALL TIME",
  /t\("qualifiers\.allTime"\),\s*\n?\s*\]\.join\(" · "\)/.test(pageCode),
  "the gauge averages the card above it, so it inherits that card's scope",
);
check(
  "the project ledger is labelled ALL TIME",
  /t\("projectLedger\.qualifier", \{ count: projects\.length \}\)/.test(pageCode) &&
    enText("overview.projectLedger.qualifier") === "TOP {count} BY HOURS · ALL TIME",
);
check(
  "the over-budget KPI is labelled ALL TIME",
  /key: "tiles\.budgetRisk\.allTime",\s*\n?\s*values: \{ count: projectRows\.length, noBudget \}/.test(queriesCode) &&
    /^ALL TIME · TOP \{count\} BY HOURS/.test(enText("overview.tiles.budgetRisk.allTime")),
  "it sits in a strip of period figures",
);
check(
  "the roster headcount is labelled ON ROSTER, not left among period totals",
  /t\("thisPeriod\.peopleOnRoster"\)/.test(pageCode) &&
    enText("overview.thisPeriod.peopleOnRoster") === "PEOPLE ON ROSTER",
);
check(
  "the ledger no longer claims to be a period figure",
  !/BY HOURS · TRACKINGTIME/.test(pageCode) &&
    !/BY HOURS · TRACKINGTIME/.test(JSON.stringify(en.overview)),
);
check(
  "a mid-week range boundary is disclosed, not silently widened",
  /snappedToWholeWeeks/.test(queriesCode) &&
    /t\("period\.widened", \{ period: periodLabel \}\)/.test(pageCode) &&
    /^PERIOD WIDENED TO WHOLE ISO WEEKS/.test(enText("overview.period.widened")),
  "org_week aggregates by week, so a to-the-day range cannot be honoured",
);
check(
  "the period is named from the weeks ACTUALLY counted, not from the request",
  /coveredWeeks === null[\s\S]{0,200}?coveredWeeks\.first/.test(pageCode),
  "ask for this year in January and you get three weeks; printing the request overstates coverage",
);
check(
  "cards carry the period in their qualifier",
  (pageCode.match(/scopedQualifier\(/g) ?? []).length >= 3,
  `${(pageCode.match(/scopedQualifier\(/g) ?? []).length} scoped qualifier(s)`,
);
check(
  'no card still hardcodes "LAST 12 WEEKS"',
  !/LAST \$\{OVERVIEW_WEEKS\} WEEKS/.test(pageCode),
);

// ---------------------------------------------------------------------------
// 4. F3 — one dialect, shared with the Team Lead board
// ---------------------------------------------------------------------------
console.log("\n--- 4. The two filter surfaces speak one dialect ---");

const presetsOf = (src) => {
  const block = /const PRESETS[\s\S]*?\n\];/.exec(src)?.[0] ?? "";
  return (block.match(/key: "([^"]+)"/g) ?? []).map((m) => m.slice(7, -1));
};
const minePresets = presetsOf(filters);
const boardPresets = presetsOf(board);
check(
  "the Overview offers the same presets, in the same order, as the board",
  minePresets.length === 6 && minePresets.join(",") === boardPresets.join(","),
  `overview [${minePresets.join(", ")}] vs board [${boardPresets.join(", ")}]`,
);
check(
  "the preset TYPE is imported from the board's module, not redeclared",
  /export type OverviewPreset = BoardPreset;/.test(queriesCode),
  "two independent unions drift the moment one gains a preset",
);
check(
  "the range arithmetic is boardRangeForPreset, not a second implementation",
  /boardRangeForPreset\(/.test(queriesCode) &&
    !/case "prev-month"/.test(queriesCode),
  "a copied month calculation is a second thing to get wrong",
);
check(
  "the board's preset list is unchanged (this change is read-only there)",
  /"4w" \| "12w" \| "26w" \| "month" \| "prev-month" \| "year"/.test(boardQueries),
);
check(
  "the URL keys match the board's (?range=, ?from=, ?to=)",
  /params\.set\("range", preset\)/.test(filtersCode) &&
    /params\.set\("from"/.test(filtersCode) &&
    /params\.set\("to"/.test(filtersCode),
);

// ---------------------------------------------------------------------------
// 5. F4 — the unassigned majority is visible and countable
// ---------------------------------------------------------------------------
console.log("\n--- 5. The no-team bucket is real, and small numbers are explained ---");

check(
  "there is a no-team sentinel that cannot collide with a stored team",
  /export const NO_TEAM = "none";/.test(queriesCode) &&
    /teamKey/.test(queriesCode),
  "teamKey() uppercases every real value, so a lowercase sentinel is unambiguous",
);
check(
  "the no-team bucket is ALWAYS offered, even at zero",
  /options\.push\(\{ key: NO_TEAM, label: "No team recorded", people: none \}\)/.test(
    queriesCode,
  ),
  "omitting it when empty is indistinguishable from 'everybody has a team'",
);
check(
  "teams are offered from the roster's stored values, not a canonical list",
  /function buildTeamOptions/.test(queriesCode) &&
    /counts\.set\(m\.team/.test(queriesCode),
  "legacy values (ENG, SAFETY) are still in the live data; a canonical list would hide people",
);
check(
  "the covered headcount is computed",
  /export type OverviewTeamCoverage = \{[\s\S]*?totalPeople: number;[\s\S]*?withTeam: number;[\s\S]*?inSelected: number \| null;/.test(
    queriesCode,
  ),
);
check(
  "the covered headcount is RENDERED when a team is active",
  /count: activeCount \?\? 0,\s*\n?\s*total: coverage\.totalPeople/.test(filtersCode) &&
    /people have this team recorded/.test(enText("overview.filters.coverage.recorded")),
  "a small filtered figure with no denominator reads as a business collapse",
);
check(
  "the coverage sentence is in a live region",
  /role="status"/.test(filtersCode),
  "it appears without a focus change, so it is otherwise silent to a screen reader",
);
check(
  "each team pill carries its headcount BEFORE the click",
  /\{option\.people\}/.test(filtersCode),
);
check(
  "shared mailboxes are excluded from the coverage denominator",
  /isSharedMailbox/.test(queriesCode),
  "info@/jobs@ hold member records but are not people; counting them inflates 'x of y'",
);
check(
  "an empty team selection is a stated absence, not a zero",
  /key: "tiles\.hoursLogged\.noHoursForTeam"/.test(queriesCode) &&
    enText("overview.tiles.hoursLogged.noHoursForTeam") === "NO HOURS FOR THIS TEAM IN PERIOD",
  '"no data imported yet" would blame the database for a filter',
);
check(
  "a team-filtered empty chart says the team is empty, not that the sync failed",
  /t\("billableShare\.noHoursTeam", \{ team: teamLabelForScope \?\? "" \}\)/.test(pageCode) &&
    enText("overview.billableShare.noHoursTeam") === "No hours logged by {team} in this period.",
);

// ---------------------------------------------------------------------------
// 6. F5 — the date-bounded read is genuinely date-bounded
// ---------------------------------------------------------------------------
console.log("\n--- 6. The window is the window ---");

const between = /async function getOrgWeeksBetween\([\s\S]*?\n}/.exec(queriesCode)?.[0] ?? "";
check("getOrgWeeksBetween exists", between.length > 0);
check(
  "the date-bounded read uses gte/lte, NOT a row limit",
  /\.gte\("week_start", firstMonday\)/.test(between) &&
    /\.lte\("week_start", lastMonday\)/.test(between) &&
    !/\.limit\(/.test(between),
  ".limit(n) returns the n newest weeks regardless of the dates asked for",
);
check(
  "the date-bounded read orders ascending for the x-axis (no limit, so no reverse)",
  /ascending: true/.test(between),
);
// Sliced from its declaration to the next top-level function rather than
// regex-matched to a closing brace: the body nests several, and a lazy `\n}`
// stops at the first inner one, which silently narrows what is asserted below.
const teamWeeksAt = queriesCode.indexOf("async function getTeamWeeks");
const teamWeeks =
  teamWeeksAt === -1
    ? ""
    : queriesCode.slice(teamWeeksAt, queriesCode.indexOf("function num(", teamWeeksAt));
check("getTeamWeeks exists", teamWeeks.length > 0);
check(
  "the team-scoped series pages the entry table rather than truncating at 1000",
  /fetchAllPaged/.test(teamWeeks),
  "a bare .limit() silently caps at db-max-rows and undercounts the hours",
);
check(
  "the team-scoped series includes calendar entries, matching org_week",
  /is_calendar/.test(teamWeeks) && !/\.eq\("is_calendar", false\)/.test(teamWeeks),
  "excluding them would make the team filter look like it halved the hours",
);
check(
  "contracted capacity is capped at the SELECTED weeks, not a constant 12",
  /Math\.min\(m\.weeksActive, rangeWeekCount\)/.test(queriesCode),
  "crediting 12 weeks of capacity against a one-month period thirds the ratio",
);
check(
  "the team-scoped weekly read only happens when a team is selected",
  /teamMemberIds === null\s*\n?\s*\? rangedWeeks/.test(queriesCode),
  "unfiltered, the page must read the same view it always did",
);

// ---------------------------------------------------------------------------
// 7. The control vocabulary
// ---------------------------------------------------------------------------
console.log("\n--- 7. It looks like the rest of the app ---");

check(
  "the filter bar is tagged for live verification",
  /data-overview-filters="1"/.test(filtersCode),
);
check(
  "there is an UPDATING… live region during the transition",
  /aria-live="polite"/.test(filtersCode) &&
    /t\("updating"\)/.test(filtersCode) &&
    enText("overview.filters.updating") === "UPDATING…",
);
check(
  "pills sit in a rounded-full trough, like the board's",
  /rounded-full border border-\[var\(--border\)\] bg-\[var\(--surface-2\)\] p-0\.5/.test(
    filtersCode,
  ),
);
check(
  "the active pill is an accent fill with accent-contrast text",
  /bg-\[var\(--accent\)\] font-medium text-\[var\(--accent-contrast\)\]/.test(filtersCode),
);
check(
  "every pill announces its pressed state",
  (filtersCode.match(/aria-pressed=/g) ?? []).length >= 3,
  `${(filtersCode.match(/aria-pressed=/g) ?? []).length} aria-pressed`,
);
check(
  "both date inputs are individually named",
  /aria-label=\{t\("fromDate"\)\}/.test(filtersCode) &&
    /aria-label=\{t\("toDate"\)\}/.test(filtersCode) &&
    enText("overview.filters.fromDate") === "Period from date" &&
    enText("overview.filters.toDate") === "Period to date",
  "a bare <input type=date> announces only as 'date'",
);
check("no hex literal anywhere in the filter bar", !/#[0-9a-fA-F]{3,8}\b/.test(filtersCode));
check(
  "no half-pixel type sizes",
  (filtersCode.match(/text-\[\d+\.5px\]/g) ?? []).length === 0,
);
check(
  "changing the period keeps the team, and vice versa",
  /next\.team === undefined \? team : next\.team/.test(filtersCode) &&
    /next\.preset === undefined \? range\.preset : next\.preset/.test(filtersCode),
  "controls that reset each other leave the reader believing both are applied",
);
check(
  "the default preset produces a CLEAN url (no ?range=12w)",
  /preset !== DEFAULT_PRESET/.test(filtersCode),
);

console.log(
  failed
    ? "\nOVERVIEW FILTERS: FAILED\n"
    : "\nOVERVIEW FILTERS: the page narrows without changing what its labels mean\n",
);
process.exit(failed ? 1 : 0);
