/**
 * Link time.member rows to Hub identities, so /time stops showing
 * "No time-tracking record linked to your account" to everyone.
 *
 * THE PROBLEM THIS SOLVES
 *
 * time.current_member_id() resolves the caller to a member two ways:
 *
 *     select m.id from time.member m
 *     where m.user_id = auth.uid()
 *        or (m.hub_person_id is not null and m.hub_person_id = app_user_person_id())
 *
 * The importer populates neither column -- grep it for `user_id`,
 * `hub_person_id` or `trackingtime_user_id` and there are no hits, so it never
 * attempts the link at all. This is not a matching failure to debug; the code
 * simply was not there. After the first live import: 4,191 entries, 49 members,
 * and 0 of them linked. current_member_id() returns NULL for every caller, RLS
 * correctly shows them nothing, and the page looks broken while the data is
 * perfect.
 *
 * WHY EMAIL, AND WHY ONLY user_id
 *
 * public.people has NO email column (id, name, factorial_employee_id,
 * trackingtime_user_id, ...). So there is no way to match a time.member to a
 * person directly -- the only shared identifier between TrackingTime and this
 * app is the email address, and on the Hub side that lives in auth.users.
 *
 * That makes auth.users the single join point:
 *
 *     time.member.email  ==  auth.users.email   ->  sets member.user_id
 *
 * hub_person_id is then derived, not matched: once user_id is known, the
 * person is whatever app_user_profile.person_id says for that user. It is only
 * written when that profile actually has a person_id -- 5 of 6 profiles have it
 * NULL, and inventing a link there would be worse than leaving it unset,
 * because user_id alone is already enough for current_member_id() to resolve.
 *
 * Matching is case-insensitive and trimmed. It is NEVER fuzzy: a display-name
 * or first-name match would eventually attach one colleague's hours to another
 * person's account, which is a data-protection incident rather than a bug. An
 * ambiguous or absent match is reported and skipped.
 *
 * SAFETY
 *
 *  * DRY RUN BY DEFAULT. Writes only with --apply. The default invocation
 *    cannot change anything, because the first thing anyone does with an
 *    unfamiliar script is run it with no arguments.
 *  * IDEMPOTENT. Re-running changes nothing once linked; already-correct rows
 *    are counted as `ok` and skipped rather than rewritten.
 *  * NEVER STEALS A LINK. If a member already points at a DIFFERENT user, that
 *    is reported as a conflict and left alone -- a manual link made in the
 *    dashboard outranks this script's guess.
 *  * Reports unmatched on BOTH sides. "6 users, 3 linked" is only good news if
 *    you can see which 3 were missed and why.
 *
 * Usage:
 *   node scripts/link-time-members.mjs            # report only, no writes
 *   node scripts/link-time-members.mjs --apply    # perform the backfill
 */
import { readFileSync, existsSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const APPLY = process.argv.slice(2).includes("--apply");

/** .env.local is gitignored and holds the service key; never log its value. */
function loadEnv() {
  const env = { ...process.env };
  if (existsSync(".env.local")) {
    for (const line of readFileSync(".env.local", "utf8").split("\n")) {
      const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
      if (m && !env[m[1]]) env[m[1]] = m[2].trim();
    }
  }
  return env;
}
const ENV = loadEnv();

const SUPABASE_URL = ENV.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = ENV.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error(
    "NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.\n" +
      "This script reads auth.users, which needs the service role -- the anon key cannot.",
  );
  process.exit(1);
}

const db = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

/** The one normalisation used on both sides. Exact after this, never fuzzy. */
const norm = (e) => (e ?? "").trim().toLowerCase() || null;

// --- read the three sides ---------------------------------------------------

// auth.users is not reachable through the REST API at any privilege level; it
// is only exposed via the Admin endpoint, which is why this needs the service
// key rather than merely a permissive policy.
const authUsers = [];
for (let page = 1; page <= 20; page++) {
  const { data, error } = await db.auth.admin.listUsers({ page, perPage: 200 });
  if (error) {
    console.error(`could not list auth users: ${error.message}`);
    process.exit(1);
  }
  const batch = data?.users ?? [];
  authUsers.push(...batch);
  if (batch.length < 200) break;
}

const { data: members, error: memberErr } = await db
  .schema("time")
  .from("member")
  .select("id, email, display_name, user_id, hub_person_id, is_archived")
  .order("id");
if (memberErr) {
  // A 42501 here means the service_role grants in schema.sql section 9 have not
  // been applied; a 406/PGRST106 means the `time` schema is not exposed. They
  // look alike from the app and have completely different fixes.
  console.error(`could not read time.member: ${memberErr.message}`);
  console.error("  run `npm run check:live-ready` -- this is usually a missing grant or an unexposed schema.");
  process.exit(1);
}

const { data: profiles, error: profileErr } = await db
  .from("app_user_profile")
  .select("user_id, person_id, is_active");
if (profileErr) {
  console.error(`could not read app_user_profile: ${profileErr.message}`);
  process.exit(1);
}

const personIdByUser = new Map(
  (profiles ?? []).filter((p) => p.is_active && p.person_id).map((p) => [p.user_id, p.person_id]),
);

// --- build the email index --------------------------------------------------

// Grouped rather than a flat Map so a duplicated address is detectable. Two
// auth users on one email should be impossible, but "impossible" is exactly
// what silently mislinks an account, so it is checked instead of assumed.
const usersByEmail = new Map();
for (const u of authUsers) {
  const key = norm(u.email);
  if (!key) continue;
  if (!usersByEmail.has(key)) usersByEmail.set(key, []);
  usersByEmail.get(key).push(u);
}

// --- decide, per member -----------------------------------------------------

const plan = [];
const skipped = { noEmail: 0, noUser: 0, ok: 0, conflict: 0, ambiguous: 0 };

for (const m of members ?? []) {
  const key = norm(m.email);
  if (!key) {
    skipped.noEmail++;
    continue;
  }

  const candidates = usersByEmail.get(key) ?? [];
  if (candidates.length > 1) {
    skipped.ambiguous++;
    console.log(`AMBIGUOUS  member ${m.id} <${m.email}> matches ${candidates.length} auth users — skipped`);
    continue;
  }
  if (candidates.length === 0) {
    skipped.noUser++;
    continue;
  }

  const user = candidates[0];
  const personId = personIdByUser.get(user.id) ?? null;

  // Someone already linked this member to a different account by hand. Do not
  // overwrite a human decision with a derived one.
  if (m.user_id && m.user_id !== user.id) {
    skipped.conflict++;
    console.log(
      `CONFLICT   member ${m.id} <${m.email}> already linked to ${m.user_id}, ` +
        `email says ${user.id} — left unchanged`,
    );
    continue;
  }

  const patch = {};
  if (m.user_id !== user.id) patch.user_id = user.id;
  // Only ever set hub_person_id, never clear it: a profile whose person_id went
  // NULL must not silently unlink a member that was already resolved.
  if (personId && m.hub_person_id !== personId) patch.hub_person_id = personId;

  if (!Object.keys(patch).length) {
    skipped.ok++;
    continue;
  }

  plan.push({ member: m, user, personId, patch });
}

// --- report -----------------------------------------------------------------

console.log(`live project: ${SUPABASE_URL}`);
console.log(`mode: ${APPLY ? "APPLY (writing)" : "DRY RUN (no writes)"}\n`);
console.log(`auth users: ${authUsers.length}   time.member rows: ${members?.length ?? 0}\n`);

if (plan.length) {
  console.log(`${plan.length} member(s) to link:`);
  for (const p of plan) {
    const bits = [
      p.patch.user_id ? `user_id=${p.user.id}` : null,
      p.patch.hub_person_id ? `hub_person_id=${p.patch.hub_person_id}` : null,
    ].filter(Boolean);
    console.log(`  member ${String(p.member.id).padStart(3)}  ${p.member.display_name} <${p.member.email}>`);
    console.log(`            ${bits.join("  ")}${p.personId ? "" : "   (no person_id on profile — user_id only)"}`);
  }
} else {
  console.log("nothing to link.");
}

// --- write ------------------------------------------------------------------

let linked = 0;
if (APPLY && plan.length) {
  console.log("");
  for (const p of plan) {
    const { error } = await db
      .schema("time")
      .from("member")
      .update(p.patch)
      .eq("id", p.member.id);
    if (error) {
      console.error(`FAILED     member ${p.member.id}: ${error.message}`);
      continue;
    }
    linked++;
  }
  console.log(`linked ${linked}/${plan.length}`);
}

// --- the other direction ----------------------------------------------------

// An auth user with no member is the case that actually reaches support: that
// person logs in, /time is empty, and nothing anywhere says why. Listed
// explicitly so the answer is on screen rather than in a query someone has to
// think to write.
const memberEmails = new Set((members ?? []).map((m) => norm(m.email)).filter(Boolean));
const unlinkedUsers = authUsers.filter((u) => !memberEmails.has(norm(u.email)));

if (unlinkedUsers.length) {
  console.log(`\n${unlinkedUsers.length} auth user(s) with no time.member — /time will be empty for them:`);
  for (const u of unlinkedUsers) console.log(`  ${u.email}`);
  console.log(
    "  (expected for test accounts and for anyone who has never tracked time.\n" +
      "   A real colleague here means their TrackingTime email differs from their login email.)",
  );
}

console.log(
  `\nsummary: ${skipped.ok} already linked, ${plan.length} ${APPLY ? `attempted (${linked} ok)` : "linkable"}, ` +
    `${skipped.noUser} no matching user, ${skipped.noEmail} member without email` +
    (skipped.conflict ? `, ${skipped.conflict} conflict` : "") +
    (skipped.ambiguous ? `, ${skipped.ambiguous} ambiguous` : ""),
);

if (!APPLY && plan.length) {
  console.log("\nre-run with --apply to write these links.");
}

// Exit non-zero only on a real failure. "Nothing to link" is a healthy state,
// and so is a test account without a member -- neither should fail a deploy
// step that calls this.
process.exit(APPLY && linked < plan.length ? 1 : 0);
