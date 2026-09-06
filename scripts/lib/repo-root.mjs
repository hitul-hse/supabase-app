/*
 * The repository root, derived from this file's own location.
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
 * which is the right idea, but "..'" is relative to the file that writes it, so
 * the line is not copyable into scripts/lib or scripts/discover and the fix had
 * to be re-derived per directory. This exports the answer once.
 *
 * TWO DETAILS THAT LOOK COSMETIC AND ARE NOT
 * ------------------------------------------
 * Trailing separator: fileURLToPath on a URL ending in "/" keeps it. Left in,
 * `${REPO_ROOT}/.env.local` becomes a double slash (harmless) and the
 * prefix-strip idiom the gates use -- f.replace(`${REPO_ROOT}/`, "") to print a
 * repo-relative name -- silently stops matching and every path prints absolute.
 * So it is stripped.
 *
 * Separator direction: on Windows fileURLToPath returns backslashes. The
 * literal being replaced was written with forward slashes, and the gates
 * compare and strip against forward slashes, so normalising here keeps this a
 * drop-in replacement rather than a Windows-only behaviour change. Node accepts
 * forward slashes on every platform.
 */
import { fileURLToPath } from "node:url";

/** Absolute path to the repository root. No trailing separator, forward slashes. */
export const REPO_ROOT = fileURLToPath(new URL("../..", import.meta.url))
  .replace(/\\/g, "/")
  .replace(/\/+$/, "");
