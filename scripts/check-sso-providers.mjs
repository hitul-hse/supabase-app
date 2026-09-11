/**
 * Which sign-in providers does the live Supabase project actually accept?
 *
 * The SSO code is complete and tested, but the buttons cannot work until each
 * provider is configured in Google Cloud / Azure and enabled in Supabase. That is
 * console work, so nothing in the repo can perform it — but it CAN be observed,
 * which turns "did someone remember to do it" from a guess into a check.
 *
 * How: /auth/v1/authorize is the endpoint the browser is sent to. Asking for a
 * disabled provider answers 400 with `provider is not enabled`; an enabled one
 * answers with a redirect toward the provider. The request is never followed, so
 * no consent screen is involved and nothing is signed in.
 *
 * Read-only, and it SKIPS rather than fails without credentials, so CI cannot go
 * red over a missing secret.
 */
import { readFileSync, existsSync } from "node:fs";
import { record, notRun } from "./lib/gate-result.mjs";

if (!existsSync(".env.local")) {
  console.log("SKIP: no .env.local — nothing to probe");
  notRun();
}

const env = readFileSync(".env.local", "utf8");
const get = (k) => (env.match(new RegExp(`^${k}=(.+)$`, "m")) || [])[1]?.trim();
const url = get("NEXT_PUBLIC_SUPABASE_URL");
const anon = get("NEXT_PUBLIC_SUPABASE_ANON_KEY");
const siteUrl = get("NEXT_PUBLIC_SITE_URL");

if (!url || !anon) {
  console.log("SKIP: no Supabase URL/key in .env.local");
  notRun();
}

console.log(`live project: ${url}\n`);

let notReady = 0;
/**
 * `ok` means "this expectation holds", which since 2026-09-08 is not the same as
 * "this provider is switched on": one of the expectations below is that a provider
 * is switched OFF. The label therefore says OK / WRONG rather than ENABLED / NOT
 * SET, because a line reading "ENABLED — Microsoft is not accepted" is a gate
 * telling you the opposite of what it checked, and that is how a passing run gets
 * misread as a failing one.
 */
const report = (ok, name, detail = "") => {
  record(ok);
  console.log(`${ok ? "OK     " : "WRONG  "} ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) notReady++;
};

/**
 * Is a provider enabled? `redirect: manual` so the 302 toward Google/Microsoft is
 * observed rather than followed.
 */
async function probe(provider) {
  const callback = `${siteUrl ?? "http://localhost:3000"}/auth/callback`;
  const target =
    `${url}/auth/v1/authorize?provider=${provider}` +
    `&redirect_to=${encodeURIComponent(callback)}`;

  const res = await fetch(target, {
    headers: { apikey: anon },
    redirect: "manual",
  });

  // A redirect toward the provider's own domain means Supabase accepted it.
  if (res.status >= 300 && res.status < 400) {
    const loc = res.headers.get("location") ?? "";
    return { ok: true, detail: new URL(loc).host };
  }

  let body = "";
  try {
    const json = await res.json();
    body = json.msg ?? json.error_description ?? json.error ?? JSON.stringify(json);
  } catch {
    body = `HTTP ${res.status}`;
  }
  return { ok: false, detail: `${res.status}: ${body}` };
}

for (const [provider, label] of [["google", "Google"]]) {
  const { ok, detail } = await probe(provider);
  report(ok, `${label} is enabled`, detail);
}

/**
 * Microsoft is REMOVED FROM THE PRODUCT, so this assertion is inverted rather than
 * deleted (2026-09-08, hitul's decision; board ticket 37).
 *
 * Deleting the check would have been the easy move and the wrong one. Until today
 * this gate failed every night because azure was not enabled, and the temptation on
 * a removal is to drop the line that was red. But the interesting failure now runs
 * the other way: if somebody enables the azure provider in the Supabase project,
 * accounts can be created through a path the application no longer offers, reviews
 * or explains. That is worth catching, and nothing else catches it.
 *
 * So the question changes from "is Microsoft enabled?" to "is Microsoft still off?",
 * and the gate keeps a real assertion instead of one fewer.
 */
{
  const { ok, detail } = await probe("azure");
  report(
    !ok,
    "Microsoft (azure) is not accepted by the project",
    ok
      ? `ENABLED in Supabase (${detail}), but the app removed Microsoft sign-in — disable it in Authentication -> Providers`
      : "disabled, as the product expects",
  );
}

if (notReady > 0) {
  console.log(
    "\n  FIX: enable the provider in Supabase → Authentication → Providers, after\n" +
      "       creating its OAuth client. Full steps, including the exact redirect\n" +
      "       URIs the Google console needs:\n" +
      "         docs/architecture/SSO-GOOGLE-MICROSOFT.md (Microsoft half now historical)",
  );
}

// The redirect allowlist is the other half, and its failure mode is nastier: the
// provider works, the user consents, and Supabase then quietly sends them to the
// bare Site URL instead of /auth/callback, so the code is never exchanged.
// Whether a URL is allowlisted is not readable through the anon API, so this is a
// reminder rather than an assertion — stated precisely so it is actionable.
const needed = new Set(["http://localhost:3000/auth/callback"]);
if (siteUrl) needed.add(`${siteUrl.replace(/\/$/, "")}/auth/callback`);

console.log("\nAlso confirm Authentication → URL Configuration lists every callback:");
for (const u of needed) console.log(`  ${u}`);
console.log(
  "  (not readable via the anon API; if one is missing, sign-in appears to work\n" +
    "   and then silently drops the code at the Site URL)",
);

// A production deploy whose NEXT_PUBLIC_SITE_URL still says localhost sends OAuth
// users back to their own machine after consenting. Worth saying out loud, since
// the value is easy to leave behind when copying .env.local to a host.
if (!siteUrl || /localhost|127\.0\.0\.1/.test(siteUrl)) {
  console.log(
    `\n  NOTE: NEXT_PUBLIC_SITE_URL is ${siteUrl ?? "unset"}, which is fine locally.\n` +
      "        On a deployed environment it must be the real origin, or users are\n" +
      "        redirected back to localhost after consenting.",
  );
}

console.log(
  notReady === 0
    ? "\nSSO PROVIDERS: Google is enabled and the removed Microsoft provider is not accepted"
    : `\nSSO PROVIDERS: ${notReady} expectation(s) not met — see the WRONG line(s) above`,
);
process.exit(notReady === 0 ? 0 : 1);
