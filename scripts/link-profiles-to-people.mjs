/*
 * Backfill app_user_profile.person_id and time.member.hub_person_id.
 *
 * WHY EVERY COLUMN WAS n/a. The audit found app_user_profile.person_id null on
 * all 20 accounts and time.member.hub_person_id null on all 49 members: the
 * admin PERSON column, the profile page's person linkage, and the leave
 * balance path all dead-ended -- not because the people are unknown, but
 * because nobody ever wrote the link.
 *
 * WHY AN EXPLICIT TABLE AND NOT A MATCHER. ADR-001 bans name-similarity
 * automation. public.people has no email column, so there IS no exact key to
 * join on mechanically. But the domain has only nine relevant people, all
 * hs-experts.com staff whose md-* rows my own masterdata import created from
 * the Excel responsible names. So the mapping is stated HERE, pair by pair,
 * as data a human reviews in this file -- an enumeration, not an algorithm.
 * Accounts not listed (hitul, kurt, hannes, munesh, seif, simone, ulf,
 * yasemin, azubuike) have no people row, and their columns stay honestly n/a
 * until HR data for them exists.
 *
 * The emp-* demo rows are NOT linked to anyone: their HR fields (uniform 40h,
 * invented employee numbers) are seed fiction, kept only because timesheet
 * FKs lock them. Linking a real account to one would put fake HR data on a
 * real profile page.
 *
 * Idempotent: re-running writes the same values.
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";

for (const line of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
  const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});
const timeDb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  db: { schema: "time" },
  auth: { persistSession: false },
});

/** auth email (exact, case-folded) -> public.people.id. Reviewed by hand. */
const LINKS = new Map([
  ["bjoern.schoenemann@hs-experts.com", "md-bjrn"],
  ["hendryk@hs-experts.com", "md-hendryk"],
  ["mathias@hs-experts.com", "md-mathias"],
  ["mustafa.elnabulsieh@hs-experts.com", "md-mustafa"],
  ["ousmane@hs-experts.com", "md-ousmane"],
  ["rency@hs-experts.com", "md-rency"],
  ["serhii@hs-experts.com", "md-serhii"],
  ["stephan@hs-experts.com", "md-stephan"],
  ["thorsten.krause@hs-experts.com", "md-thorsten"],
]);

// Assert every target person exists before writing anything.
const { data: people, error: pe } = await db.from("people").select("id, name");
if (pe) throw pe;
const peopleIds = new Set(people.map((p) => p.id));
for (const [email, personId] of LINKS) {
  if (!peopleIds.has(personId)) throw new Error(`people.id ${personId} (for ${email}) does not exist`);
}

const { data: authList, error: ae } = await db.auth.admin.listUsers({ perPage: 100 });
if (ae) throw ae;

let profileWrites = 0;
for (const user of authList.users) {
  const personId = LINKS.get((user.email ?? "").toLowerCase());
  if (!personId) continue;
  const { error } = await db.from("app_user_profile").update({ person_id: personId }).eq("user_id", user.id);
  if (error) throw new Error(`profile ${user.email}: ${error.message}`);
  profileWrites += 1;
  console.log(`profile ${user.email} -> ${personId}`);
}

// Same link on time.member (by member email), so org/team views can resolve
// a member to a person without going through an auth account.
const { data: members, error: me } = await timeDb.from("member").select("id, email");
if (me) throw me;
let memberWrites = 0;
for (const member of members) {
  const personId = LINKS.get((member.email ?? "").toLowerCase());
  if (!personId) continue;
  const { error } = await timeDb.from("member").update({ hub_person_id: personId }).eq("id", member.id);
  if (error) throw new Error(`member ${member.email}: ${error.message}`);
  memberWrites += 1;
  console.log(`member  ${member.email} -> ${personId}`);
}

console.log(`\n${profileWrites} profiles linked, ${memberWrites} members linked.`);

// Post-condition: report what remains unlinked, so the gap is visible.
const { data: still } = await db.from("app_user_profile").select("user_id, person_id");
const unlinked = still.filter((p) => !p.person_id).length;
console.log(`profiles still without person: ${unlinked} (accounts with no HR person row -- honest n/a)`);
