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
