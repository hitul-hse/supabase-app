// Read-only audit: which gates in the test:db / CI chains cannot run on CI?
//
// Fixing these one at a time as each CI run reveals the next is slow and leaves
// the suite red meanwhile. This finds all of them in one pass by the property
// that actually matters: does the script read .env.local in a way that THROWS
// when the file is absent, which is always the case on a GitHub runner.
//
// The correct pattern is: seed from process.env, then treat .env.local as an
// optional local convenience guarded by existsSync.
import { readFileSync, existsSync } from "node:fs";
import { chainFiles, CI_CHAINS } from "./lib/script-files.mjs";

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
  const guarded = /existsSync\(/.test(src)
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

process.exit(unsafe.length ? 1 : 0);
