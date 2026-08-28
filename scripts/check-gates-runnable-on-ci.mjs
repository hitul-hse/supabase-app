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

const pkg = JSON.parse(readFileSync("package.json", "utf8"));

// Expand an npm script into the actual .mjs files it runs, following
// `npm run x && npm run y` chains one level deep.
const scriptFiles = (name, seen = new Set()) => {
  if (seen.has(name)) return [];
  seen.add(name);
  const body = pkg.scripts[name];
  if (!body) return [];
  const out = [];
  for (const part of body.split("&&").map((s) => s.trim())) {
    const run = /^npm run ([\w:-]+)/.exec(part);
    if (run) { out.push(...scriptFiles(run[1], seen)); continue; }
    const file = /(scripts\/[\w./-]+\.(?:mjs|cjs))/.exec(part);
    if (file) out.push(file[1]);
  }
  return out;
};

const CHAINS = ["test:db", "check:profile-rls", "check:password-strength", "check:avatar",
  "check:profile-effective-name", "lint"];

const files = new Set();
for (const c of CHAINS) for (const f of scriptFiles(c)) files.add(f);

console.log(`auditing ${files.size} gate file(s) reachable from CI chains\n`);

const unsafe = [];
const safe = [];
for (const f of [...files].sort()) {
  if (!existsSync(f)) { console.log(`  MISSING FILE  ${f}`); continue; }
  const src = readFileSync(f, "utf8");
  if (!src.includes(".env.local")) continue;

  /*
   * Safe means the read cannot throw when the file is absent. Two accepted
   * shapes: guarded by existsSync, or wrapped in try/catch. Seeding from
   * process.env additionally means CI secrets are actually USED rather than the
   * gate skipping silently, which is weaker but not a crash.
   */
  const guarded = /existsSync\(\s*["']\.env\.local["']\s*\)/.test(src)
    || /try\s*{[^}]*\.env\.local/s.test(src);
  const seedsEnv = /\{\s*\.\.\.process\.env\s*\}/.test(src);

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
