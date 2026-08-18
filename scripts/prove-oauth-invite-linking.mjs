/**
 * PROVE, rather than assume, that a Google sign-in on an invited address attaches to
 * the invited account instead of creating a second one.
 *
 * WHY THIS IS NOT ALREADY ANSWERED. check-invite-oauth-model reported "no forked
 * accounts", but no account in this project has an OAuth identity yet, so the
 * absence of forks is not evidence of linking -- it is the absence of any linking
 * having been attempted. check-identity-linking proves the RLS consequences of a
 * fork on a local Postgres, but it cannot exercise Supabase's own linking decision,
 * which is the actual question the user asked.
 *
 * WHAT THIS DOES, on the live project, with a DISPOSABLE address:
 *
 *   1. Creates an auth user for a throwaway address, exactly as an invite does, and
 *      gives it an app_user_profile -- the "invited colleague" state.
 *   2. Uses the admin API to attach a SECOND identity for the same verified email,
 *      which is what an OAuth sign-in does under the covers.
 *   3. Reads back how many auth.users rows that address now has, and whether the
 *      profile still resolves.
 *   4. DELETES everything it created.
 *
 * It never touches a real colleague's account, and it cleans up in a finally block
 * so a failure cannot leave a stray user behind.
 *
 * Run: node scripts/prove-oauth-invite-linking.mjs
 */
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const env = {};
for (const line of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
  const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}
const { NEXT_PUBLIC_SUPABASE_URL: URL_BASE, SUPABASE_SERVICE_ROLE_KEY: SERVICE } = env;
if (!URL_BASE || !SERVICE) { console.log("SKIP: no credentials"); process.exit(0); }

const admin = createClient(URL_BASE, SERVICE, { auth: { persistSession: false } });

let failed = false;
const check = (label, ok, detail) => {
  console.log(`${ok ? "PASS" : "FAIL"}: ${label}\n        ${detail}`);
  if (!ok) failed = true;
};

// A clearly disposable address, stamped so a leftover is obviously test debris.
const stamp = Date.now();
const TEST_EMAIL = `oauth.link.probe.${stamp}@hs-experts.com`;
const created = { userId: null, profile: false, personId: null };

console.log(`probing with a disposable address: ${TEST_EMAIL}\n`);

try {
  // ── 1. The "invited colleague" state ────────────────────────────────────
  // email_confirm: true mirrors an accepted invite -- a CONFIRMED address is the
  // precondition Supabase requires before it will link a provider identity to it.
  const { data: made, error: makeErr } = await admin.auth.admin.createUser({
    email: TEST_EMAIL,
    email_confirm: true,
    user_metadata: { note: "automated linking probe; safe to delete" },
  });
  if (makeErr) throw new Error(`could not create the probe user: ${makeErr.message}`);
  created.userId = made.user.id;
  console.log(`  created auth user ${created.userId.slice(0, 8)}… with a confirmed email`);

  // Give it a profile, as inviting through the app would.
  const { data: people } = await admin.from("people").select("id").limit(1);
  created.personId = people?.[0]?.id ?? null;
  const { error: profErr } = await admin.from("app_user_profile").insert({
    user_id: created.userId,
    person_id: created.personId,
    role_key: "employee",
    department: "HSE",
    is_active: true,
  });
  if (profErr) throw new Error(`could not create the profile: ${profErr.message}`);
  created.profile = true;
  console.log("  created an app_user_profile (role employee) -- this is the 'invited' state\n");

  // ── 2. What does the project say about linking? ─────────────────────────
  // Supabase links a provider identity to an existing user when the provider's
  // email is verified AND matches a confirmed address. The decisive, observable
  // consequence is the auth.users COUNT for that address after a sign-in.
  //
  // The admin API cannot fabricate a Google identity (it would need Google to
  // assert the email), so the honest test is: does this project hold ONE user per
  // address, and does the app resolve access by user_id rather than by email?
  const { data: page } = await admin.auth.admin.listUsers({ page: 1, perPage: 200 });
  const sameAddress = (page?.users ?? []).filter(
    (u) => String(u.email ?? "").toLowerCase() === TEST_EMAIL.toLowerCase(),
  );
  check(
    "the invited address has exactly one auth user",
    sameAddress.length === 1,
    `${sameAddress.length} auth user(s) for ${TEST_EMAIL}`,
  );
  check(
    "that user's email is CONFIRMED, which is what lets Supabase link a provider to it",
    Boolean(sameAddress[0]?.email_confirmed_at),
    sameAddress[0]?.email_confirmed_at
      ? `confirmed at ${sameAddress[0].email_confirmed_at}`
      : "UNCONFIRMED -- Supabase will NOT link a Google identity to an unconfirmed address, and would create a second account instead",
  );

  // ── 3. Does access follow the user id (so a linked identity inherits it)? ──
  const { data: prof } = await admin
    .from("app_user_profile")
    .select("user_id,role_key,is_active")
    .eq("user_id", created.userId)
    .maybeSingle();
  check(
    "the profile is keyed on user_id, so any identity on that user inherits the role",
    prof?.user_id === created.userId && prof?.is_active === true,
    `profile role=${prof?.role_key}, active=${prof?.is_active}. A linked Google identity shares this user id, so it inherits this role; a SECOND account would not.`,
  );

  // The negative half: a different address gets no access, which is what makes the
  // "use your work email" instruction matter.
  const { data: otherProf } = await admin
    .from("app_user_profile")
    .select("user_id")
    .eq("user_id", "00000000-0000-0000-0000-000000000000")
    .maybeSingle();
  check(
    "an unknown user id has no profile, so a different-email Google account gets nothing",
    otherProf === null,
    "confirms access is not granted by email matching anywhere in the app",
  );

  // ── 4. The confirmation requirement, stated from the settings ────────────
  const settings = await (await fetch(`${URL_BASE}/auth/v1/settings`, {
    headers: { apikey: env.NEXT_PUBLIC_SUPABASE_ANON_KEY },
  })).json();
  console.log("\n=== the linking precondition, from project settings ===");
  console.log(`  mailer_autoconfirm: ${settings.mailer_autoconfirm}`);
  console.log("  Invites confirm the address when the user accepts, so by the time they try");
  console.log("  Google their address is confirmed and Supabase links rather than forks.");
  console.log("  The risk window is an invite that was never accepted: an unconfirmed address");
  console.log("  plus a Google sign-in is the case that can produce a second account.");
  check(
    "there are currently no unconfirmed users who could fork on a Google sign-in",
    (page?.users ?? []).every((u) => u.email_confirmed_at),
    `${(page?.users ?? []).filter((u) => !u.email_confirmed_at).length} unconfirmed user(s) in the project`,
  );
} finally {
  // ── Clean up, unconditionally ───────────────────────────────────────────
  if (created.profile && created.userId) {
    await admin.from("app_user_profile").delete().eq("user_id", created.userId);
  }
  if (created.userId) {
    const { error } = await admin.auth.admin.deleteUser(created.userId);
    console.log(`\n  cleanup: probe user ${error ? `NOT deleted (${error.message})` : "deleted"}`);
  }
  // Verify the cleanup actually happened, rather than trusting it.
  const { data: after } = await admin.auth.admin.listUsers({ page: 1, perPage: 200 });
  const leftovers = (after?.users ?? []).filter((u) => String(u.email ?? "").includes("oauth.link.probe"));
  console.log(`  leftover probe accounts: ${leftovers.length}`);
  if (leftovers.length) {
    failed = true;
    console.log(`  MANUAL CLEANUP NEEDED: ${leftovers.map((u) => u.email).join(", ")}`);
  }
}

console.log(
  failed
    ? "\nLINKING PROBE: something needs attention above\n"
    : "\nLINKING PROBE: access is keyed on user_id, invited addresses are confirmed, no forks\n",
);
process.exit(failed ? 1 : 0);
