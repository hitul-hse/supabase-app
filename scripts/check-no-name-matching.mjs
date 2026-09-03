/*
 * ADR-001 as a gate on SOURCE: no file under src/ may resolve an identity by
 * name equality.
 *
 * ── The defect this exists to catch ─────────────────────────────────────────
 *
 * src/lib/queries/factorial-hours.ts shipped this line to production:
 *
 *     const m = (f.email ? memberByEmail.get(f.email) : undefined)
 *               ?? memberByName.get(norm(f.fullName));
 *
 * `memberByName` is `new Map(members.map(m => [norm(m.display_name), m]))`. So
 * when the email lookup missed, /operations-analytics decided which colleague's
 * TrackingTime hours belonged to which Factorial attendance record by comparing
 * two display names after lowercasing and collapsing whitespace, and rendered
 * the result as a measured figure about a named person.
 *
 * ADR-001 is not a preference. Name similarity may be SHOWN to a human, who may
 * then record a decision; it may never be ACTED ON by code. The recorded
 * decisions live in crm.factorial_person_reference and crm.factorial_identity_review,
 * and the sync writes them from an exact key. The page ignored all of it.
 *
 * Nothing was red when this shipped. It type-checked, it rendered, and on the
 * live roster the one person it reached by name happened to be the right one —
 * so even a careful reading of the output would not have shown it. That is why
 * the rule has to be enforced on the source text.
 *
 * ── Why this is a separate file from check-adr001-rule-discriminates.mjs ────
 *
 * That gate was read first and is deliberately not extended. It guards a
 * different rule in a different medium: it replays the ORDER-to-TrackingTime-
 * PROJECT name rule from check-management-data.mjs against the LIVE database
 * and proves the rule still rejects wrong pairings. It is about project names,
 * it needs credentials, and its subject is data.
 *
 * This one is about PERSON identity, needs no credentials, and its subject is
 * source code. Folding a static source scan into a live data-rule replay would
 * make one gate that SKIPs without SUPABASE_DB_URL — which is exactly how a
 * source rule stops being enforced on CI. They share the ADR, not a mechanism.
 *
 * ── What is flagged ────────────────────────────────────────────────────────
 *
 *   A. A LOOKUP KEYED ON A NAME.  `map.get(x)` / `map.has(x)` where the
 *      argument reads a name-ish property, AND one of three tells is present:
 *      the receiver is called something-by-name, the argument is wrapped in a
 *      normaliser, or the call sits on the right of `??`/`||` — i.e. it is a
 *      fallback, which is the exact shape the ADR forbids.
 *
 *   B. CROSS-RECORD NAME EQUALITY USED TO SELECT.  Inside `.find`/`.filter`/
 *      `.some`/`.findIndex`/`.findLast`, either `a.name === b.fullName` across
 *      two DIFFERENT base identifiers, or `xs.memberNames.includes(p.name)`.
 *
 * ── What is deliberately NOT flagged, with the live examples ───────────────
 *
 *   Grouping and aggregating BY name is not identity resolution: the key and
 *   the value come from the same record set and no entity crosses a system
 *   boundary. Both live cases pass:
 *
 *     src/lib/queries/data-hygiene.ts        `byName.get(n)!.add(lex)` — counts
 *       Lexware numbers per customer name, to REPORT that a name is split.
 *     src/app/(app)/projects/ProjectsExplorer.tsx  `byName.get(name)` — sums
 *       hours per customer for a filter dropdown.
 *
 *   So is sorting (`localeCompare`), searching a user's typed query, and
 *   rendering a name. The rule keys on the ARGUMENT reading a name-ish property
 *   of a record, which none of those do.
 *
 * ── Discrimination is proved here, not assumed ─────────────────────────────
 *
 * A gate written after its own fix and then observed to pass is documentation
 * with a green tick. So this file ends by running the same rule over a fixture
 * set: eight violations that MUST be caught (including the exact line that
 * shipped) and nine lawful snippets that MUST NOT be. If either half is wrong
 * the gate fails even when src/ is clean.
 *
 * Run: npm run check:no-name-matching
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = fileURLToPath(new URL("..", import.meta.url));
const SRC = join(REPO, "src");

/* ------------------------------------------------------------------ tokens */

/**
 * Property names that carry a human/entity NAME. `name` is included even though
 * it is broad: a lookup keyed on `.name` is the thing being banned, and the
 * tells in rule A are what stop that breadth becoming noise.
 */
const NAME_PROP =
  "(?:full_?name|fullName|display_?name|displayName|person_?name|personName|"
  + "employee_?name|employeeName|member_?name|memberName|customer_?name|customerName|"
  + "legal_?name|legalName|memberNames|names|name|lead)";

/** Calls that exist to make two different spellings compare equal. */
const NORMALISER = "(?:norm|normalise|normalize|normalised|normalized|slug|slugify|canonical|"
  + "toLowerCase|toLocaleLowerCase|trim|strip|head|tokens)";

const SELECTORS = "(?:find|filter|some|findIndex|findLast|findLastIndex|every)";

/* ----------------------------------------------------- comment/string strip */

/**
 * Replace comments and string/template literals with same-length blanks.
 *
 * Not cosmetic: the fix for this defect documents the banned line verbatim in a
 * doc comment, and this gate quotes it too. A scanner that reads prose reports
 * the explanation of a bug as the bug, and the first person to hit that will
 * "fix" it by deleting the explanation.
 *
 * Length and newlines are preserved so reported line numbers stay true.
 *
 * WRITTEN AS A STATE MACHINE ON PURPOSE. The first version of this function
 * handled `${...}` inside a template literal with a `break` out of the wrong
 * loop, desynced on the first interpolation in the file, and blanked everything
 * after it. The gate then reported src/ clean because it was reading 247 files
 * of spaces — including, when it was tested by planting the original defect back
 * into factorial-hours.ts, the planted line itself. A gate cannot be trusted to
 * say "clean" until it has been shown it can still SEE. The canary at the bottom
 * of this file is what caught it and is what keeps catching it.
 */
function blankNonCode(text) {
  const out = text.split("");
  const n = text.length;
  const blank = (a, b) => { for (let k = a; k < b && k < n; k += 1) if (out[k] !== "\n") out[k] = " "; };

  // Template-literal nesting: each entry is the brace depth at which the
  // enclosing template resumes.
  const templates = [];
  let braceDepth = 0;
  let i = 0;
  // Tracks the last significant code character, to tell a regex literal from a
  // division. `a / b` vs `/re/.test(x)`.
  let prevCode = "";

  while (i < n) {
    const c = text[i];
    const d = text[i + 1];

    if (c === "/" && d === "/") {
      let j = i; while (j < n && text[j] !== "\n") j += 1;
      blank(i, j); i = j; continue;
    }
    if (c === "/" && d === "*") {
      let j = i + 2; while (j < n && !(text[j] === "*" && text[j + 1] === "/")) j += 1;
      j = Math.min(n, j + 2); blank(i, j); i = j; continue;
    }
    if (c === "'" || c === '"') {
      let j = i + 1;
      while (j < n && text[j] !== c) { j += text[j] === "\\" ? 2 : 1; }
      blank(i, Math.min(j + 1, n)); i = Math.min(j + 1, n); prevCode = "s"; continue;
    }
    if (c === "`") {
      templates.push(braceDepth);
      // Blank the backtick and run forward until the template ends or an
      // interpolation begins.
      let j = i + 1;
      while (j < n) {
        if (text[j] === "\\") { j += 2; continue; }
        if (text[j] === "`") { blank(i, j + 1); i = j + 1; templates.pop(); prevCode = "s"; break; }
        if (text[j] === "$" && text[j + 1] === "{") {
          blank(i, j);                 // the literal text so far
          i = j + 2;                   // resume as CODE inside ${ }
          braceDepth += 1;
          break;
        }
        j += 1;
      }
      if (j >= n) { blank(i, n); i = n; }
      continue;
    }
    if (c === "{") { braceDepth += 1; i += 1; prevCode = "{"; continue; }
    if (c === "}") {
      braceDepth -= 1;
      // Closing the brace of a ${...} puts us back inside the template literal.
      if (templates.length && braceDepth === templates[templates.length - 1]) {
        let j = i + 1;
        while (j < n) {
          if (text[j] === "\\") { j += 2; continue; }
          if (text[j] === "`") { blank(i, j + 1); i = j + 1; templates.pop(); prevCode = "s"; break; }
          if (text[j] === "$" && text[j + 1] === "{") { blank(i, j); i = j + 2; braceDepth += 1; break; }
          j += 1;
        }
        if (j >= n) { blank(i, n); i = n; }
        continue;
      }
      i += 1; prevCode = "}"; continue;
    }
    if (c === "/" && /[(,=:[!&|?{};+\-*%~^<>]/.test(prevCode)) {
      // A regex literal. Its contents can hold quotes and braces, so skip it
      // whole rather than letting them desync the string states above.
      let j = i + 1; let inClass = false;
      while (j < n) {
        if (text[j] === "\\") { j += 2; continue; }
        if (text[j] === "[") inClass = true;
        else if (text[j] === "]") inClass = false;
        else if (text[j] === "/" && !inClass) break;
        else if (text[j] === "\n") { j = -1; break; }
        j += 1;
      }
      if (j > 0 && j < n) { blank(i, j + 1); i = j + 1; prevCode = "s"; continue; }
    }
    if (!/\s/.test(c)) prevCode = c;
    i += 1;
  }
  return out.join("");
}

/* ------------------------------------------------------------------- rules */

const RE_A_RECEIVER_NAMED = new RegExp(
  String.raw`\b([A-Za-z_$][\w$]*(?:[Bb]y[Nn]ame|[Nn]ame[Mm]ap|[Nn]ames))\s*\.\s*(?:get|has)\s*\(([^()]*(?:\([^()]*\)[^()]*)*)\)`,
  "g",
);
const RE_A_NORMALISED = new RegExp(
  String.raw`\b([A-Za-z_$][\w$]*)\s*\.\s*(?:get|has)\s*\(\s*${NORMALISER}\s*\(([^()]*)\)`,
  "g",
);
/**
 * A name lookup used as a FALLBACK FROM ANOTHER LOOKUP. The left-hand context is
 * required to contain `.get(`/`.has(`/`.find(` for a reason measured on this
 * repo: without it the rule also flagged
 *
 *     f.customers.size === 0 || f.customers.has(p.customerName ?? NO_CUSTOMER)
 *
 * in src/app/(app)/projects/project-insights.ts, which is the customer filter on
 * /projects. That set holds names the USER picked from a dropdown built from the
 * same rows; nothing is resolved and nothing crosses a system boundary, which is
 * precisely the case ADR-001 permits. "We tried a key, then tried a name" is the
 * forbidden shape, and requiring a preceding lookup is what says so.
 */
const RE_A_FALLBACK = new RegExp(
  String.raw`\.\s*(?:get|has|find)\s*\([^;\n]{0,160}?(?:\?\?|\|\|)\s*([A-Za-z_$][\w$.]*)\s*\.\s*(?:get|has)\s*\(([^()]*(?:\([^()]*\)[^()]*)*)\)`,
  "g",
);

/** `map.get(row.fullName.toLowerCase())` — the normaliser trails the name. */
const RE_A_SUFFIX_NORMALISED = new RegExp(
  String.raw`\b([A-Za-z_$][\w$]*)\s*\.\s*(?:get|has)\s*\(\s*[^()]*\.\s*${NAME_PROP}\s*(?:\(\s*\))?\s*\.\s*${NORMALISER}\s*\(`,
  "g",
);
const RE_ARG_READS_NAME = new RegExp(String.raw`\.\s*${NAME_PROP}\b`);

const RE_B_INCLUDES = new RegExp(
  String.raw`\.\s*(?:${NAME_PROP})\s*\.\s*includes\s*\(\s*([A-Za-z_$][\w$]*)\s*\.\s*(?:${NAME_PROP})\s*\)`,
  "g",
);
const RE_B_EQUALITY = new RegExp(
  String.raw`\.\s*${SELECTORS}\s*\(([\s\S]{0,400}?)\)\s*(?:[;,)\]]|$)`,
  "g",
);
const RE_B_PAIR = new RegExp(
  String.raw`(?:${NORMALISER}\s*\(\s*)?([A-Za-z_$][\w$]*)\s*\.\s*(${NAME_PROP})\s*\)?\s*={2,3}\s*`
  + String.raw`(?:${NORMALISER}\s*\(\s*)?([A-Za-z_$][\w$]*)\s*\.\s*(${NAME_PROP})\b`,
  "g",
);

/**
 * Collections built ENTIRELY from string literals — `new Set(["missing", "n/a",
 * "tbd", ...])` and the like. A lookup against one of those classifies a string;
 * it cannot resolve an identity, because there is no record on the other side.
 *
 * Found on the blanked text, which is what makes the test exact rather than a
 * naming convention: string literals have already become spaces, so a
 * literal-only collection has no identifier characters left between its
 * brackets, while one built from data (`new Set(rows.map(r => r.id))`) does.
 *
 * The live case this exists for is `PLACEHOLDER_NAMES.has(norm(p.name))` in
 * src/lib/queries/data-hygiene.ts, which asks "is this order name one of the
 * nine ways people write 'I did not fill this in'". Normalising there is not
 * identity by similarity; it is spelling tolerance on a fixed vocabulary, and
 * the answer is a hygiene finding shown to a human, never a join.
 */
function literalCollections(code) {
  const names = new Set();
  const re = /(?:const|let|var)\s+([A-Za-z_$][\w$]*)[^=\n]*=\s*new\s+(?:Set|Map)\s*\(\s*\[([\s\S]*?)\]\s*\)/g;
  for (const m of code.matchAll(re)) {
    if (!/[A-Za-z_$]/.test(m[2])) names.add(m[1]);
  }
  return names;
}

/**
 * Apply every rule to one file's CODE (comments and strings already blanked).
 * Returns findings as {line, rule, text}.
 */
export function findNameMatching(code) {
  const literal = literalCollections(code);
  const found = [];
  const lineOf = (idx) => code.slice(0, idx).split("\n").length;
  const lineText = (idx) => code.split("\n")[lineOf(idx) - 1].trim();
  const add = (idx, rule, why) => found.push({ line: lineOf(idx), rule, why, text: lineText(idx) });

  for (const m of code.matchAll(RE_A_RECEIVER_NAMED)) {
    if (literal.has(m[1])) continue;
    if (RE_ARG_READS_NAME.test(m[2])) {
      add(m.index, "A", `${m[1]}.get(...) keyed on a name read from a record`);
    }
  }
  for (const m of code.matchAll(RE_A_NORMALISED)) {
    if (literal.has(m[1])) continue;
    if (RE_ARG_READS_NAME.test(m[2])) {
      add(m.index, "A", `${m[1]}.get(<normaliser>(...name...)) — normalising to make two spellings match is identity by similarity`);
    }
  }
  for (const m of code.matchAll(RE_A_FALLBACK)) {
    if (RE_ARG_READS_NAME.test(m[2])) {
      add(m.index, "A", `?? ${m[1]}.get(...name...) — a name lookup used as the FALLBACK from another lookup`);
    }
  }
  for (const m of code.matchAll(RE_A_SUFFIX_NORMALISED)) {
    if (literal.has(m[1])) continue;
    add(m.index, "A", `${m[1]}.get(...name....toLowerCase()) — normalising a name to make it match is identity by similarity`);
  }
  for (const m of code.matchAll(RE_B_INCLUDES)) {
    add(m.index, "B", "a list of names .includes(record.name) — membership decided by name");
  }
  for (const m of code.matchAll(RE_B_EQUALITY)) {
    const body = m[1];
    for (const p of body.matchAll(RE_B_PAIR)) {
      // Same base identifier on both sides is a self-comparison, not a join.
      if (p[1] === p[3]) continue;
      add(m.index + body.indexOf(p[0]), "B",
        `${p[1]}.${p[2]} === ${p[3]}.${p[4]} inside a selector — two records equated by name`);
    }
  }
  return found;
}

/* --------------------------------------------------------------- allow-list */

/**
 * Every entry needs a WRITTEN REASON. An allow-list without reasons becomes a
 * list of things nobody dares remove.
 *
 * Empty today, and that is the point: the one violation that existed is fixed,
 * not excused. If something lands here, the reason must say why a human, not
 * code, is the one acting on the similarity.
 */
const ALLOW = [
  // { file: "src/...", line: 0, reason: "..." },
];

/* ------------------------------------------------------------------- scan */

const walk = (dir) => readdirSync(dir).flatMap((e) => {
  const p = join(dir, e);
  if (statSync(p).isDirectory()) return walk(p);
  return /\.(ts|tsx|mts|cts)$/.test(e) ? [p] : [];
});

let failures = 0;
const check = (label, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}: ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures += 1;
};

const files = walk(SRC).sort();
const violations = [];
for (const abs of files) {
  const rel = relative(REPO, abs).split(sep).join("/");
  const code = blankNonCode(readFileSync(abs, "utf8"));
  for (const f of findNameMatching(code)) {
    if (ALLOW.some((a) => a.file === rel && a.line === f.line)) continue;
    violations.push({ file: rel, ...f });
  }
}

console.log(`check-no-name-matching: ${files.length} files under src/\n`);
check(
  "no file under src/ resolves an identity by name equality (ADR-001)",
  violations.length === 0,
  violations.length ? `${violations.length} violation(s)` : "clean",
);
for (const v of violations) {
  console.log(`        ${v.file}:${v.line}  [rule ${v.rule}] ${v.why}`);
  console.log(`            ${v.text}`);
}

/* ------------------------------------------ the gate must be able to fail */

const MUST_CATCH = [
  ["the exact line that shipped to production",
    "const m = (f.email ? memberByEmail.get(f.email) : undefined) ?? memberByName.get(norm(f.fullName));"],
  ["a name map consulted without any fallback",
    "const hit = memberByName.get(norm(person.fullName));"],
  ["a name map under a different spelling",
    "const hit = personNameMap.get(row.display_name);"],
  ["a normalised name lookup on an innocently-named map",
    "const hit = lookup.get(normalise(employee.full_name));"],
  ["a lowercased name lookup",
    "const hit = index.get(employee.fullName.toLowerCase());"],
  ["|| used as the fallback instead of ??",
    "const m = byEmail.get(e) || byName.get(norm(f.fullName));"],
  ["a find() equating two records by name",
    "const p = people.find((p) => norm(p.name) === norm(f.fullName));"],
  ["a names array deciding membership",
    "const members = people.filter((p) => team.memberNames.includes(p.name));"],
];

const MUST_NOT_CATCH = [
  ["grouping Lexware numbers per customer name (data-hygiene.ts)",
    "const n = norm(p.customer); if (!byName.has(n)) byName.set(n, new Set()); byName.get(n).add(lex);"],
  ["summing hours per customer for a dropdown (ProjectsExplorer.tsx)",
    "const name = p.customerName ?? NO_CUSTOMER; byName.set(name, (byName.get(name) ?? 0) + p.actualHours);"],
  ["sorting by name",
    "people.sort((a, b) => a.name.localeCompare(b.name));"],
  ["a user's typed search over a rendered row",
    "const hits = rows.filter((r) => r.name.toLowerCase().includes(query.toLowerCase()));"],
  ["rendering a name",
    "return <span>{p.name}</span>;"],
  ["comparing a record's name to its own other field",
    "const odd = rows.filter((r) => r.name === r.displayName);"],
  ["an exact-id lookup, which is the lawful shape",
    "const m = memberByPerson.get(identityMap.personByEmployeeId.get(f.factorialId));"],
  ["an id membership test",
    "const members = people.filter((p) => ids.has(p.factorialId));"],
  ["a map keyed on an id even though the value carries a name",
    "const label = nameById.get(row.person_id);"],
  ["the /projects customer filter, where the names came from the user (project-insights.ts)",
    "const matchesCustomer = f.customers.size === 0 || f.customers.has(p.customerName ?? NO_CUSTOMER);"],
  ["a fallback between two ID lookups",
    "const m = byPerson.get(f.personId) ?? byMember.get(f.memberId);"],
  ["classifying a name against a fixed placeholder vocabulary (data-hygiene.ts)",
    'const PLACEHOLDER_NAMES = new Set(["missing", "n/a", "tbd", ""]);\n'
    + "const rows = projects.filter((p) => PLACEHOLDER_NAMES.has(norm(p.name)));"],
];

/*
 * And the literal-collection escape hatch must not be a hole: the same lookup
 * against a collection built from DATA is still a violation.
 */
MUST_CATCH.push([
  "a name set built from another record set, despite an all-caps name",
  'const KNOWN_NAMES = new Set(members.map((m) => norm(m.display_name)));\n'
  + "const hit = KNOWN_NAMES.has(norm(f.fullName));",
]);

console.log("");
let fixtureFailures = 0;
for (const [label, snippet] of MUST_CATCH) {
  const hit = findNameMatching(blankNonCode(snippet)).length > 0;
  console.log(`${hit ? "PASS" : "FAIL"}: catches ${label}`);
  if (!hit) { console.log(`        ${snippet}`); fixtureFailures += 1; }
}
for (const [label, snippet] of MUST_NOT_CATCH) {
  const found = findNameMatching(blankNonCode(snippet));
  console.log(`${found.length === 0 ? "PASS" : "FAIL"}: allows ${label}`);
  if (found.length) { console.log(`        ${snippet}\n        flagged: ${found.map((f) => f.why).join("; ")}`); fixtureFailures += 1; }
}
check(
  `the rule discriminates (${MUST_CATCH.length} violations caught, ${MUST_NOT_CATCH.length} lawful uses allowed)`,
  fixtureFailures === 0,
  fixtureFailures ? `${fixtureFailures} fixture(s) wrong` : "",
);

/* --------------------------------------- the canary: can the gate still SEE? */

/*
 * Snippet fixtures are not enough, and this is not a hypothetical.
 *
 * The first version of this gate passed on src/ while blankNonCode was blanking
 * every file after its first template literal. Planting the original defect back
 * into factorial-hours.ts by hand produced a green run — the gate could not see
 * the line it was written for. Every assertion above was true and the gate was
 * worthless.
 *
 * So the plant happens on every run, against the REAL file, through the REAL
 * pipeline: read the shipped source, splice in the line that shipped in August,
 * and require a hit. If the scanner ever stops seeing code, this goes red rather
 * than the whole gate going quietly green.
 */
const CANARY_FILE = "src/lib/queries/factorial-hours.ts";
const CANARY_ANCHOR = "const m = personId ? memberByPerson.get(personId) : undefined;";
const CANARY_PLANT =
  "const memberByName = new Map(members.map((mm) => [norm(mm.display_name), mm]));\n"
  + "    const m = (personId ? memberByPerson.get(personId) : undefined) ?? memberByName.get(norm(f.fullName));";

const canarySource = readFileSync(join(REPO, CANARY_FILE), "utf8");
check(
  `canary: ${CANARY_FILE} still contains the exact-key join the plant replaces`,
  canarySource.includes(CANARY_ANCHOR),
  canarySource.includes(CANARY_ANCHOR) ? "" : "anchor not found — update CANARY_ANCHOR with the current join",
);
const planted = blankNonCode(canarySource.replace(CANARY_ANCHOR, CANARY_PLANT));
const caught = findNameMatching(planted);
check(
  "canary: planting the August defect back into that real file turns the gate red",
  caught.length > 0,
  caught.length ? caught.map((c) => `line ${c.line} [rule ${c.rule}]`).join(", ") : "NOT CAUGHT — the scanner is blind, not the source clean",
);
check(
  "canary: the shipped file is clean once the plant is removed",
  findNameMatching(blankNonCode(canarySource)).length === 0,
);

/*
 * And a corpus-wide sanity floor. If a future edit to blankNonCode blanks
 * everything again, the canary above catches it — but only for one file. This
 * says the whole scan still has code in it.
 */
const visible = files.reduce((sum, abs) => {
  const raw = readFileSync(abs, "utf8");
  return sum + (blankNonCode(raw).match(/\.\s*(?:get|has|find|filter|map)\s*\(/g)?.length ?? 0);
}, 0);
check(
  "the scan can see code across src/ (method calls survive comment-stripping)",
  visible > 500,
  `${visible} call sites visible`,
);

console.log(failures === 0
  ? "\nADR-001 HOLDS IN SOURCE: no identity is decided by a name"
  : `\n${failures} check(s) failed`);
process.exit(failures === 0 ? 0 : 1);
