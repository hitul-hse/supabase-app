/**
 * No page may render the seeded mockup people.
 *
 * WHY THIS EXISTS, and why check:no-mock-data did not catch it. That gate names
 * specific FILES (the landing page, SyncBar, overview-live) and specific TABLES,
 * so it proved the Overview could not read the mock tables. It said nothing about
 * /team-lead or /admin/users, which went on rendering all eight seeded names -- for
 * a company of 49 real people -- while the whole suite stayed green. A crawl of the
 * deployed app found them in seconds.
 *
 * So this check is the general form: no reporting surface anywhere may read the
 * mockup people table or the tables keyed to it, and the mockup NAMES must not
 * appear in any source file that renders. A gate written against a list of known
 * pages can only ever catch the pages someone already remembered.
 *
 * WHAT THE TEAM LEAD BOARD LOOKS LIKE NOW. It reads time.entry, bucketed per
 * member per ISO week, bounded at today. The checks below pin the parts that were
 * wrong rather than merely absent:
 *
 *   - weeks are DATES, not the fixed "W31".."W34" strings, which described the
 *     wrong weeks the moment the calendar passed week 34;
 *   - the window is bounded at today, so planned future work is not shown as
 *     logged (nine members carry future-dated entries, one to 2026-12-31);
 *   - the KPI strip is derived, not four constants (76%, 3, 14, 2);
 *   - the certificate and timesheet columns are GONE, not rewired -- nothing here
 *     tracks certificate expiry, and "CERTS OK" from an invented string is worse
 *     than silence;
 *   - the invite form does not offer fictional people as the "linked person".
 *
 * Source-level, deliberately: it runs without credentials, in CI, and fails on the
 * commit that introduces the regression rather than after a deploy.
 *
 * Run: npm run check:no-mockup-people
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

let failed = 0;
const check = (name, ok, detail = "") => {
  if (!ok) failed++;
  console.log(`${ok ? "PASS" : "FAIL"}: ${name}${detail ? `\n        ${detail}` : ""}`);
};

/** Every .ts/.tsx under src, except the demo and video marketing pages. */
function sourceFiles(dir = "src", out = []) {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) {
      // /demo and /video are deliberate marketing mockups, not reporting surfaces.
      if (entry === "demo" || entry === "video") continue;
      sourceFiles(path, out);
    } else if (/\.tsx?$/.test(entry)) {
      out.push(path);
    }
  }
  return out;
}

const files = sourceFiles();
const read = (p) => readFileSync(p, "utf8").replace(/\r\n/g, "\n");

/**
 * A file's CODE, with comments stripped.
 *
 * Necessary, not fastidious: the modules that removed the mockup data explain in
 * their header comments exactly what they removed ("the hardcoded 76%", "Site
 * risk assessment 2026", the certificate column). Searching raw source would
 * report those explanations as the very regressions they document, and the
 * obvious fix -- deleting the explanation -- would lose the reason the code looks
 * the way it does. So the checks read code and the prose stays.
 */
function codeOnly(path) {
  return read(path)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((l) => !l.trim().startsWith("//"))
    .join("\n");
}

// ── 1. The mockup names must not appear in any rendering source ────────────
// These are the eight seeded rows in public.people. Their presence in a
// component means someone hardcoded them; in a query, that the mock table is
// being read and rendered.
const MOCKUP_NAMES = [
  "Anna Brandt", "C. Haas", "L. Fischer", "P. Novak",
  "R. Yilmaz", "S. Ott", "T. Bergmann", "J. Weiß",
];
const nameHits = [];
for (const file of files) {
  const body = read(file);
  for (const name of MOCKUP_NAMES) {
    // Skip our own prose about them: a comment explaining the removal is fine.
    const lines = body.split("\n");
    for (const [i, line] of lines.entries()) {
      if (!line.includes(name)) continue;
      const trimmed = line.trim();
      const isComment = trimmed.startsWith("*") || trimmed.startsWith("//") || trimmed.startsWith("/*");
      if (!isComment) nameHits.push(`${file}:${i + 1} ${trimmed.slice(0, 70)}`);
    }
  }
}
check(
  "no mockup person's name appears in rendering code",
  nameHits.length === 0,
  nameHits.slice(0, 6).join("\n        ") || "none of the eight seeded names is hardcoded",
);

// ── 2. Reporting surfaces must not query the mockup people table ──────────
// Pages a colleague uses to make a decision. The demo pages are excluded above.
const REPORTING = [
  "src/app/(app)/page.tsx",
  "src/app/(app)/team-lead/page.tsx",
  "src/app/(app)/people/page.tsx",
  "src/app/(app)/admin/users/page.tsx",
  "src/lib/queries/team-lead-live.ts",
  "src/lib/queries/people-live.ts",
  "src/lib/queries/overview-live.ts",
];
// weekly_bookings is the seeded workload table; the others are keyed to people.id.
const MOCK_TABLES = ['from("people")', 'from("weekly_bookings")', 'from("org_chart_nodes")'];
for (const file of REPORTING) {
  const body = read(file);
  for (const table of MOCK_TABLES) {
    check(
      `${file} does not query ${table}`,
      !body.includes(table),
      body.includes(table) ? "this table holds seeded mockup rows, not measured data" : "",
    );
  }
}

// ── 3. The Team Lead board reads measured time ────────────────────────────
const tlPage = codeOnly("src/app/(app)/team-lead/page.tsx");
check(
  "the Team Lead page calls getLiveTeamLeadBoard",
  tlPage.includes("getLiveTeamLeadBoard"),
  "anything else means it is back on weekly_bookings",
);
check(
  "getTeamLeadBoard (the seeded reader) is gone from the codebase",
  !files.some((f) => /export async function getTeamLeadBoard/.test(read(f))),
  "a dead export returning seeded rows is how mockup data survives a rewire",
);

const tlQuery = codeOnly("src/lib/queries/team-lead-live.ts");
check(
  "the board's window is bounded at today",
  tlQuery.includes("current") || tlQuery.includes("today"),
  "TrackingTime stores planned future entries; an unbounded board shows unworked time as logged",
);
check(
  "the bound is applied in the entry query, not only computed",
  /\.lte\("started_at"/.test(tlQuery),
  "a computed cutoff that is never passed to the query filters nothing",
);
check(
  "an entry is bucketed by its ISO week Monday",
  // The CALL SITE, not the identifier. Checking that "isoWeekMonday" appears
  // anywhere passed a mutation swapping isoWeekMonday(day) for day.slice(0, 7) --
  // month buckets wearing week labels -- because the helper was still declared
  // further up the file.
  /weekIndex\.get\(isoWeekMonday\(/.test(tlQuery),
  "fixed labels or coarser buckets put hours in the wrong column",
);
check(
  "entries are paged, not truncated at PostgREST's cap",
  tlQuery.includes(".range(") && tlQuery.includes("PAGE"),
  "a single request stops at 1000 rows and silently under-reports every person",
);
check(
  "shared mailboxes are excluded from the board",
  // Again the call, not the import. `.filter((m) => !isSharedMailbox(...))`
  // becoming `.slice()` left the identifier in the import line and passed.
  /!isSharedMailbox\(/.test(tlQuery),
  "info@ and jobs@ hold member records but are inboxes, not colleagues",
);

// ── 4. The board component shows no invented constants ───────────────────
const tlBoard = codeOnly("src/app/(app)/team-lead/TeamLeadBoard.tsx");
for (const [label, pattern] of [
  ['the hardcoded "76%" team utilisation', />\s*76%\s*</],
  ["the hardcoded overdue-task count", />\s*14\s*</],
  ['the invented "Site risk assessment 2026" project', /Site risk assessment 2026/],
  ["the invented 1 164 / 1 200 h figure", /1 164/],
]) {
  check(`${label} is gone`, !pattern.test(tlBoard), "");
}
check(
  "the utilisation KPI comes from the query",
  tlBoard.includes("teamUtilisationPercent"),
  "",
);
check(
  "a missing utilisation renders n/a rather than 0%",
  /teamUtilisationPercent === null \? "n\/a"/.test(tlBoard),
  "0% reads as a team sitting idle; n/a reads as no basis to judge",
);
check(
  "the certificate column is removed, not filled with a guess",
  !tlBoard.includes("certificates") && !tlBoard.includes("SIFA EXP"),
  "nothing in this project tracks certificate expiry, so 'CERTS OK' would be a false assurance",
);
check(
  "nominal contracted hours are labelled as nominal",
  tlBoard.includes("weeklyHoursAreNominal") && /NOMINAL/.test(tlBoard),
  "every member reports 40h because that is TrackingTime's default, not a contract",
);

// ── 5. The invite form no longer offers fictional colleagues ─────────────
const invite = codeOnly("src/app/(app)/admin/users/InviteUserForm.tsx");
check(
  "the invite form has no mockup-people picker",
  !invite.includes('name="person_id"'),
  "it listed the eight seeded people as the choices for linking a real colleague",
);
const usersPage = codeOnly("src/app/(app)/admin/users/page.tsx");
check(
  "the users page does not load the mockup people list",
  !usersPage.includes('from("people")'),
  "",
);
const inviteAction = codeOnly("src/app/(app)/admin/users/actions.ts");
check(
  "invites link to TrackingTime by email instead",
  inviteAction.includes('.ilike("email", email)'),
  "every Hub account on a work address already matches a member on email",
);
check(
  "a mismatched email does not fail the invite",
  inviteAction.includes("No TrackingTime account matches that address"),
  "someone can hold a Hub account with no TrackingTime record; that must not undo the invite",
);
check(
  "an already-claimed member record is not silently reassigned",
  inviteAction.includes("already linked to a different account"),
  "overwriting user_id would move one person's hours onto another's account",
);

console.log(
  failed
    ? "\nMOCKUP PEOPLE: a page can still render seeded people\n"
    : "\nMOCKUP PEOPLE: no page reads or renders the seeded roster\n",
);
process.exit(failed ? 1 : 0);
