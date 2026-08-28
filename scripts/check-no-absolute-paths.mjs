/*
 * Gate: no gate may reference an absolute developer path.
 *
 * WHY THIS EXISTS
 * ---------------
 * Eleven gates read sibling scripts, migrations and components through
 * "C:/Supabase/...", a path that existed on exactly one laptop. They had never
 * worked on CI, and nothing noticed for weeks: gates earlier in the chain
 * crashed on missing credentials first, so the runner never reached them. Each
 * fix revealed the next one, a CI round-trip at a time.
 *
 * Worse, a codemod that matched only quoted strings missed a TEMPLATE LITERAL
 * form -- readFileSync(`C:/Supabase/${f}`) -- which then failed on the very next
 * run. Scanning by line for the path fragment, rather than by a syntax pattern,
 * catches every form: quoted, template, or concatenated.
 *
 * Cheap and offline, so it runs in the normal chain.
 */
import { readFileSync, existsSync } from "node:fs";

/*
 * SCOPE: gates that CI actually runs, not every script in the folder.
 *
 * Scanning all 384 scripts found 197 references. Nearly all are in one-off
 * diagnostics and codemods -- diagnose-*, audit-*, fix-* -- which are run by
 * hand on a developer machine, are never invoked by CI, and are often written
 * to answer a single question and then abandoned. Failing the build over those
 * would be noise, and noise is how a gate earns the right to be ignored.
 *
 * What matters is the chain CI executes. A hardcoded path there is a guaranteed
 * runner failure, and that is exactly how the DB Tests job broke after the
 * credential crashes ahead of it were fixed.
 */
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
const targets = [...files].filter((f) => existsSync(f));

const offenders = [];
for (const f of targets) {
  const lines = readFileSync(f, "utf8").split(/\r?\n/);
  lines.forEach((line, i) => {
    // Skip comments: explaining this rule necessarily names the path.
    if (/^\s*(\/\/|\*|\/\*)/.test(line)) return;
    /*
     * Match the PATH FRAGMENT, not a syntax shape. A codemod that only handled
     * quoted strings missed readFileSync(`C:/Supabase/${f}`) and the next CI run
     * failed on exactly that line.
     */
    if (/[A-Za-z]:[/\\](?:Supabase|Users)/.test(line)) {
      offenders.push({ f, line: i + 1, text: line.trim().slice(0, 110) });
    }
  });
}

console.log(`check-no-absolute-paths: scanned ${targets.length} gate(s) that CI runs\n`);

if (offenders.length) {
  console.log(`FAIL: ${offenders.length} absolute path reference(s) — these work on one machine only:\n`);
  for (const o of offenders) console.log(`  ${o.f}:${o.line}\n      ${o.text}`);
  console.log("\nResolve from the script's own location instead:");
  console.log('  const REPO = fileURLToPath(new URL("..", import.meta.url));');
  console.log('  readFileSync(join(REPO, "src/…"), "utf8")');
} else {
  console.log("PASS: no script hardcodes a developer-specific absolute path.");
}

process.exit(offenders.length ? 1 : 0);
