/**
 * Drives each profile Server Action over HTTP with no session -- for real.
 *
 * FIX ROUND 1 HISTORY (Task 8, reviewer finding, Critical): the previous
 * version of this file only ever sent a plain GET /profile and called that
 * "driving the Server Action over HTTP." A GET carries no Next-Action header
 * and never reaches Next's action dispatcher at all -- it exercises the PAGE
 * gate (requireProfile()/middleware redirecting a page load), not the ACTION
 * gate. That distinction is exactly the one AGENTS.md names: "Server Actions
 * are public HTTP endpoints... a page-level gate does not protect an
 * action." check-profile-actions.mjs already proves the actions' guards are
 * WRITTEN (source read); this file has to prove they FIRE, over the wire,
 * for the actual attack it is named for -- a caller who never loads /profile
 * at all and POSTs directly to the action endpoint.
 *
 * HOW, and why this shape:
 *
 *   1. Read the REAL, build-generated action ids for each profile Server
 *      Action out of `.next`'s server-reference-manifest.json for the
 *      profile page -- the exact ids a legitimate signed-in browser's
 *      client bundle would send. Hardcoding a guessed id would prove
 *      nothing (a wrong id fails for an unrelated reason, see below); this
 *      resolves the id from the same build the running server is serving.
 *   2. POST directly to /profile with a `Next-Action: <id>` header and a
 *      minimal multipart body, presenting NO session cookie at all --
 *      never loading the page, never running any client JS.
 *   3. Assert the response is a 307/302 redirect whose Location is
 *      SPECIFICALLY /auth/login?redirect_to=... -- the exact string this
 *      app's own auth code constructs (both middleware.ts's
 *      redirectToLogin() and requireProfile() build this literal shape,
 *      nothing generic to Next.js does). That specificity is the whole
 *      point: a wrong/garbage action id, or a malformed request, fails
 *      differently -- a Next.js "Failed to find Server Action" error, a
 *      500, or (per an earlier, abandoned attempt at hand-forging this
 *      protocol for a different action in check-server-action-auth.mjs's
 *      own header comment) a dropped connection -- never this app's own
 *      login-redirect URL. Landing on exactly this redirect is evidence
 *      the APP's auth gate fired before the action ran, not evidence of an
 *      unrelated request-framing error being rejected. A non-200 alone
 *      would not be enough to conclude that (a 404 from a bad id would
 *      also be non-200 while proving nothing); matching this exact,
 *      app-specific Location is what rules that out.
 *
 * What this still does NOT prove: that the block is `middleware.ts`
 * specifically rather than some earlier framework-level check (both fire
 * before this script can distinguish them), and it cannot positive-control
 * against a REAL authenticated invocation of this same crafted request --
 * this project has no safe way to mint a real session from a script (same
 * constraint documented in check-profile-rls.mjs and
 * scripts/try-policy-verification-paths.mjs). That the actions genuinely
 * DO execute when a real signed-in browser submits the real form is
 * verified manually (task-8-brief.md Step 4) and their guards are read
 * statically by check-profile-actions.mjs. This script's job is narrower
 * and real: a direct, no-browser, no-cookie POST carrying a genuine action
 * id is refused before the action body ever runs.
 *
 * The original page-level checks are kept alongside the action checks --
 * they test a real, separate thing (the page itself does not render or
 * leak data while signed out) and cost nothing to keep.
 *
 * FIX ROUND 2 (Important): fix round 1 covered four of the five exported
 * actions in actions.ts -- ACTIONS omitted changePassword, so the docstring's
 * claim of "each profile Server Action" was still false for the one action
 * that changes a password, architecturally identical to the other four and
 * defended by nothing action-specific. Added it, and added a count assertion
 * (below) that fails loudly if ACTIONS and actions.ts's exported functions
 * ever drift apart again, rather than relying on someone remembering to keep
 * the array in sync by hand -- which is exactly how changePassword was
 * missed the first time.
 *
 * SKIPs unless a server is already running at PROFILE_GATE_URL, so CI
 * cannot go red for want of a build. The action-invocation checks
 * specifically SKIP (not the whole file) if `.next`'s
 * server-reference-manifest for the profile page is missing: if a server
 * is running at all, a build necessarily happened, so a missing manifest
 * means Next's build output layout has changed in some future version, not
 * that a build is simply absent -- SKIPping and saying so is the honest
 * choice for a build-artifact path this script would otherwise trust
 * blindly.
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

const ACTIONS_SRC_PATH = path.join("src", "app", "(app)", "profile", "actions.ts");

const base = process.env.PROFILE_GATE_URL || "http://localhost:3000";

const res = await fetch(base, { redirect: "manual" }).catch(() => null);
if (!res) {
  console.log(`SKIP: nothing serving at ${base} — run \`npm run build && npm start\` first`);
  process.exit(0);
}

let failures = 0;
const check = (ok, label, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
};

// ── Page-level checks: an unauthenticated GET must not render the profile ──

const page = await fetch(`${base}/profile`, { redirect: "manual" });
check(
  page.status === 307 || page.status === 302,
  "GET /profile while signed out redirects",
  `got ${page.status}`,
);
check(
  (page.headers.get("location") || "").includes("/auth/login"),
  "…and the redirect goes to the login page",
  page.headers.get("location") || "no location header",
);

const body = await fetch(`${base}/profile`).then((r) => r.text());
check(!/Employee no\./.test(body), "signed-out body contains no employment fields");
check(!/display_name/.test(body), "signed-out body contains no profile form");

// ── Action-level checks: a direct POST carrying a real Next-Action id, ─────
// ── with no session, must never reach the action body ──────────────────────

const MANIFEST_PATH = path.join(
  ".next",
  "server",
  "app",
  "(app)",
  "profile",
  "page",
  "server-reference-manifest.json",
);

if (!existsSync(MANIFEST_PATH)) {
  console.log(
    `SKIP action-invocation checks: ${MANIFEST_PATH} not found — a server is\n` +
      `      running, so a build happened, but Next's build output layout must\n` +
      `      have changed. Update MANIFEST_PATH rather than trusting a guessed id.`,
  );
} else {
  const manifest = JSON.parse(readFileSync(MANIFEST_PATH, "utf8"));
  const ACTIONS = [
    "updateDisplayName",
    "uploadAvatar",
    "removeAvatar",
    "updatePreferences",
    "changePassword",
  ];

  const idsByName = {};
  for (const [id, info] of Object.entries(manifest.node ?? {})) {
    if (ACTIONS.includes(info.exportedName) && info.filename?.includes("profile/actions.ts")) {
      idsByName[info.exportedName] = id;
    }
  }

  // Coverage must not silently lag actions.ts. Rather than trust ACTIONS to
  // stay in sync by hand (that's exactly how changePassword went uncovered
  // in fix round 1), count the actual exported async functions in the
  // source and assert it matches how many ids this gate resolved. If a
  // sixth action is added later and nobody adds it to ACTIONS above, this
  // fails loudly instead of quietly testing five out of six forever.
  const actionsSrc = readFileSync(ACTIONS_SRC_PATH, "utf8");
  const exportedActionCount = (actionsSrc.match(/^export async function \w+/gm) ?? []).length;
  const resolvedCount = Object.keys(idsByName).length;
  check(
    resolvedCount === exportedActionCount,
    `this gate resolves an id for every exported action in ${ACTIONS_SRC_PATH}`,
    `resolved ${resolvedCount} of ${exportedActionCount} exported actions — ` +
      `ACTIONS lists [${ACTIONS.join(", ")}]`,
  );

  for (const name of ACTIONS) {
    const id = idsByName[name];
    if (!id) {
      check(false, `${name}: found a real action id in the build manifest`, "not present");
      continue;
    }

    const boundary = "----profileActionAuthProbe";
    const requestBody =
      `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="1_probe"\r\n\r\n` +
      `check-profile-action-auth\r\n` +
      `--${boundary}--\r\n`;

    const actionRes = await fetch(`${base}/profile`, {
      method: "POST",
      redirect: "manual",
      headers: {
        "Next-Action": id,
        Accept: "text/x-component",
        "Content-Type": `multipart/form-data; boundary=${boundary}`,
      },
      body: requestBody,
    });

    const location = actionRes.headers.get("location") || "";
    check(
      (actionRes.status === 307 || actionRes.status === 302) && location.includes("/auth/login"),
      `POST /profile with Next-Action: ${name} (${id.slice(0, 8)}…) and no session is refused`,
      `HTTP ${actionRes.status}, location ${location || "(none)"}`,
    );
  }
}

console.log(failures ? `\n${failures} FAILED` : "\nall passed");
process.exit(failures ? 1 : 0);
