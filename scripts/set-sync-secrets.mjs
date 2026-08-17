/**
 * One-shot helper: copies the four secrets the nightly TrackingTime sync needs
 * from local .env.local into GitHub Actions repository secrets.
 *
 * Why a script rather than four `gh secret set` commands typed by hand: the
 * values must never appear in a shell history, a terminal echo, or a chat log.
 * Passing the value on stdin keeps it process-to-process, never rendered.
 *
 * TRAP, learned the hard way: `gh secret set` reads stdin only when --body is
 * OMITTED ENTIRELY. Writing `--body -` does NOT mean "read stdin" -- gh stores
 * the literal one-character string "-". That fails silently: `gh secret list`
 * shows all four names present and freshly updated, so it looks like it worked,
 * and the breakage only surfaces later in CI as
 * "Invalid supabaseUrl: Must be a valid HTTP or HTTPS URL."
 *
 * Safe to re-run — `gh secret set` overwrites in place.
 *
 *   node scripts/set-sync-secrets.mjs            # set them
 *   node scripts/set-sync-secrets.mjs --dry-run  # show what would be set
 */
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

const REPO = "hitul-hse/supabase-app";

// Exactly the names .github/workflows/sync-trackingtime.yml references. Kept as
// a literal list rather than parsed from the workflow so that a rename there
// fails loudly here instead of silently setting the wrong secret.
const REQUIRED = [
  "TRACKINGTIME_AUTH",
  "TRACKINGTIME_ACCOUNT_ID",
  "NEXT_PUBLIC_SUPABASE_URL",
  "SUPABASE_SERVICE_ROLE_KEY",
];

const dryRun = process.argv.includes("--dry-run");

function loadEnv(path) {
  const out = {};
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    let value = trimmed.slice(eq + 1).trim();
    // Values written by `vercel env pull` arrive quoted; the quotes are not
    // part of the credential and a quoted token authenticates as nothing.
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    out[trimmed.slice(0, eq).trim()] = value;
  }
  return out;
}

const env = loadEnv(".env.local");

const missing = REQUIRED.filter((k) => !env[k]);
if (missing.length) {
  console.error("Missing from .env.local: " + missing.join(", "));
  process.exit(1);
}

let failed = 0;
for (const key of REQUIRED) {
  const value = env[key];
  // Only ever print the length. Printing a prefix of a token is still a leak of
  // a token, and these end up in CI logs and chat transcripts.
  const shape = `len=${value.length}`;

  if (dryRun) {
    console.log(`would set ${key} (${shape})`);
    continue;
  }

  // No --body flag: that is what makes gh read the value from stdin.
  const res = spawnSync("gh", ["secret", "set", key, "-R", REPO], {
    input: value,
    encoding: "utf8",
  });

  if (res.status === 0) {
    console.log(`set ${key} (${shape})`);
  } else {
    failed += 1;
    console.error(`FAILED ${key}: ${(res.stderr || "").trim()}`);
  }
}

/**
 * Prove the value actually landed, rather than trusting exit code 0.
 *
 * `gh secret list` is NOT a verification: it shows names and timestamps only,
 * and reported all four as freshly set when every one held the literal "-".
 * Secrets are write-only, so the value cannot be read back either.
 *
 * What CAN be checked: --no-store re-encrypts a value and prints it instead of
 * uploading. Encryption is non-deterministic, so the ciphertext differs every
 * time and cannot be compared -- but its LENGTH tracks the plaintext length.
 * Encrypting the real value and encrypting "-" produce visibly different sizes,
 * which is enough to catch exactly the failure that bit here.
 */
if (!dryRun && !failed) {
  console.log("\nverifying (encrypted length should track plaintext length):");
  for (const key of REQUIRED) {
    const real = spawnSync("gh", ["secret", "set", key, "-R", REPO, "--no-store"], {
      input: env[key],
      encoding: "utf8",
    });
    const dash = spawnSync("gh", ["secret", "set", key, "-R", REPO, "--no-store"], {
      input: "-",
      encoding: "utf8",
    });
    const realLen = (real.stdout || "").trim().length;
    const dashLen = (dash.stdout || "").trim().length;
    const ok = realLen > dashLen;
    if (!ok) failed += 1;
    console.log(`  ${ok ? "OK  " : "BAD "} ${key}: enc=${realLen} vs enc("-")=${dashLen}`);
  }
}

process.exit(failed ? 1 : 0);
