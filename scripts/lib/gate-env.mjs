/*
 * Credential loading for gates, in one place.
 *
 * WHY THIS EXISTS
 * ---------------
 * Gates had grown four different ways of reading credentials, and two of them
 * could not work on CI:
 *
 *   const env = {}; readFileSync(".env.local")            -> ENOENT on a runner
 *   readFileSync("C:/Supabase/.env.local")                -> a Windows-only
 *                                                            absolute path that
 *                                                            can never exist on
 *                                                            the Linux runner
 *   existsSync guard, but ignoring process.env            -> silently SKIPs on
 *                                                            CI, so the gate
 *                                                            proves nothing
 *   process.env first, .env.local optional                -> correct
 *
 * The consequence was not theoretical. The nightly sync workflow and the CI DB
 * Tests job were both red for over a week on ENOENT rather than on any real
 * defect, and the failures moved from gate to gate as each was fixed
 * individually.
 *
 * ORDER MATTERS: process.env wins. On CI the secrets are injected as
 * environment variables and there is no file; locally the file supplies what
 * the environment does not. A local file must never silently override a secret
 * CI has set, or a gate would test the wrong database.
 */
import { readFileSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Locate .env.local by walking up from this file, so a gate works regardless of
 * the directory it was invoked from -- and without hardcoding an absolute path
 * that only exists on one machine.
 */
function findEnvFile() {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 5; i += 1) {
    const candidate = join(dir, ".env.local");
    if (existsSync(candidate)) return candidate;
    const parent = resolve(dir, "..");
    if (parent === dir) break;
    dir = parent;
  }
  // Fall back to the working directory for callers run from the repo root.
  return existsSync(".env.local") ? ".env.local" : null;
}

/**
 * Environment first, then .env.local as a local convenience.
 * Always returns an object; never throws when the file is absent.
 */
export function loadEnv() {
  const env = { ...process.env };
  const file = findEnvFile();
  if (!file) return env;
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (m && env[m[1]] === undefined) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
  return env;
}

/**
 * For gates that genuinely cannot run without live credentials: return them, or
 * print a clear SKIP and exit 0.
 *
 * Skipping is honest when no credentials exist anywhere. It is NOT honest to
 * skip on CI when secrets were provided, which is why loadEnv reads process.env.
 */
export function requireEnv(...keys) {
  const env = loadEnv();
  const missing = keys.filter((k) => !env[k]);
  if (missing.length) {
    console.log(`SKIP: no credentials for ${missing.join(", ")}`);
    process.exit(0);
  }
  return env;
}
