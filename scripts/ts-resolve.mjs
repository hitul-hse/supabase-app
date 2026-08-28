/*
 * Resolver hook: let Node load the app's TypeScript modules using the same
 * extensionless relative imports the rest of the codebase uses.
 *
 * WHY THIS EXISTS
 * ---------------
 * Several gates run real application code directly under
 * `node --experimental-strip-types` rather than testing a copy of it. That is
 * deliberate and worth keeping: a gate that reads a reimplementation proves
 * nothing about what ships.
 *
 * But Next.js resolves `import { x } from "./request-cache"` through webpack,
 * which tries the .ts extension, while Node's ESM loader requires the specifier
 * to be exact and throws ERR_MODULE_NOT_FOUND. Every file in src/lib/queries
 * imports its siblings extensionlessly, so the moment a runtime (non-type)
 * import was added to profile.ts, the Profile gates job started failing on
 * every push -- 25 consecutive red CI runs -- for a reason that had nothing to
 * do with the behaviour under test.
 *
 * The alternatives were worse:
 *   - adding .ts to the import would make profile.ts inconsistent with its 20+
 *     siblings, and invites the same breakage the next time someone follows the
 *     surrounding style;
 *   - having the gate parse the file as text instead of importing it would mean
 *     it no longer executes the shipped code, which defeats its purpose.
 *
 * So the mismatch is fixed where it actually is: in how Node resolves, not in
 * how the application is written.
 *
 * Used via `node --import ./scripts/ts-resolve.mjs`.
 */
import { register } from "node:module";
import { pathToFileURL } from "node:url";

register(
  "data:text/javascript," +
    encodeURIComponent(`
      import { existsSync } from "node:fs";
      import { fileURLToPath } from "node:url";

      export async function resolve(specifier, context, nextResolve) {
        try {
          return await nextResolve(specifier, context);
        } catch (err) {
          // Only rescue the specific failure this hook exists for: a relative
          // specifier with no extension that names a real .ts/.tsx file. Any
          // other resolution error is a genuine missing module and must still
          // throw, so this cannot quietly paper over a real broken import.
          const isRelative = specifier.startsWith("./") || specifier.startsWith("../");
          if (err?.code !== "ERR_MODULE_NOT_FOUND" || !isRelative) throw err;
          if (/\\.[a-zA-Z0-9]+$/.test(specifier)) throw err;

          const base = new URL(specifier, context.parentURL);
          for (const ext of [".ts", ".tsx", "/index.ts", "/index.tsx"]) {
            const candidate = new URL(base.href + ext);
            if (existsSync(fileURLToPath(candidate))) {
              return nextResolve(base.href + ext, context);
            }
          }
          throw err;
        }
      }
    `),
  pathToFileURL("./"),
);
