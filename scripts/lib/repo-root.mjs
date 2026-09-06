/*
 * The repository root, found by walking up from this file until the repo's own
 * marker appears. Never counted in "..", never guessed.
 *
 * WHY THIS EXISTS
 * ---------------
 * 150 of the 207 gates addressed the repo through a drive-letter absolute path
 * that existed on exactly one laptop. `node scripts/run-all-gates.mjs` -- the
 * only thing that runs the whole suite -- died on its 13th line reading that
 * path's package.json, so on every other machine the acceptance criteria for
 * this repo could not be evaluated at all. Not "reported failures": could not
 * start.
 *
 * Twenty gates had already been fixed one at a time with an inline
 *
 *   const REPO = fileURLToPath(new URL("..", import.meta.url));
 *
 * which is the right idea, but ".." is relative to the file that writes it, so
 * the line is not copyable into scripts/lib or scripts/discover and the fix had
 * to be re-derived per directory. This exports the answer once.
 *
 * WHY IT SEARCHES INSTEAD OF COUNTING
 * -----------------------------------
 * The first version of this file counted: new URL("../..", import.meta.url),
 * correct for a file at scripts/lib/ and wrong for one anywhere else. Counting
 * has a failure mode with no symptom. An over-climb produces a path that is
 * still absolute, still starts with a separator, still passes any "is this
 * absolute" test -- and in a deep checkout it even lands on a real directory,
 * so it passes locally too. This worktree sits eight levels down; a GitHub
 * runner checks out at /home/runner/work/<repo>/<repo>, four levels down. The
 * same wrong count is invisible in one and resolves to "/" in the other, and
 * every path built from it then points at a file that does not exist.
 *
 * Searching removes the parameter that can be wrong. Depth stops mattering, a
 * file may move between scripts/ and scripts/lib/ without touching this, and a
 * tree that genuinely has no root THROWS, naming the file that asked -- because
 * the one outcome worse than a wrong root is a wrong root returned quietly.
 *
 * The marker is package.json AND this file's own path. package.json alone would
 * stop at the first one encountered, which is any npm package a script is
 * nested inside; requiring scripts/lib/repo-root.mjs beside it means the only
 * directory that can answer is the checkout this file is actually in.
 *
 * TWO DETAILS THAT LOOK COSMETIC AND ARE NOT
 * ------------------------------------------
 * Trailing separator: left in, `${REPO_ROOT}/.env.local` becomes a double slash
 * (harmless) and the prefix-strip idiom the gates use -- f.replace(
 * `${REPO_ROOT}/`, "") to print a repo-relative name -- silently stops matching
 * and every path prints absolute.
 *
 * Separator direction: on Windows fileURLToPath returns backslashes. The
 * literal being replaced was written with forward slashes, and the gates
 * compare and strip against forward slashes, so normalising here keeps this a
 * drop-in replacement rather than a Windows-only behaviour change. Node accepts
 * forward slashes on every platform.
 */
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const SELF = "scripts/lib/repo-root.mjs";

function findRepoRoot(fromUrl) {
  const start = dirname(fileURLToPath(fromUrl));
  let dir = start;
  // dirname("/") === "/" and dirname("C:\\") === "C:\\", so the fixed point is
  // the filesystem root and the loop always terminates.
  for (;;) {
    if (existsSync(join(dir, "package.json")) && existsSync(join(dir, SELF))) return dir;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error(
    `repo-root: walked from ${start} to the filesystem root without finding a `
    + `directory holding both package.json and ${SELF}. `
    + "This file must live inside the repository it is describing; returning a "
    + "root here would hand every caller an absolute path that points nowhere.",
  );
}

/** Absolute path to the repository root. No trailing separator, forward slashes. */
export const REPO_ROOT = findRepoRoot(import.meta.url)
  .replace(/\\/g, "/")
  .replace(/(?!^)\/+$/, "");
