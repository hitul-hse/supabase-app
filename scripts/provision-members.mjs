/**
 * Provision Hub accounts for the real TrackingTime roster.
 *
 * WHY THIS EXISTS. The Hub has 49 real people in TrackingTime and, before this,
 * three Hub accounts on real work addresses. So the access model, the role
 * system and every per-person feature were untestable: there was nobody to
 * assign, nobody to scope a department to, and no hierarchy to draw.
 *
 * WHAT IT DOES NOT DO: send email. `createUser` is used, not
 * `inviteUserByEmail`, so nothing lands in fifteen colleagues' inboxes. The
 * accounts exist, appear in /admin/users, hold a role, and are linked to their
 * TrackingTime member -- but cannot be signed into until someone sets a password.
 * Inviting for real is a separate, deliberate step (--invite), because fifteen
 * unexpected emails to real people is not an action you can take back.
 *
 * WHO IS INCLUDED, and why the filters are not arbitrary:
 *
 *   - not archived in TrackingTime. 30 of 49 are leavers or dormant; giving them
 *     accounts would be handing access to people who left.
 *   - has an @hs-experts.com address. Excludes `stefan-external@hs-expert.com`
 *     (an external contractor, and note the different domain) and personal gmail
 *     addresses. Verified: 18 of 19 active members qualify.
 *   - not a shared mailbox. `info@` and `jobs@` hold member records but are
 *     inboxes, not colleagues.
 *
 * ROLE MAPPING. TrackingTime's `role` is an ACCESS LEVEL for a time tracker, not
 * a job. Mapping it to the Hub's roles is a judgement, so it is conservative:
 * nobody is made an Executive automatically, because exec sees all money and all
 * people. The mapping is printed for every account so it can be corrected in
 * /admin/users, which is the right place for that decision.
 *
 *     TrackingTime         ->  Hub role
 *     MANAGER              ->  dept_head
 *     PROJECT_MANAGER      ->  project_manager
 *     ADMIN                ->  employee   (deliberately NOT exec -- see above)
 *     CO_WORKER            ->  employee
 *
 * IDEMPOTENT. Re-running skips anyone who already has an account, and links any
 * member whose account exists but is not yet linked. Safe to run twice.
 *
 * Usage:
 *     node scripts/provision-members.mjs            # dry run, changes nothing
 *     node scripts/provision-members.mjs --apply    # create accounts, no email
 *     node scripts/provision-members.mjs --apply --invite   # also email invites
 */
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const APPLY = process.argv.includes("--apply");
const INVITE = process.argv.includes("--invite");

const env = {};
for (const line of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
  const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}
if (!env.NEXT_PUBLIC_SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
  console.log("SKIP: need NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY");
  process.exit(0);
}
const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

/** Shared inboxes that hold member records but are not people. */
const SHARED_MAILBOX = /^(info|jobs|no-reply|noreply|office|admin|team)@/i;

/** The company's own domain. An external contractor is not a Hub user by default. */
const COMPANY_DOMAIN = /@hs-experts\.com$/i;

const ROLE_MAP = {
  MANAGER: "dept_head",
  PROJECT_MANAGER: "project_manager",
  ADMIN: "employee",
  CO_WORKER: "employee",
};

const members = (await admin
  .schema("time")
  .from("member")
  .select("id, display_name, email, role, status, is_archived, user_id")
  .then(({ data, error }) => {
    if (error) { console.log(`FATAL: ${error.message}`); process.exit(1); }
    return data;
  }));

const { data: authList } = await admin.auth.admin.listUsers();
const userIdByEmail = new Map(
  authList.users.map((u) => [(u.email ?? "").toLowerCase(), u.id]),
);
const { data: profiles } = await admin.from("app_user_profile").select("user_id, role_key");
const profiledUserIds = new Set((profiles ?? []).map((p) => p.user_id));

const eligible = [];
const skipped = [];
for (const m of members) {
  const email = (m.email ?? "").toLowerCase();
  if (m.is_archived) { skipped.push([m, "archived in TrackingTime"]); continue; }
  if (!email) { skipped.push([m, "no email address"]); continue; }
  if (SHARED_MAILBOX.test(email)) { skipped.push([m, "shared mailbox, not a person"]); continue; }
  if (!COMPANY_DOMAIN.test(email)) { skipped.push([m, "not an @hs-experts.com address"]); continue; }
  eligible.push(m);
}

console.log(`${APPLY ? "APPLYING" : "DRY RUN (pass --apply to make changes)"}\n`);
console.log(`TrackingTime members: ${members.length}`);
console.log(`eligible for a Hub account: ${eligible.length}`);
console.log(`skipped: ${skipped.length}\n`);

for (const [m, why] of skipped) {
  console.log(`  skip  ${String(m.display_name).slice(0, 26).padEnd(26)} ${String(m.email ?? "").padEnd(36)} ${why}`);
}

console.log("");
let created = 0;
let linked = 0;
let alreadyFine = 0;
let failed = 0;

for (const m of eligible) {
  const email = m.email.toLowerCase();
  const roleKey = ROLE_MAP[m.role] ?? "employee";
  let userId = userIdByEmail.get(email);
  const actions = [];

  // On a dry run the account is not created, so there is no id to compare
  // against for the profile and link steps below. Tracking that explicitly
  // matters: without it the dry run reported "members to link: 0" while
  // planning to link fifteen, which is exactly the kind of misleading preview
  // someone would approve without realising what it does.
  const willCreateAccount = !userId;

  // 1. The auth account.
  if (!userId) {
    if (APPLY) {
      const { data, error } = await admin.auth.admin.createUser({
        email,
        email_confirm: false,
        user_metadata: { display_name: m.display_name, source: "trackingtime" },
      });
      if (error) {
        console.log(`  FAIL  ${m.display_name}: ${error.message}`);
        failed += 1;
        continue;
      }
      userId = data.user.id;
      userIdByEmail.set(email, userId);
    }
    actions.push("create account");
    created += 1;
  }

  // 2. The profile, which is what actually makes them a Hub user.
  if (willCreateAccount || (userId && !profiledUserIds.has(userId))) {
    if (APPLY && userId) {
      const { error } = await admin.from("app_user_profile").insert({
        user_id: userId,
        role_key: roleKey,
        // Deliberately null: this used to point at one of eight seeded mockup
        // people. The real link is member.user_id, set below.
        person_id: null,
        department: null,
        is_active: true,
      });
      if (error) {
        console.log(`  FAIL  ${m.display_name} profile: ${error.message}`);
        failed += 1;
        continue;
      }
      profiledUserIds.add(userId);
    }
    actions.push(`role=${roleKey}`);
  }

  // 3. Link the TrackingTime member to the account, so their own hours resolve.
  //    time.current_member_id() checks user_id first, so this is the link that
  //    makes /time work for them.
  if (willCreateAccount || (userId && m.user_id !== userId)) {
    if (m.user_id && userId && m.user_id !== userId) {
      // Someone else owns this member record. Never reassign silently: that would
      // move one person's logged hours onto another's account.
      console.log(`  WARN  ${m.display_name}: member already linked to a different account, left alone`);
    } else {
      if (APPLY && userId) {
        const { error } = await admin.schema("time").from("member")
          .update({ user_id: userId }).eq("id", m.id);
        if (error) {
          console.log(`  FAIL  ${m.display_name} link: ${error.message}`);
          failed += 1;
          continue;
        }
      }
      actions.push("link to TrackingTime");
      linked += 1;
    }
  }

  // 4. Optional real invite email.
  if (INVITE && APPLY && actions.length) {
    const { error } = await admin.auth.admin.inviteUserByEmail(email, {
      redirectTo: `${env.NEXT_PUBLIC_SITE_URL ?? "https://hseportal.hs-experts.com"}/auth/callback?next=%2Fauth%2Fset-password`,
    });
    actions.push(error ? `INVITE FAILED: ${error.message}` : "invited by email");
  }

  if (actions.length === 0) {
    alreadyFine += 1;
    console.log(`  ok    ${m.display_name.slice(0, 26).padEnd(26)} ${email.padEnd(36)} already provisioned`);
  } else {
    console.log(`  ${APPLY ? "done" : "plan"}  ${m.display_name.slice(0, 26).padEnd(26)} ${email.padEnd(36)} TT=${String(m.role).padEnd(16)} ${actions.join(", ")}`);
  }
}

console.log(`\naccounts ${APPLY ? "created" : "to create"}: ${created}`);
console.log(`members ${APPLY ? "linked" : "to link"}: ${linked}`);
console.log(`already provisioned: ${alreadyFine}`);
if (failed) console.log(`FAILURES: ${failed}`);

if (!APPLY) {
  console.log("\nNothing was changed. Re-run with --apply to provision.");
} else if (!INVITE) {
  console.log("\nNo email was sent. These accounts exist and hold roles, but cannot be");
  console.log("signed into until a password is set. Add --invite to email real invites,");
  console.log("or invite individuals from /admin/users when you are ready.");
}
process.exit(failed ? 1 : 0);
