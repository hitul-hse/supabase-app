import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Every OTHER Next build output. The test harness builds into its own
    // distDir so the shared .next is never disturbed (.next-real,
    // .next-action-probe, .next-acceptance), and eslint-config-next only
    // knows about ".next/**". The moment a probe dir existed, linting
    // Turbopack's emitted chunks produced 433 errors that buried the 4 real
    // ones in src/ -- lint "failing" with nothing wrong in our code is worse
    // than lint passing, because it trains you to ignore the output.
    // Globbed rather than listed: .gitignore and this file had already
    // drifted once, so the next distDir must not reintroduce the problem.
    ".next-*/**",
    // Throwaway debug scratch (gitignored as /tmp-* and .tmp-*). eslint does
    // NOT read .gitignore, so an untracked probe script still gets linted and
    // its bare require() fails the run under the app's ESM-only rule -- lint
    // red for a file that is not part of the app.
    "tmp-*",
    ".tmp-*",
    // Vendored, generated runtime for the design mockup — not part of the
    // app and explicitly marked "do not edit" at its own source.
    "docs/design/hse-hub-mockup/support.js",
    // Third-party agent skills installed via `npx skills add` / `impeccable`.
    // Not our code and not editable by us — linting them produced 152 warnings
    // that drowned out real signal from src/. Excluded so `npm run lint` output
    // stays readable and a genuine new warning is actually noticeable.
    ".github/skills/**",
    ".claude/skills/**",
    ".agents/skills/**",
    // Same third-party skills again, mirrored into the editor's own skills
    // directory so V3Code's loader can find them (it scans .v3code/skills and
    // does NOT follow .claude/skills). The copy is real files, not links, so
    // the three entries above did not cover it and all 152 warnings came
    // straight back the moment the mirror was created.
    ".v3code/**",
    // And a third time, via the agent worktrees. Every `git worktree` an agent
    // session opens lands under .claude/worktrees/ as a REAL checkout, each
    // carrying its own copy of .claude/skills, .agents/skills, .github/skills
    // and .v3code -- so the four entries above, which anchor at the repo root,
    // miss all of them. Measured on 2026-09-07 with 25 worktrees present:
    // `npm run lint` reported 77,782 problems (5,826 errors) across 3,523
    // files, of which 3,513 were worktree copies. Ten files in the real tree
    // had anything to say, and none of them an error. The run took over twenty
    // minutes, emitted 14.6 MB, and exited 1 -- so the repo's own lint command
    // was red on this machine for code that is not the app, while CI stayed
    // green because a fresh checkout has no worktrees. That is the failure the
    // .next-* and tmp-* entries above were written to prevent, arriving through
    // a directory they do not cover: lint red for a file that is not part of
    // the app trains you to ignore the output. Globbed, not listed, for the
    // same reason .next-* is.
    ".claude/worktrees/**",
  ]),
  // Plain Node CommonJS scripts (CI checks, etc.) — not app source, so the
  // app's ESM-only import rule doesn't apply.
  {
    files: ["scripts/**/*.cjs"],
    rules: {
      "@typescript-eslint/no-require-imports": "off",
    },
  },
]);

export default eslintConfig;
