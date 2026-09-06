/*
 * The secret-parity registry: one definition of "what was last pushed", shared
 * by the gate that reads it and the pusher that writes it.
 *
 * WHY A REGISTRY AND NOT A COMPARISON
 * -----------------------------------
 * GitHub Actions secrets are WRITE-ONLY. `gh secret list` and
 * /repos/{repo}/actions/secrets return a name and an updated_at and nothing
 * else -- there is no endpoint, and no flag, that hands back a value. So the
 * two homes of a credential can never be compared directly, and any tool that
 * claims to have done so is comparing something else.
 *
 * What CAN be compared is a hash of the rig's value against a hash recorded at
 * the moment that value was pushed. That is what this file stores.
 *
 * NOT MODIFICATION TIMES. The obvious cheap version -- "is .env.local newer
 * than the GitHub secret" -- is a false-positive machine: one edit to
 * .env.local (adding an unrelated variable, `vercel env pull`, a text editor
 * rewriting the file) moves the mtime of every credential in it at once, and
 * every mapped secret then looks stale. A gate that goes red for a reason
 * nobody caused is a gate people learn to ignore, which is worse than no gate.
 * The hash moves if and only if the VALUE moved.
 *
 * WHERE IT LIVES, AND WHY NOT IN THE REPO
 * ---------------------------------------
 * ~/.config/hse/secret-parity.json, mode 600. This repository is public. A
 * sha256 of a credential is not the credential, but it is an oracle: anyone
 * holding it can confirm a guess offline, at whatever rate their hardware
 * allows, against a value that in two cases here is a structured string
 * (a company id, a URL) with very little entropy. Committing one would be
 * publishing a verifier for a secret. It stays on the machine that holds the
 * secret anyway.
 *
 * Shape:
 *   { "<SECRET_NAME>": { "sha256": "<hex>", "pushed_at": "<ISO>",
 *                        "repo": "hitul-hse/supabase-app" } }
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync, chmodSync, readdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { homedir, tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { spawnSync } from "node:child_process";

/**
 * Override for the registry location. It exists so this gate's own negative
 * controls (corrupt a hash, move the baseline aside) can be run against a
 * scratch copy without touching the real one. The gate PRINTS the path it
 * used, so an override can never be invisible.
 */
export const REGISTRY_ENV = "HSE_SECRET_PARITY_REGISTRY";

export function registryPath(env = process.env) {
  return env[REGISTRY_ENV] || join(homedir(), ".config", "hse", "secret-parity.json");
}

/** Full hex sha256 over the EXACT string, no trimming and no normalising. */
export function sha256(value) {
  return createHash("sha256").update(String(value), "utf8").digest("hex");
}

/**
 * The only form of a hash that may ever be printed. A full hash of a
 * low-entropy secret is a verifier; eight hex characters are enough for a human
 * to see that two things differ and not enough to confirm a guess.
 */
export const shortHash = (hex) => String(hex ?? "").slice(0, 8);

export function readRegistry(env = process.env) {
  const path = registryPath(env);
  if (!existsSync(path)) return { path, exists: false, entries: {} };
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8"));
    return { path, exists: true, entries: parsed && typeof parsed === "object" ? parsed : {} };
  } catch (e) {
    /*
     * A corrupt registry is NOT an empty one. Returning {} would present a
     * truncated file as "no baseline yet", which reads as a bootstrap problem
     * rather than as the data loss it is, so the error travels with the result
     * and the caller reports it as its own kind of failure.
     */
    return { path, exists: true, entries: {}, error: e.message };
  }
}

/** Write the registry with 0600, creating ~/.config/hse at 0700 if needed. */
export function writeRegistry(entries, env = process.env) {
  const path = registryPath(env);
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  writeFileSync(path, `${JSON.stringify(entries, null, 2)}\n`, { mode: 0o600 });
  // writeFileSync's `mode` applies only when it CREATES the file; an existing
  // one keeps whatever mode it had. Set it explicitly on every write.
  chmodSync(path, 0o600);
  return path;
}

/**
 * Find a GitHub token, in the documented order, and say which source answered.
 *
 * There is no silent fallback and no "skip if absent" branch: a parity gate
 * that cannot see GitHub has proved nothing, and must say so rather than pass.
 *
 * The two `gh` attempts are deliberately run from a NON-REPO directory. This
 * rig has no Linux `gh`; the Windows one resolves through WSL interop, and
 * Windows git refuses a \\wsl.localhost working directory as dubious
 * ownership -- which can turn a perfectly good `auth token` into an error
 * about repository safety.
 */
export function resolveGitHubToken(env = process.env) {
  const tried = [];

  for (const name of ["GH_TOKEN", "GITHUB_TOKEN"]) {
    tried.push(`$${name}`);
    const v = (env[name] || "").trim();
    if (v) return { token: v, source: `$${name}`, tried };
  }

  for (const bin of ["gh", "gh.exe"]) {
    tried.push(`${bin} auth token`);
    let res;
    try {
      res = spawnSync(bin, ["auth", "token"], { encoding: "utf8", cwd: tmpdir(), shell: false });
    } catch {
      continue;
    }
    /*
     * \r survives the Windows binary's output and would go into the
     * Authorization header verbatim, where it is a protocol error rather than
     * a 401 -- a baffling failure for a token that is entirely correct.
     */
    const out = (res.stdout || "").replace(/[\r\n]/g, "").trim();
    if (res.status === 0 && out) return { token: out, source: `${bin} auth token`, tried };
  }

  // Last resort: the Windows CLI's own config, read directly. The same token
  // the binary would have printed, without needing the binary to run at all.
  for (const file of windowsGhHostsFiles()) {
    tried.push(file);
    try {
      const m = /^\s*oauth_token:\s*(\S+)\s*$/m.exec(readFileSync(file, "utf8"));
      if (m) return { token: m[1], source: file, tried };
    } catch { /* unreadable is just another miss */ }
  }

  return { token: null, source: null, tried };
}

/**
 * Candidate paths for the Windows GitHub CLI config under WSL. Enumerated
 * rather than hardcoded to one account: the drive mount is stable, the user
 * name is not.
 */
function windowsGhHostsFiles() {
  const root = "/mnt/c/Users";
  const out = [];
  try {
    for (const user of readdirSync(root)) {
      const candidate = join(root, user, "AppData", "Roaming", "GitHub CLI", "hosts.yml");
      if (existsSync(candidate)) out.push(candidate);
    }
  } catch { /* not WSL, or no C: mount */ }
  return out;
}

/**
 * List the repository's Actions secrets: names and updated_at only, because
 * that is all the API returns and all this needs.
 *
 * Plain fetch -- no dependency and no `gh` binary, so the gate still works on a
 * machine that has a token and nothing else installed.
 */
export async function listRepoSecrets(repo, token) {
  const res = await fetch(`https://api.github.com/repos/${repo}/actions/secrets?per_page=100`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "hse-hub-secret-parity",
    },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "(unreadable)");
    throw new Error(`GET /repos/${repo}/actions/secrets: HTTP ${res.status} — ${body.slice(0, 200)}`);
  }
  const body = await res.json();
  if (!Array.isArray(body?.secrets)) {
    throw new Error(
      `GET /repos/${repo}/actions/secrets: no secrets array (keys: ${Object.keys(body ?? {}).join(",")})`,
    );
  }
  return new Map(body.secrets.map((s) => [s.name, s.updated_at]));
}
