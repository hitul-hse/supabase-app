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
 * IT WAS NOT ONLY THE GATES
 * -------------------------
 * The same defect was sitting in .claude/settings.json, which is committed and
 * shared with the Windows checkout: two PreToolUse hooks invoked
 * "C:/Users/hitul/.local/bin/graphify.EXE", a path that existed on no machine at
 * all -- the binary is at C:/claude/bin. On WSL every Bash, Grep, Read and Glob
 * therefore fired a hook that could not run, and the knowledge graph AGENTS.md
 * tells every session to query first was silently unreachable.
 *
 * That file is not a gate, so scanning the CI chain could never have found it.
 * Config that names a binary is the same class of error as a gate that names a
 * sibling script, and it fails the same way: on one machine only. So the scan
 * covers both, and the remedy differs by kind -- a script resolves from its own
 * location, a config invokes the tool by NAME and lets PATH answer.
 *
 * Cheap and offline, so it runs in the normal chain.
 */
import { readFileSync, existsSync } from "node:fs";
import { chainFiles, CI_CHAINS } from "./lib/script-files.mjs";

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
// Gate discovery lives in lib/script-files.mjs so every audit sees the same set.

/*
 * COMMITTED config that names an executable or a path. Not settings.local.json:
 * that one is gitignored precisely so a machine can hold its own paths, and
 * failing the build over a file no other machine ever sees would be the noise
 * this gate is scoped to avoid.
 */
const CONFIG_FILES = [".claude/settings.json", ".mcp.json"];

const files = new Set(chainFiles(CI_CHAINS));
const targets = [...files].filter((f) => existsSync(f));
const configs = CONFIG_FILES.filter((f) => existsSync(f));

const offenders = [];
for (const f of [...targets, ...configs]) {
  const lines = readFileSync(f, "utf8").split(/\r?\n/);
  lines.forEach((line, i) => {
    /*
     * Skip comments: explaining this rule necessarily names the path. JSON has
     * no comments, so the skip is confined to the scripts -- a `"command"` value
     * beginning with a slash must never be read as a comment and waved through.
     */
    if (!f.endsWith(".json") && /^\s*(\/\/|\*|\/\*)/.test(line)) return;
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

console.log(
  `check-no-absolute-paths: scanned ${targets.length} gate(s) that CI runs `
  + `and ${configs.length} committed config file(s)\n`,
);

if (offenders.length) {
  console.log(`FAIL: ${offenders.length} absolute path reference(s) — these work on one machine only:\n`);
  for (const o of offenders) console.log(`  ${o.f}:${o.line}\n      ${o.text}`);
  if (offenders.some((o) => !o.f.endsWith(".json"))) {
    console.log("\nIn a script, resolve from the script's own location instead:");
    console.log('  const REPO = fileURLToPath(new URL("..", import.meta.url));');
    console.log('  readFileSync(join(REPO, "src/…"), "utf8")');
  }
  if (offenders.some((o) => o.f.endsWith(".json"))) {
    console.log("\nIn committed config, name the tool and let PATH answer:");
    console.log('  "command": "graphify hook-guard search"');
    console.log("Put a machine-specific path in .claude/settings.local.json, which is gitignored,");
    console.log("or a shim on PATH — see ~/.local/bin/graphify on the WSL box.");
  }
} else {
  console.log("PASS: no gate or committed config hardcodes a developer-specific absolute path.");
}

process.exit(offenders.length ? 1 : 0);
