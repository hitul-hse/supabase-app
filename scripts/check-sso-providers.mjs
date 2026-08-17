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

if (!existsSync(".env.local")) {
  console.log("SKIP: no .env.local — nothing to probe");
  process.exit(0);
}

const env = readFileSync(".env.local", "utf8");
const get = (k) => (env.match(new RegExp(`^${k}=(.+)$`, "m")) || [])[1]?.trim();
const url = get("NEXT_PUBLIC_SUPABASE_URL");
const anon = get("NEXT_PUBLIC_SUPABASE_ANON_KEY");
const siteUrl = get("NEXT_PUBLIC_SITE_URL");

if (!url || !anon) {
  console.log("SKIP: no Supabase URL/key in .env.local");
  process.exit(0);
}

console.log(`live project: ${url}\n`);

let notReady = 0;
const report = (ok, name, detail = "") => {
  console.log(`${ok ? "ENABLED  " : "NOT SET  "} ${name}${detail ? ` — ${detail}` : ""}`);
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

for (const [provider, label] of [
  ["google", "Google"],
  ["azure", "Microsoft (azure)"],
]) {
  const { ok, detail } = await probe(provider);
  report(ok, label, detail);
}

if (notReady > 0) {
  console.log(
    "\n  FIX: enable the provider in Supabase → Authentication → Providers, after\n" +
      "       creating its OAuth client. Full steps, including the exact redirect\n" +
      "       URIs each console needs:\n" +
      "         docs/architecture/SSO-GOOGLE-MICROSOFT.md",
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
    ? "\nSSO PROVIDERS: both enabled on the live project"
    : `\nSSO PROVIDERS: ${notReady} not enabled yet — the buttons will show an error until then`,
);
process.exit(notReady === 0 ? 0 : 1);
