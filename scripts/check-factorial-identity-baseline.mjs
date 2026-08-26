/*
 * The identity resolution the Factorial sync will perform, run as a DRY RUN
 * against the live database BEFORE any credential exists.
 *
 * Why this is worth doing now: the doc's §6 design says every Factorial employee
 * either auto-resolves by exact email or becomes a review-queue row. That design
 * is only as good as the numbers behind it, and one of its inputs has already
 * changed -- time.member.hub_person_id was NULL for all 49 members when the
 * live-people map was written on 18 Aug; it is populated for 18 now. So the
 * resolvable population is a real number that can be measured today.
 *
 * This script cannot see Factorial. What it CAN do is establish the HUB side of
 * the join exactly: which emails are resolvable to a person, which are ambiguous,
 * which are shared mailboxes, and which would land in the queue. When the
 * credential arrives, Phase 2 is then a comparison against a known baseline
 * rather than a discovery exercise.
 *
 * READ-ONLY. It writes nothing and needs no Factorial token.
 */
import { readFileSync } from "node:fs";
import pg from "pg";

const env = Object.fromEntries(
  readFileSync("C:/Supabase/.env.local", "utf8").split(/\r?\n/)
    .filter((l) => l && !l.startsWith("#") && l.includes("="))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^"|"$/g, "")]; }));

const c = new pg.Client({ connectionString: env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
await c.connect();

/*
 * The classifier. This is deliberately the SAME logic the sync will use, written
 * once here so Phase 2 can import the shape rather than reinvent it.
 *
 * ADR-001: the only matching input is lower(trim(email)). Never a name, never a
 * local-part comparison, never a similarity score.
 */
const SHARED_MAILBOX = /^(info|jobs|office|kontakt|kontact|mail|hello|admin|noreply|no-reply)@/i;
const norm = (e) => String(e ?? "").trim().toLowerCase();

const { rows: members } = await c.query(`
  select m.id, m.email, m.hub_person_id, m.user_id, m.is_archived, m.role,
         p.name as person_name, p.source as person_source,
         (select count(*) from time.entry e
           where e.member_id = m.id
             and e.started_at::date <= current_date) as entry_count
    from time.member m
    left join public.people p on p.id = m.hub_person_id
   order by m.id`);

// A person already claimed by a Factorial id cannot be claimed again: people
// .factorial_employee_id is UNIQUE, so the DB enforces it, but the classifier
// must predict it rather than let the insert blow up mid-sync.
const { rows: claimed } = await c.query(
  "select id, factorial_employee_id from public.people where factorial_employee_id is not null");
const claimedPersons = new Set(claimed.map((r) => r.id));

const byEmail = new Map();
for (const m of members) {
  const e = norm(m.email);
  if (!e) continue;
  if (!byEmail.has(e)) byEmail.set(e, []);
  byEmail.get(e).push(m);
}

/**
 * Classify one Factorial login_email against the hub. Returns the outcome the
 * review queue's `status` column would record.
 */
const classify = (loginEmail) => {
  const e = norm(loginEmail);
  if (!e) return { status: "unmatched", reason: "Factorial has no login email for this employee" };
  if (SHARED_MAILBOX.test(e)) {
    return { status: "excluded_not_a_person", reason: `${e} is a shared mailbox, not a colleague` };
  }
  const hits = byEmail.get(e) ?? [];
  if (hits.length === 0) return { status: "unmatched", reason: `no time.member has ${e}` };
  if (hits.length > 1) {
    return { status: "ambiguous", reason: `${hits.length} time.member rows share ${e}`, count: hits.length };
  }
  const m = hits[0];
  if (!m.hub_person_id) {
    return { status: "bridged_unlinked", reason: `member ${m.id} matches on email but has no hub_person_id`, memberId: m.id };
  }
  if (claimedPersons.has(m.hub_person_id)) {
    return { status: "ambiguous", reason: `${m.hub_person_id} is already claimed by another Factorial employee`, memberId: m.id, personId: m.hub_person_id };
  }
  return { status: "resolvable", reason: `exact email -> member ${m.id} -> ${m.hub_person_id}`, memberId: m.id, personId: m.hub_person_id };
};

/* ----------------------------------------------------- the hub-side baseline */

console.log("=".repeat(78));
console.log("HUB-SIDE BASELINE for Factorial identity resolution");
console.log("Measured " + new Date().toISOString().slice(0, 10) + ". No Factorial credential used.");
console.log("=".repeat(78));

const tally = {};
const rows = [];
for (const m of members) {
  // Simulate Factorial presenting this exact address. Every hub member is a
  // candidate, because an employee in Factorial is expected to be one of these.
  const v = classify(m.email);
  tally[v.status] = (tally[v.status] ?? 0) + 1;
  rows.push({ email: norm(m.email), status: v.status, person: v.personId ?? "", entries: Number(m.entry_count), archived: m.is_archived });
}

console.log("\nIf Factorial's roster matched the 49 TrackingTime addresses exactly:");
console.table(Object.entries(tally).map(([status, n]) => ({ status, n })));

const resolvable = rows.filter((r) => r.status === "resolvable");
const queued = rows.filter((r) => r.status !== "resolvable" && r.status !== "excluded_not_a_person");
const excluded = rows.filter((r) => r.status === "excluded_not_a_person");

console.log(`\nresolvable: ${resolvable.length}   queued for review: ${queued.length}   excluded: ${excluded.length}`);
console.log("\nThe honest headline for a Phase 2 gate is all three counts, never just the first.");

console.log("\n--- would AUTO-RESOLVE (exact email -> member -> person)");
console.table(resolvable.map((r) => ({ email: r.email, person: r.person, entries: r.entries })));

console.log("\n--- would QUEUE for a human");
console.table(queued.map((r) => ({ email: r.email, status: r.status, entries: r.entries, archived: r.archived })));

console.log("\n--- would be EXCLUDED as not-a-person (terminal, pre-seeded)");
console.table(excluded.map((r) => ({ email: r.email, status: r.status })));

/* ------------------------------------------------- what the queue would cost */

const queuedWithHours = queued.filter((r) => r.entries > 0);
console.log(`\nOf the ${queued.length} queued, ${queuedWithHours.length} have logged time in TrackingTime.`);
console.log("Those are the ones that matter: an unresolved employee WITH hours means the");
console.log("weekly rollup omits real work, so the queue is not cosmetic backlog.");

/*
 * The one finding here that is a LIVE problem rather than Factorial groundwork.
 *
 * 636h sits behind members with no hub_person_id. Most of it belongs to archived
 * leavers, which is expected and harmless -- their hours are historical and the
 * queue will carry them as `bridged_unlinked` until someone decides whether a
 * departed colleague needs a `people` row at all.
 *
 * But an ACTIVE member with recent billable time and no person link is different.
 * That person is working now, their hours are being billed now, and nothing in
 * the hub can attribute them to a colleague. Whatever Factorial eventually says,
 * this is already wrong today.
 */
const { rows: activeUnlinked } = await c.query(`
  select m.email, m.display_name, m.role,
         count(e.id) as entries,
         round(sum(e.duration_seconds)/3600.0, 1) as hours,
         count(e.id) filter (where e.is_billable) as billable_entries,
         max(e.started_at)::date as last_day,
         (current_date - max(e.started_at)::date) as days_since
    from time.member m
    join time.entry e on e.member_id = m.id and e.started_at::date <= current_date
   where m.hub_person_id is null
     and m.is_archived = false
   group by m.email, m.display_name, m.role
   order by 5 desc`);

let failuresLive = 0;
console.log("\n" + "=".repeat(78));
console.log("LIVE FINDING: active members logging billable time with no person link");
console.log("=".repeat(78));
if (activeUnlinked.length === 0) {
  console.log("PASS: none — every non-archived member with hours resolves to a person");
} else {
  console.table(activeUnlinked);
  console.log("Each row is billable work that cannot be attributed to a colleague in the hub.");
  console.log("Archived leavers are deliberately excluded above: their hours are historical.");
  failuresLive = activeUnlinked.length;
}

/* --------------------------------------------------------- negative controls */

console.log("\n" + "=".repeat(78));
console.log("NEGATIVE CONTROLS: the classifier must refuse to guess");
console.log("=".repeat(78));

let failures = 0;
const mustBe = (label, email, want) => {
  const got = classify(email).status;
  const ok = got === want;
  console.log(`${ok ? "PASS" : "FAIL"}: ${label} -> ${got}${ok ? "" : ` (wanted ${want})`}`);
  if (!ok) failures += 1;
};

const sample = resolvable[0]?.email;
if (sample) {
  const [local, domain] = sample.split("@");
  mustBe("the exact address resolves", sample, "resolvable");
  mustBe("a dot inserted in the local part does NOT resolve", `${local.slice(0, 2)}.${local.slice(2)}@${domain}`, "unmatched");
  mustBe("the same local part on another domain does NOT resolve", `${local}@example.com`, "unmatched");
  mustBe("uppercase still resolves (we lowercase, which is not fuzzy)", sample.toUpperCase(), "resolvable");
  mustBe("surrounding whitespace still resolves", `  ${sample}  `, "resolvable");
}
mustBe("a shared mailbox is excluded, not matched", "info@hs-experts.com", "excluded_not_a_person");
mustBe("an empty email is unmatched, never resolved", "", "unmatched");
mustBe("a name is not an email and must not match", "Rency Sebastian", "unmatched");
mustBe("a stranger is unmatched", "nobody.here@hs-experts.com", "unmatched");

await c.end();

if (failures > 0) {
  console.log(`\n${failures} negative control(s) leaked — the classifier is guessing`);
  process.exit(1);
}
console.log("\nCLASSIFIER: exact-key only. It resolves the address and refuses everything near it.");

/*
 * The exit code separates the two things this script reports.
 *
 * The classifier is CODE and must be correct, so a leak is a hard failure. The
 * live finding is DATA and the fix needs a human to say who Stefan is in the
 * hub, so it exits 2 (the same "blocked, not broken" convention
 * check-factorial-auth.mjs uses) rather than pretending to pass or claiming the
 * code is wrong.
 */
if (failuresLive > 0) {
  console.log(`\nBLOCKED (exit 2): ${failuresLive} active member(s) with billable hours and no`);
  console.log("person link. Not a code fault and not something to auto-resolve: linking a");
  console.log("person is an attribution decision. Set time.member.hub_person_id for them,");
  console.log("or say they should not have a people row.");
  process.exit(2);
}
console.log("\nBASELINE CLEAN: every active member with hours resolves to a person.");
