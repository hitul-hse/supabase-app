/*
 * Gate: does every credential that lives in more than one place still hold the
 * SAME value in each place -- and if not, WHICH one drifted?
 *
 * THE INCIDENT THIS EXISTS FOR (2026-09-06)
 * -----------------------------------------
 * FACTORIAL_API_KEY was rotated on the rig (.env.local) and not in the GitHub
 * Actions secret. The scheduled sync-factorial.yml run then failed with
 *
 *     employees/employees page 0: HTTP 401
 *
 * on 2026-09-05 and again on 2026-09-04, twice, and nobody was told. The only
 * thing that eventually went red was check-factorial-freshness.mjs, 36 hours
 * later, saying "the last successful Factorial sync is under 36h old — 39.8h
 * ago — STALE". That names the SYMPTOM. It does not name the cause, and it
 * cannot: from the database side a dead credential and a deleted workflow look
 * identical. The rig's own key worked the whole time -- verified by a GET to
 * the Factorial API with the .env.local value returning 200 while CI got 401 --
 * so every local check a person might reach for said the key was fine.
 *
 * This gate names the cause, by name, within a run of the gate rather than a
 * day and a half later.
 *
 * WHY A REGISTRY, AND NOT A COMPARISON OF THE TWO VALUES
 * -----------------------------------------------------
 * GitHub Actions secrets are write-only. There is no API that returns a
 * secret's value, so "compare the two values" is not an available move. Parity
 * is therefore established against a LOCAL REGISTRY of what was last pushed:
 * ~/.config/hse/secret-parity.json, written by scripts/set-sync-secrets.mjs.
 * See scripts/lib/secret-parity.mjs for the file's shape and why it is 0600 and
 * outside this (public) repository.
 *
 * WHY NOT MODIFICATION TIMES, which was the first idea
 * ----------------------------------------------------
 * "Is .env.local newer than the GitHub secret" is a false-positive machine.
 * .env.local holds every credential in one file, so ANY edit to it -- adding an
 * unrelated variable, a `vercel env pull`, an editor rewriting the file on
 * save -- moves the mtime of all of them at once, and every mapped secret then
 * reads as drifted. A gate that goes red for a reason nobody caused is a gate
 * people learn to skip, and this repo has already paid for that lesson once
 * (see the note about check-order-hours-freshness at the top of
 * check-factorial-freshness.mjs). A sha256 of the value moves if and only if
 * the VALUE moved.
 *
 * WHAT IT ASSERTS, PER MAPPED NAME
 * --------------------------------
 *   1. sha256(the value in .env.local) === the hash recorded at the last push.
 *   2. the name exists in the repository's Actions secrets.
 *   3. that secret's updated_at is >= the recorded pushed_at.
 *
 * (3) is exact rather than approximate: set-sync-secrets.mjs records pushed_at
 * as the updated_at GitHub itself reports after the push, so the two clocks are
 * never compared and there is no skew tolerance to tune.
 *
 * WHAT IT CANNOT SEE, said plainly rather than left to be discovered
 * -----------------------------------------------------------------
 * A value changed in the GitHub web UI and nowhere else. The registry hash
 * still matches the rig, and updated_at only moves forward, so both assertions
 * hold while the values have in fact diverged. That direction is reported as a
 * NOTE (GitHub's copy is newer than the last recorded push) and is deliberately
 * not fatal, because a legitimate re-push from another machine looks the same.
 * The remedy is the same either way: push from the rig, which re-records.
 *
 * A GATE THAT CANNOT PROVE PARITY MUST NOT PRINT PASS. There is no SKIP branch
 * here. No token, no registry, no local value -- each of those is a FAIL that
 * says what is missing and what to run, because "I could not check" and "I
 * checked and it is fine" must never look the same.
 *
 * READ-ONLY. It reads .env.local, the registry, and one GitHub list endpoint.
 * It writes nothing and it prints no secret value and no full hash.
 *
 *   node scripts/check-secret-parity.mjs
 */
import { existsSync } from "node:fs";
import { loadEnv } from "./lib/gate-env.mjs";
import {
  readRegistry,
  sha256,
  shortHash,
  resolveGitHubToken,
  listRepoSecrets,
  REGISTRY_ENV,
} from "./lib/secret-parity.mjs";

// The same literal as scripts/set-sync-secrets.mjs. Written out rather than
// derived from `git remote`, so a fork or a renamed remote cannot silently
// point the check at a repository whose secrets are not the ones CI reads.
const REPO = "hitul-hse/supabase-app";

/*
 * THE NAME -> HOMES MAP.
 *
 * A literal, one line of reasoning per entry, naming the workflow that consumes
 * it. Parsed from nothing: a rename in a workflow must fail loudly here rather
 * than quietly re-point this gate at whatever the new name is -- the same
 * reasoning as the REQUIRED list in set-sync-secrets.mjs.
 *
 * Membership was decided by reading the rig's .env.local against the live
 * repository secret list, not guessed. Four of the seven repository secrets
 * genuinely hold the same string in both homes. The other three are named
 * below in PRESENCE_ONLY with the reason each cannot be value-compared, because
 * an unexplained absence from this list is indistinguishable from an oversight.
 */
const MAPPED = [
  // .github/workflows/sync-factorial.yml — the credential in the 2026-09-06
  // incident. x-api-key on api.factorialhr.com; a rotation invalidates the old
  // value immediately, so a stale copy in either home is a hard 401.
  "FACTORIAL_API_KEY",
  // .github/workflows/sync-factorial.yml — company 157774. Low entropy and it
  // almost never changes, which is exactly why a silent divergence here would
  // sit undetected: every review row would be written against the wrong
  // factorial_company_id.
  "FACTORIAL_COMPANY_ID",
  // .github/workflows/sync-trackingtime.yml — the project URL, used by the
  // sync, the vendor-parity check and refresh-order-hours. Same string in both
  // homes; a divergence would point CI at a different Supabase project while
  // every local run stayed correct.
  "NEXT_PUBLIC_SUPABASE_URL",
  // .github/workflows/sync-trackingtime.yml — the service-role key. Rotating
  // this in the dashboard and forgetting CI is the same failure as the
  // Factorial one with a much larger blast radius: the nightly import writes
  // nothing and the dashboard freezes at yesterday.
  "SUPABASE_SERVICE_ROLE_KEY",
];

/*
 * NAMED, BUT NOT VALUE-COMPARED. Presence in GitHub is still asserted -- a
 * secret that vanished is exactly the drift this gate is for -- but the hash
 * comparison is skipped for a stated reason.
 */
const PRESENCE_ONLY = [
  {
    name: "SUPABASE_DB_URL",
    // .github/workflows/sync-factorial.yml.
    why:
      "the two homes hold DIFFERENT urls ON PURPOSE. The rig's .env.local uses the "
      + "direct host db.<ref>.supabase.co; that host publishes only an AAAA record and "
      + "GitHub runners are IPv4-only, so the repository secret must be the SESSION "
      + "POOLER url. sync-factorial.yml rejects the direct host by shape at line ~120. "
      + "Hash-comparing these would be red forever, and 'fixing' it by pushing the rig's "
      + "value would break the sync with ENETUNREACH.",
  },
  {
    name: "TRACKINGTIME_AUTH",
    // .github/workflows/sync-trackingtime.yml.
    why:
      "not present in this rig's .env.local, so there is no second copy here to hash. "
      + "It is base64(email:APP_PASSWORD) and lives only in the repository secret and "
      + "the vendor. Add it to .env.local and move it into MAPPED if that changes.",
  },
  {
    name: "TRACKINGTIME_ACCOUNT_ID",
    // .github/workflows/sync-trackingtime.yml.
    why:
      "not present in this rig's .env.local (import-trackingtime.mjs falls back to "
      + "GET /me for it), so there is nothing local to compare.",
  },
];

const failures = [];
let asserted = 0;

const check = (ok, label, detail) => {
  asserted += 1;
  console.log(`${ok ? "  ok  " : " FAIL "} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures.push(label);
};

const finish = () => {
  console.log(
    `\n${asserted} assertion(s) over ${MAPPED.length} value-parity name(s) `
    + `and ${PRESENCE_ONLY.length} presence-only name(s).`,
  );
  console.log(`\n${failures.length === 0 ? "PASS" : `FAIL (${failures.length})`}`);
  if (failures.length) for (const f of failures) console.log(`  - ${f}`);
  process.exit(failures.length ? 1 : 0);
};

console.log(`check-secret-parity: does every secret hold the same value in each of its homes?\n`);
console.log(`  repository:  ${REPO}`);

// ---------------------------------------------------------------------------
// The rig's copy.
// ---------------------------------------------------------------------------
const env = loadEnv();
// Reported, not asserted: loadEnv() also seeds from process.env, so a value can
// legitimately be present with no file at all. Saying which case we are in
// makes a run on a fresh clone self-explanatory.
console.log(`  .env.local:  ${existsSync(".env.local") ? "present" : "not in the working directory (values may still come from the environment)"}`);

// ---------------------------------------------------------------------------
// The registry: what we last pushed.
// ---------------------------------------------------------------------------
const registry = readRegistry();
console.log(`  registry:    ${registry.path}${process.env[REGISTRY_ENV] ? `  (overridden by $${REGISTRY_ENV})` : ""}`);

if (registry.error) {
  console.log(`\n  The registry exists but could not be parsed: ${registry.error}`);
  console.log(`  Re-record it with:  node scripts/set-sync-secrets.mjs --record\n`);
  check(false, "the secret-parity registry is readable", "corrupt JSON — nothing can be proved from it");
  finish();
}

if (!registry.exists) {
  console.log(`\n  There is no baseline on this machine, so parity cannot be proved for any name.`);
  console.log(`  This is not a pass and it is not a skip. Bootstrap it with:`);
  console.log(`    node scripts/set-sync-secrets.mjs --record\n`);
}

// ---------------------------------------------------------------------------
// GitHub. No token means no second home in view, which means nothing is proved.
// ---------------------------------------------------------------------------
const { token, source, tried } = resolveGitHubToken();
if (!token) {
  console.log(`\n  No GitHub token. Tried, in order:`);
  for (const t of tried) console.log(`    - ${t}`);
  console.log(`\n  Without one, the second home of every secret is invisible and this gate`);
  console.log(`  can prove nothing. Set $GH_TOKEN, or authenticate the GitHub CLI.\n`);
  check(false, "a GitHub token resolves", "none of the documented sources answered");
  finish();
}
console.log(`  token from:  ${source}\n`);

let live;
try {
  live = await listRepoSecrets(REPO, token);
} catch (e) {
  console.log(`  ${e.message}\n`);
  check(false, "the repository's Actions secrets can be listed", "the API call failed — see above");
  finish();
}

console.log(`GitHub holds ${live.size} repository secret(s):`);
for (const [name, updated] of [...live].sort()) {
  console.log(`  ${name.padEnd(28)} updated ${String(updated).replace("T", " ").replace("Z", "")}`);
}
console.log("");

// ---------------------------------------------------------------------------
// Value parity, per mapped name.
// ---------------------------------------------------------------------------
const FIX = (name) => `node scripts/set-sync-secrets.mjs --only ${name}`;

for (const name of MAPPED) {
  const local = env[name];
  const entry = registry.entries[name];
  const updatedAt = live.get(name);

  if (!local) {
    check(false, `${name} is present on this machine`,
      `not in .env.local or the environment — this gate compares the rig's copy and there is none. `
      + `Restore it, or drop ${name} from MAPPED with a reason`);
    continue;
  }

  const localHash = sha256(local);

  if (!entry) {
    check(false, `${name} has a recorded baseline`,
      `no baseline: run \`node scripts/set-sync-secrets.mjs --record\` (rig value is sha256 ${shortHash(localHash)}…)`);
    continue;
  }

  if (entry.repo && entry.repo !== REPO) {
    check(false, `${name}'s baseline was recorded against ${REPO}`,
      `the registry entry names ${entry.repo} — re-record with \`${FIX(name)}\``);
    continue;
  }

  check(
    entry.sha256 === localHash,
    `${name} holds the same value on the rig as was last pushed to GitHub`,
    entry.sha256 === localHash
      ? `sha256 ${shortHash(localHash)}…, pushed ${String(entry.pushed_at).replace("T", " ").replace("Z", "")}`
      : `DRIFTED. .env.local is sha256 ${shortHash(localHash)}…, last pushed was ${shortHash(entry.sha256)}… `
        + `(${String(entry.pushed_at).replace("T", " ").replace("Z", "")}). `
        + `The rig was rotated and GitHub was not. Fix: ${FIX(name)}`,
  );

  if (!updatedAt) {
    check(false, `${name} exists as a repository secret`,
      `the rig has a value for it and GitHub does not. Fix: ${FIX(name)}`);
    continue;
  }

  const pushed = Date.parse(entry.pushed_at);
  const updated = Date.parse(updatedAt);
  check(
    Number.isFinite(pushed) && Number.isFinite(updated) && updated >= pushed,
    `${name}'s GitHub copy was written no earlier than the recorded push`,
    Number.isFinite(pushed) && Number.isFinite(updated) && updated >= pushed
      ? `updated ${updatedAt.replace("T", " ").replace("Z", "")}`
      : `GitHub says ${updatedAt}, the registry claims a push at ${entry.pushed_at} — `
        + `the recorded push did not land. Fix: ${FIX(name)}`,
  );

  /*
   * Informational only. GitHub's copy being NEWER than the last push we
   * recorded means something changed it that was not this rig -- the web UI,
   * another machine, or a hand-typed `gh secret set`. That may be perfectly
   * legitimate, so it is not a failure; but it is the one direction of drift
   * the hash cannot see, so it must at least be said out loud.
   */
  if (Number.isFinite(pushed) && Number.isFinite(updated) && updated - pushed > 3_600_000) {
    const hours = (updated - pushed) / 3_600_000;
    console.log(
      `  note  ${name}: GitHub's copy is ${hours.toFixed(1)}h newer than the last push recorded here. `
      + `If that was not you, the rig may now be the stale home — re-push to re-synchronise.`,
    );
  }
}

// ---------------------------------------------------------------------------
// Presence-only names: no local value to hash, but their absence still matters.
// ---------------------------------------------------------------------------
console.log("");
for (const { name, why } of PRESENCE_ONLY) {
  check(live.has(name), `${name} exists as a repository secret`,
    live.has(name)
      ? `updated ${String(live.get(name)).replace("T", " ").replace("Z", "")} — value parity not asserted`
      : "MISSING from GitHub — the workflow that consumes it will fail on a missing secret");
  console.log(`        not value-compared: ${why}`);
}

finish();
