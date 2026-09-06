/*
 * Gate: no gate may reference an absolute developer path.
 *
 * WHY THIS EXISTS
 * ---------------
 * Eleven gates read sibling scripts, migrations and components through a
 * drive-letter path that existed on exactly one laptop. They had never worked
 * on CI, and nothing noticed for weeks: gates earlier in the chain crashed on
 * missing credentials first, so the runner never reached them. Each fix
 * revealed the next one, a CI round-trip at a time.
 *
 * Worse, a codemod that matched only quoted strings missed a TEMPLATE LITERAL
 * form -- readFileSync(`<drive>:/repo/${f}`) -- which then failed on the very
 * next run. Scanning by line for the path fragment, rather than by a syntax
 * pattern, catches every form: quoted, template, or concatenated.
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
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { chainFiles, CI_CHAINS } from "./lib/script-files.mjs";
import { REPO_ROOT } from "./lib/repo-root.mjs";

/*
 * SCOPE, AND WHY IT WIDENED ON 2026-09-06
 * ---------------------------------------
 * This gate used to scan only the chain CI executes, on the argument that the
 * one-off diagnostics were noise and "noise is how a gate earns the right to be
 * ignored". That argument was right about noise and wrong about the boundary,
 * and it cost the whole suite.
 *
 * The chain-only scan reported PASS with 150 of the 207 gates still holding the
 * dead drive-letter path, because none of the 150 was reachable from test:db.
 * One of them was scripts/run-all-gates.mjs -- the ONLY thing that runs the
 * suite end to end, and the file this repo's acceptance criteria are read out
 * of. It died on line 13 reading that path's package.json, so on this machine
 * the 207 gates could not be evaluated at all, and the gate whose entire job is
 * to catch that printed a green line.
 *
 * A hardcoded path in a hand-run diagnostic is indeed low stakes. But "is it in
 * a CI chain" turned out to be a bad proxy for "does it matter": a runner, a
 * meta-gate and a pre-push check are none of them in test:db. So the scan now
 * covers every script under scripts/, and the report still names which
 * offenders are in the CI chain so a genuine build-stopper is not buried.
 *
 * The old noise argument no longer applies for a simple reason: the count is
 * zero. Every script in the tree resolves its own root now, so the broad scan
 * has nothing to be noisy about, and the first re-introduction is caught on the
 * commit that makes it rather than the CI run that finally reaches it.
 */
// Chain discovery lives in lib/script-files.mjs so every audit sees the same set.

/*
 * COMMITTED config that names an executable or a path. Not settings.local.json:
 * that one is gitignored precisely so a machine can hold its own paths, and
 * failing the build over a file no other machine ever sees would be the noise
 * this gate is scoped to avoid.
 */
const CONFIG_FILES = [".claude/settings.json", ".mcp.json"];

/** Every .mjs/.cjs under scripts/, as repo-relative paths, from any cwd. */
function allScripts(dir = "scripts") {
  const out = [];
  for (const e of readdirSync(`${REPO_ROOT}/${dir}`, { withFileTypes: true })) {
    if (e.isDirectory()) out.push(...allScripts(`${dir}/${e.name}`));
    else if (/\.(mjs|cjs)$/.test(e.name)) out.push(`${dir}/${e.name}`);
  }
  return out;
}

const chain = new Set(chainFiles(CI_CHAINS));
// The chain set is still asserted on, and is now a labelled subset of the whole
// scripts/ tree rather than the whole scope.
const targets = [...new Set([...chain, ...allScripts()])].filter((f) => existsSync(`${REPO_ROOT}/${f}`));
const configs = CONFIG_FILES.filter((f) => existsSync(`${REPO_ROOT}/${f}`));

const offenders = [];
for (const f of [...targets, ...configs]) {
  const lines = readFileSync(`${REPO_ROOT}/${f}`, "utf8").split(/\r?\n/);
  lines.forEach((line, i) => {
    /*
     * Skip comments: explaining this rule necessarily names the path. JSON has
     * no comments, so the skip is confined to the scripts -- a `"command"` value
     * beginning with a slash must never be read as a comment and waved through.
     */
    if (!f.endsWith(".json") && /^\s*(\/\/|\*|\/\*)/.test(line)) return;
    /*
     * Match the PATH FRAGMENT, not a syntax shape. A codemod that only handled
     * quoted strings missed readFileSync(`<drive>:/repo/${f}`) and the next CI
     * run failed on exactly that line.
     */
    if (/[A-Za-z]:[/\\](?:Supabase|Users)/.test(line)) {
      offenders.push({ f, line: i + 1, text: line.trim().slice(0, 110) });
    }
  });
}

const inChain = targets.filter((f) => chain.has(f)).length;
console.log(
  `check-no-absolute-paths: scanned ${targets.length} script(s) under scripts/ `
  + `(${inChain} of them in a CI chain) and ${configs.length} committed config file(s)\n`,
);

if (offenders.length) {
  const chainOffenders = offenders.filter((o) => chain.has(o.f)).length;
  console.log(`FAIL: ${offenders.length} absolute path reference(s) — these work on one machine only:\n`);
  for (const o of offenders) console.log(`  ${o.f}:${o.line}${chain.has(o.f) ? "  [in a CI chain]" : ""}\n      ${o.text}`);
  if (chainOffenders) console.log(`\n${chainOffenders} of them are in a chain CI executes, so the build is red today.`);
  if (offenders.some((o) => !o.f.endsWith(".json"))) {
    console.log("\nIn a script, resolve from the script's own location instead:");
    console.log('  import { REPO_ROOT } from "./lib/repo-root.mjs";');
    console.log('  readFileSync(`${REPO_ROOT}/src/…`, "utf8")');
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
