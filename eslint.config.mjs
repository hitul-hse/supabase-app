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
