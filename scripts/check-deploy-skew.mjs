/**
 * Deployment skew is handled, not left as a broken page.
 *
 * THE BUG THIS LOCKS DOWN. A user recording the org chart ("Björn is CEO, everyone
 * reports to him") had the page break and ask for a reload when saving a reporting
 * line. The org chart was not at fault -- single edits, deep trees, reporting loops
 * and five consecutive saves were all driven through the live site without failing.
 * The cause was skew: a Server Action is addressed by an opaque ID baked into the JS
 * bundle at BUILD time, every deploy mints new IDs, and a tab loaded before a deploy
 * holds IDs the new server has never heard of. Six deploys landed during that
 * session.
 *
 * Verified against production at the time, with a real session:
 *
 *     POST /people, Next-Action: <well-formed but unknown id>
 *     -> HTTP 404, x-nextjs-action-not-found=1, body "Server action not found."
 *
 * WHAT IS ASSERTED, and why in this order:
 *
 *  1. next.config.ts pins deploymentId from VERCEL_DEPLOYMENT_ID. This is the real
 *     cure: requests carry the deployment that built them, so Vercel can route them
 *     back to it. Asserted by parsing the config, and NOT by matching the whole line
 *     verbatim, so reformatting does not break the gate.
 *
 *  2. The live endpoint still rejects an unknown action id rather than doing
 *     something worse. A 404 is the correct answer; silently running a DIFFERENT
 *     action would be a security problem, so this is a real assertion and not a
 *     restatement of the bug.
 *
 *  3. The recovery UI exists and is mounted in the app shell. Skew stays possible
 *     until Skew Protection is enabled on the project, and afterwards for tabs older
 *     than the retention window, so the user-facing half has to be there too.
 *
 * The last one is a source assertion by necessity: the failure needs a redeploy
 * mid-session to trigger, which cannot be staged against production from a test.
 * So the runtime half is covered by (2) and the presence and wiring of the notice is
 * covered here.
 */
import { readFileSync } from "node:fs";

let failed = 0;
const check = (name, ok, detail = "") => {
  if (!ok) failed += 1;
  console.log(`${ok ? "PASS" : "FAIL"}: ${name}${detail ? `\n        ${detail}` : ""}`);
};

// ── 1. The config pins a deployment id ──────────────────────────────────
const config = readFileSync("next.config.ts", "utf8");
const stripped = config.replace(/\/\/[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");

check(
  "next.config.ts sets deploymentId",
  /\bdeploymentId\s*:/.test(stripped),
  "without it every deploy invalidates the action ids in every open tab, and the only recovery offered is a manual reload",
);
check(
  "deploymentId comes from VERCEL_DEPLOYMENT_ID, not a hardcoded string",
  /\bdeploymentId\s*:\s*process\.env\.VERCEL_DEPLOYMENT_ID\b/.test(stripped),
  "a literal would pin every future build to one stale deployment, which is worse than not setting it",
);

// ── 2. The recovery notice exists and is wired into the shell ───────────
let notice = "";
try {
  notice = readFileSync("src/components/StaleDeployNotice.tsx", "utf8");
} catch {
  /* reported by the check below */
}
check("the skew recovery notice exists", notice.length > 0, "src/components/StaleDeployNotice.tsx");
check(
  "it is a client component (it listens to window events)",
  /^"use client"/.test(notice.trimStart()),
  "a server component cannot attach an unhandledrejection listener",
);
check(
  "it recognises Next's missing-action wording",
  /Failed to find Server Action/i.test(notice) && /Server action not found/i.test(notice),
  "both spellings appear across Next versions and the 404 body uses the second",
);
check(
  "it listens for unhandledrejection, not just render errors",
  /unhandledrejection/.test(notice),
  "an action's rejection never passes through an error boundary, so error.tsx cannot catch this",
);
check(
  "it does NOT reload the page by itself",
  !/useEffect\([^)]*\)\s*=>\s*\{[^}]*location\.reload/s.test(notice) &&
    /onClick=\{\(\) => window\.location\.reload\(\)\}/.test(notice),
  "an automatic reload would discard whatever the user had typed; the button leaves the choice to them",
);

const layout = readFileSync("src/app/(app)/layout.tsx", "utf8");
check(
  "the notice is mounted in the (app) shell, so every page is covered",
  /import \{ StaleDeployNotice \}/.test(layout) && /<StaleDeployNotice \/>/.test(layout),
  "mounting it per-page would leave the pages nobody thought about unprotected",
);

// ── 3. The live endpoint still rejects an unknown action id ─────────────
// Unauthenticated is enough for this one: the assertion is that a bogus id is not
// honoured, and a 307 to login is also a refusal. Skipped when offline so the gate
// does not fail for the wrong reason.
const SITE = process.env.SITE ?? "https://hseportal.hs-experts.com";
try {
  const res = await fetch(`${SITE}/people`, {
    method: "POST",
    headers: { "Next-Action": "a".repeat(40), "Content-Type": "text/plain;charset=UTF-8" },
    body: "[]",
    redirect: "manual",
    signal: AbortSignal.timeout(20_000),
  });
  const body = await res.text().catch(() => "");
  check(
    "an unknown action id is refused rather than dispatched to something else",
    res.status >= 300,
    `HTTP ${res.status}${res.headers.get("x-nextjs-action-not-found") ? " (x-nextjs-action-not-found=1)" : ""} ${body.slice(0, 80).replace(/\s+/g, " ")}`,
  );
} catch (err) {
  console.log(`SKIP: could not reach ${SITE} -- ${err instanceof Error ? err.message : String(err)}`);
}

console.log(failed === 0 ? "\nDEPLOY SKEW: all checks passed" : `\n${failed} check(s) failed`);
process.exit(failed === 0 ? 0 : 1);
