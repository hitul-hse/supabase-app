/*
 * Gate: does every script that resolves the repo root actually land on THIS
 * repo?
 *
 * WHY THIS EXISTS
 * ---------------
 * 150 of the 207 gates addressed the repo through a drive-letter path from one
 * laptop, and the codemod that removed it touched 133 files in one pass. A
 * codemod at that scale has to be proved, not spot-checked: an earlier one in
 * this repo rebuilt a list of names from a regex parse, truncated every name at
 * its first digit, and shipped a broken chain that read perfectly in review.
 *
 * check-no-absolute-paths proves the old path is GONE. That is only half the
 * claim. This proves the replacement is RIGHT: the shared helper resolves to
 * the checkout this file is in, every consumer imports it rather than
 * redeclaring it, and every static `${REPO_ROOT}/...` path a script builds
 * still names a file that exists.
 *
 * The third assertion is the one that catches an off-by-one in the "..", which
 * is otherwise invisible: a root one level too high still looks like an
 * absolute path and still starts with a slash.
 *
 * Cheap, offline and read-only, so it runs in the normal chain.
 */
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { REPO_ROOT } from "./lib/repo-root.mjs";

let failures = 0;
const check = (label, ok, detail = "") => {
  // Detail on failure only: a PASS line that also prints the thing it ruled out
  // reads like a finding, and this suite has enough real ones.
  console.log(`${ok ? "PASS" : "FAIL"}: ${label}${!ok && detail ? `\n        ${detail}` : ""}`);
  if (!ok) failures += 1;
};

console.log("check-repo-root-resolves: the helper, its consumers, and the paths they build\n");

/* --------------------------------------------------- 1. the helper itself */

// package.json is the cheapest unambiguous marker of a repo root, and it is
// what run-all-gates.mjs reads on its first working line.
check("REPO_ROOT names a directory holding this repo's package.json",
  existsSync(`${REPO_ROOT}/package.json`) && existsSync(`${REPO_ROOT}/scripts/lib/repo-root.mjs`),
  REPO_ROOT);

/*
 * The specific shape an over-climb produces. "/" holds no package.json on any
 * machine this runs on, so the assertion above already covers it -- but it
 * covers it as "package.json missing", which reads like a broken checkout. Name
 * the real cause separately, because the failure is otherwise diagnosed wrong:
 * a root of "/" still looks absolute, still starts with a separator, and in a
 * deep checkout an over-climb lands on a real directory and hides completely.
 */
check("REPO_ROOT is not the filesystem root",
  REPO_ROOT !== "" && REPO_ROOT !== "/" && !/^[A-Za-z]:\/?$/.test(REPO_ROOT),
  `got ${JSON.stringify(REPO_ROOT)} — the derivation climbed past the checkout`);

check("REPO_ROOT carries no trailing separator",
  !/[\\/]$/.test(REPO_ROOT),
  `a trailing separator silently breaks the f.replace(\`\${REPO_ROOT}/\`, "") idiom — got ${JSON.stringify(REPO_ROOT)}`);

check("REPO_ROOT is the checkout this file lives in",
  import.meta.url.startsWith(new URL("scripts/", `file://${REPO_ROOT}/`).href),
  `${import.meta.url} is not under ${REPO_ROOT}/scripts`);

/*
 * Stop here if the root is wrong. Everything below reads scripts/ through it,
 * so continuing turns a clean verdict into an ENOENT stack trace -- a gate
 * crashing on infrastructure instead of reporting, which is the exact shape
 * check-gates-ci-executable exists to forbid.
 */
if (failures) {
  console.log(`\n${failures} problem(s) — the root itself is wrong, so nothing below can be checked`);
  process.exit(1);
}

/* --------------------------------------------- 2. every consumer, statically */

const allScripts = (dir = "scripts") => readdirSync(`${REPO_ROOT}/${dir}`, { withFileTypes: true })
  .flatMap((e) => (e.isDirectory() ? allScripts(`${dir}/${e.name}`) : (/\.(mjs|cjs)$/.test(e.name) ? [`${dir}/${e.name}`] : [])));

const files = allScripts();
const users = [];
const missingImport = [];
for (const rel of files) {
  const src = readFileSync(`${REPO_ROOT}/${rel}`, "utf8");
  if (!src.includes("REPO_ROOT")) continue;
  users.push(rel);
  // The helper defines it; everyone else must import it rather than re-derive a
  // second, possibly differently-levelled root.
  if (rel === "scripts/lib/repo-root.mjs") continue;
  if (!/import\s*\{[^}]*\bREPO_ROOT\b[^}]*\}\s*from\s*["'][^"']*repo-root\.mjs["']/.test(src)) missingImport.push(rel);
}

check(`all ${users.length - 1} consumer(s) import REPO_ROOT from the shared helper`,
  missingImport.length === 0,
  missingImport.join(", "));

/* ------------------------------------- 3. the paths those consumers build */

/*
 * Only paths whose remainder is STATIC can be resolved here, so the match
 * requires the template literal to CLOSE right after the suffix. `${REPO_ROOT}/${f}`
 * is skipped by design: its target is decided at runtime, and inventing a value
 * for f would be the kind of guess this gate exists to avoid.
 *
 * Comments and console.log lines are skipped too. Both name paths for the
 * reader -- this gate's own advice string suggests `${REPO_ROOT}/src/…` -- and
 * a path being PRINTED is not a path being READ.
 *
 * Some static targets legitimately do not exist yet: screenshots and snapshots
 * a script WRITES. Recognised by extension and by the tmp-/dot prefix the repo
 * already gitignores, so a new one needs no registration here.
 *
 * .env.local is the other kind of legitimate absence, and getting it wrong is
 * what made this gate red on CI while green on every developer machine. It is
 * gitignored, it is absent on every runner ON PURPOSE -- ci.yml says the live
 * credentials "must NOT be added" -- and scripts/lib/gate-env.mjs exists
 * precisely so a gate treats it as optional and SKIPs. Requiring it to exist
 * asserted the opposite of the repo's own doctrine, and it passed locally only
 * because a developer checkout always has one. What this gate is entitled to
 * check is that the PATH is built from a real root, which the assertions above
 * settle; whether the file happens to be present is the caller's business.
 */
const STATIC_PATH = /\$\{REPO_ROOT\}(\/[A-Za-z0-9._\-/()[\] ]*)`/g;
const WRITTEN = /\.(png|jpg|jpeg|json|sql|md|txt)$/;
const OUTPUT_HINT = /^(tmp-|\.)/;
const OPTIONAL_AT_RUNTIME = new Set(["/.env.local"]);

const built = [];
for (const rel of users) {
  for (const line of readFileSync(`${REPO_ROOT}/${rel}`, "utf8").split(/\r?\n/)) {
    if (/^\s*(\/\/|\*|\/\*)/.test(line) || line.includes("console.log(")) continue;
    for (const m of line.matchAll(STATIC_PATH)) {
      const suffix = m[1];
      if (!suffix || suffix === "/") continue;
      built.push({ rel, suffix, optional: OPTIONAL_AT_RUNTIME.has(suffix) });
    }
  }
}

const escaped = built.filter(({ suffix }) => !`${REPO_ROOT}${suffix}`.startsWith(`${REPO_ROOT}/`));
check(`all ${built.length} static \${REPO_ROOT} path(s) stay inside the repo`,
  escaped.length === 0,
  escaped.map((e) => `${e.rel}: ${e.suffix}`).join("\n        "));

const absent = built.filter(({ suffix, optional }) => !optional
  && !existsSync(`${REPO_ROOT}${suffix}`)
  && !(WRITTEN.test(suffix) && OUTPUT_HINT.test(suffix.split("/").pop() ?? "")));

const optionalCount = built.filter((b) => b.optional).length;
check(`every static \${REPO_ROOT} path that names a COMMITTED input resolves to a real file`
  + ` (${built.length - optionalCount} checked, ${optionalCount} runtime-optional)`,
  absent.length === 0,
  // Absolute, not just the suffix: a reviewer reading "-> /.env.local" cannot
  // tell a bad root from a missing file, and that ambiguity already cost one
  // wrong diagnosis of this very gate.
  absent.map((e) => `${e.rel} builds ${REPO_ROOT}${e.suffix}`).join("\n        "));

console.log(failures === 0
  ? `\nThe repo root is derived from the tree, not from a machine. ${users.length - 1} script(s) checked.`
  : `\n${failures} problem(s) — a mis-levelled root looks absolute and still points nowhere`);
process.exit(failures === 0 ? 0 : 1);
