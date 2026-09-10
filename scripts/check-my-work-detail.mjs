/*
 * Does the My Work detail panel stay inside the contract it was built under?
 *
 * The masterdata sheet's 27 purple columns (HSEHU-64) reach /my-work through
 * public.project_masterdata and public.project_contact, and they reach the
 * SCREEN through one panel for one selected order -- never through the two
 * tables. Six things hold that shape, in the order they would fail worst:
 *
 * 1. PRIVACY. The two customer contacts are personal data of third parties.
 *    They render in the panel and nowhere else: no list column carries them
 *    and no `Column.csv` exports them. A CSV that quietly grew a phone column
 *    would ship a contact list to every download.
 * 2. WIDTH. The projects table clears 1280px by a few pixels and
 *    check-table-scroll-budget pins /my-work on FIRST LOAD. So the panel is a
 *    separate file, a sibling Card, and it renders ONLY once a row is
 *    selected -- with nothing selected the wrapper is a plain column and the
 *    table is byte-identical to before. And the column set of both tables is
 *    pinned: the purple fields must not creep back in as columns.
 * 3. PAGING. The three new reads are paged like every other read here:
 *    `.order()` before `.range()` so the pages partition stably, and wrapped
 *    in try/catch so losing a table costs the panel, not the list.
 * 4. HONESTY. `lifecycle_status = 'historical'` (the sheet stopped carrying
 *    the row; never deleted, decision 2026-09-10) raises a banner that says
 *    WHICH kind of historical, from contract_end -- the contract ran out, or
 *    the row vanished while it ran.
 * 5. LANGUAGE. Every new string goes through the `myWork.detail` branch, present
 *    in both catalogues with the same key set. German is the primary UI
 *    language; a key present in one catalogue only renders its own path to
 *    half the company (the failure check-i18n-key-references was written for).
 * 6. BUDGETS. The panel never touches the raw contract figure: it receives the
 *    string the tables already formatted through hours(), plus the withheld
 *    flag, so the redaction applied at the query cannot be undone here.
 *
 * NEGATIVE CONTROLS at the end re-run the load-bearing regexes against
 * deliberately broken inputs and fail if any of them still passes. A gate
 * nobody has seen go red is a gate nobody knows the meaning of.
 *
 * Static and offline: it reads source and the two catalogues, so it runs in
 * CI with no secrets and costs a second.
 */
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { record } from "./lib/gate-result.mjs";

const REPO = fileURLToPath(new URL("..", import.meta.url));

let failures = 0;
const check = (l, ok, d = "") => {
  record(ok);
  console.log(`${ok ? "PASS" : "FAIL"}: ${l}${d ? `\n        ${d}` : ""}`);
  if (!ok) failures += 1;
};

const read = (p) => readFileSync(join(REPO, p), "utf8");
/** Comments describe intent; they must never satisfy an assertion about code. */
const stripComments = (src) =>
  src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

const DETAIL = "src/components/my-work/MyWorkDetail.tsx";
const TABLES = "src/components/my-work/MyWorkTables.tsx";
const QUERY = "src/lib/queries/my-work.ts";

check("the panel is its own file", existsSync(join(REPO, DETAIL)), DETAIL);
if (!existsSync(join(REPO, DETAIL))) {
  console.log("\nMY WORK DETAIL: cannot continue without the panel file");
  process.exit(1);
}

const detailRaw = read(DETAIL);
const detail = stripComments(detailRaw);
const tablesRaw = read(TABLES);
const tables = stripComments(tablesRaw);
const query = stripComments(read(QUERY));

const sliceBetween = (src, from, to) => {
  const a = src.indexOf(from);
  if (a === -1) return null;
  const b = src.indexOf(to, a + from.length);
  if (b === -1) return null;
  return src.slice(a, b);
};

/* ---------------------------------------------------------- 1. privacy */

console.log("\n--- 1. contacts render in the panel and nowhere else\n");

const projectBlock = sliceBetween(tables, "const projectColumns", "const customerColumns");
const customerBlock = sliceBetween(tables, "const customerColumns", "const roleChips");
check(
  "both column lists are locatable by their source markers",
  projectBlock !== null && customerBlock !== null,
  "every column assertion below slices on these markers",
);
const columns = `${projectBlock ?? ""}${customerBlock ?? ""}`;

/**
 * Every `csv:` callback in the two column lists, as text. A callback ends at
 * the next column property (`cell:` / `title:` ...) or the closing `},` of
 * its column, whichever comes first, so a multi-line csv body is captured
 * whole rather than cut at its first comma.
 */
const csvBodies = [...columns.matchAll(/csv:\s*\(r\)\s*=>[\s\S]*?(?=\n\s*(?:cell|title|search|compare|className|compact|align|descFirst|header|key):|\n\s*\}\s*[,)])/g)]
  .map((m) => m[0]);
check(
  "the column lists carry csv callbacks to inspect",
  csvBodies.length >= 10,
  `${csvBodies.length} csv callbacks found`,
);
const CONTACT_FIELD = /\bcontacts\b|\.phone\b|\.email\b|\bdetail\b/;
const leakingCsv = csvBodies.filter((b) => CONTACT_FIELD.test(b));
check(
  "no csv callback reads contacts, phone, email or the sheet detail",
  leakingCsv.length === 0,
  leakingCsv.length ? leakingCsv.map((b) => b.replace(/\s+/g, " ").slice(0, 80)).join(" | ") : "personal data never enters the export",
);
check(
  "no list column renders contacts, phone, email or the sheet detail",
  !CONTACT_FIELD.test(columns),
  "the two tables must stay column-for-column what they were; the panel is the only surface",
);
check(
  "the panel is not itself a DataTable and exports no csv",
  !/DataTable|csv:/.test(detail),
);
check(
  "the panel renders the contacts (they exist to be shown, once)",
  /contacts\.map\(/.test(detail) && /href=\{telHref\(c\.phone\)\}/.test(detail) && /href=\{`mailto:\$\{c\.email\}`\}/.test(detail),
  "phone as a tel: link, e-mail as mailto:",
);

/* ------------------------------------------------------------ 2. width */

console.log("\n--- 2. a first load is unchanged; the panel is a sibling, on selection only\n");

check(
  "MyWorkTables imports the panel from its own module rather than defining it inline",
  /import \{ MyWorkDetail \} from "\.\/MyWorkDetail"/.test(tables) && !/function MyWorkDetail/.test(tables),
);
check(
  "the panel mounts only when a row is selected",
  /\{selectedRow \? \(\s*<MyWorkDetail/.test(tables),
  "an unconditional <MyWorkDetail /> would change the first-load layout the scroll-budget gate measures",
);
check(
  "the two-column grid exists only while a row is selected; otherwise a plain column",
  /selectedRow\s*\?\s*"grid [^"]*lg:grid-cols-\[[^"]*\]"\s*:\s*"flex [^"]*flex-col"/.test(tables),
  "the grid must not be the default: it would take width from a table that clears 1280px by a few pixels",
);
check(
  "the selection resolves against the UNFILTERED project list",
  /projects\.find\(\(p\) => p\.id === selectedProject\)/.test(tables),
  "a shared link with ?project= and a role filter must still open the linked project",
);
check(
  "the panel is a Card that sticks beside the list (UI-CONVENTIONS rule 4)",
  /<Card[\s\S]{0,200}className="lg:sticky lg:top-4"/.test(detail),
);
check(
  "the panel is a sibling of the DataTable, not a child of its Card",
  (() => {
    const a = tables.indexOf("<DataTable<MyProject>");
    const close = tables.indexOf("/>", a);
    const b = tables.indexOf("<MyWorkDetail");
    return a > 0 && close > a && b > close;
  })(),
  "Card-in-Card is banned by the design gate; the detail follows the table's closing tag",
);

/**
 * THE COLUMN SETS, PINNED. Every key the two tables carry today, so that none
 * of the sheet's fields can come back as a column without failing here.
 * Link columns are templated from LINK_ORDER and asserted by their template.
 */
// Mixed case: "topRole" is a real key, and a lowercase-only pattern silently
// dropped it -- which is how this gate first reported the customers table one
// column short of itself.
const keysIn = (block) => [...block.matchAll(/key: "([A-Za-z]+)"/g)].map((m) => m[1]).sort();
const PROJECT_KEYS = ["code", "customer", "due", "mine", "project", "role", "service", "status"];
const CUSTOMER_KEYS = ["breakdown", "budget", "customer", "logged", "mine", "services", "topRole"];
check(
  "the projects table carries exactly its pinned columns plus the templated link columns",
  projectBlock !== null &&
    keysIn(projectBlock).join(",") === PROJECT_KEYS.join(",") &&
    /key: `link:\$\{kind\}`/.test(projectBlock),
  projectBlock ? keysIn(projectBlock).join(", ") : "",
);
check(
  "the customers table carries exactly its pinned columns",
  customerBlock !== null && keysIn(customerBlock).join(",") === CUSTOMER_KEYS.join(","),
  customerBlock ? keysIn(customerBlock).join(", ") : "",
);

/* ----------------------------------------------------------- 3. paging */

console.log("\n--- 3. the three reads page in order and degrade to the panel, not the list\n");

const fnBody = (name) => {
  const start = query.indexOf(`async function ${name}(`);
  if (start === -1) return null;
  const end = query.indexOf("\n}\n", start);
  return end === -1 ? null : query.slice(start, end);
};
for (const [fn, table, orderCol] of [
  ["fetchMyMasterdata", "project_masterdata", "project_id"],
  ["fetchMyContacts", "project_contact", "project_id"],
  ["fetchPersonNames", "org_chart_nodes", "id"],
]) {
  const body = fnBody(fn);
  check(`${fn} exists`, body !== null);
  check(
    `  ${fn} reads ${table} through the caller's own client, never the service role`,
    body !== null && new RegExp(`\\.from\\("${table}"\\)`).test(body) && !/SERVICE_ROLE/.test(body),
  );
  check(
    `  ${fn} orders before ranging`,
    body !== null &&
      new RegExp(`\\.from\\("${table}"\\)[\\s\\S]{0,260}\\.order\\("${orderCol}"\\)[\\s\\S]{0,120}\\.range\\(`).test(body),
    "an unordered paged read returns an arbitrary partition, not a stable one",
  );
  check(
    `  ${fn} is wrapped in try/catch and degrades to no rows`,
    body !== null && /try \{[\s\S]*\.from\(/.test(body) && /\} catch \{[\s\S]*return \{ rows: \[\], truncated: false \};/.test(body),
    "losing this table must cost the panel, not the list -- contrast fetchMyProjects, which must throw",
  );
  check(
    `  ${fn} chunks its id list`,
    body !== null && /const CHUNK = 200;/.test(body) && /\.in\(/.test(body),
    "a long .in() list risks a 414 that would read as an empty panel",
  );
}
check(
  "names resolve through org_chart_nodes, never public.people",
  /\.from\("org_chart_nodes"\)/.test(query) && !/\.from\("people"\)/.test(query),
  "people is hidden from a non-exec caller by can_view_person(); the identity view is not",
);
check(
  "fetchMyProjects is still NOT caught (losing it must say 'load failed')",
  (() => {
    const body = fnBody("fetchMyProjects");
    return body !== null && !/try \{/.test(body);
  })(),
);
check(
  "assembleMyWork keeps its positional parameters and takes the sheet inputs as ONE trailing options object",
  /canSeeBudgets = true,\s*options: \{\s*masterdata\?: MasterdataRowLite\[\];\s*contacts\?: ContactRowLite\[\];\s*personNames\?: PersonNameRowLite\[\];\s*\} = \{\},\s*\): MyWork/.test(query),
  "check-my-work-scoping calls it with four arguments and must keep type-checking",
);
check(
  "the sheet's fields ride on the row as `detail` and `contacts`",
  /detail: MyProjectDetail \| null;/.test(query) && /contacts: MyContact\[\];/.test(query),
);

/* ---------------------------------------------------------- 4. honesty */

console.log("\n--- 4. historical is a banner, and it says which kind\n");

check(
  "the banner is keyed on lifecycleStatus === 'historical'",
  /detail\.lifecycleStatus === "historical" \?/.test(detail),
);
check(
  "it says whether the contract ended or the row vanished, from contractEnd",
  /contractEnded/.test(detail) &&
    /detail\.contractEnd < todayIso/.test(detail) &&
    /t\("detail\.historical\.ended", \{ date:/.test(detail) &&
    /t\("detail\.historical\.gone"\)/.test(detail),
  "liveness is contract_end, never the sheet's status column",
);
check(
  "the query maps any value other than 'historical' to active (no banner on an unexpected value)",
  /lifecycleStatus: m\.lifecycle_status === "historical" \? "historical" : "active"/.test(query),
);
check(
  "an absent value renders as the house glyph, never 0 or an empty string",
  /const ABSENT = "—";/.test(detail) && /if \(value === null\) return <span[^>]*>\{ABSENT\}<\/span>;/.test(detail),
);
check(
  "a Ja/Nein cell that held free text shows the text, not a guessed boolean",
  /if \(value === true\) return t\("detail\.delivery\.yes"\);[\s\S]{0,120}if \(value === false\) return t\("detail\.delivery\.no"\);[\s\S]{0,40}return text;/.test(detail),
);
check(
  "the empty state is one line when the sheet has no row for the order",
  /detail === null \? \([\s\S]{0,400}t\("detail\.empty"\)/.test(detail),
);

/* --------------------------------------------------------- 5. language */

console.log("\n--- 5. every string goes through myWork.detail, in both catalogues\n");

const cat = Object.fromEntries(
  ["en", "de"].map((l) => [l, JSON.parse(read(`messages/${l}.json`))]),
);
const flatten = (obj, prefix = "", out = []) => {
  for (const [k, v] of Object.entries(obj ?? {})) {
    const path = prefix ? `${prefix}.${k}` : k;
    if (typeof v === "string") out.push(path);
    else if (v && typeof v === "object") flatten(v, path, out);
  }
  return out.sort();
};
const enKeys = flatten(cat.en.myWork?.detail);
const deKeys = flatten(cat.de.myWork?.detail);
check("myWork.detail exists in en.json", enKeys.length > 0, `${enKeys.length} keys`);
check("myWork.detail exists in de.json", deKeys.length > 0, `${deKeys.length} keys`);
check(
  "the two branches hold the same key set",
  enKeys.join("|") === deKeys.join("|"),
  enKeys.join("|") === deKeys.join("|") ? "" : `en: ${enKeys.filter((k) => !deKeys.includes(k)).join(", ")} | de: ${deKeys.filter((k) => !enKeys.includes(k)).join(", ")}`,
);
check(
  "the German branch is German, not a copy of the English",
  enKeys.filter((k) => cat.en.myWork.detail && k !== "language.de" && k !== "language.en" && k !== "service.title" && k !== "links.title").every((k) => {
    const at = (o, p) => p.split(".").reduce((x, s) => x?.[s], o);
    return at(cat.en.myWork.detail, k) !== at(cat.de.myWork.detail, k);
  }),
  "identical strings in both catalogues means one of them was never translated",
);
check(
  "the panel binds useTranslations(\"myWork\")",
  /const t = useTranslations\("myWork"\);/.test(detail),
);
const referenced = [...new Set([...detail.matchAll(/\bt\("detail\.([^"]+)"/g)].map((m) => m[1]))].sort();
const missing = referenced.filter((k) => !enKeys.includes(k));
check(
  "every detail.* key the panel asks for exists in the branch",
  referenced.length >= 25 && missing.length === 0,
  missing.length ? `missing: ${missing.join(", ")}` : `${referenced.length} keys referenced`,
);
const stale = enKeys.filter((k) => !referenced.includes(k));
check(
  "every key in the branch is asked for by the panel (no dead strings)",
  stale.length === 0,
  stale.length ? `unused: ${stale.join(", ")}` : "",
);
/*
 * Rendered English literals in the panel's JSX. A `>Some words<` between tags
 * that is not an expression is a string that bypassed the catalogue. The
 * absence glyph and punctuation-only fragments are structure, not copy.
 */
const literals = [...detail.matchAll(/>\s*([A-Za-z][^<>{}]{2,})\s*</g)].map((m) => m[1].trim());
check(
  "no rendered English literal bypasses the catalogue",
  literals.length === 0,
  literals.length ? literals.join(" | ") : "",
);

/* ---------------------------------------------------------- 6. budgets */

console.log("\n--- 6. contract hours arrive formatted and redacted; the panel cannot undo either\n");

check(
  "the tables pass hours(selectedRow.contractHours) and the withheld flag, not the raw number",
  /contractHours=\{hours\(selectedRow\.contractHours\)\}/.test(tables) && /budgetsWithheld=\{budgetsWithheld\}/.test(tables),
);
check(
  "the panel takes contract hours as a string and never reads contractHours off the row",
  /contractHours: string;/.test(detail) &&
    // The i18n key `detail.service.contractHours` is a label, not a read;
    // strip it before looking for a property access on any object.
    !/[A-Za-z_\]\)]\.contractHours\b/.test(detail.replace(/"detail\.service\.contractHours"/g, "")),
  "a `project.contractHours` here would be a second place to forget the redaction",
);
check(
  "withheld renders as the reader's state, distinct from the absence glyph",
  /budgetsWithheld \? \(\s*<span[^>]*>\{t\("detail\.withheld"\)\}<\/span>/.test(detail),
);

/* --------------------------------------------- the page: design tokens */

console.log("\n--- house tokens\n");

check(
  "the panel sets type through the roles only (no text-[Npx], no Tailwind size utility)",
  !/text-\[\d+(?:\.\d+)?px\]|\btext-(?:xs|sm|base|lg|xl|2xl)\b/.test(detail),
);
check(
  "no hex colour and no var() fallback literal",
  !/#[0-9a-fA-F]{3,8}\b/.test(detail) && !/var\(--[a-z-]+,\s*#/.test(detail),
);
check(
  "no emoji or icon-glyph in the panel (the ABSENT dash and the middle dot are the house punctuation)",
  ([...detail.matchAll(/[^\t\n\r\x20-\x7E]/g)].map((m) => m[0]).filter((c) => c !== "—" && c !== "·")).length === 0,
);
check(
  "the design-system gate owns the panel's type scale",
  /"src\/components\/my-work\/MyWorkDetail\.tsx"/.test(read("scripts/check-design-system.mjs")),
  "SCALE_OWNED / ROLE_ONLY must list the new file the way MyWorkTables.tsx is listed",
);
check(
  "the operations-role gate compares the two new tables for the operations user",
  (() => {
    const ops = read("scripts/check-operations-role.mjs");
    return /project_masterdata: `select/.test(ops) && /project_contact: `select/.test(ops) &&
      /20260910120000_masterdata_sheet_warehouse\.sql/.test(ops);
  })(),
  "operations must read exactly what employee reads on project_masterdata and project_contact",
);

/* ---------------------------------------------- negative controls */

console.log("\n--- negative controls: the load-bearing regexes can go red\n");

{
  const leaky = `csv: (r) => r.contacts.map((c) => c.email).join(" "),\n        cell: (r) => null,`;
  const bodies = [...leaky.matchAll(/csv:\s*\(r\)\s*=>[\s\S]*?(?=\n\s*(?:cell|title):|\n\s*\}\s*[,)])/g)].map((m) => m[0]);
  check(
    "[control] a csv callback that exports contacts WOULD be caught",
    bodies.length === 1 && CONTACT_FIELD.test(bodies[0]),
  );
}
{
  const unconditional = `        />\n        <MyWorkDetail project={row} />`;
  check(
    "[control] an unconditionally mounted panel WOULD be caught",
    !/\{selectedRow \? \(\s*<MyWorkDetail/.test(unconditional),
  );
}
{
  const unordered = `async function fetchMyContacts(\n  try {\n    (supabase as any).from("project_contact").select("x").in("project_id", slice).range(from, to)\n  } catch {\n    return { rows: [], truncated: false };\n  }\n}`;
  check(
    "[control] a read that ranges without ordering WOULD be caught",
    !/\.from\("project_contact"\)[\s\S]{0,260}\.order\("project_id"\)[\s\S]{0,120}\.range\(/.test(unordered),
  );
}
{
  const extraColumn = `${projectBlock ?? ""}\n{ key: "phone", header: "PHONE", csv: (r) => "", cell: (r) => null },`;
  check(
    "[control] a new column on the projects table WOULD be caught",
    keysIn(extraColumn).join(",") !== PROJECT_KEYS.join(","),
  );
}
{
  const half = { a: "x", b: { c: "y" } };
  const whole = { a: "x", b: { c: "y", d: "z" } };
  check(
    "[control] a key present in one catalogue only WOULD be caught",
    flatten(half).join("|") !== flatten(whole).join("|"),
  );
}

console.log(failures === 0 ? "\nMY WORK DETAIL: OK" : `\nMY WORK DETAIL: ${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
