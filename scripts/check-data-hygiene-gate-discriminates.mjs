/*
 * Seam test for check-data-hygiene-page: prove the gate FAILS when the thing it
 * guards is broken.
 *
 * A gate that only ever passes is decoration. This has already caught one of my
 * own gates asserting a constant against itself. So: mutate the page and the
 * query module in ways a careless edit really would, run the gate against each
 * mutation, and require a non-zero exit every time.
 *
 * Every mutation is reverted in a finally block, including on crash.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";

const PAGE = "src/app/(app)/data-hygiene/page.tsx";
const QUERY = "src/lib/queries/data-hygiene.ts";

const MUTATIONS = [
  {
    file: PAGE,
    why: "drops the exec role gate, so any signed-in user reads a whole-company report",
    from: 'await requireProfile("/data-hygiene", ["exec"]);',
    to: 'await requireProfile("/data-hygiene");',
  },
  {
    file: PAGE,
    why: "removes the rule-7 disclosure, so a capped list looks complete",
    from: "showing {shown} of {finding.count}",
    to: "showing {shown} results",
  },
  {
    file: PAGE,
    why: "caches the page, so findings are served stale",
    from: 'export const dynamic = "force-dynamic";',
    to: 'export const revalidate = 3600;',
  },
  {
    file: PAGE,
    why: "sums proven and suspected into one figure, inviting action on a guess",
    from: "value={exactCount}",
    to: "value={exactCount + suspectCount}",
  },
  {
    file: QUERY,
    why: "over-filters the number direction to only DIFFERENT-company cases, hiding real duplicates from the count",
    from: "      if (names.size < 2) continue;",
    to: "      if (names.size < 3) continue;",
  },
  {
    file: QUERY,
    why: "renders empty panels instead of routing zero-result probes to `clean`",
    from: "if (f.count === 0) clean.push(f.title);\n    else findings.push({ ...f, error: null });",
    to: "findings.push({ ...f, error: null });",
  },
  {
    file: QUERY,
    why: "strips the remedy from a finding, leaving a complaint with no stated fix",
    /*
     * Overwrite the real value. A first attempt INSERTED `action: ""` above the
     * genuine key, which JS object-literal semantics then override with the real
     * string -- so the mutation changed nothing and the gate was right to stay
     * green. The mutation was the bug, not the gate.
     */
    from: '"Nobody is accountable for these orders, so nothing routes to a desk when a "\n        + "budget or a deadline moves. Assign a responsible in the source workbook.",',
    to: '"",',
  },
];

let failures = 0;
for (const m of MUTATIONS) {
  const original = readFileSync(m.file, "utf8");
  /*
   * These sources are CRLF. Needles are written with \n for legibility, so match
   * against both. A needle that silently misses would report "anchor not found"
   * -- or worse, in a laxer runner, quietly skip and look like a pass.
   */
  const needle = original.includes(m.from)
    ? m.from
    : original.includes(m.from.replace(/\n/g, "\r\n")) ? m.from.replace(/\n/g, "\r\n") : null;

  if (!needle) {
    console.log(`FAIL: mutation anchor not found in ${m.file} — ${m.why}`);
    console.log(`        looked for: ${JSON.stringify(m.from.slice(0, 70))}`);
    failures += 1;
    continue;
  }
  try {
    // Replace only the FIRST occurrence: a global replace can change unrelated
    // lines and fail the gate for the wrong reason.
    writeFileSync(m.file, original.replace(needle, m.to));
    let exit = 0;
    try {
      execFileSync("node", ["--experimental-strip-types", "scripts/check-data-hygiene-page.mjs"],
        { stdio: "pipe", encoding: "utf8" });
    } catch (e) {
      exit = e.status ?? 1;
    }
    const caught = exit !== 0;
    console.log(`${caught ? "PASS" : "FAIL"}: gate catches — ${m.why}`);
    if (!caught) failures += 1;
  } finally {
    writeFileSync(m.file, original);
  }
}

// Belt and braces: the gate must be green again now everything is reverted.
let cleanExit = 0;
try {
  execFileSync("node", ["--experimental-strip-types", "scripts/check-data-hygiene-page.mjs"],
    { stdio: "pipe", encoding: "utf8" });
} catch (e) { cleanExit = e.status ?? 1; }
console.log(`${cleanExit === 0 ? "PASS" : "FAIL"}: every mutation reverted, gate green again`);
if (cleanExit !== 0) failures += 1;

console.log(failures === 0
  ? `\nGATE DISCRIMINATES: all ${MUTATIONS.length} mutations caught, sources restored`
  : `\n${failures} problem(s) — the gate does not catch everything it claims to`);
process.exit(failures === 0 ? 0 : 1);
