/*
 * Does the working-links feature on /my-work stay inside its scope?
 *
 * Four things are asserted, in order of how badly they fail:
 *
 * 1. SCOPING. The read is gated by can_view_project(project_id) and nothing
 *    else. If that policy were ever widened -- or a call site reached for the
 *    service role -- one person's customer links would render on another
 *    person's page. This is the same class as the budget-visibility hole found
 *    on 2026-09-03, where a policy existed and admitted everyone.
 * 2. CONTAINMENT. Links belong to /my-work only. hitul was explicit that the
 *    Overview tab stays the company-wide analysis surface, so a stray import
 *    there is a product regression even though it would typecheck.
 * 3. HONESTY. A project with no recorded link of a kind renders NOTHING, not
 *    "n/a" and not a placeholder chip. An absent link is not an unmeasured
 *    figure: there is nothing being withheld, so "n/a" would overstate the
 *    case, and with a column per kind roughly 80% of the cells are empty.
 * 4. SHAPE. One column per destination, generated FROM the shared LINK_ORDER
 *    rather than hand-listed, so the columns and the kinds cannot drift apart.
 *
 * REWRITTEN 2026-09-04, when the single mixed LINKS column became five columns
 * (CHAT / TEAMS / ASANA / TT / DRIVE). The intent is unchanged and the honesty
 * bar is deliberately RAISED rather than relaxed to fit the new markup: the
 * empty-cell rule now has ~250 cells to hold rather than ~44, and an
 * end-to-end-empty column (Mathias has zero Asana boards) must additionally
 * say so in words, which is what the new inventory assertion is for.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = fileURLToPath(new URL("..", import.meta.url));

let failures = 0;
const check = (l, ok, d = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}: ${l}${d ? `\n        ${d}` : ""}`);
  if (!ok) failures += 1;
};

const q = readFileSync(join(REPO, "src/lib/queries/my-work.ts"), "utf8");
const tables = readFileSync(join(REPO, "src/components/my-work/MyWorkTables.tsx"), "utf8");
const migrationRaw = readFileSync(
  join(REPO, "supabase/migrations/20260903230000_project_link.sql"), "utf8");
/*
 * Statement assertions run against the SQL with `--` comments stripped.
 * Without this, a regex like /grant[^;]*to[^;]*anon/ matches straight across
 * the file header, because comment prose contains no semicolon to stop it --
 * which is exactly how this gate first reported a hole that did not exist.
 */
const migration = migrationRaw.replace(/--[^\n]*/g, "");
const overviewQuery = readFileSync(join(REPO, "src/lib/queries/overview-live.ts"), "utf8");
const overviewPage = readFileSync(join(REPO, "src/app/(app)/page.tsx"), "utf8");

/*
 * The two regions this gate reasons about, sliced by their own source markers.
 *
 * `projectBlock` is the projects table's column list; `linkBlock` is the loop
 * that generates the five destination columns inside it. Slicing rather than
 * scanning the whole file matters: "logged" and "budget" are legitimate strings
 * in the CUSTOMERS table, which still carries both, so a file-wide search for
 * them would fail a gate about a table they are not in.
 */
const sliceBetween = (src, from, to) => {
  const a = src.indexOf(from);
  if (a === -1) return null;
  const b = src.indexOf(to, a + from.length);
  if (b === -1) return null;
  return src.slice(a, b);
};

const projectBlock = sliceBetween(tables, "const projectColumns", "const customerColumns");
const linkBlock = projectBlock && sliceBetween(projectBlock, "LINK_ORDER.entries()", "return cols;");

/*
 * A comment-stripped copy, for the assertions that ban a string from being
 * RENDERED. Without it this gate fails on its own subject matter: the code
 * comment explaining why a cell must never say "n/a" contains the characters
 * "n/a", and a raw substring search cannot tell the rule from the violation.
 */
const stripComments = (src) =>
  src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
const linkCode = linkBlock === null ? null : stripComments(linkBlock);

check(
  "the projects column list and its link block are both locatable",
  projectBlock !== null && linkBlock !== null,
  "every assertion below slices on these markers; if they moved, this gate is inspecting the wrong text",
);

/* ------------------------------------------------------------------ scoping */

check(
  "the only SELECT policy on project_link is can_view_project(project_id)",
  /using \(public\.can_view_project\(project_id\)\)/.test(migration) &&
    (migration.match(/create policy/g) ?? []).length === 1,
  "a link must be visible exactly when its project is -- no second policy, no permission key of its own",
);

check(
  "anon holds nothing on project_link",
  /revoke all on public\.project_link from anon/.test(migration) &&
    !/grant[^;]*to[^;]*anon/i.test(migration),
);

check(
  "authenticated is granted SELECT only, never write",
  /grant select on public\.project_link to authenticated/.test(migration) &&
    !/grant (insert|update|delete|all)[^;]*project_link[^;]*authenticated/i.test(migration),
);

check(
  "the query reads through the caller's own client, never the service role",
  /from\("project_link"\)/.test(q) && !/SERVICE_ROLE/.test(q),
);

check(
  "the paged read orders before ranging",
  /\.from\("project_link"\)[\s\S]{0,220}\.order\("project_id"\)[\s\S]{0,80}\.range\(/.test(q),
  "an unordered paged read returns an arbitrary partition, not a stable one",
);

/* -------------------------------------------------------------- containment */

check(
  "the Overview query does NOT read project_link",
  !/project_link/.test(overviewQuery),
  "the Overview tab is the company-wide analysis surface; working links belong to /my-work",
);

check(
  "the Overview page does NOT render links",
  !/project_link|MyLink|LINK_LABEL|LINK_ORDER/.test(overviewPage),
);

/* ------------------------------------------------------------------ honesty */

check(
  "a project with no link of a kind renders nothing, not a placeholder",
  linkBlock !== null && /if \(mine\.length === 0\) return null;/.test(linkBlock),
  'an absent link is not a withheld measurement, so it must not render "n/a"',
);

check(
  'no cell in the link block falls back to "n/a" or a dash placeholder',
  linkCode !== null && !/n\/a|>\s*[-–—]\s*<|"\."/.test(linkCode),
  "~80% of these cells are empty; a placeholder repeated that often is noise pretending to be data",
);

check(
  "a column that is empty end to end says so in words, not with a bare 0",
  /linkInventory/.test(tables) && /x\.count === 0 \? "none"/.test(tables),
  'Mathias has zero Asana boards, so his ASANA column is blank top to bottom -- "ASANA none" ' +
    "under the table is what distinguishes an empty column from a broken one",
);

check(
  "the inventory counts the rows actually on screen, not the unfiltered set",
  /count: filteredProjects\.filter/.test(tables),
  "a legend that disagrees with the rows above it is worse than no legend",
);

check(
  "an unrecognised link kind from the database is dropped, not rendered blank",
  /if \(!\(l\.kind in LINK_LABEL\)\) continue;/.test(q),
);

check(
  "every link of a kind is rendered, not just the first",
  linkBlock !== null &&
    /r\.links\.filter\(\(l\) => l\.kind === kind\)/.test(linkBlock) &&
    /mine\.map\(/.test(linkBlock),
  "project_link is unique on (project_id, kind, url), NOT (project_id, kind) -- a project may " +
    "legitimately carry two Asana boards, and .find() would silently drop the second",
);

/* -------------------------------------------------------------------- shape */

check(
  "the five columns are generated from the shared LINK_ORDER, not hand-listed",
  linkBlock !== null &&
    /for \(const \[i, kind\] of LINK_ORDER\.entries\(\)\)/.test(projectBlock) &&
    /export const LINK_ORDER/.test(q),
  "hand-listing them lets the columns and the kinds drift; a new kind must appear as a column " +
    "automatically or fail the build",
);

check(
  "each column's header comes from the shared LINK_LABEL map",
  linkBlock !== null && /header: LINK_LABEL\[kind\]/.test(linkBlock),
  "the UI must not invent its own name for a kind",
);

check(
  "each column exports its own CSV column holding the URL",
  linkBlock !== null && /csv: \(r\) =>[\s\S]{0,120}\.map\(\(l\) => l\.url\)/.test(linkBlock),
  "one CSV column per kind, so a spreadsheet can filter on a destination the way the table can",
);

check(
  "the link columns are the last columns in the projects table",
  projectBlock !== null &&
    projectBlock.indexOf("LINK_ORDER.entries()") > projectBlock.indexOf('key: "due"'),
  "they are the row's exits, not its facts -- everything left of the fence describes the project",
);

check(
  "the first link column carries the group fence",
  linkBlock !== null && /i === 0 \? "w-px border-l/.test(linkBlock),
  "without it, a row whose five link cells are all empty reads as the table having run out " +
    "rather than as five honest noes",
);

/* --------------------------------------------- the three columns hitul cut */

for (const gone of ["logged", "budget", "burn"]) {
  check(
    `the projects table no longer carries a ${gone.toUpperCase()} column`,
    projectBlock !== null && !new RegExp(`key: "${gone}"`).test(projectBlock),
    gone === "burn"
      ? "removed on the owner's instruction 2026-09-04"
      : `removed on the owner's instruction 2026-09-04; BUDGET survives on the CUSTOMERS table only`,
  );
}

check(
  "the customers table is untouched by that cut",
  /const customerColumns/.test(tables) &&
    /key: "budget"/.test(tables.slice(tables.indexOf("const customerColumns"))),
  "one row per customer is a roll-up, not 54 rows of the word 'withheld' -- the cut was scoped " +
    "to the projects table on purpose",
);

/* ------------------------------------------------------------ accessibility */

check(
  "outbound links carry rel=noopener noreferrer",
  linkBlock !== null && /target="_blank"[\s\S]{0,80}rel="noopener noreferrer"/.test(linkBlock),
);

check(
  "the accessible name names the project, not just the destination",
  linkBlock !== null && /aria-label=\{[\s\S]{0,200}for \$\{r\.name\}/.test(linkBlock),
  'a screen reader running the page\'s link list would otherwise meet "TrackingTime project" ' +
    "32 times with nothing to tell them apart",
);

check(
  "the glyph itself is never the accessible name",
  linkBlock !== null && /<Icon className="h-4 w-4" \/>/.test(linkBlock) && /aria-hidden/.test(
    readFileSync(join(REPO, "src/components/my-work/link-icons.tsx"), "utf8"),
  ),
);

/* ------------------------------------------- no emoji or unicode glyph chips */

// Printable ASCII plus tab/newline/carriage-return, which are structure rather
// than content. Anything else in this block is a glyph standing in for an icon.
const nonAscii = (linkBlock ?? "").match(/[^\t\n\r\x20-\x7E]/g) ?? [];
check(
  "the link columns use plain ASCII, no emoji or glyphs",
  nonAscii.filter((c) => c !== "—" && c !== "·").length === 0,
  nonAscii.length ? `found: ${[...new Set(nonAscii)].join(" ")}` : "",
);

console.log(failures === 0 ? "\nMY WORK LINKS: OK" : `\nMY WORK LINKS: ${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
