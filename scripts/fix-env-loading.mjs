/*
 * One-off codemod: make every gate load credentials in a way that works on CI.
 *
 * Rewrites the unguarded
 *     const env = {};
 *     for (const line of readFileSync(".env.local", ...)) { ... }
 * into the guarded process.env-first form, and adds existsSync to the node:fs
 * import when it is missing.
 *
 * Deliberately conservative: it only touches files matching the exact known
 * shape, reports anything it cannot rewrite, and never edits a file it did not
 * fully understand. Run once, then delete.
 */
import { readFileSync, writeFileSync } from "node:fs";

const targets = process.argv.slice(2);
if (!targets.length) {
  console.log("usage: node scripts/fix-env-loading.mjs <file>...");
  process.exit(1);
}

const REPLACEMENT = `const env = { ...process.env };
if (existsSync(".env.local")) {
  for (const line of readFileSync(".env.local", "utf8").split(/\\r?\\n/)) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    // Never let a local file override a secret injected by CI.
    if (m && env[m[1]] === undefined) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}`;

let changed = 0;
const skipped = [];

for (const file of targets) {
  let src = readFileSync(file, "utf8");
  const before = src;

  // The exact unguarded shape, allowing for small whitespace/quote variations.
  const re = /const env = \{\};\s*\nfor \(const line of readFileSync\(["']\.env\.local["'], ["']utf8["']\)\.split\(\/\\r\?\\n\/\)\) \{\s*\n\s*const m = \/\^\(\[A-Z0-9_\]\+\)=\(\.\*\)\$\/\.exec\(line\.trim\(\)\);\s*\n\s*if \(m\) env\[m\[1\]\] = m\[2\]\.replace\(\/\^\["'\]\|\["'\]\$\/g, ""\);\s*\n\}/;

  if (!re.test(src)) { skipped.push(`${file}  (did not match the known shape)`); continue; }
  src = src.replace(re, REPLACEMENT);

  // Ensure existsSync is imported from node:fs.
  if (!/existsSync/.test(before.split("\n").filter((l) => /from "node:fs"/.test(l)).join(""))) {
    const imp = /import \{([^}]*)\} from "node:fs";/.exec(src);
    if (!imp) { skipped.push(`${file}  (no node:fs import to extend)`); continue; }
    if (!imp[1].includes("existsSync")) {
      src = src.replace(imp[0], `import {${imp[1].replace(/\s*$/, "")}, existsSync } from "node:fs";`);
    }
  }

  writeFileSync(file, src);
  console.log(`  fixed  ${file}`);
  changed += 1;
}

console.log(`\n${changed} file(s) rewritten`);
if (skipped.length) {
  console.log(`\n${skipped.length} needing manual attention:`);
  for (const s of skipped) console.log(`  ${s}`);
}
