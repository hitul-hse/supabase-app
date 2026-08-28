/*
 * Resolve an npm script name to the .mjs/.cjs files it actually executes.
 *
 * Shared by check-gates-runnable-on-ci and check-gates-ci-executable so the two
 * cannot disagree about which gates exist.
 *
 * THE SUBTLETY THAT CAUSED A FALSE PASS
 * -------------------------------------
 * Both audits originally took the FIRST scripts/*.mjs match on the line. That
 * was correct until `--import ./scripts/ts-resolve.mjs` was added to twelve
 * scripts, at which point the first match became the loader rather than the
 * gate. Those twelve silently dropped out of both audits, which then reported
 * PASS while CI failed on one of them.
 *
 * So: skip anything that is the argument to a node FLAG (--import, --require,
 * --loader) and take the last remaining candidate, which is the entry point.
 */
import { readFileSync } from "node:fs";

const pkg = JSON.parse(readFileSync("package.json", "utf8"));

const FLAG_ARG = /--(?:import|require|loader|experimental-loader)[= ]\S+/g;

export function scriptFiles(name, seen = new Set()) {
  if (seen.has(name)) return [];
  seen.add(name);
  const body = pkg.scripts?.[name];
  if (!body) return [];

  const out = [];
  for (const rawPart of body.split("&&").map((s) => s.trim())) {
    const run = /^npm run ([\w:-]+)/.exec(rawPart);
    if (run) { out.push(...scriptFiles(run[1], seen)); continue; }

    // Drop loader arguments before looking for the entry point.
    const part = rawPart.replace(FLAG_ARG, " ");
    const matches = [...part.matchAll(/(scripts\/[\w./-]+\.(?:mjs|cjs))/g)].map((m) => m[1]);
    if (matches.length) out.push(matches[matches.length - 1]);
  }
  return out;
}

export function chainFiles(chains) {
  const files = new Set();
  for (const c of chains) for (const f of scriptFiles(c)) files.add(f);
  return [...files];
}

export const CI_CHAINS = ["test:db", "check:profile-rls", "check:profile-effective-name"];
