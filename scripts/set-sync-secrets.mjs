/**
 * One-shot helper: copies the secrets the nightly syncs need from local
 * .env.local into GitHub Actions repository secrets.
 *
 * Why a script rather than a handful of `gh secret set` commands typed by hand:
 * the values must never appear in a shell history, a terminal echo, or a chat
 * log. Passing the value on stdin keeps it process-to-process, never rendered.
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
 * IT ALSO RECORDS WHAT IT PUSHED (added 2026-09-06, after the FACTORIAL_API_KEY
 * incident: rotated here, never pushed there, and the only thing that noticed
 * was a freshness gate going red 36 hours later with a message about staleness
 * rather than about a credential). Every successful push writes a sha256 of the
 * value it sent to ~/.config/hse/secret-parity.json, and
 * scripts/check-secret-parity.mjs compares the rig's current value against that
 * record. Secrets are write-only, so a hash of what was last pushed is the only
 * evidence of parity that can exist -- see scripts/lib/secret-parity.mjs.
 *
 *   node scripts/set-sync-secrets.mjs                     # set them all, then record
 *   node scripts/set-sync-secrets.mjs --only FACTORIAL_API_KEY
 *   node scripts/set-sync-secrets.mjs --record            # record only, push nothing
 *   node scripts/set-sync-secrets.mjs --dry-run           # show what would be set
 */
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import {
  readRegistry,
  writeRegistry,
  sha256,
  shortHash,
  resolveGitHubToken,
  listRepoSecrets,
} from "./lib/secret-parity.mjs";

const REPO = "hitul-hse/supabase-app";

/*
 * Exactly the names the sync workflows reference, one comment per entry naming
 * the workflow that consumes it. Kept as a literal list rather than parsed from
 * the workflows so that a rename there fails loudly here instead of silently
 * setting the wrong secret.
 *
 * SUPABASE_DB_URL IS DELIBERATELY ABSENT and must stay absent. The repository
 * secret has to be the SESSION POOLER url, while this rig's .env.local holds the
 * direct host db.<ref>.supabase.co -- which publishes only an AAAA record, on
 * runners that are IPv4-only. Pushing the local value would break
 * sync-factorial.yml with ENETUNREACH; the workflow rejects that host by shape
 * for exactly this reason. It is set by hand, once, from the Supabase console.
 */
const REQUIRED = [
  // .github/workflows/sync-trackingtime.yml — base64(email:APP_PASSWORD).
  "TRACKINGTIME_AUTH",
  // .github/workflows/sync-trackingtime.yml — the account the importer reads.
  "TRACKINGTIME_ACCOUNT_ID",
  // .github/workflows/sync-trackingtime.yml — the Supabase project url.
  "NEXT_PUBLIC_SUPABASE_URL",
  // .github/workflows/sync-trackingtime.yml — the service-role key the
  // importer, check-vendor-parity and refresh-order-hours all write with.
  "SUPABASE_SERVICE_ROLE_KEY",
  // .github/workflows/sync-factorial.yml — the x-api-key credential. Added
  // 2026-09-06: it had never been in this list, so the one script that exists to
  // keep GitHub in step with the rig did not know the Factorial key existed.
  "FACTORIAL_API_KEY",
  // .github/workflows/sync-factorial.yml — company 157774, written to every
  // review row as factorial_company_id.
  "FACTORIAL_COMPANY_ID",
];

const dryRun = process.argv.includes("--dry-run");
const recordOnly = process.argv.includes("--record");

/*
 * `--only A,B` restricts everything below to those names. It exists because the
 * remedy for one drifted credential is to push THAT credential: re-pushing all
 * six touches five secrets that were already correct, and each of those is a
 * fresh updated_at that makes the audit trail less legible, not more.
 */
const onlyArg = process.argv.find((a) => a === "--only" || a.startsWith("--only="));
let selected = REQUIRED;
if (onlyArg) {
  const raw = onlyArg.includes("=")
    ? onlyArg.slice(onlyArg.indexOf("=") + 1)
    : process.argv[process.argv.indexOf(onlyArg) + 1];
  const names = String(raw ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  const unknown = names.filter((n) => !REQUIRED.includes(n));
  if (!names.length || unknown.length) {
    console.error(
      unknown.length
        ? `--only names a secret this script does not manage: ${unknown.join(", ")}`
        : "--only needs at least one secret name",
    );
    console.error(`It manages: ${REQUIRED.join(", ")}`);
    process.exit(1);
  }
  selected = names;
}

/*
 * The `gh` binary. This rig has no Linux gh; the Windows one resolves through
 * WSL interop and works. Resolved rather than hardcoded so the fix command
 * check-secret-parity.mjs prints actually runs on the machine it is printed on
 * -- a remedy that ENOENTs is not a remedy.
 */
const GH = ["gh", "gh.exe"].find((bin) => {
  try {
    return spawnSync(bin, ["--version"], { encoding: "utf8" }).status === 0;
  } catch {
    return false;
  }
}) ?? "gh";

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

/*
 * Checked over the SELECTED names, not all of them: `--only FACTORIAL_API_KEY`
 * must not abort because an unrelated credential this rig has never held is
 * absent from the file.
 *
 * Fatal for a PUSH, because pushing a partial set is exactly the half-configured
 * state that produces a job failing on one missing secret. Not fatal for
 * --record, which handles it below: recording is not pushing, and a name with no
 * local copy has no baseline to record rather than a problem to abort over.
 */
const missing = selected.filter((k) => !env[k]);
if (!recordOnly && missing.length) {
  console.error("Missing from .env.local: " + missing.join(", "));
  process.exit(1);
}

/**
 * Write the parity baseline for the given names.
 *
 * pushed_at is GitHub's OWN updated_at for the secret, read back after the
 * push, never a local `new Date()`. Two clocks that never meet cannot skew, and
 * the gate's `updated_at >= pushed_at` assertion then holds by construction --
 * so there is no tolerance to tune and no window in which a correct push looks
 * like a failed one.
 *
 * A name GitHub does not hold is NOT recorded. Writing a baseline for a secret
 * that is not there would let the gate prove parity with nothing.
 */
async function recordBaseline(names) {
  const { token, source, tried } = resolveGitHubToken();
  if (!token) {
    console.error("\nNo GitHub token, so the parity baseline cannot be recorded. Tried:");
    for (const t of tried) console.error(`  - ${t}`);
    return names.length;
  }

  let live;
  try {
    live = await listRepoSecrets(REPO, token);
  } catch (e) {
    console.error(`\nCould not list repository secrets: ${e.message}`);
    return names.length;
  }

  const registry = readRegistry();
  const entries = { ...registry.entries };
  let bad = 0;

  console.log(`\nrecording the parity baseline (token from ${source}):`);
  for (const key of names) {
    const updatedAt = live.get(key);
    if (!updatedAt) {
      bad += 1;
      console.error(`  BAD  ${key}: GitHub does not hold this secret, so nothing was recorded`);
      continue;
    }
    const hash = sha256(env[key]);
    entries[key] = { sha256: hash, pushed_at: updatedAt, repo: REPO };
    // Eight hex characters, never the full hash: a full sha256 of a
    // low-entropy value is an offline verifier for it.
    console.log(`  OK   ${key}: sha256 ${shortHash(hash)}…, pushed_at ${updatedAt}`);
  }

  const path = writeRegistry(entries);
  console.log(`\nbaseline: ${path} (mode 600, deliberately outside this public repo)`);
  console.log("verify with: node scripts/check-secret-parity.mjs");
  return bad;
}

if (recordOnly) {
  if (dryRun) {
    console.error("--record and --dry-run are mutually exclusive. Pass one.");
    process.exit(1);
  }

  /*
   * A name explicitly asked for with --only must never be silently narrowed
   * away; a name merely swept up by the default selection is reported and
   * skipped. Two credentials genuinely do not live on this rig at all
   * (TRACKINGTIME_*), and refusing to bootstrap the four that do because of the
   * two that do not would leave the gate with no baseline for anything.
   */
  const absent = selected.filter((k) => !env[k]);
  const present = selected.filter((k) => env[k]);

  if (absent.length && onlyArg) {
    console.error("Missing from .env.local: " + absent.join(", "));
    process.exit(1);
  }
  if (absent.length) {
    console.log("not recorded — no copy in .env.local, so there is nothing to hash:");
    for (const k of absent) console.log(`  --   ${k}`);
  }
  if (!present.length) {
    console.error("\nNothing to record: none of the selected names is in .env.local.");
    process.exit(1);
  }

  console.log(`recording only — nothing will be pushed (${present.length} name(s))`);
  process.exit((await recordBaseline(present)) ? 1 : 0);
}

let failed = 0;
for (const key of selected) {
  const value = env[key];
  // Only ever print the length. Printing a prefix of a token is still a leak of
  // a token, and these end up in CI logs and chat transcripts.
  const shape = `len=${value.length}`;

  if (dryRun) {
    console.log(`would set ${key} (${shape})`);
    continue;
  }

  // No --body flag: that is what makes gh read the value from stdin.
  const res = spawnSync(GH, ["secret", "set", key, "-R", REPO], {
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
  for (const key of selected) {
    const real = spawnSync(GH, ["secret", "set", key, "-R", REPO, "--no-store"], {
      input: env[key],
      encoding: "utf8",
    });
    const dash = spawnSync(GH, ["secret", "set", key, "-R", REPO, "--no-store"], {
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

/*
 * Record LAST, and only on a clean run. A baseline written after a failed push
 * would assert parity that does not exist -- which is worse than no baseline,
 * because the gate would then print PASS over a stale secret. That is the exact
 * failure this whole mechanism was built to stop.
 */
if (!dryRun && !failed) {
  failed += await recordBaseline(selected);
}

process.exit(failed ? 1 : 0);
