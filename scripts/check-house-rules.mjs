/*
 * The house-rule lint rules, tested against fixtures with known answers.
 *
 * WHY A GATE AND NOT "I RAN IT AND IT LOOKED RIGHT"
 * ------------------------------------------------
 * A static-analysis rule fails in two directions and only one of them is
 * visible. If it stops firing -- a refactor, an AST shape it no longer
 * recognises, a config block someone narrowed -- nothing goes red. The suite
 * simply stops catching the thing it was written for, silently, which is the
 * same "silence read as success" failure that scripts/lib/gate-result.mjs
 * exists to end. So every rule is exercised here against a file whose answer is
 * written down.
 *
 * WHAT IS ASSERTED, PER RULE
 * --------------------------
 *   1. It fires on exactly the lines marked `VIOLATION` in its fixture --
 *      not merely "at least once", and not merely the right COUNT, which a
 *      rule that had drifted to a neighbouring line would still satisfy.
 *   2. The total matches a number held HERE, independently of the markers.
 *      Two statements that must agree: editing the fixture's markers to match
 *      a broken rule then fails on the count, and editing the count then fails
 *      on the lines.
 *   3. It does NOT fire on the lawful constructions in the same file. Every
 *      fixture carries a "must NOT be flagged" half drawn from constructions
 *      that exist in this repo today, and the gate refuses a fixture that has
 *      no such half -- a rule whose boundary is untested is a rule whose
 *      false-positive rate is unknown.
 *
 * SEMGREP
 * -------
 * Two of the eight rules are shell, not JavaScript, and live in .semgrep/.
 * semgrep is not a repo dependency and is not installed on CI, so when it is
 * absent those two assertions are recorded as NOT RUN -- never as passes. The
 * RESULT line then carries notrun=2 and says so out loud.
 *
 * Run: npm run check:house-rules
 */
import { readFileSync, existsSync, mkdirSync, copyFileSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ESLint } from "eslint";
import { REPO_ROOT } from "./lib/repo-root.mjs";
import { record, recordNotRun } from "./lib/gate-result.mjs";
import houseRules from "../eslint-rules/house-rules.mjs";

const FIXTURES = `${REPO_ROOT}/scripts/fixtures/house-rules`;

let failures = 0;
const check = (name, ok, detail = "") => {
  record(ok);
  if (ok) console.log(`PASS | ${name}`);
  else { failures += 1; console.log(`FAIL | ${name}${detail ? ` -- ${detail}` : ""}`); }
  return ok;
};

/* ------------------------------------------------------------------ shared */

/** 1-based line numbers carrying a VIOLATION marker, and the lawful-half size. */
function readFixture(file) {
  const lines = readFileSync(`${FIXTURES}/${file}`, "utf8").split(/\r?\n/);
  const expected = [];
  lines.forEach((l, i) => {
    // The marker must be a trailing comment on a line of CODE, so that a
    // fixture's own prose cannot accidentally declare an expectation.
    if (/(?:\/\/|#)\s*VIOLATION\s*$/.test(l) && !/^\s*(?:\/\/|#|\*)/.test(l)) expected.push(i + 1);
  });
  const lawfulFrom = lines.findIndex((l) => /must NOT be flagged/.test(l));
  const lawfulLines = lawfulFrom === -1 ? 0
    : lines.slice(lawfulFrom).filter((l) => l.trim() && !/^\s*(?:\/\/|#|\*|\/\*)/.test(l)).length;
  return { expected, lawfulLines, total: lines.length };
}

const sameLines = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);

/* ======================================================== the ESLint rules */

/*
 * Each fixture is linted with EXACTLY ONE rule enabled, through a config built
 * here rather than through eslint.config.mjs. Two reasons: the repo config
 * ignores scripts/fixtures/** on purpose (the fixtures are full of deliberate
 * violations and would otherwise be a permanent block of warnings in
 * `npm run lint`), and isolating the rule means a finding cannot come from
 * somewhere else and be mistaken for proof.
 */
const ESLINT_CASES = [
  { rule: "paged-read-needs-order", fixture: "paged-read-needs-order.fixture.mjs", expectedCount: 3 },
  { rule: "honest-nulls-not-zero", fixture: "honest-nulls-not-zero.fixture.mjs", expectedCount: 4 },
  { rule: "no-silent-catch", fixture: "no-silent-catch.fixture.mjs", expectedCount: 2 },
  { rule: "gate-skip-must-not-exit-zero", fixture: "gate-skip-must-not-exit-zero.fixture.mjs", expectedCount: 2 },
  { rule: "no-name-join-across-systems", fixture: "no-name-join-across-systems.fixture.mjs", expectedCount: 3 },
  { rule: "no-machine-absolute-path", fixture: "no-machine-absolute-path.fixture.mjs", expectedCount: 3 },
];

async function runEslintCases() {
  for (const { rule, fixture, expectedCount } of ESLINT_CASES) {
    const path = `${FIXTURES}/${fixture}`;
    if (!check(`${rule}: fixture exists`, existsSync(path), path)) continue;

    const { expected, lawfulLines } = readFixture(fixture);

    const eslint = new ESLint({
      overrideConfigFile: true,
      overrideConfig: [{
        files: ["**/*.mjs"],
        languageOptions: { ecmaVersion: "latest", sourceType: "module" },
        plugins: { house: houseRules },
        rules: { [`house/${rule}`]: "error" },
      }],
    });
    const [result] = await eslint.lintFiles([path]);
    const fatal = result.messages.filter((m) => m.fatal);
    if (!check(`${rule}: fixture parses`, fatal.length === 0,
      fatal.map((m) => `${m.line}: ${m.message}`).join("; "))) continue;

    const got = result.messages
      .filter((m) => m.ruleId === `house/${rule}`)
      .map((m) => m.line)
      .sort((a, b) => a - b);

    check(`${rule}: fires on exactly the ${expected.length} marked line(s)`,
      sameLines(got, expected),
      `expected ${JSON.stringify(expected)}, got ${JSON.stringify(got)}`);

    check(`${rule}: the count matches the number held in this gate (${expectedCount})`,
      got.length === expectedCount,
      `fixture markers say ${expected.length}, rule found ${got.length}, gate expects ${expectedCount}`);

    check(`${rule}: the fixture has a lawful half to prove the negative against`,
      lawfulLines >= 5, `only ${lawfulLines} lines after "must NOT be flagged"`);

    // Stated separately because it is the claim that matters most: the lawful
    // constructions in this fixture produced NO findings.
    const strayInLawfulHalf = got.filter((l) => !expected.includes(l));
    check(`${rule}: no finding on any lawful construction`,
      strayInLawfulHalf.length === 0, `stray finding(s) at line(s) ${strayInLawfulHalf.join(", ")}`);
  }
}

/* ======================================================= the Semgrep rules */

const SEMGREP_CASES = [
  { rule: "house-no-pkill-f", fixture: "no-pkill-f.fixture.sh", expectedCount: 3 },
  { rule: "house-no-silent-stderr-redirect", fixture: "no-silent-stderr-redirect.fixture.sh", expectedCount: 2 },
];

/** semgrep on PATH, or the uv tool shim this rig installs it as. */
function findSemgrep() {
  for (const c of ["semgrep", `${process.env.HOME}/.local/bin/semgrep`]) {
    try {
      execFileSync(c, ["--version"], { stdio: "ignore" });
      return c;
    } catch { /* not this one; try the next candidate */ }
  }
  return null;
}

function runSemgrepCases() {
  const bin = findSemgrep();
  if (!bin) {
    recordNotRun("semgrep is not installed — the two shell rules were not exercised", SEMGREP_CASES.length);
    console.log("NOTRUN: install it with `uv tool install semgrep` to run these locally; the");
    console.log("        PR workflow installs it in its own job.");
    return;
  }

  /*
   * The fixtures are copied into a temp `scripts/` directory before scanning.
   * .semgrep/house-rules.yml excludes `scripts/fixtures/**` on purpose -- so a
   * repo-wide scan does not report the deliberate violations -- and that
   * exclusion applies to a direct scan of the fixture too. Copying them to a
   * path the rules DO include is the only way to exercise the rules exactly as
   * configured, rather than a hand-relaxed copy of them that could drift.
   */
  const tmp = join(tmpdir(), `house-rules-fixtures-${process.pid}`);
  try {
    mkdirSync(join(tmp, "scripts"), { recursive: true });
    for (const { fixture } of SEMGREP_CASES) copyFileSync(`${FIXTURES}/${fixture}`, join(tmp, "scripts", fixture));

    let out;
    try {
      out = execFileSync(bin, [
        "--config", `${REPO_ROOT}/.semgrep`,
        "--metrics=off", "--quiet", "--json", "--no-git-ignore",
        join(tmp, "scripts"),
      ], { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
    } catch (e) {
      check("semgrep ran over the shell fixtures", false, String(e.stderr || e.message).slice(0, 300));
      return;
    }

    const results = JSON.parse(out).results ?? [];
    for (const { rule, fixture, expectedCount } of SEMGREP_CASES) {
      const { expected, lawfulLines } = readFixture(fixture);
      const got = results
        .filter((r) => r.check_id.endsWith(rule) && r.path.endsWith(fixture))
        .map((r) => r.start.line)
        .sort((a, b) => a - b);

      check(`${rule}: fires on exactly the ${expected.length} marked line(s)`,
        sameLines(got, expected),
        `expected ${JSON.stringify(expected)}, got ${JSON.stringify(got)}`);
      check(`${rule}: the count matches the number held in this gate (${expectedCount})`,
        got.length === expectedCount, `rule found ${got.length}`);
      check(`${rule}: the fixture has a lawful half to prove the negative against`,
        lawfulLines >= 4, `only ${lawfulLines} lines after "must NOT be flagged"`);
      const stray = got.filter((l) => !expected.includes(l));
      check(`${rule}: no finding on any lawful construction`,
        stray.length === 0, `stray finding(s) at line(s) ${stray.join(", ")}`);
    }
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

/* ============================================ the wiring is real, not stale */

function checkWiring() {
  const cfg = readFileSync(`${REPO_ROOT}/eslint.config.mjs`, "utf8");
  for (const { rule } of ESLINT_CASES) {
    check(`eslint.config.mjs actually turns on house/${rule}`,
      new RegExp(`["']house/${rule}["']\\s*:\\s*["'](?:warn|error)["']`).test(cfg),
      "the rule exists and is tested, but nothing runs it on src/ or scripts/");
  }
  // The fixtures must stay OUT of the ordinary lint run, or `npm run lint`
  // grows a permanent block of warnings that are not defects -- the exact
  // noise-drowns-signal failure the .next-* ignores were added for.
  check("eslint.config.mjs ignores scripts/fixtures/** in the ordinary run",
    /["']scripts\/fixtures\/\*\*["']/.test(cfg),
    "the deliberate violations would show up in `npm run lint`");

  const sem = readFileSync(`${REPO_ROOT}/.semgrep/house-rules.yml`, "utf8");
  for (const { rule } of SEMGREP_CASES) {
    check(`.semgrep/house-rules.yml defines ${rule}`, sem.includes(`id: ${rule}`));
  }
}

/* ------------------------------------------------------------------- main */

console.log("check-house-rules: the incident-backed lint rules, against fixtures with known answers\n");
await runEslintCases();
console.log("");
runSemgrepCases();
console.log("");
checkWiring();

console.log(`\n${failures ? `${failures} problem(s)` : "every house rule fires where it must and nowhere else"}`);
process.exit(failures ? 1 : 0);
