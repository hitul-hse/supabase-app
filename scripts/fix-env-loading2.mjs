/*
 * One-off codemod: point CI-chain gates at scripts/lib/gate-env.mjs.
 *
 * Handles the several bespoke shapes that had accumulated, including the
 * Windows-absolute-path variant that can never resolve on a Linux runner.
 * Conservative by design: each file must match exactly one known shape, and
 * anything else is reported rather than guessed at.
 *
 * Run once, then delete.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { relative, dirname } from "node:path";

const targets = process.argv.slice(2);
let changed = 0;
const skipped = [];

// Every known way these files built `env`, each ending in a single binding.
const SHAPES = [
  // const env = Object.fromEntries( readFileSync("<any path>/.env.local"...) ... );
  // Ends at the first ");" that closes fromEntries, which in practice is "}));"
  // or "\n);" depending on whether the last call was a .map arrow.
  /const env = Object\.fromEntries\([\s\S]*?\.env\.local[\s\S]*?\)\);/,
  // const env = {}; for (...) { ... }
  /const env = \{\};\s*\nfor \(const line of readFileSync\([^)]*\)\.split\([^)]*\)\) \{[\s\S]*?\n\}/,
];

for (const file of targets) {
  let src = readFileSync(file, "utf8");
  const matched = SHAPES.find((re) => re.test(src));
  if (!matched) { skipped.push(`${file}  (no known env-loading shape)`); continue; }

  // Import path relative to the file, so this works from any directory.
  const rel = relative(dirname(file), "scripts/lib/gate-env.mjs").replace(/\\/g, "/");
  const spec = rel.startsWith(".") ? rel : `./${rel}`;

  src = src.replace(matched, `const env = loadEnv();`);

  // Add the import after the last existing import line.
  if (!src.includes("gate-env.mjs")) {
    const imports = [...src.matchAll(/^import .*?;$/gm)];
    if (!imports.length) { skipped.push(`${file}  (no import block)`); continue; }
    const last = imports[imports.length - 1];
    src = src.slice(0, last.index + last[0].length)
      + `\nimport { loadEnv } from "${spec}";`
      + src.slice(last.index + last[0].length);
  }

  // readFileSync may now be unused; drop it from the node:fs import if so.
  const usesRead = (src.match(/readFileSync/g) || []).length;
  if (usesRead === 1) {
    src = src.replace(/import \{([^}]*)\} from "node:fs";/, (m0, inner) => {
      const kept = inner.split(",").map((s) => s.trim()).filter((s) => s && s !== "readFileSync");
      return kept.length ? `import { ${kept.join(", ")} } from "node:fs";` : "";
    }).replace(/^\n{3,}/gm, "\n\n");
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
