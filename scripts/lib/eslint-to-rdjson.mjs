/*
 * ESLint JSON -> reviewdog RDFormat (rdjson), keeping only the house rules.
 *
 * WHY THIS EXISTS RATHER THAN reviewdog/action-eslint
 * ---------------------------------------------------
 * That action runs its own eslint and reports EVERY rule it finds on the
 * changed lines. This repo already carries thirteen pre-existing
 * no-unused-vars warnings, and a PR that touched one of those lines would get
 * a review comment about a warning it did not introduce and that this change
 * has nothing to do with. The whole point of the reviewdog step is that a
 * finding on the diff is worth reading; the fastest way to lose that is to
 * mix in findings nobody asked for.
 *
 * So: this repo's own eslint, this repo's own config, filtered to `house/*`,
 * converted here. Twenty lines, no extra npm package in CI, and testable
 * locally, which the action is not.
 *
 * Usage:
 *   npx eslint -f json src scripts | node scripts/lib/eslint-to-rdjson.mjs
 */
import { readFileSync } from "node:fs";
import { relative } from "node:path";

const RULE_PREFIX = "house/";

const raw = readFileSync(0, "utf8").trim();
const files = raw ? JSON.parse(raw) : [];
const cwd = process.cwd();

const diagnostics = [];
for (const file of files) {
  for (const m of file.messages) {
    if (!m.ruleId?.startsWith(RULE_PREFIX)) continue;
    diagnostics.push({
      message: m.message,
      location: {
        path: relative(cwd, file.filePath).split("\\").join("/"),
        range: {
          start: { line: m.line, column: m.column },
          // endLine can be absent on a single-token report; reviewdog is happy
          // with a start-only range and unhappy with an end before the start.
          ...(m.endLine && m.endLine >= m.line
            ? { end: { line: m.endLine, column: m.endColumn } }
            : {}),
        },
      },
      // Everything here is `warn` in eslint.config.mjs on purpose -- see the
      // note there. WARNING keeps reviewdog from failing the job.
      severity: "WARNING",
      code: { value: m.ruleId },
    });
  }
}

process.stdout.write(`${JSON.stringify({
  source: { name: "house-rules", url: "https://github.com/hitul-hse/supabase-app/blob/master/eslint-rules/house-rules.mjs" },
  severity: "WARNING",
  diagnostics,
})}\n`);
