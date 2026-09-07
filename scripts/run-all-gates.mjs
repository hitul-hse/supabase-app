// `npm run test:db` is a single && chain of ~75 gates. The first non-zero exit
// stops it, so a stale failure early in the chain hides every gate after it.
// Today it stopped at permissions-rls, gate 20 of 75, meaning 55 gates have not
// been run at all - and nobody would know, because the output ends in PASS lines.
//
// Run every gate independently and report the true state.
//
// WHAT "TRUE STATE" HAD TO GROW TO MEAN (2026-09-06)
// -------------------------------------------------
// The first version of this file read a gate's exit code and nothing else, so
// it printed `pass` for a gate that exited 0 having asserted NOTHING. That is
// not a hypothetical: check-time-integration.mjs crashed on the next-intl
// components, printed SKIP, exited 0 with zero assertions, and a pull request
// was opened on the resulting green. A runner that cannot tell forty passing
// assertions from none is not reporting the true state; it is laundering
// silence into a tick.
//
// So exit code alone no longer decides. Each gate now ends with
//
//     RESULT pass=<n> fail=<m> notrun=<k>
//
// written by scripts/lib/gate-result.mjs from the gate's own check() calls, and
// this runner classifies on the pair:
//
//   exit 3                     -> NOT RUN. A missing credential or an absent
//                                 build artefact. Reported separately and never
//                                 counted as green -- but not counted as red
//                                 either, because crying wolf on every
//                                 unconfigured environment is how a red suite
//                                 gets ignored.
//   exit 0, no RESULT line     -> RED. The gate does not implement the protocol,
//                                 so its silence cannot be distinguished from a
//                                 pass. This is what a crashed-then-SKIPped gate
//                                 looks like from out here.
//   exit 0, pass=0 fail=0      -> RED, named as "exit 0 with pass=0 fail=0".
//                                 Ran, claimed success, checked nothing.
//   exit 0, pass=0, notrun>0   -> NOT RUN. It declared that it could not run.
//                                 The twenty gates inside the && chain report
//                                 this way, because exiting 3 there would stop
//                                 npm and silence the 114 gates after them.
//   anything else non-zero     -> RED, as before.
//
// The seven scripts registered as diagnostics in scripts/gates/manual.json are
// exempt: they print an explanation rather than a verdict and have no pass or
// fail state to count. check-gates-runnable-on-ci.mjs verifies that exemption
// is still true rather than taking it on trust.
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { spawn } from "node:child_process";
import { REPO_ROOT } from "./lib/repo-root.mjs";

// A UTF-8 BOM on package.json is invisible to npm but fatal to JSON.parse, which
// silently killed this whole runner (and with it every gate) until 26 Aug 2026.
// Strip it on read so a text editor saving with a BOM cannot disable the suite.
const pkg = JSON.parse(readFileSync(`${REPO_ROOT}/package.json`, "utf8").replace(/^\uFEFF/, ""));
const chain = pkg.scripts["test:db"];

// The chain is "npm run a && npm run b && ..."
const allNames = [...chain.matchAll(/npm run ([\w:-]+)/g)].map((m) => m[1]);
// `--only <substring>` narrows the run to matching gate names. It exists so the baseline
// guard below can be exercised on one fast gate instead of a ten-minute suite -- a guard
// nobody can afford to test is a guard nobody has tested.
const onlyAt = process.argv.indexOf("--only");
const only = onlyAt > -1 ? process.argv[onlyAt + 1] : null;
const names = only ? allNames.filter((n) => n.includes(only)) : allNames;
if (only && names.length === 0) {
  console.error(`--only ${only} matched none of the ${allNames.length} gates in test:db`);
  process.exit(2);
}
console.log(only
  ? `test:db chains ${allNames.length} gates; --only ${only} selects ${names.length}\n`
  : `test:db chains ${names.length} gates; running each independently\n`);

const run = (name) => new Promise((resolve) => {
  const t0 = Date.now();
  const p = spawn("npm", ["run", name], { cwd: REPO_ROOT, shell: true });
  let out = "";
  p.stdout.on("data", (d) => (out += d));
  p.stderr.on("data", (d) => (out += d));
  /*
   * The kill timer must be cleared, not merely allowed to fire.
   *
   * It was not, and an unreferenced 600-second timer keeps Node's event loop
   * alive: after the last gate finished, this process sat there doing nothing
   * for up to ten more minutes. That went unnoticed for as long as the suite
   * itself took longer than the timeout to complete, which stopped being true
   * the first time it was pointed at a short chain -- exactly what a negative
   * control does. A runner that hangs when the suite is fast is a runner
   * nobody will use to test the runner.
   */
  let killTimer;
  p.on("close", (code) => {
    clearTimeout(killTimer);
    const fails = [...out.matchAll(/^FAIL:.*$/gm)].map((m) => m[0]);
    // The LAST RESULT line, not the first: a gate that spawns other gates
    // (check-new-gates-can-fail, check-data-hygiene-gate-discriminates) relays
    // their output, and its own verdict is the one written on the way out.
    const lines = [...out.matchAll(/^RESULT pass=(\d+) fail=(\d+) notrun=(\d+)$/gm)];
    const m = lines[lines.length - 1];
    const result = m ? { pass: +m[1], fail: +m[2], notrun: +m[3] } : null;
    resolve({ name, code, ms: Date.now() - t0, fails, result });
  });
  // Playwright gates drive production over the network across ~18 routes twice
  // (desktop + mobile). check:table-scroll-budget legitimately takes ~4m25s, so a
  // 180s cap reported it as red-by-timeout and hid its 3 real assertion failures.
  killTimer = setTimeout(() => { try { p.kill(); } catch {} resolve({ name, code: -1, ms: Date.now() - t0, fails: ["(timeout)"], result: null }); }, 600000);
});

/*
 * Diagnostics are registered by file path and this runner works in npm script
 * names, so match on the basename inside the script body. Deliberately NOT via
 * lib/script-files.mjs: that module reads package.json from the working
 * directory at import time, and this runner is careful to resolve everything
 * from REPO_ROOT so it works from any directory -- which is the whole point of
 * PR #51 and not worth giving back for a tidier lookup.
 */
const REGISTRY = `${REPO_ROOT}/scripts/gates/manual.json`;
const diagnostics = existsSync(REGISTRY)
  ? (JSON.parse(readFileSync(REGISTRY, "utf8")).diagnostics ?? []).map((d) => d.file.split("/").pop())
  : [];
const isDiagnostic = (name) => diagnostics.some((base) => (pkg.scripts[name] ?? "").includes(base));

/*
 * THE ASSERTION BASELINE (2026-09-07)
 * -----------------------------------
 * Classifying on the RESULT line catches a gate that asserts NOTHING. It does not catch a
 * gate that quietly asserts LESS: one whose forty checks become six because a selector
 * stopped matching, a loop lost its input, or an early return skipped the rest. That gate
 * stays green and stays silent, which is this project's most expensive recurring bug wearing
 * a smaller hat.
 *
 * So the count is remembered. scripts/gates/assertion-baseline.json holds the pass+fail total
 * each gate last evaluated; a gate that RAN and now evaluates fewer is red, and says by how
 * much. A gate that did not run is never compared, because zero assertions from a gate that
 * could not start is not a regression -- it is the NOT RUN state, already handled above.
 *
 * When a drop is deliberate, `npm run gates:baseline` rewrites the file. That is the whole
 * escape hatch, and it is deliberately a separate, explicit command: the failure mode this
 * guards against is silence, and a baseline that updated itself on every run would restore it.
 */
const BASELINE = `${REPO_ROOT}/scripts/gates/assertion-baseline.json`;
const baselineFile = existsSync(BASELINE) ? JSON.parse(readFileSync(BASELINE, "utf8")) : {};
const baseline = baselineFile.gates ?? {};
/*
 * A few gates legitimately evaluate a different number of assertions from run to run: a
 * browser gate measures however many routes it reached, so a slow production or a dropped
 * interface changes the count without anything being wrong with the code. Those are named
 * in the file with the reason, never silently omitted, and the runner prints which gates it
 * did not hold to a count. Silence about an exemption is the bug this file exists to prevent.
 */
const unstable = baselineFile.unstable ?? {};
const UPDATE_BASELINE = process.argv.includes("--update-baseline");
/*
 * THE BASELINE IS ENVIRONMENT-SPECIFIC, AND ONLY ONE ENVIRONMENT IS RECORDED.
 *
 * The counts are written on the rig, where live credentials exist and every gate can reach
 * the database and the deployed site. CI has no credentials on purpose, and thirteen gates
 * quietly evaluate fewer assertions there -- test:time-write-path 44 against 50,
 * check:offboarding 53 against 60 -- while still reporting notrun=0. Comparing those
 * numbers across environments produced thirteen red gates on the first CI run of this
 * runner, every one of them a false alarm, which is precisely the crying-wolf failure this
 * suite has already paid for once.
 *
 * So the count is enforced where it was recorded, and CI is told why it is not enforcing.
 * CI still gets the honest half: exit codes and RESULT lines, red for a gate that asserts
 * nothing, NOT RUN for a gate that cannot reach its dependency.
 *
 * Two follow-ups this deliberately does not do: record a second set of counts for the
 * credential-free environment, and fix the thirteen gates that drop assertions in CI
 * without declaring them not-run. The second is the real bug; the first is a workaround.
 */
const ENFORCE_BASELINE = !process.env.CI;

/** GREEN | RED | NOTRUN, plus why, from the exit code and the RESULT line. */
function classify(r) {
  if (r.code === 3) return { state: "NOTRUN", why: "exit 3 — did not run" };
  if (r.code !== 0) return { state: "RED", why: `exit ${r.code}` };
  if (isDiagnostic(r.name)) return { state: "GREEN", why: "diagnostic — reports, does not assert" };
  if (!r.result) return { state: "RED", why: "exit 0 with no RESULT line — it cannot say whether it checked anything" };
  const { pass, fail, notrun } = r.result;
  if (pass === 0 && fail === 0 && notrun === 0) return { state: "RED", why: "exit 0 with pass=0 fail=0" };
  if (pass === 0 && fail === 0) return { state: "NOTRUN", why: `exit 0 with pass=0 notrun=${notrun}` };
  return { state: "GREEN", why: `pass=${pass} fail=${fail} notrun=${notrun}` };
}

const results = [];
for (const n of names) {
  const r = await run(n);
  r.verdict = classify(r);
  // The baseline only speaks about gates that ran: NOT RUN already means "proved nothing".
  if (r.verdict.state !== "NOTRUN" && r.result) {
    const asserted = r.result.pass + r.result.fail;
    const was = ENFORCE_BASELINE && !unstable[n] ? baseline[n] : undefined;
    if (typeof was === "number" && asserted < was) {
      r.verdict = { state: "RED", why: `evaluated ${asserted} assertions where the baseline is ${was} — ${was - asserted} fewer. If that is intended, run: npm run gates:baseline` };
    }
  }
  results.push(r);
  const mark = { GREEN: "pass", RED: "RED ", NOTRUN: "n/r " }[r.verdict.state];
  const counts = r.result ? `  ${r.result.pass}/${r.result.pass + r.result.fail} asserted` : "";
  console.log(`${mark}  ${String(r.ms).padStart(6)}ms  ${n}${counts}${r.fails.length ? `  (${r.fails.length} assertion failures)` : ""}`);
}

const broken = results.filter((r) => r.verdict.state === "RED");
const notrun = results.filter((r) => r.verdict.state === "NOTRUN");
const green = results.length - broken.length - notrun.length;
console.log(`\n${results.length} gates: ${green} green, ${broken.length} red, ${notrun.length} not run\n`);
for (const b of broken) {
  console.log(`RED  ${b.name}  ${b.verdict.why}`);
  for (const f of b.fails.slice(0, 6)) console.log(`     ${f}`);
}
if (notrun.length) {
  console.log(`\nNOT RUN (${notrun.length}) — proved nothing, and are NOT counted as passing:`);
  for (const n of notrun) console.log(`     ${n.name}  ${n.verdict.why}`);
}
const asserted = results.reduce((a, r) => a + (r.result?.pass ?? 0) + (r.result?.fail ?? 0), 0);
console.log(`\n${asserted} assertions actually evaluated across the suite.`);

const idx = names.indexOf(broken[0]?.name);
if (idx >= 0) {
  console.log(`\nFirst red gate is #${idx + 1} of ${names.length}.`);
  console.log(`In the real chain that hides the ${names.length - idx - 1} gates after it.`);
}

if (UPDATE_BASELINE) {
  if (only) {
    console.error("\nRefusing to write the baseline from a --only run: it would erase every gate not selected.");
    process.exitCode = 2;
  } else {
  const gates = {};
  for (const r of results) if (r.verdict.state !== "NOTRUN" && r.result && !unstable[r.name]) gates[r.name] = r.result.pass + r.result.fail;
  const before = Object.keys(baseline).length;
  writeFileSync(BASELINE, `${JSON.stringify({
    _comment: "Assertions each gate last evaluated (pass+fail). run-all-gates.mjs turns a gate RED if it runs and evaluates fewer than this. Rewrite deliberately with `npm run gates:baseline`, never automatically.",
    updated: new Date().toISOString().slice(0, 10),
    unstable,
    gates,
  }, null, 2)}\n`);
  console.log(`\nBaseline written: ${Object.keys(gates).length} gates (was ${before}). Commit scripts/gates/assertion-baseline.json with the change that justified it.`);
  process.exitCode = 0;
  }
} else {
  /*
   * The runner that exists to stop silence reading as success exited 0 with six gates red,
   * every day, until 2026-09-07. Nothing called it, so nothing noticed. It now reports its
   * own verdict the way it demands its gates do: red gates fail, NOT RUN does not -- an
   * unconfigured environment is a fact about the environment, and failing on it is how a
   * red suite gets ignored.
   */
  if (!ENFORCE_BASELINE) {
    console.log("\nAssertion baseline NOT enforced here: it is recorded on a machine with live\ncredentials, and this environment has none, so a lower count is expected rather than a\nregression. Exit codes and RESULT lines are still enforced.");
  }
  const exempt = Object.keys(unstable).filter((n) => names.includes(n));
  if (exempt.length) {
    console.log(`\nNot held to an assertion count (${exempt.length}):`);
    for (const n of exempt) console.log(`     ${n}  ${unstable[n]}`);
  }
  process.exitCode = broken.length > 0 ? 1 : 0;
  console.log(broken.length
    ? `\nVERDICT: FAIL — ${broken.length} gate(s) red${notrun.length ? `, ${notrun.length} not run` : ""}.`
    : `\nVERDICT: PASS — no gate is red${notrun.length ? `, ${notrun.length} not run and counted as proving nothing` : ""}.`);
}
