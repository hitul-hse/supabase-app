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
 *
 * NOTE ON ANCHORS. Each `from` is a literal lifted out of the source, so a
 * refactor that renames or reflows the anchored line makes this gate print
 * "mutation anchor not found" and fail. That is deliberate and is the correct
 * failure: an anchor that no longer matches is a mutation that is no longer
 * being applied, and a meta-gate silently testing nothing is worse than one that
 * complains. When you see it, re-point the anchor -- do not delete the mutation.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

const PAGE = "src/app/(app)/data-hygiene/page.tsx";
const QUERY = "src/lib/queries/data-hygiene.ts";

const MUTATIONS = [
  {
    file: PAGE,
    catcher: "live",
    why: "drops the exec role gate, so any signed-in user reads a whole-company report",
    from: 'await requireProfile("/data-hygiene", ["exec"]);',
    to: 'await requireProfile("/data-hygiene");',
  },
  {
    file: PAGE,
    catcher: "live",
    why: "removes the rule-7 disclosure, so a capped list looks complete",
    from: "showing {shown} of {finding.count}",
    to: "showing {shown} results",
  },
  {
    file: PAGE,
    catcher: "live",
    why: "caches the page, so findings are served stale",
    from: 'export const dynamic = "force-dynamic";',
    to: 'export const revalidate = 3600;',
  },
  {
    file: PAGE,
    catcher: "live",
    why: "sums proven and suspected into one figure, inviting action on a guess",
    from: "value={exactCount}",
    to: "value={exactCount + suspectCount}",
  },
  {
    file: QUERY,
    catcher: "live",
    why: "over-filters the number direction to only DIFFERENT-company cases, hiding real duplicates from the count",
    from: "      if (names.size < 2) continue;",
    to: "      if (names.size < 3) continue;",
  },
  {
    file: QUERY,
    catcher: "live",
    why: "removes the `clean` routing entirely, so a zero-result probe renders an empty panel",
    /*
     * Deleting the call, not disabling the condition. `if (false) clean.push(...)`
     * is undetectable today and the gate was right to stay green on it: all seven
     * probes currently fire, so `clean` is empty either way and no runtime
     * observation can distinguish the two. Only the source assertion can, so the
     * mutation has to remove what that assertion looks for.
     */
    from: "if (f.count === 0) clean.push(f.title);\n    else findings.push",
    to: "if (f.count === 0) return;\n    else findings.push",
  },
  {
    file: QUERY,
    catcher: "live",
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
  {
    file: QUERY,
    /*
     * The rows are no longer capped at a sample -- they are paged -- so the
     * sabotage that matters is removing the CLAMP on the page size rather than
     * raising a cap. Note it has to remove the clamp rather than merely raise
     * either constant: `Math.min(MAX, ...)` means changing one of the two
     * numbers alone still yields a bounded page, which is the point of writing
     * it that way and the reason the obvious one-number mutation would have
     * been a false accusation against the gate.
     */
    catcher: "fixture",
    why: "removes the page-size clamp, so `?rows=` can render every row of every finding and blow the scroll budget",
    from: `  const rowsPerPage = Math.min(
    MAX_ROWS_PER_PAGE,
    Math.max(1, Math.floor(options.rowsPerPage ?? DEFAULT_ROWS_PER_PAGE)),
  );`,
    to: "  const rowsPerPage = options.rowsPerPage ?? 500;",
  },
  {
    file: QUERY,
    catcher: "fixture",
    why: "makes the pager serve page 1 whatever page was asked for, so NEXT changes the URL and nothing else",
    from: "    const start = (page - 1) * rowsPerPage;",
    to: "    const start = 0;",
  },
  {
    file: PAGE,
    catcher: "fixture",
    why: "stops the page passing its URL page numbers to the query, pinning every panel to page 1 forever",
    from: "const hygiene = await getDataHygiene(supabase, { pages });",
    to: "const hygiene = await getDataHygiene(supabase);",
  },
  {
    file: PAGE,
    catcher: "fixture",
    why: "drops aria-current from the pager, so a screen reader announces N identical page links",
    from: 'aria-current={current ? "page" : undefined}',
    to: "data-current={current}",
  },
  /*
   * The five below are claim-classification sabotages. Each one WAS a live bug,
   * found by feeding the probes hostile rows; they are pinned here because the
   * first two fix each other's failure mode, so a careless "simplification" of
   * either reintroduces the other.
   */
  {
    file: QUERY,
    catcher: "fixture",
    why: "requires a significant word to be 3+ letters, so a short customer name matches nothing and its account is asserted to carry DIFFERENT COMPANIES",
    from: 'return words.find((w) => !NAME_STOP.has(w)) ?? words[0] ?? "";',
    to: 'return words.find((w) => w.length > 2 && !NAME_STOP.has(w)) ?? "";',
  },
  {
    file: QUERY,
    catcher: "fixture",
    why: "compares raw first words, so two companies sharing a leading article are reported as one company spelled twice",
    from: 'return words.find((w) => !NAME_STOP.has(w)) ?? words[0] ?? "";',
    to: 'return words[0] ?? "";',
  },
  {
    file: QUERY,
    catcher: "fixture",
    why: "lets placeholder-named orders back into the name-conflict heuristic, counting one defect twice",
    from: "      if (PLACEHOLDER_NAMES.has(norm(p.name))) continue;",
    to: "",
  },
  {
    file: QUERY,
    catcher: "fixture",
    why: "lets a negative contract figure cancel real committed hours, so the headline understates unwatched work",
    from: "(sum, p) => sum + Math.max(0, Number(p.contract_hours ?? 0) || 0), 0);",
    to: "(sum, p) => sum + Number(p.contract_hours ?? 0), 0);",
  },
  {
    file: QUERY,
    catcher: "fixture",
    why: "marks every shared account number as serious, so the severity bar stops meaning anything",
    from: "        severe: !sameCompany,",
    to: "        severe: true,",
  },
  {
    file: QUERY,
    catcher: "fixture",
    /*
     * The inverse of every mutation above. Those make the page claim a defect it
     * cannot support; this makes it withhold one, which is the only direction
     * where being wrong looks like good news and therefore the direction nobody
     * reports. Removing the guard is silent in review -- all seven probes still
     * run, every other gate stays green, and the regression appears only for a
     * reader whose grants were never tested.
     */
    why: "drops the empty-read guard, so an order book RLS filtered to nothing renders as a clean bill of health",
    from: "    if (projects.length === 0) {",
    to: "    if (false) {",
  },
];

let failures = 0;

/*
 * TWO gates are under test, not one, and they fail in different circumstances.
 *
 *   live     check-data-hygiene-page.mjs -- recounts against the real order
 *            book, and SKIPs without a service-role key.
 *   fixture  check-data-hygiene-paging.mjs -- drives a synthetic order book and
 *            reads the page source, so it always runs.
 *
 * Each mutation names the gate expected to catch it. That distinction is what
 * makes this meta-gate useful on a laptop: it used to exit early the moment the
 * live gate skipped, so on any machine without credentials -- which is where
 * the code is actually written -- it asserted nothing at all. Now the four
 * fixture-caught mutations are exercised everywhere, and only the live-caught
 * ones are reported as skipped.
 */
const TS = ["--import", "./scripts/ts-resolve.mjs", "--experimental-strip-types"];
const GATES = {
  live: [...TS, "scripts/check-data-hygiene-page.mjs"],
  paging: [...TS, "scripts/check-data-hygiene-paging.mjs"],
  claims: [...TS, "scripts/check-data-hygiene-claims.mjs"],
};
/** The gates that need no credentials, so they run everywhere. */
const FIXTURE_GATES = ["paging", "claims"];

/** Non-zero exit from the named gate, i.e. "this sabotage was noticed". */
function runGate(name) {
  const r = spawnSync("node", GATES[name], { encoding: "utf8" });
  return { exit: r.status ?? 1, out: `${r.stdout ?? ""}${r.stderr ?? ""}` };
}

const liveSkips = /^SKIP/m.test(runGate("live").out);
if (liveSkips) {
  console.log("NOTE: check-data-hygiene-page skips without credentials — its mutations are reported as SKIP,");
  console.log("      not as failures. The fixture gate's mutations still run.\n");
}

for (const m of MUTATIONS) {
  if (m.catcher === "live" && liveSkips) {
    console.log(`SKIP: needs credentials — ${m.why}`);
    continue;
  }
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
    /*
     * Caught by EITHER gate counts. A mutation is a claim about the system, not
     * about one script, and pinning each to a single gate would make an
     * improvement in coverage look like a regression here.
     */
    const byFixture = FIXTURE_GATES.some((g) => runGate(g).exit !== 0);
    const byLive = liveSkips ? false : runGate("live").exit !== 0;
    const caught = byFixture || byLive;
    console.log(`${caught ? "PASS" : "FAIL"}: caught by ${
      [byFixture && "fixture", byLive && "live"].filter(Boolean).join(" + ") || "NOTHING"
    } — ${m.why}`);
    if (!caught) failures += 1;
  } finally {
    writeFileSync(m.file, original);
  }
}

// Belt and braces: both gates must be green again now everything is reverted.
const cleanFixture = FIXTURE_GATES.some((g) => runGate(g).exit !== 0) ? 1 : 0;
const cleanLive = liveSkips ? 0 : runGate("live").exit;
const cleanExit = cleanFixture || cleanLive;
console.log(`${cleanExit === 0 ? "PASS" : "FAIL"}: every mutation reverted, gates green again`);
if (cleanExit !== 0) failures += 1;

const ran = MUTATIONS.filter((m) => !(m.catcher === "live" && liveSkips)).length;
console.log(failures === 0
  ? `\nGATE DISCRIMINATES: all ${ran} exercised mutation(s) caught, sources restored`
  : `\n${failures} problem(s) — the gate does not catch everything it claims to`);
// exitCode, not process.exit(): the Supabase/Playwright clients leave sockets
// open, and exiting on top of them trips a Windows libuv assert under
// contention. See check-data-hygiene-page.mjs for the measured numbers.
process.exitCode = failures === 0 ? 0 : 1;
