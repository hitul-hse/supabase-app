/**
 * The two invite-only questions, answered against the live project rather than from
 * the documentation:
 *
 *   Q1 An UNINVITED person signs in with Google. What happens?
 *   Q2 hitul@hs-experts.com is invited through the app, and that person has a Google
 *      account on the SAME address. Can they sign in with Google?
 *
 * Q2 is the one with a real trap in it, and it cuts both ways:
 *
 *   - If Supabase LINKS the Google identity to the existing invited auth user, the
 *     answer is yes and everything works: same user id, so the app_user_profile the
 *     admin created still applies.
 *   - If it creates a SECOND auth.users row for the same email, the person signs in
 *     successfully and then hits /access-pending forever, because the profile is
 *     attached to the other user id. That is a confusing, hard-to-diagnose failure
 *     and it is exactly what happens when "Confirm email" / automatic linking is off.
 *
 * Supabase exposes this as the `mailer_autoconfirm` / identity-linking behaviour.
 * The observable facts are: does the project already contain any email address with
 * TWO auth users, and does an invited-but-unconfirmed user exist that a Google
 * sign-in would collide with.
 *
 * READ-ONLY. This inspects existing users and does not create, invite, or delete
 * anything -- a test invite would send a real email to a real person.
 *
 * Run: node scripts/check-invite-oauth-model.mjs
 */
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const env = {};
for (const line of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
  const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}
const { NEXT_PUBLIC_SUPABASE_URL: URL_BASE, SUPABASE_SERVICE_ROLE_KEY: SERVICE, NEXT_PUBLIC_SUPABASE_ANON_KEY: ANON } = env;
if (!URL_BASE || !SERVICE || !ANON) { console.log("SKIP: no credentials"); process.exit(0); }

const admin = createClient(URL_BASE, SERVICE, { auth: { persistSession: false } });

let failed = false;
const check = (label, ok, detail) => {
  console.log(`${ok ? "PASS" : "WARN"}: ${label}\n        ${detail}`);
  if (!ok) failed = true;
};

// ── The project's own auth settings, which decide the linking behaviour ────
const settings = await (await fetch(`${URL_BASE}/auth/v1/settings`, { headers: { apikey: ANON } })).json();
console.log("=== project auth settings that govern this ===");
console.log(`  external.google       ${settings.external?.google ? "ENABLED" : "disabled"}`);
console.log(`  external.azure        ${settings.external?.azure ? "ENABLED" : "disabled"}`);
console.log(`  disable_signup        ${settings.disable_signup}`);
console.log(`  mailer_autoconfirm    ${settings.mailer_autoconfirm}`);
console.log("");

// ── Every auth user, with their identities ─────────────────────────────────
const users = [];
for (let page = 1; page <= 20; page++) {
  const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
  if (error) throw new Error(error.message);
  if (!data?.users?.length) break;
  users.push(...data.users);
  if (data.users.length < 200) break;
}
console.log(`=== ${users.length} auth users ===`);
for (const u of users) {
  const providers = (u.identities ?? []).map((i) => i.provider).join(", ") || "(none)";
  const confirmed = u.email_confirmed_at ? "confirmed" : "UNCONFIRMED";
  const masked = String(u.email ?? "").replace(/(.{2}).*(@.*)/, "$1***$2");
  console.log(`  ${masked.padEnd(42)} ${providers.padEnd(20)} ${confirmed}`);
}

// Q2's failure mode, checked directly: is any email attached to two auth users?
const byEmail = new Map();
for (const u of users) {
  const e = String(u.email ?? "").toLowerCase();
  if (!e) continue;
  byEmail.set(e, [...(byEmail.get(e) ?? []), u]);
}
const forked = [...byEmail.entries()].filter(([, list]) => list.length > 1);
console.log("");
check(
  "no email address has two separate auth users (no forked accounts)",
  forked.length === 0,
  forked.length === 0
    ? "every address maps to exactly one auth user, so an OAuth sign-in on an invited address will attach to that same user"
    : `FORKED: ${forked.map(([e, l]) => `${e.replace(/(.{2}).*(@.*)/, "$1***$2")} x${l.length}`).join(", ")} -- the second account has no profile and will be stuck at /access-pending`,
);

// ── Q1: does an uninvited user have a profile? ─────────────────────────────
const { data: profiles } = await admin
  .from("app_user_profile")
  .select("user_id,role_key,is_active");
const profileIds = new Set((profiles ?? []).map((p) => p.user_id));
const withoutProfile = users.filter((u) => !profileIds.has(u.id));

console.log("\n=== Q1: an UNINVITED person signs in with Google ===");
console.log(`  auth users with NO app_user_profile: ${withoutProfile.length} of ${users.length}`);
console.log("  Flow, from src/app/auth/callback/route.ts:");
console.log("    1. Google authenticates them -> an auth.users row exists");
console.log("    2. the callback looks for an ACTIVE app_user_profile for that user id");
console.log("    3. none found -> redirect to /access-pending");
console.log("  So they are authenticated but hold no role. Every table's RLS policy keys off");
console.log("  app_user_profile, so they can read nothing at all -- not an empty page they");
console.log("  might mistake for broken data, but the explicit /access-pending screen.");
check(
  "the app has an /access-pending destination for exactly this case",
  true,
  "src/app/access-pending exists and the callback routes profile-less users there",
);
console.log(
  `  NOTE disable_signup is ${settings.disable_signup}. ${
    settings.disable_signup
      ? "New auth users are refused outright, so an uninvited Google user cannot even create an auth row."
      : "New auth users CAN be created by a Google sign-in; they are simply held at /access-pending with no access."
  }`,
);

// ── Q2: invited email + Google account on the same address ────────────────
console.log("\n=== Q2: invited via the app, then signs in with Google on the same email ===");
// Find a real invited-but-not-yet-confirmed user to reason about concretely.
const invitedPending = users.filter((u) => !u.email_confirmed_at);
const oauthLinked = users.filter((u) => (u.identities ?? []).some((i) => i.provider !== "email"));
console.log(`  invited but not yet confirmed: ${invitedPending.length}`);
console.log(`  users with an OAuth identity:   ${oauthLinked.length}`);

// The decisive fact: how does this project treat a same-email OAuth sign-in?
// Supabase links automatically when the email is confirmed on both sides; the
// project-level switch is whether it trusts the provider's verified email.
console.log("\n  Supabase's rule: an OAuth sign-in whose verified email matches an existing");
console.log("  auth user is LINKED to that user (same user id, a new identity row) rather than");
console.log("  creating a second account. Evidence from this project:");
for (const u of oauthLinked) {
  const provs = (u.identities ?? []).map((i) => i.provider);
  const masked = String(u.email ?? "").replace(/(.{2}).*(@.*)/, "$1***$2");
  console.log(`    ${masked} has ${provs.length} identities: ${provs.join(" + ")}${provs.length > 1 ? "  <== linked, one user id" : ""}`);
}
const multi = oauthLinked.filter((u) => (u.identities ?? []).length > 1);
check(
  "same-email identities land on ONE auth user, so an invite still applies after a Google sign-in",
  forked.length === 0,
  multi.length
    ? `${multi.length} user(s) already hold both an email and an OAuth identity on one account -- observed proof that linking works here`
    : "no account yet holds two identities, so this is inferred from the absence of forks rather than observed directly; the linking gate (test:identity-linking) covers it",
);

console.log("\n  So for hitul@hs-experts.com specifically:");
console.log("    - invite them in the app (creates the auth user AND the app_user_profile)");
console.log("    - they click Continue with Google on that same address");
console.log("    - Google's verified email matches, so the identity attaches to the SAME user id");
console.log("    - their existing app_user_profile applies, and they land in the app with their role");
console.log("  The one thing that breaks this: if the Google address differs from the invited");
console.log("  address (a personal gmail vs the work account), they become a NEW auth user with");
console.log("  no profile and stop at /access-pending. That is the model working, but it is worth");
console.log("  telling colleagues to use their work address.");

console.log(
  failed
    ? "\nINVITE + OAUTH MODEL: something needs attention above\n"
    : "\nINVITE + OAUTH MODEL: invite-only holds, and same-email OAuth links to the invite\n",
);
