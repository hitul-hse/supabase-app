/*
 * Gate: can every CI-chain gate actually RUN on CI?
 *
 * WHY THIS EXISTS
 * ---------------
 * Both the nightly sync workflow and the CI DB Tests job spent over a week red
 * on `ENOENT: no such file or directory, open '.env.local'`. Not one of those
 * failures was a defect in the software being checked. A gate would crash on a
 * missing file before running a single assertion, the job would go red, and the
 * next fix would simply reveal the next gate with the same bug.
 *
 * Static inspection was not good enough: a regex-based audit of the same
 * question reported 17 broken gates when only 2 actually were. The gates guard
 * themselves in many shapes, and reading source cannot reliably tell which ones
 * survive.
 *
 * So this executes them, in a tree with no .env.local, exactly as a runner
 * would. The question is not "does it pass" -- most cannot pass without live
 * credentials, and SKIP is the correct answer there. The question is whether it
 * FAILS FOR THE WRONG REASON: crashing on infrastructure instead of reporting
 * on behaviour.
 *
 * Deliberately not part of test:db: it copies the tree and runs dozens of
 * gates, so it belongs in a pre-push or scheduled check.
 */
import { readFileSync, existsSync, mkdtempSync, cpSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const pkg = JSON.parse(readFileSync("package.json", "utf8"));

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

const files = new Set();
for (const chain of ["test:db", "check:profile-rls", "check:profile-effective-name"]) {
  for (const f of scriptFiles(chain)) files.add(f);
}
// Only gates that mention .env.local can have this failure mode.
const candidates = [...files].filter((f) => existsSync(f) && readFileSync(f, "utf8").includes(".env.local"));

console.log(`check-gates-ci-executable: running ${candidates.length} credential-reading gate(s) with no .env.local\n`);

// Build a CI-shaped copy: the whole tree minus .env.local, with node_modules
// linked rather than copied.
const dir = mkdtempSync(join(tmpdir(), "ci-shape-"));
for (const entry of ["scripts", "src", "supabase", "package.json", "tsconfig.json", "docs"]) {
  if (existsSync(entry)) cpSync(entry, join(dir, entry), { recursive: true });
}
try { symlinkSync(resolve("node_modules"), join(dir, "node_modules"), "junction"); } catch { /* best effort */ }

if (existsSync(join(dir, ".env.local"))) {
  console.log("FAIL: the sandbox contains .env.local, so this proves nothing");
  process.exit(1);
}

const crashed = [];
const fine = [];
for (const f of candidates) {
  const r = spawnSync(process.execPath, [f], {
    cwd: dir,
    encoding: "utf8",
    timeout: 120000,
    // Strip inherited credentials: a developer's shell may already export them,
    // which would mask the very failure this gate looks for.
    env: {
      PATH: process.env.PATH,
      SystemRoot: process.env.SystemRoot,
      NODE_PATH: process.env.NODE_PATH,
    },
  });
  const out = `${r.stdout ?? ""}${r.stderr ?? ""}`;
  // The signature that matters: an unhandled file-not-found for the env file.
  if (/ENOENT[\s\S]*\.env\.local/.test(out) || /Cannot find module/.test(out)) {
    crashed.push({ f, why: /ENOENT/.test(out) ? "ENOENT on .env.local" : "module not found" });
  } else {
    fine.push(f);
  }
}

/*
 * Remove the junction BEFORE the recursive delete.
 *
 * rmSync on a directory containing a Windows junction raises EPERM, and because
 * cleanup ran before the reporting below, the gate died with a stack trace
 * instead of printing its verdict -- an infrastructure crash masking a result,
 * which is the exact failure mode this gate exists to catch. Reporting now
 * happens first, and cleanup is best-effort.
 */
try { rmSync(join(dir, "node_modules"), { recursive: false, force: true }); } catch { /* junction */ }

if (crashed.length) {
  console.log(`FAIL: ${crashed.length} gate(s) crash on infrastructure rather than reporting:\n`);
  for (const c of crashed) console.log(`  ${c.f}  -- ${c.why}`);
  console.log("\nSeed credentials from process.env and treat .env.local as optional:");
  console.log("  import { loadEnv } from \"./lib/gate-env.mjs\";");
  console.log("  const env = loadEnv();");
} else {
  console.log(`PASS: all ${fine.length} gate(s) run to a verdict without .env.local.`);
  console.log("They may SKIP for want of credentials, which is honest; none crash.");
}

try { rmSync(dir, { recursive: true, force: true }); } catch { /* leave the temp dir */ }

process.exit(crashed.length ? 1 : 0);
