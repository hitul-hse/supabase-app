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
// So every scripts/**/check-*.mjs must now be referenced by package.json, by a
// workflow, or by scripts/gates/manual.json -- the register of gates CI cannot
// run, which requires a stated reason rather than a bare filename. Unreferenced
// is a FAILURE, and the fix is one of three: chain it, register it with the
// reason it cannot be chained, or delete it and say what supersedes it.
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { chainFiles, CI_CHAINS } from "./lib/script-files.mjs";
import { REPO_ROOT } from "./lib/repo-root.mjs";

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
const allCheckGates = (dir = "scripts") => readdirSync(`${REPO_ROOT}/${dir}`, { withFileTypes: true })
  .flatMap((e) => (e.isDirectory()
    ? allCheckGates(`${dir}/${e.name}`)
    : (/^check-.*\.mjs$/.test(e.name) ? [`${dir}/${e.name}`] : [])));

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

console.log(`\nreachability: ${gates.length} check-*.mjs, ${registered.size} registered as CI-cannot-run\n`);
if (orphans.length) {
  console.log(`REFERENCED BY NOTHING (${orphans.length}) — no npm script, no workflow, no register entry:`);
  for (const o of orphans) console.log(`  ${o}`);
  console.log("\nChain it in package.json, register it in scripts/gates/manual.json with the");
  console.log("reason CI cannot run it, or delete it and name what supersedes it.");
} else {
  console.log("every check-*.mjs is reachable from a chain, a workflow or the register.");
}
if (registryProblems.length) {
  console.log(`\nREGISTER PROBLEMS (${registryProblems.length}):`);
  for (const p of registryProblems) console.log(`  ${p}`);
}

process.exit(unsafe.length || orphans.length || registryProblems.length ? 1 : 0);
