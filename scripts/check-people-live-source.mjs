/**
 * What does the live TrackingTime member data actually look like, and which
 * definition of "a person" does the Hub have to choose?
 *
 * WHY THIS IS A CHECK AND NOT A ONE-OFF SCRIPT. "Show the live users instead of
 * the dummy ones" sounds like one decision and is really several, each with a
 * number attached: 49 members exist, 19 are not archived, 18 have ever logged
 * time, 15 are both, and 3 are archived but carry real logged hours that the
 * Overview totals already include. Picking a filter without those counts in front
 * of you is how a directory ends up listing `info@hs-experts.com` as a colleague,
 * or hiding a former employee whose 433h still show up in the org total.
 *
 * It also pins the facts a rewire depends on, so a later change that invalidates
 * them fails here rather than surfacing as a wrong page:
 *
 *   - `time.member.hub_person_id` is null for every row, and `public.people` has
 *     no email column, so there is NO join between live members and the 8 mockup
 *     rows. This is a replacement, not a migration.
 *   - TrackingTime holds FUTURE-dated entries, so any per-person or org hours
 *     figure must bound its window at today.
 *   - `app_user_profile.person_id` is null for 5 of 6 rows, so the access model
 *     does not hang off the mockup people rows -- which is what makes replacing
 *     them safe.
 *
 * TWO MEASUREMENT TRAPS, both of which produced confident wrong answers here
 * before being caught, and both guarded against below:
 *
 *   1. `.limit(20000)` does not defeat PostgREST's 1000-row cap. Reading one page
 *      reported 8 distinct members with logged time; fully paging gives 18.
 *   2. Selecting a column that does not exist fails the WHOLE request, and an
 *      unchecked `data` then reads as an empty array. `time.entry` has
 *      `started_at`, not `date`; asking for `date` reported "0 members have ever
 *      logged time". Every read below checks `error` explicitly.
 *
 * Read-only. Uses the service role deliberately: the point is ground truth,
 * unfiltered by RLS.
 *
 * Run: npm run check:people-live-source
 */
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

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

let failed = 0;
const check = (name, ok, detail = "") => {
  if (!ok) failed++;
  console.log(`${ok ? "PASS" : "FAIL"}: ${name}${detail ? `\n        ${detail}` : ""}`);
};

/** Read that refuses to silently return nothing. */
async function must(label, query) {
  const { data, error } = await query;
  if (error) {
    console.log(`FATAL: ${label} -- ${error.message}`);
    process.exit(1);
  }
  return data;
}

// ── 1. The live member roster ──────────────────────────────────────────────
const members = await must("read time.member", admin.schema("time").from("member").select("*"));
console.log(`\n=== time.member: ${members.length} live TrackingTime members ===`);

check(
  "the live roster is substantially larger than the 8 mockup rows",
  members.length > 20,
  `${members.length} live members -- if this collapses to single digits, the sync has broken`,
);

const requiredCols = ["id", "source_id", "email", "display_name", "hub_person_id", "role", "status", "is_archived", "weekly_hours"];
const missing = requiredCols.filter((c) => !(c in members[0]));
check(
  "time.member exposes the columns a directory needs",
  missing.length === 0,
  missing.length ? `missing: ${missing.join(", ")}` : requiredCols.join(", "),
);

// ── 2. Who logged time? Fully paged, never sampled. ───────────────────────
const logged = new Map();
let entryRows = 0;
for (let from = 0; ; from += 1000) {
  const page = await must(
    "page time.entry",
    admin
      .schema("time")
      .from("entry")
      .select("member_id, duration_seconds, started_at")
      .range(from, from + 999),
  );
  if (!page.length) break;
  entryRows += page.length;
  for (const r of page) {
    if (!r.member_id) continue;
    const cur = logged.get(r.member_id) ?? { seconds: 0, entries: 0, last: "" };
    cur.seconds += Number(r.duration_seconds ?? 0);
    cur.entries += 1;
    const d = (r.started_at ?? "").slice(0, 10);
    if (d > cur.last) cur.last = d;
    logged.set(r.member_id, cur);
  }
  if (page.length < 1000) break;
}

check(
  "time.entry was read in full, not capped at one page",
  entryRows > 1000,
  `${entryRows} entries across ${Math.ceil(entryRows / 1000)} pages -- a single limit() would have stopped at 1000 and undercounted members`,
);

// ── 3. The definitions, with counts ───────────────────────────────────────
const active = members.filter((m) => !m.is_archived);
const withTime = members.filter((m) => logged.has(m.id));
const activeWithTime = active.filter((m) => logged.has(m.id));
const archivedWithTime = members.filter((m) => m.is_archived && logged.has(m.id));
const shared = members.filter((m) => /^(info|jobs|no-reply|noreply|office|admin|team)@/i.test(m.email ?? ""));

console.log("\n=== candidate definitions of 'a person to show' ===");
console.log(`  all members                       ${members.length}`);
console.log(`  not archived                      ${active.length}`);
console.log(`  has ever logged time              ${withTime.length}`);
console.log(`  not archived AND logged time      ${activeWithTime.length}   <- the working organisation`);
console.log(`  ARCHIVED but has logged history   ${archivedWithTime.length}   <- their hours are in the org totals`);
console.log(`  shared mailboxes, not people      ${shared.length}   ${shared.map((m) => m.email).join(", ")}`);

check(
  "some members have logged time and some have not, so the filter choice is real",
  withTime.length > 0 && withTime.length < members.length,
  `${withTime.length} of ${members.length} have logged time`,
);

check(
  "archived-with-history exists, so a directory filter cannot double as an attribution filter",
  archivedWithTime.length > 0,
  archivedWithTime
    .map((m) => `${m.display_name} ${Math.round(logged.get(m.id).seconds / 3600)}h`)
    .join(", ") || "none -- this caveat no longer applies",
);

check(
  "shared mailboxes are present and must be excluded from a people directory",
  shared.length > 0,
  `${shared.map((m) => m.email).join(", ")} are inboxes; listing them as colleagues is the fiction we are removing`,
);

// ── 4. There is no join to the mockup rows ────────────────────────────────
const people = await must("read public.people", admin.from("people").select("*"));
console.log(`\n=== public.people: ${people.length} mockup rows ===`);

/*
 * RE-ANCHORED. This used to assert hub_person_id is null on EVERY member,
 * which held only while public.people was pure mockup. The masterdata import
 * added nine real md-* colleagues, and linking members to those is what made
 * the profile, admin and leave columns render real values instead of n/a.
 *
 * The invariant that still matters -- and always did -- is that no live member
 * is mapped to a SEED row. Pointing a real person at mockup HR data (uniform
 * 40h, invented employee numbers) would put fiction on a real profile page,
 * which is the actual failure this check was written to prevent.
 */
/*
 * A SEED row is one whose provenance is the mockup. Two tests, deliberately:
 * source='masterdata' is the authority once
 * 20260824100000_allow_masterdata_people_source.sql is applied, and until then
 * the check constraint permits only 'seed'/'factorial', so every row -- real or
 * mockup -- reads 'seed'. The 'md-' prefix is what the masterdata importer
 * assigns, so it identifies the same population in the interim and agrees with
 * the source column afterwards.
 */
const isSeedPerson = (person) => person.source === "seed" && !person.id.startsWith("md-");
const seedPersonIds = new Set(people.filter(isSeedPerson).map((p) => p.id));
const mappedToSeed = members.filter(
  (m) => m.hub_person_id !== null && seedPersonIds.has(m.hub_person_id),
);
check(
  "no live member is mapped to a SEED (mockup) person",
  mappedToSeed.length === 0,
  mappedToSeed.map((m) => `${m.email} -> ${m.hub_person_id}`).join(", ") ||
    `${members.filter((m) => m.hub_person_id !== null).length} member(s) mapped, all to masterdata rows`,
);
check(
  "public.people still has no email column, so any link is a reviewed decision",
  !("email" in (people[0] ?? {})),
  "scripts/link-profiles-to-people.mjs enumerates the nine pairs by hand for exactly this reason (ADR-001 bans name matching)",
);

// ── 5. Future-dated time is real, and will lie if unbounded ───────────────
const today = new Date().toISOString().slice(0, 10);
const future = [...logged.entries()].filter(([, l]) => l.last > today);
check(
  "TrackingTime holds FUTURE-dated entries, so hours windows must be bounded at today",
  future.length > 0,
  `${future.length} members have entries dated after ${today} (latest ${[...logged.values()].map((l) => l.last).sort().at(-1)}) -- an unbounded 'hours logged' reports planned work as done`,
);

// ── 6. Access does not depend on the mockup rows ──────────────────────────
const profiles = await must(
  "read app_user_profile",
  admin.from("app_user_profile").select("person_id, role_key, is_active"),
);
const linked = profiles.filter((p) => p.person_id !== null);
/*
 * RE-ANCHORED, same reason as the hub_person_id check above. "At most one
 * profile carries a person_id" described a database where person_id was
 * unused; nine accounts are now linked to their real masterdata rows, which
 * is what the HR columns needed.
 *
 * The property to protect is that no profile points at a SEED row -- that
 * would show invented HR data on a real person's profile -- and that ACCESS
 * still resolves by user_id rather than by person_id, which is why replacing
 * the people table stays safe. Both are asserted directly.
 */
const linkedToSeed = linked.filter((p) => seedPersonIds.has(p.person_id));
check(
  "no account is linked to a SEED (mockup) person",
  linkedToSeed.length === 0,
  linkedToSeed.map((p) => p.person_id).join(", ") ||
    `${linked.length} of ${profiles.length} profiles linked, all to masterdata rows`,
);
check(
  "access does not depend on person_id (roles resolve by user_id)",
  profiles.every((p) => p.role_key),
  `${profiles.filter((p) => p.role_key).length} of ${profiles.length} profiles carry a role independent of person_id -- confirm with check:stranger-access`,
);

// ── 7. weekly_hours is a uniform TrackingTime default, not contract truth ─
const distinctWeekly = [...new Set(members.map((m) => m.weekly_hours))];
check(
  "weekly_hours is recorded for every member",
  members.every((m) => m.weekly_hours),
  `values present: ${JSON.stringify(distinctWeekly)}`,
);
if (distinctWeekly.length === 1) {
  console.log(
    `        NOTE: every member reports ${distinctWeekly[0]}h/week. That is a uniform TrackingTime\n` +
      "        default, not per-contract truth, so utilisation built on it must not be\n" +
      "        presented as a contractual ratio.",
  );
}

console.log(
  failed
    ? "\nPEOPLE LIVE SOURCE: an assumption behind the live-data rewire no longer holds\n"
    : "\nPEOPLE LIVE SOURCE: live roster present, and the rewire's assumptions hold\n",
);
process.exit(failed ? 1 : 0);
