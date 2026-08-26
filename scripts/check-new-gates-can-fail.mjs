/*
 * Meta-gate: do the gates added this session actually FAIL when the thing they
 * describe is broken?
 *
 * The critique that prompted this is fair. Each new gate was written after its
 * fix and then observed to pass. "It passes" is not evidence that it would have
 * caught anything -- a gate asserting `true === true` also passes. A gate whose
 * failure mode is untested is documentation with a green tick.
 *
 * Two of the new gates already carry their own negative controls
 * (check-adr001-rule-discriminates, check-invite-throttle-classification), and
 * check-factorial-identity-migration attacks its constraints directly. This
 * covers the ones that do NOT: it MUTATES the source they read, confirms the gate
 * goes red, and restores the original byte-for-byte.
 *
 * Safety: every mutation is to a file, in a try/finally that restores the exact
 * original bytes, and the restore is verified by hash before exit. No database
 * is touched.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";

const sha = (b) => createHash("sha256").update(b).digest("hex");

const run = (script) => new Promise((resolve) => {
  const p = spawn("node", [script], { cwd: "C:/Supabase", shell: false });
  let out = "";
  p.stdout.on("data", (d) => (out += d));
  p.stderr.on("data", (d) => (out += d));
  p.on("close", (code) => resolve({ code, out }));
  setTimeout(() => { try { p.kill(); } catch {} resolve({ code: -1, out: "(timeout)" }); }, 240000);
});

let failures = 0;
const check = (l, ok, d = "") => { console.log(`${ok ? "PASS" : "FAIL"}: ${l}${d ? `\n        ${d}` : ""}`); if (!ok) failures += 1; };

/**
 * Break `file` by applying `mutate` to its text, assert `script` notices, then
 * restore. The restore is the important part and runs even on a throw.
 *
 * Two modes, because one gate is legitimately red right now:
 *
 *   exit-code mode (default) -- the gate is green, so breaking its subject must
 *     turn it non-zero. The cleanest possible signal.
 *
 *   assertion mode (`assertion:` given) -- the gate is ALREADY red for a known,
 *     separate reason (check-projects-admit-unmeasured stays red until its
 *     migration is pasted). Exit code cannot distinguish "still red for the old
 *     reason" from "red for the new one", so instead require that a SPECIFIC
 *     assertion is PASSing before the mutation and FAILing after. That is a
 *     stronger claim than the exit code anyway.
 */
const provesItCatches = async ({ label, file, script, mutate, expect, assertion }) => {
  const path = `C:/Supabase/${file}`;
  const original = readFileSync(path);
  const before = sha(original);

  const clean = await run(script);

  if (assertion) {
    // The named assertion must currently PASS, or there is nothing to break.
    const passing = clean.out.includes(`PASS: ${assertion}`);
    if (!passing) {
      check(`${label}: baseline has "${assertion}" passing`, false,
        `not found in output; gate exits ${clean.code}`);
      return;
    }
  } else if (clean.code !== 0) {
    check(`${label}: baseline is green`, false,
      `${script} already exits ${clean.code}; use assertion mode for a known-red gate`);
    return;
  }

  try {
    const mutated = mutate(original.toString("utf8"));
    if (mutated === original.toString("utf8")) {
      check(`${label}: the mutation actually changed the file`, false, "mutation was a no-op");
      return;
    }
    writeFileSync(path, mutated);
    const broken = await run(script);

    let caught;
    let detail;
    if (assertion) {
      // The specific assertion must have flipped to FAIL.
      caught = broken.out.includes(`FAIL: ${assertion}`);
      detail = caught
        ? `"${assertion}" flipped PASS -> FAIL`
        : `"${assertion}" did NOT flip. ${broken.out.slice(-260)}`;
    } else {
      caught = broken.code !== 0 && (!expect || expect.test(broken.out));
      detail = caught
        ? `exit ${broken.code} — the gate caught it`
        : `exit ${broken.code} — THE GATE DID NOT NOTICE. ${broken.out.slice(-260)}`;
    }
    check(label, caught, detail);
  } finally {
    writeFileSync(path, original);
    const after = sha(readFileSync(path));
    check(`${label}: ${file} restored byte-for-byte`, after === before,
      after === before ? "" : `HASH MISMATCH — restore ${before} -> ${after}`);
  }
};

console.log("Each case below BREAKS the source a gate reads, and requires the gate to go red.\n");

/* ---------------------------------------------------------------- the pager */

await provesItCatches({
  label: "check-factorial-pager notices if the cursor-cycle guard is removed",
  file: "scripts/lib/factorial.mjs",
  script: "scripts/check-factorial-pager.mjs",
  // Delete the guard that refuses a non-advancing cursor. Without it the endless
  // has_next_page case loops until MAX_PAGES instead of throwing, so the
  // "repeated cursor is fatal" assertions must fail.
  mutate: (s) => s.replace(
    "if (next === cursor || seenCursors.has(next)) {",
    "if (false) {"),
  expect: /did not advance|FAIL/,
});

await provesItCatches({
  label: "check-factorial-pager notices if the envelope check is loosened",
  file: "scripts/lib/factorial.mjs",
  script: "scripts/check-factorial-pager.mjs",
  // Accept a non-array `data`. This is the exact bug that made a Supabase read
  // report "0 members have ever logged time".
  mutate: (s) => s.replace("if (!Array.isArray(data)) {", "if (false) {"),
  expect: /FAIL/,
});

await provesItCatches({
  label: "check-factorial-pager notices if the page cap is changed",
  file: "scripts/lib/factorial.mjs",
  script: "scripts/check-factorial-pager.mjs",
  /*
   * This case FOUND A REAL WEAKNESS on its first run. The gate asserted
   * `r.pages === MAX_PAGES`, comparing the result against the same constant the
   * code under test used, so it stayed green with the cap set to 3. It now
   * asserts the literal 500 and this mutation is caught.
   */
  mutate: (s) => s.replace("export const MAX_PAGES = 500;", "export const MAX_PAGES = 3;"),
  expect: /FAIL/,
});

await provesItCatches({
  label: "check-factorial-pager notices if the page SIZE is changed",
  file: "scripts/lib/factorial.mjs",
  script: "scripts/check-factorial-pager.mjs",
  // Same self-referential trap as MAX_PAGES, on the documented limit of 100.
  // Sending a larger limit is silently capped by the server, so a wrong value
  // here means we page more times than necessary against an API with no
  // documented GET budget.
  mutate: (s) => s.replace("export const MAX_LIMIT = 100;", "export const MAX_LIMIT = 25;"),
  expect: /FAIL/,
});

await provesItCatches({
  label: "check-factorial-pager notices if the classifier starts guessing",
  file: "scripts/lib/factorial.mjs",
  script: "scripts/check-factorial-pager.mjs",
  // Make matching fuzzy by stripping dots from the local part -- Gmail's rule,
  // not an identity rule. ADR-001 forbids exactly this.
  mutate: (s) => s.replace(
    'export const normaliseEmail = (e) => String(e ?? "").trim().toLowerCase();',
    'export const normaliseEmail = (e) => String(e ?? "").trim().toLowerCase().replace(/\\./g, (m, i, str) => str.indexOf("@") > i ? "" : m);'),
  expect: /FAIL/,
});

/* ------------------------------------------------- the honest-nulls importer */

await provesItCatches({
  label: "check-projects-admit-unmeasured notices if the importer reverts to writing 0",
  file: "scripts/import-masterdata-projects.mjs",
  script: "scripts/check-projects-admit-unmeasured.mjs",
  // Restore the original bug: coerce an unmeasured consumed_percent to 0.
  mutate: (s) => s.replace(
    "const consumed = measured && contract ? Math.round((logged / contract) * 100) : null;",
    "const consumed = contract ? Math.round((logged / contract) * 100) : 0;"),
  // Assertion mode: this gate is already red because its migration is unpasted.
  assertion: "the importer does not coerce consumed_percent to 0",
});

await provesItCatches({
  label: "check-projects-admit-unmeasured notices if the measured flag disappears",
  file: "scripts/import-masterdata-projects.mjs",
  script: "scripts/check-projects-admit-unmeasured.mjs",
  mutate: (s) => s.replace("const measured = hits.length === 1;", "const measured = true;"),
  assertion: "the importer distinguishes measured from unmeasured",
});

/* --------------------------------------------------------- the ADR-001 rule */

await provesItCatches({
  label: "check-management-data notices if the trim is removed from the link rule",
  file: "scripts/check-management-data.mjs",
  script: "scripts/check-management-data.mjs",
  // Two TT names carry a leading space. Without the strip, the prefix rule
  // anchors ^ on whitespace and those links read as unlawful again.
  mutate: (s) => s.replace(
    'const strip = (s) => norm(s).replace(/^closed?\\s*:\\s*/, "").replace(/^\\d{5}[_\\s]+/, "").trim();',
    "const strip = (s) => String(s ?? \"\");"),
  expect: /FAIL: every link satisfies/,
});

console.log(failures === 0
  ? "\nEVERY NEW GATE FAILS WHEN ITS SUBJECT BREAKS. They are checks, not decoration."
  : `\n${failures} problem(s) — a gate that cannot fail is not protecting anything`);
process.exit(failures === 0 ? 0 : 1);
