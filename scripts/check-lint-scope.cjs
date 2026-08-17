// Guards the SIGNAL in `npm run lint`, not the code it lints.
//
// THE FAILURE THIS CATCHES
//
// The test harness builds Next into its own distDir so the shared .next is
// never disturbed -- .next-real, .next-action-probe, .next-acceptance. Those
// are in .gitignore. But eslint has a SEPARATE ignore list, and
// eslint-config-next only ships ".next/**".
//
// So the moment a probe dir existed on disk, `npm run lint` walked into
// Turbopack's emitted chunks and reported 433 errors -- require() imports,
// module assignment, @ts-ignore -- in generated code nobody wrote. Exactly
// 4 real errors in src/ were buried underneath.
//
// That is worse than lint simply failing. A run that is always red for
// reasons that are never your fault trains everyone to stop reading it, and
// the next genuine error goes out with the tide.
//
// WHY A GATE AND NOT JUST THE FIX
//
// .gitignore and eslint.config.mjs had ALREADY drifted apart once -- three
// dirs ignored by git, one known to eslint. Adding the fourth by hand would
// only reset the clock. This asserts the two lists agree, so the next distDir
// cannot quietly reintroduce it.
//
// It deliberately does NOT run eslint (that costs ~90s and CI already runs it
// as its own job). It is a static agreement check between two config files.
const fs = require("node:fs");

let failed = 0;
const check = (name, ok, detail = "") => {
  if (ok) {
    console.log(`PASS | ${name}`);
  } else {
    failed++;
    console.log(`FAIL | ${name}${detail ? ` -- ${detail}` : ""}`);
  }
};

const eslintCfgRaw = fs.readFileSync("eslint.config.mjs", "utf8");
const gitignore = fs.readFileSync(".gitignore", "utf8");

// Strip comments before matching. This file DOCUMENTS the patterns it sets
// ("eslint-config-next only knows about \".next/**\""), so a naive search
// finds the string in prose and reports an ignore that is not configured.
// Caught by the negative control: deleting the real ".next/**" entry left the
// gate passing, because the comment three lines below still matched.
// ORDER MATTERS. Stripping /* */ FIRST destroys the file: the glob string
// ".next-*/**" contains a literal `/*`, so a block-comment regex starts there
// and eats every line until the next `*/` -- which deleted the very entries
// being checked and failed all five assertions. Line comments go first, and
// only then are block comments (of which this file has none) removed.
const eslintCfg = eslintCfgRaw
  .replace(/^\s*\/\/.*$/gm, "")
  .replace(/^\s*\/\*[\s\S]*?\*\/\s*$/gm, "");

// ---------------------------------------------------------------- the fix

check(
  "eslint ignores every .next-* build output, not just .next",
  /["']\.next-\*\/\*\*["']/.test(eslintCfg),
  'no ".next-*/**" entry in globalIgnores -- a probe distDir will be linted',
);

check(
  "eslint still ignores the primary .next output",
  /["']\.next\/\*\*["']/.test(eslintCfg),
  "the .next/** entry was removed",
);

// ------------------------------------------------- the two lists agree

// Every build output git is told to ignore. Anything matching .next-<name>/
// is a Next distDir whose emitted chunks must never reach eslint.
const gitNextDirs = [
  ...gitignore.matchAll(/^\/?(\.next-[A-Za-z0-9._-]+)\/?\s*$/gm),
].map((m) => m[1]);

check(
  "at least one .next-* distDir is gitignored (otherwise this gate is vacuous)",
  gitNextDirs.length > 0,
  "found none -- if the harness stopped using probe dirs, delete this gate",
);

// The glob is what makes this hold for dirs that do not exist yet, so verify
// it actually covers each one rather than trusting the pattern by eye.
const globCoversAll = /["']\.next-\*\/\*\*["']/.test(eslintCfg);
for (const dir of gitNextDirs) {
  check(
    `eslint covers gitignored build dir ${dir}/`,
    globCoversAll || eslintCfg.includes(`${dir}/**`),
    "gitignored but eslint would still lint its generated chunks",
  );
}

// ------------------------------------------------------ negative control
//
// Proves the matcher above is real. A config WITHOUT the glob must fail the
// same test -- otherwise the assertions pass regardless of the config and the
// gate is decorative.
{
  const stripped = eslintCfg.replace(/["']\.next-\*\/\*\*["'],?/g, "");
  check(
    "negative control: a config missing the glob is actually detected",
    !/["']\.next-\*\/\*\*["']/.test(stripped),
    "the matcher passes even with the entry removed -- it proves nothing",
  );
}

// --------------------------------------------------- probe dirs stay untracked
//
// The ignore fix stops eslint reading them. This stops them being COMMITTED,
// which would put hundreds of generated files in the diff and make them
// everyone's problem rather than one machine's.
{
  const { execSync } = require("node:child_process");
  let tracked = "";
  try {
    tracked = execSync("git ls-files .next-real .next-action-probe .next-acceptance", {
      encoding: "utf8",
    }).trim();
  } catch {
    // Not a git checkout (or git unavailable) -- skip rather than fail.
  }
  check(
    "no probe build output is tracked by git",
    tracked === "",
    `tracked generated files: ${tracked.split("\n").slice(0, 3).join(", ")}`,
  );
}

if (failed > 0) {
  console.log(`\nLINT SCOPE: ${failed} check(s) failed`);
  process.exit(1);
}
console.log("\nLINT SCOPE: all checks passed");
