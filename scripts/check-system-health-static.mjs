/**
 * Source-only guardrails for /admin/system-health that a browser cannot see
 * or that a regression could reintroduce without ever failing a render.
 *
 * WHY THESE SPECIFIC CHECKS
 * -------------------------
 * check-system-health-ui.mjs proves the deployed page is honest right now.
 * This gate pins the things that would silently rot the NEXT change to it:
 *
 *   - The permission check is the FIRST thing the page does. This is the one
 *     admin key the schema withholds from every non-exec role by name (see
 *     page.tsx's own doc-comment); a data fetch moved above it would leak
 *     server-side timing/errors to a request that was never authorised.
 *   - `export const dynamic = "force-dynamic"` -- every figure here is "as of
 *     one instant" (page.tsx's own words). A cached render would show a stale
 *     number on the one page whose entire job is to say what is stale.
 *   - src/lib/queries/system-health.ts's own doc-comment records a real
 *     incident: a `Promise.all` fan-out of `db.query`/`attempt()` calls on the
 *     single per-request `pg` Client raced two queries on one connection,
 *     which pg 8.23 already warns about and pg@9 removes outright. Nothing
 *     stops it coming back except a gate that looks for the shape.
 *   - Every user-visible string goes through next-intl's `t(...)`. This repo
 *     ships an EN/DE switcher; a literal string is invisible in German, and
 *     it fails silently -- no error, just a page that looks half-translated.
 *   - No raw #hex colour in the page files -- see check-design-system.mjs's
 *     own incident log for what happens when a colour drifts from its token.
 *   - The five section ids are load-bearing: check-system-health-ui.mjs (and
 *     any future dashboard) selects panels by them.
 *   - drills.ts's one law (src/components/DrillDialog.tsx): a Drill without
 *     `check` cannot be reconciled by the UI gate, so it degrades from
 *     "provable" to "trust me."
 *   - check-health-score.mjs pins the score arithmetic this page renders; its
 *     existence and registration is asserted here so a future refactor cannot
 *     delete it unnoticed.
 *
 * Deliberately independent of check-health-score.mjs (not run from here) --
 * gates that call other gates hide which one actually failed.
 */
import { readFileSync, existsSync } from "node:fs";

let failed = false;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}: ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failed = true;
};

const read = (p) => readFileSync(p, "utf8");
/** Strip comments before asserting -- a rule documented in a comment must not pass by matching the comment. */
const stripComments = (src) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
const readStripped = (p) => stripComments(read(p));

const DIR = "src/app/(app)/admin/system-health/";
const PAGE = `${DIR}page.tsx`;
const VIEW = `${DIR}view.ts`;
const DRILLS = `${DIR}drills.ts`;
const QUERIES = "src/lib/queries/system-health.ts";
const PANELS = ["HealthHero.tsx", "FreshnessPanel.tsx", "EfficiencyPanel.tsx", "SecurityPanel.tsx", "ConsumptionPanel.tsx", "bits.tsx"].map(
  (f) => DIR + f,
);
const PAGE_FILES = [PAGE, VIEW, DRILLS, `${DIR}format.ts`, ...PANELS];

for (const f of PAGE_FILES) check(`${f} exists`, existsSync(f));

// ---------------------------------------------------------------------------
// 1. Permission check is the FIRST await in the page component
// ---------------------------------------------------------------------------
const pageSrc = readStripped(PAGE);
const firstAwait = pageSrc.match(/await\s+[\w.]+\([^)]*\)/);
check(
  "page.tsx's first await is requirePermission(...)",
  firstAwait !== null && /^await\s+requirePermission\(/.test(firstAwait[0]),
  firstAwait ? firstAwait[0] : "no await found",
);
check(
  "the permission checked is PERMISSIONS.ADMIN_ROLES_WRITE",
  /await requirePermission\(\s*"[^"]*",\s*PERMISSIONS\.ADMIN_ROLES_WRITE\s*\)/.test(pageSrc),
);

check(
  '`export const dynamic = "force-dynamic"` is present',
  /export const dynamic = "force-dynamic";/.test(pageSrc),
);

// ---------------------------------------------------------------------------
// 2. No Promise.all fan-out of concurrent db.query / attempt() on one client
// ---------------------------------------------------------------------------
// Heuristic: find every `Promise.all(`, extract its balanced-paren contents,
// and fail if that content contains a `db.query`/`attempt(` call. A
// Promise.all over something else entirely (e.g. Promise.all of plain
// values, or of an unrelated network call) is not what this incident was
// about and is left alone.
const queriesSrc = readStripped(QUERIES);
function balancedCalls(src, marker) {
  const calls = [];
  let i = 0;
  while ((i = src.indexOf(marker, i)) !== -1) {
    let depth = 0;
    let j = i + marker.length - 1; // sits on the opening "("
    for (; j < src.length; j += 1) {
      if (src[j] === "(") depth += 1;
      else if (src[j] === ")") {
        depth -= 1;
        if (depth === 0) break;
      }
    }
    calls.push(src.slice(i, j + 1));
    i = j + 1;
  }
  return calls;
}
const promiseAllCalls = balancedCalls(queriesSrc, "Promise.all(");
const concurrentDbCalls = promiseAllCalls.filter((c) => /db\.query|attempt\(/.test(c));
check(
  "system-health.ts has no Promise.all(...) racing db.query/attempt() on the single connection",
  concurrentDbCalls.length === 0,
  concurrentDbCalls.length ? `${concurrentDbCalls.length} offending Promise.all(...) block(s)` : `${promiseAllCalls.length} Promise.all(...) total, none concurrent-db`,
);

// ---------------------------------------------------------------------------
// 3. Every user-visible label in the panels goes through t(...)
// ---------------------------------------------------------------------------
/**
 * A JSX text node is whatever sits directly between `>` and `<` once
 * comments are stripped. A node of two or more "words" (2+ Latin letters
 * each) that is not itself the call site of t(...) is a literal string that
 * bypasses next-intl -- invisible in German, and invisible to any lint rule
 * that only checks JSX attributes.
 *
 * ALLOWED EXCEPTIONS: none were needed. A pass over page.tsx, view.ts,
 * drills.ts, format.ts and all five panels (plus bits.tsx) found every
 * >=2-word text node already wrapped in {t(...)} or composed from formatted
 * values -- see the run below. If a future change needs an exception (a
 * literal unit like "ms", a punctuation-only separator like " — ", or a
 * brand name), add it here BY NAME with the reason, not as a blanket
 * word-count relaxation.
 */
const JSX_FILES = [PAGE, ...PANELS];
const literalTextHits = [];
for (const f of JSX_FILES) {
  const src = readStripped(f);
  const lines = src.split("\n");
  lines.forEach((line, i) => {
    for (const m of line.matchAll(/>([^<>{}]*?)</g)) {
      const text = m[1].trim();
      const words = text.split(/\s+/).filter((w) => /[A-Za-z]{2,}/.test(w));
      if (words.length >= 2) literalTextHits.push(`${f}:${i + 1}: "${text.slice(0, 60)}"`);
    }
  });
}
check(
  "no JSX text node of >= 2 words bypasses t(...)",
  literalTextHits.length === 0,
  literalTextHits.slice(0, 10).join(" | "),
);

// ---------------------------------------------------------------------------
// 4. Tokens only -- no raw #hex in the page files
// ---------------------------------------------------------------------------
const hexHits = [];
for (const f of PAGE_FILES) {
  const src = readStripped(f);
  const lines = src.split("\n");
  lines.forEach((line, i) => {
    if (/#[0-9a-fA-F]{3,8}\b/.test(line)) hexHits.push(`${f}:${i + 1}: ${line.trim().slice(0, 70)}`);
  });
}
check("no raw #hex colour literal in the page files (var(--token) only)", hexHits.length === 0, hexHits.join(" | "));

// ---------------------------------------------------------------------------
// 5. data-section ids match the fixed list
// ---------------------------------------------------------------------------
const FIXED_SECTIONS = ["score", "freshness", "efficiency", "security", "consumption", "db-error"];
const foundSections = new Set();
for (const f of [PAGE, ...PANELS]) {
  for (const m of readStripped(f).matchAll(/data-section="([^"]+)"/g)) foundSections.add(m[1]);
}
const unknownSections = [...foundSections].filter((s) => !FIXED_SECTIONS.includes(s));
check(
  "every data-section id found is in the fixed list (score, freshness, efficiency, security, consumption, db-error)",
  unknownSections.length === 0,
  unknownSections.length ? `unknown: ${unknownSections.join(", ")}` : [...foundSections].sort().join(", "),
);
// The five always-rendered panels must each be present at least once.
const ALWAYS_RENDERED = ["score", "freshness", "efficiency", "security", "consumption"];
const missingAlways = ALWAYS_RENDERED.filter((s) => !foundSections.has(s));
check("every always-rendered section id is used somewhere", missingAlways.length === 0, missingAlways.join(", "));

// ---------------------------------------------------------------------------
// 6. drills.ts sets `check` on every Drill it builds
// ---------------------------------------------------------------------------
const drillsSrc = readStripped(DRILLS);
const drillFnCount = (drillsSrc.match(/\):\s*Drill\s*\{/g) ?? []).length;
const checkAssignCount = (drillsSrc.match(/\bcheck:\s*"(sum|count|mean)"/g) ?? []).length;
check(
  "drills.ts exports at least one Drill-returning function",
  drillFnCount > 0,
  `${drillFnCount} function(s)`,
);
check(
  "every Drill-returning function sets check on its reconcilable (ok) return",
  checkAssignCount >= drillFnCount,
  `${drillFnCount} function(s), ${checkAssignCount} check: assignment(s)`,
);

// ---------------------------------------------------------------------------
// 7. The health-score gate exists and is registered
// ---------------------------------------------------------------------------
check("scripts/check-health-score.mjs exists", existsSync("scripts/check-health-score.mjs"));
const pkg = read("package.json");
check(
  '"check:health-score" is registered in package.json',
  /"check:health-score":\s*"node scripts\/check-health-score\.mjs"/.test(pkg),
);

console.log(failed ? "\nSYSTEM HEALTH STATIC: FAIL" : "\nSYSTEM HEALTH STATIC: OK");
process.exitCode = failed ? 1 : 0;
