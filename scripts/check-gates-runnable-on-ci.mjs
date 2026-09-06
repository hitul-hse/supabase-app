// Read-only audit of gate REACHABILITY, in two halves.
//
// 1. Which gates in the test:db / CI chains cannot run on CI?
//
// Fixing these one at a time as each CI run reveals the next is slow and leaves
// the suite red meanwhile. This finds all of them in one pass by the property
// that actually matters: does the script read .env.local in a way that THROWS
// when the file is absent, which is always the case on a GitHub runner.
//
// The correct pattern is: seed from process.env, then treat .env.local as an
// optional local convenience guarded by existsSync.
//
// 2. Which gates are reachable from NOTHING?
//
// Added 2026-09-06. Half one asks whether a gate CI runs can run; it never
// asked whether a gate is run at all. Thirty check-*.mjs were named by no npm
// script and no workflow -- a seventh of the suite, including ten that needed
// no credentials and had simply never been wired up. They cost as much to write
// as the rest and were protecting nothing: a gate nobody runs does not fail
// when its subject breaks, it just quietly describes older code, and the first
// person to run it after months of drift cannot tell a real regression from
// rot.
//
// 3. Which gates could report success while asserting nothing?
//
// Added 2026-09-06. Halves one and two ask whether a gate runs. Neither asks
// whether it CHECKED anything once it did. check-time-integration.mjs crashed
// on the next-intl components, printed SKIP, exited 0 with zero assertions, and
// a pull request was opened on that green; check-sync-schedule-alive.mjs, whose
// entire purpose is to notice silence, exited 0 with "SKIP: no .env.local" on
// every runner for nine days. Measured before this section existed: 0 of 207
// gates emitted a machine-readable result and 0 used a distinct "did not run"
// exit code.
//
// So every gate must now import scripts/lib/gate-result.mjs and call record()
// -- which is what makes its RESULT line carry real counts -- and every gate
// that can abort for want of a credential must exit 3 rather than 0. The
// exceptions are diagnostics: scripts named check-* that print an explanation
// rather than a verdict. They are registered in manual.json's "diagnostics"
// list with a reason, and registration is checked, not trusted: a registered
// file that prints PASS or FAIL is a gate hiding in the exemption list and
// fails this audit.
//
// So every scripts/**/check-*.[cm]js must now be referenced by package.json, by a
// workflow, or by scripts/gates/manual.json -- the register of gates CI cannot
// run, which requires a stated reason rather than a bare filename. Unreferenced
// is a FAILURE, and the fix is one of three: chain it, register it with the
// reason it cannot be chained, or delete it and say what supersedes it.
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { chainFiles, CI_CHAINS } from "./lib/script-files.mjs";
import { REPO_ROOT } from "./lib/repo-root.mjs";
import { record } from "./lib/gate-result.mjs";

// Gate discovery lives in lib/script-files.mjs so every audit sees the same set.
const files = new Set(chainFiles(CI_CHAINS));

console.log(`auditing ${files.size} gate file(s) reachable from CI chains\n`);

const unsafe = [];
const safe = [];
for (const f of [...files].sort()) {
  if (!existsSync(f)) { console.log(`  MISSING FILE  ${f}`); continue; }
  const src = readFileSync(f, "utf8");
  if (!src.includes(".env.local")) continue;

  /*
   * Safe means the read cannot throw when the file is absent.
   *
   * The first version of this audit tested only for `existsSync(".env.local")`
   * and a `{ ...process.env }` seed, and reported 17 unsafe gates. Actually
   * running all 17 with the file removed showed only 2 crashed: the rest guard
   * themselves in ways the regex did not recognise (an existsSync on a path
   * variable, a helper that returns null, a try/catch, an early SKIP).
   *
   * A static check that over-reports by 8x trains people to ignore it, so the
   * accepted shapes are broad. The authoritative test is executing the gate with
   * no .env.local present, which is what scripts/check-gates-ci-executable.mjs
   * does; this one is the cheap pre-filter.
   */
  // Importing the shared loader is the canonical guard (scripts/lib/gate-env.mjs
  // walks up with existsSync and never throws), so a gate that uses it must not
  // be reported as a crash just because the existsSync lives in the helper.
  const guarded = /existsSync\(/.test(src)
    || /from "\.\/lib\/gate-env\.mjs"/.test(src)
    || /try\s*\{[\s\S]{0,400}?\.env\.local/.test(src)
    || /function read\b|const read =/.test(src);
  const seedsEnv = /\{\s*\.\.\.process\.env\s*\}/.test(src) || /process\.env\[/.test(src)
    || /loadEnv\(\)/.test(src);

  (guarded ? safe : unsafe).push({ f, guarded, seedsEnv });
}

record(unsafe.length === 0);
if (unsafe.length) {
  console.log(`WILL CRASH ON CI (${unsafe.length}):`);
  for (const u of unsafe) console.log(`  ${u.f}`);
} else {
  console.log("no gate in these chains reads .env.local unguarded.");
}

console.log(`\nsafe (${safe.length}):`);
for (const s of safe) {
  console.log(`  ${s.f}${s.seedsEnv ? "" : "   (guarded, but does not read process.env -- will SKIP on CI rather than run)"}`);
}

/* ------------------------------------------- 2. gates nothing references ---- */

const REGISTRY = "scripts/gates/manual.json";
/*
 * .cjs as well as .mjs. Every sweep in this repo had matched check-*.mjs only,
 * so six CommonJS gates -- check-lint-scope, check-schema-order,
 * check-remote-state, check-agent-claims, check-agent-references,
 * check-approval-error-handling -- were invisible to this audit from the day it
 * was written. test:lint-scope runs in the test:db chain and had never been
 * asked whether it was reachable or whether it asserted anything. It surfaced
 * only when run-all-gates started demanding a RESULT line and reported it red,
 * which is the audit doing its job on the audit.
 */
const allCheckGates = (dir = "scripts") => readdirSync(`${REPO_ROOT}/${dir}`, { withFileTypes: true })
  .flatMap((e) => (e.isDirectory()
    ? allCheckGates(`${dir}/${e.name}`)
    : (/^check-.*\.[cm]js$/.test(e.name) ? [`${dir}/${e.name}`] : [])));

const pkgRaw = readFileSync(`${REPO_ROOT}/package.json`, "utf8");
const workflowDir = `${REPO_ROOT}/.github/workflows`;
const workflows = existsSync(workflowDir)
  ? readdirSync(workflowDir).map((f) => readFileSync(`${workflowDir}/${f}`, "utf8")).join("\n")
  : "";

/*
 * A registered gate must carry its reason. An entry that is only a filename is
 * a suppression, and a suppression list grows until the audit means nothing --
 * which is how the chain-only scope of check-no-absolute-paths ended up
 * certifying a suite that could not start.
 */
const registryProblems = [];
const registered = new Set();
if (existsSync(`${REPO_ROOT}/${REGISTRY}`)) {
  const reg = JSON.parse(readFileSync(`${REPO_ROOT}/${REGISTRY}`, "utf8"));
  for (const entry of reg.gates ?? []) {
    registered.add(entry.file);
    if (!entry.file) registryProblems.push(`an entry has no "file"`);
    else if (!existsSync(`${REPO_ROOT}/${entry.file}`)) registryProblems.push(`${entry.file} is registered but does not exist`);
    if (!entry.why || entry.why.length < 40) registryProblems.push(`${entry.file}: "why" must explain what CI cannot supply`);
    if (!Array.isArray(entry.requires) || !entry.requires.length) registryProblems.push(`${entry.file}: "requires" must name what is absent on a runner`);
    if (!entry.run) registryProblems.push(`${entry.file}: "run" must give the exact command`);
  }
} else {
  registryProblems.push(`${REGISTRY} is missing — it is the only place a gate CI cannot run may be recorded`);
}

const gates = allCheckGates();
const orphans = gates.filter((f) => {
  const base = f.split("/").pop();
  return !pkgRaw.includes(base) && !workflows.includes(base) && !registered.has(f);
});

console.log(`\nreachability: ${gates.length} check-* gate(s), ${registered.size} registered as CI-cannot-run\n`);
record(orphans.length === 0);
record(registryProblems.length === 0);
if (orphans.length) {
  console.log(`REFERENCED BY NOTHING (${orphans.length}) — no npm script, no workflow, no register entry:`);
  for (const o of orphans) console.log(`  ${o}`);
  console.log("\nChain it in package.json, register it in scripts/gates/manual.json with the");
  console.log("reason CI cannot run it, or delete it and name what supersedes it.");
} else {
  console.log("every check-* gate is reachable from a chain, a workflow or the register.");
}
if (registryProblems.length) {
  console.log(`\nREGISTER PROBLEMS (${registryProblems.length}):`);
  for (const p of registryProblems) console.log(`  ${p}`);
}

/* ------------------------------------------ 3. the RESULT-line protocol ---- */

/*
 * A gate proves the protocol by importing the counter and calling it. Reading
 * the source rather than executing it is deliberate: executing 211 gates here
 * would need every credential they need, and the property being checked is
 * static anyway. The cost is that a gate could import record() and never call
 * it -- which is why the call, not just the import, is what is required.
 */
const diagnostics = new Map();
if (existsSync(`${REPO_ROOT}/${REGISTRY}`)) {
  const reg = JSON.parse(readFileSync(`${REPO_ROOT}/${REGISTRY}`, "utf8"));
  for (const d of reg.diagnostics ?? []) diagnostics.set(d.file, d);
}

const chainFileSet = new Set(chainFiles(["test:db"]));
const noResult = [];
const skipsWithExitZero = [];
const chainOnlyOutsideChain = [];
const diagnosticProblems = [];
const fakeDiagnostics = [];

for (const f of gates) {
  const src = readFileSync(`${REPO_ROOT}/${f}`, "utf8");
  /*
   * Require an IMPORT whose binding the file then calls, not merely the text
   * "record(" somewhere in it. This file is the counter-example: it prints the
   * advice "Use notRun(reason) ..." and matches its own naive test, so a gate
   * could satisfy the protocol by mentioning it in a message. Only what is
   * imported can be called, so the binding list is the honest anchor -- and
   * only the text AFTER the import counts, so the import line cannot vouch for
   * itself.
   */
  const importLine = /^import \{([^}]*)\} from "\.\.?\/lib\/gate-result\.mjs";$/m.exec(src)
    // CommonJS gates require() the same ESM module -- Node has allowed that for
    // a module without top-level await since 22.12, and a .cjs twin of the
    // counter would be a second implementation free to drift from the first.
    || /^const \{([^}]*)\} = require\("\.\.?\/lib\/gate-result\.mjs"\);$/m.exec(src);
  const imports = importLine !== null;
  const after = imports ? src.slice(importLine.index + importLine[0].length) : "";
  const bound = imports ? importLine[1].split(",").map((n) => n.trim()).filter(Boolean) : [];
  const callsRecord = bound.some((n) => new RegExp(`\\b${n}\\s*\\(`).test(after));

  if (diagnostics.has(f)) {
    // An exemption must remain true. A "diagnostic" that emits a verdict is a
    // gate, and parking it here would launder the exact silence this section
    // exists to end.
    if (/"PASS"|'PASS'|`PASS|: PASS\b/.test(src) || /"FAIL"|'FAIL'|`FAIL/.test(src)) {
      fakeDiagnostics.push(f);
    }
    continue;
  }

  if (!imports || !callsRecord) { noResult.push(f); continue; }

  /*
   * A gate that aborts on a missing dependency must not exit 0 doing it. The
   * twenty gates inside the test:db && chain are the documented exception --
   * exiting 3 there stops npm and silences the 114 gates after it -- and they
   * say so by calling notRunInChain(). Outside that chain there is no excuse,
   * so a notRunInChain() there is a failure.
   */
  const lines = src.split(/\r?\n/);
  for (let i = 0; i < lines.length; i += 1) {
    if (!/process\.exit\(0\)/.test(lines[i])) continue;
    if (/SKIP/.test(lines.slice(Math.max(0, i - 3), i + 1).join("\n"))) {
      skipsWithExitZero.push(`${f}:${i + 1}`);
    }
  }
  // On the IMPORT, not on a call: `const x = notRunInChain` would slip past a
  // call-site regex, and the one thing this must not be is evadable by
  // renaming. Nothing can be called that was not first imported.
  if (bound.includes("notRunInChain") && !chainFileSet.has(f)) chainOnlyOutsideChain.push(f);
}

for (const [file, d] of diagnostics) {
  if (!existsSync(`${REPO_ROOT}/${file}`)) diagnosticProblems.push(`${file} is registered as a diagnostic but does not exist`);
  if (!d.why || d.why.length < 40) diagnosticProblems.push(`${file}: "why" must explain what it reports instead of a verdict`);
}

console.log(`\nresult protocol: ${gates.length - diagnostics.size} gate(s) must emit RESULT, ${diagnostics.size} registered as diagnostics\n`);

record(noResult.length === 0);
record(skipsWithExitZero.length === 0);
record(chainOnlyOutsideChain.length === 0);
record(fakeDiagnostics.length === 0);
record(diagnosticProblems.length === 0);
if (noResult.length) {
  console.log(`NO RESULT LINE (${noResult.length}) — cannot be told apart from a gate that asserted nothing:`);
  for (const f of noResult) console.log(`  ${f}`);
  console.log("\nImport scripts/lib/gate-result.mjs and call record(ok) from the gate's own");
  console.log("check() helper, or register it in manual.json \"diagnostics\" with the reason");
  console.log("it reports an explanation rather than a verdict.");
}
if (skipsWithExitZero.length) {
  console.log(`\nSKIPS WITH EXIT 0 (${skipsWithExitZero.length}) — a gate that cannot run must not exit 0:`);
  for (const f of skipsWithExitZero) console.log(`  ${f}`);
  console.log("\nUse notRun(reason) from scripts/lib/gate-result.mjs, which exits 3.");
}
if (chainOnlyOutsideChain.length) {
  console.log(`\nnotRunInChain() OUTSIDE THE test:db CHAIN (${chainOnlyOutsideChain.length}):`);
  for (const f of chainOnlyOutsideChain) console.log(`  ${f}`);
  console.log("\nThat helper exists only because && would stop npm mid-chain. Outside the");
  console.log("chain nothing is hidden by exiting 3, so use notRun().");
}
if (fakeDiagnostics.length) {
  console.log(`\nREGISTERED AS A DIAGNOSTIC BUT EMITS A VERDICT (${fakeDiagnostics.length}):`);
  for (const f of fakeDiagnostics) console.log(`  ${f}`);
  console.log("\nIf it prints PASS or FAIL it is a gate. Adopt the protocol or stop printing a verdict.");
}
if (diagnosticProblems.length) {
  console.log(`\nDIAGNOSTIC REGISTER PROBLEMS (${diagnosticProblems.length}):`);
  for (const p of diagnosticProblems) console.log(`  ${p}`);
}
if (!noResult.length && !skipsWithExitZero.length && !chainOnlyOutsideChain.length
  && !fakeDiagnostics.length && !diagnosticProblems.length) {
  console.log("every gate emits a RESULT line from real counts, and none exits 0 on a skip.");
}

const protocolProblems = noResult.length + skipsWithExitZero.length
  + chainOnlyOutsideChain.length + fakeDiagnostics.length + diagnosticProblems.length;

process.exit(unsafe.length || orphans.length || registryProblems.length || protocolProblems ? 1 : 0);
