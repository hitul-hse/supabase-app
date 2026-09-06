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
import { readFileSync, existsSync } from "node:fs";
import { spawn } from "node:child_process";
import { REPO_ROOT } from "./lib/repo-root.mjs";

// A UTF-8 BOM on package.json is invisible to npm but fatal to JSON.parse, which
// silently killed this whole runner (and with it every gate) until 26 Aug 2026.
// Strip it on read so a text editor saving with a BOM cannot disable the suite.
const pkg = JSON.parse(readFileSync(`${REPO_ROOT}/package.json`, "utf8").replace(/^\uFEFF/, ""));
const chain = pkg.scripts["test:db"];

// The chain is "npm run a && npm run b && ..."
const names = [...chain.matchAll(/npm run ([\w:-]+)/g)].map((m) => m[1]);
console.log(`test:db chains ${names.length} gates; running each independently\n`);

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
