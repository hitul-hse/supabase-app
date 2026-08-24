// Mint a one-time sign-in link for a colleague so a human can test the app AS
// them, without resetting their password and without ever seeing it.
//
// Why a magic link rather than credentials: setting a password would lock the
// real person out of their own account and would be a destructive change to a
// live system. A magiclink is single-use, expires on its own, and leaves the
// account exactly as it was.
//
//   node scripts/issue-test-login-link.mjs <email> [--target production|local]
import { readFileSync } from "node:fs";

const env = Object.fromEntries(
  readFileSync("C:/Supabase/.env.local", "utf8").split(/\r?\n/)
    .filter((l) => l && !l.startsWith("#") && l.includes("="))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^"|"$/g, "")]; }));

const email = process.argv[2];
if (!email) { console.log("usage: node scripts/issue-test-login-link.mjs <email> [--target production|local] [--next /my-work]"); process.exit(1); }

const argVal = (name, fallback) => {
  const eq = process.argv.find((a) => a.startsWith(`--${name}=`));
  if (eq) return eq.split("=").slice(1).join("=");
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
};

const target = argVal("target", "production");
const next = argVal("next", "/my-work");
const SITE = target === "local" ? "http://localhost:3000" : "https://hseportal.hs-experts.com";

const URL_ = env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE = env.SUPABASE_SERVICE_ROLE_KEY;

const res = await fetch(`${URL_}/auth/v1/admin/generate_link`, {
  method: "POST",
  headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, "Content-Type": "application/json" },
  body: JSON.stringify({ type: "magiclink", email, options: { redirect_to: `${SITE}/auth/callback` } }),
});

if (!res.ok) { console.log(`failed: ${res.status} ${(await res.text()).slice(0, 300)}`); process.exit(1); }
const body = await res.json();

const hashed = body?.properties?.hashed_token ?? body?.hashed_token;
const userId = body?.user?.id ?? body?.id;
if (!hashed) { console.log(`unexpected shape: ${JSON.stringify(body).slice(0, 300)}`); process.exit(1); }

// IMPORTANT: point the human straight at our own /auth/callback with
// `token_hash`, NOT at Supabase's /auth/v1/verify.
//
// Verified by reading src/app/auth/callback/route.ts: it handles `?code=` and
// `?token_hash=&type=`, and its own comment states that the implicit flow puts
// tokens in the URL *fragment*, "which browsers never send to the server, so
// this handler cannot see it". Supabase's /verify endpoint 303s to
// `/auth/callback#access_token=...`, so a link built that way would land the
// visitor on a page that cannot read their credential. This form is the one the
// route actually implements.
//
// `next` must be a same-origin relative path; the route rejects anything else
// to avoid an open redirect right after authentication.
const link = `${SITE}/auth/callback?token_hash=${hashed}&type=magiclink&next=${encodeURIComponent(next)}`;

console.log(`\nOne-time sign-in link for ${email}`);
console.log(`   user id : ${userId}`);
console.log(`   lands on: ${SITE}${next}`);
console.log(`   single use, expires on its own, password NOT changed\n`);
console.log(link);
console.log(`\nOpen it in a private/incognito window so it does not collide with your own session.`);
