/**
 * Bridge the real time-tracking schema to the hub.
 *
 *   node scripts/bridge-time-to-hub.mjs            dry run (default, writes nothing)
 *   node scripts/bridge-time-to-hub.mjs --apply    write, inside ONE transaction
 *
 * ── Why this exists ────────────────────────────────────────────────────────────
 *
 * scripts/audit-timesheet-links.mjs established that time.entry is the real time
 * data (5,322 rows / 8,458.7 h, ingested from trackingtime + calendar) and that
 * public.timesheet_entries is a 28-row mockup belonging entirely to an inactive
 * seed person. Referential integrity *inside* the time schema is perfect. The
 * defect is the bridge to the hub:
 *
 *   crm.trackingtime_project_reference   0 rows
 *   crm.factorial_person_reference       0 rows
 *   crm.trackingtime_customer_reference  0 rows
 *
 * The documented mapping tables were never populated. Bridging is done instead
 * by two inline columns that are only partly filled:
 *
 *   time.member.hub_person_id    9 of 49
 *   time.project.hub_project_id  123 of 334
 *
 * Consequence: only 920 of 5,322 entries (1,897.8 h of 8,458.7 h) can reach a
 * hub project, and nine people with genuine tracked time cannot be attributed at
 * all. This script closes the part of that gap that can be closed on evidence,
 * and refuses to guess at the rest.
 *
 * ── Matching discipline ────────────────────────────────────────────────────────
 *
 * PEOPLE need TWO independent agreeing signals, never one:
 *   (1) time.member.email equals the email on an active app_user_profile
 *       (auth.users.email), which already carries a person_id; and
 *   (2) the first name in time.member.display_name equals public.people.name
 *       for that same person row.
 * One signal alone is refused. Linking the wrong person to time data would
 * misattribute billable hours and hand one employee another's work through RLS,
 * so a single weak signal is not good enough.
 *
 * PROJECTS use two rules, applied in order.
 *
 * RULE A — the order number, an EXACT equality: time.project.code =
 * public.projects.id. public.projects.id and .code are identical for all 231 rows
 * and have the shape 10121_00359_104_01 (customer_order_service_seq). This rule is
 * now EXHAUSTED: it has already been applied and finds 0 remaining candidates,
 * because 154 of the 157 still-unbridged rows carry no code at all.
 *
 * RULE B — structured inference from time.project.customer_id + service_id, with
 * the meaning of each learned from the rows that are already bridged, and six
 * guards that each killed measured false positives. Fully documented at its own
 * section below. It is deliberately narrow, and its counts move as the bridge
 * fills, so they are dated rather than stated as standing fact: on 2026-08-26,
 * against 177 bridged rows, it linked 14 and refused 143; on 2026-08-27, against
 * 187 bridged rows, it links 0 and refuses all 149 that remain. The script PRINTS
 * the current numbers -- read those, not this paragraph.
 *
 * That it now links nothing is not evidence it is broken. A leave-one-out check
 * (rebuild the maps from every OTHER bridged row, then ask what this row would
 * get) reproduces the stored hub_project_id on 111 of the 187 rows, makes no call
 * on 74, and picks a different order on 2. So the rule agrees with what is in the
 * table wherever it is willing to speak at all. What it does NOT establish is who
 * wrote those rows: link-tt-to-hub-projects.mjs and link-tt-round2.mjs also set
 * hub_project_id, and 96 of the 187 carry a code that differs from their link, so
 * attribution between the three is not settled here and should not be assumed.
 *
 * Rules deliberately NOT used, because they were measured and found unsafe:
 *   - time.project.source_id: a TrackingTime numeric id (e.g. 2728565). Zero of
 *     334 match any project id or code. Useless here.
 *   - exact name equality: zero matches out of 334. The two systems name
 *     projects differently ("KIKO Germany GmbH / 26 SiFa" vs "Caseking
 *     (Arbeitsschutz) 25/26").
 *   - the 5-digit customer prefix inside the name: 0 unique hits, 16 ambiguous.
 *     A customer has several concurrent orders, so the customer number cannot
 *     identify an order. This is exactly the guess that must not be made:
 *     picking any one of a customer's orders would silently book hours against
 *     the wrong contract and corrupt budget burn.
 *   - "the customer happens to have exactly one order in the hub": tested, and
 *     it produced 11 candidates of which the service-segment check proved 4
 *     WRONG (e.g. "Arden University / 25/26 BA" onto a SiFa order). Uniqueness
 *     there reflects an incomplete hub table, not a real one-to-one.
 *   - fuzzy/prefix code matching: three time.project rows carry a code whose
 *     order number does not exist in public.projects (01.03.01 twice, which is a
 *     service code not an order number, and 10178_00028_104_01). They stay NULL.
 *
 * Rows already bridged are never overwritten. Three time.project rows have a
 * code that disagrees with their existing hub_project_id (e.g. code
 * 10878_00394_304_01 vs hub 10878_00394_104_01, differing in the service
 * segment). Those are reported as conflicts for a human, not silently rewritten:
 * whoever set the hub id may have known something the code does not say.
 *
 * ── What this script will NOT do ───────────────────────────────────────────────
 *
 * It never creates a public.people row. Four members have real tracked time and
 * no person row at all. Creating one is not a data repair, it grants a human
 * visibility in the app and a place in headcount, and one of the four is flagged
 * external by their own email domain. That is a human decision; the script
 * reports each case with a recommendation and stops there.
 *
 * It never touches public.timesheet_entries. That table is the mockup, and the
 * /timesheets route reading it is a separate problem from this bridge.
 */
import { readFileSync, existsSync } from "node:fs";

const APPLY = process.argv.includes("--apply");
const ENV_PATH = "C:/Supabase/.env.local";

if (!existsSync(ENV_PATH)) {
  console.log("SKIP: no .env.local — this script operates on the live project only.");
  process.exit(0);
}
const env = Object.fromEntries(
  readFileSync(ENV_PATH, "utf8").split(/\r?\n/)
    .filter((l) => l && !l.startsWith("#") && l.includes("="))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^"|"$/g, "")]; }));
if (!env.SUPABASE_DB_URL) { console.log("SKIP: SUPABASE_DB_URL not set."); process.exit(0); }

const pg = (await import("pg")).default;
const c = new pg.Client({ connectionString: env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
await c.connect();

const h = (s) => console.log(`\n${"=".repeat(78)}\n${s}\n${"=".repeat(78)}`);
const hours = (n) => (Number(n) / 3600).toFixed(1);
// Fold German umlauts and diacritics so "Schülke" and "Schuelke" compare equal.
const norm = (s) => (s ?? "").toString().trim().toLowerCase()
  .replace(/ä/g, "ae").replace(/ö/g, "oe").replace(/ü/g, "ue").replace(/ß/g, "ss")
  .normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]/g, "");

console.log(APPLY
  ? "MODE: --apply  (one transaction; rolled back on any error)"
  : "MODE: dry run  (writes nothing; pass --apply to commit)");

// ── measurement helpers ──────────────────────────────────────────────────────
const coverage = async () => {
  const m = (await c.query(`
    select count(*)::int members, count(hub_person_id)::int bridged,
           count(*) filter (where hub_person_id is null
             and exists (select 1 from time.entry e where e.member_id=m.id))::int unbridged_with_time
      from time.member m`)).rows[0];
  const p = (await c.query(`
    select count(*)::int projects, count(hub_project_id)::int bridged
      from time.project`)).rows[0];
  const reach = (await c.query(`
    select count(*)::int entries, coalesce(sum(e.duration_seconds),0)::bigint secs
      from time.entry e join time.project p on p.id=e.project_id
     where p.hub_project_id is not null`)).rows[0];
  const person = (await c.query(`
    select count(*)::int entries, coalesce(sum(e.duration_seconds),0)::bigint secs
      from time.entry e join time.member m on m.id=e.member_id
     where m.hub_person_id is not null`)).rows[0];
  const total = (await c.query(
    `select count(*)::int entries, coalesce(sum(duration_seconds),0)::bigint secs from time.entry`)).rows[0];
  return { m, p, reach, person, total };
};
const printCoverage = (label, s) => {
  console.log(`  ${label}`);
  console.log(`    time.member.hub_person_id   : ${s.m.bridged}/${s.m.members}` +
    `   (members with time but unbridged: ${s.m.unbridged_with_time})`);
  console.log(`    time.project.hub_project_id : ${s.p.bridged}/${s.p.projects}`);
  console.log(`    entries reaching a hub PROJECT: ${s.reach.entries}/${s.total.entries}` +
    `  = ${hours(s.reach.secs)}h of ${hours(s.total.secs)}h`);
  console.log(`    entries reaching a hub PERSON : ${s.person.entries}/${s.total.entries}` +
    `  = ${hours(s.person.secs)}h of ${hours(s.total.secs)}h`);
};

const before = await coverage();
h("0. COVERAGE BEFORE");
printCoverage("before:", before);

// ── evidence gathering ───────────────────────────────────────────────────────
// The profile table is the authority for "which email belongs to which person",
// because that is literally what RLS reads via app_user_person_id().
const profiles = (await c.query(`
  select aup.person_id, lower(u.email) email, aup.role_key, aup.is_active
    from public.app_user_profile aup
    join auth.users u on u.id = aup.user_id
   where aup.is_active and aup.person_id is not null`)).rows;
const profileByEmail = new Map(profiles.map((p) => [p.email, p]));

const people = (await c.query(
  `select id, name, is_active, source, department from public.people`)).rows;
const personById = new Map(people.map((p) => [p.id, p]));

const membersWithTime = (await c.query(`
  select m.id, m.display_name, lower(m.email) email, m.hub_person_id, m.status, m.is_archived,
         count(e.id)::int entries, coalesce(sum(e.duration_seconds),0)::bigint secs
    from time.member m
    join time.entry e on e.member_id = m.id
   where m.hub_person_id is null
   group by 1,2,3,4,5,6
   order by entries desc`)).rows;

h("1. PEOPLE — two-signal match on every unbridged member that has tracked time");
console.log(`  ${membersWithTime.length} members have time entries and no hub_person_id.`);
console.log("  A link is accepted only when the EMAIL resolves to a person via an active");
console.log("  profile AND the display name's first name agrees with that person's name.\n");

const personLinks = [];
const noPersonRow = [];

for (const m of membersWithTime) {
  const local = (m.email || "").split("@")[0];
  const domain = (m.email || "").split("@")[1] ?? "";
  const first = norm((m.display_name || "").split(/\s+/)[0]);
  const prof = profileByEmail.get(m.email);

  const label = `${String(m.display_name ?? "(no name)").padEnd(28)} ${String(m.email ?? "").padEnd(34)}` +
    ` ${String(m.entries).padStart(4)} entries ${hours(m.secs).padStart(7)}h`;

  // Signal 1: the email is the exact login of an active profile carrying a person_id.
  if (!prof) {
    // Could the local part still name a person? md-<local> is the house convention.
    const guess = personById.get(`md-${local}`);
    noPersonRow.push({ ...m, local, domain, guessedPerson: guess ? guess.id : null });
    console.log(`  SKIP  ${label}`);
    console.log(`        no active profile owns ${m.email} → no person_id to copy. Reported in section 2.`);
    continue;
  }
  const person = personById.get(prof.person_id);
  if (!person) {
    console.log(`  REFUSE ${label}`);
    console.log(`        profile points at ${prof.person_id} which does not exist in public.people (dangling).`);
    continue;
  }

  // Signal 2: the human's name must agree, independently of the email.
  const nameAgrees = norm(person.name) === first || first.startsWith(norm(person.name)) ||
    norm(person.name).startsWith(first);
  // Signal 1b: the email local part must also agree with the person id suffix,
  // so the two signals are not both just "the profile said so".
  const localAgrees = norm(person.id.replace(/^md-/, "")) === norm(local) ||
    norm(local).startsWith(norm(person.id.replace(/^md-/, "")));

  if (!nameAgrees) {
    console.log(`  REFUSE ${label}`);
    console.log(`        email says ${prof.person_id} ("${person.name}") but display name starts "${(m.display_name || "").split(/\s+/)[0]}". One signal only → refused.`);
    continue;
  }
  if (!localAgrees) {
    console.log(`  REFUSE ${label}`);
    console.log(`        name agrees with ${prof.person_id} but email local part "${local}" does not. Refused.`);
    continue;
  }
  if (!person.is_active) {
    console.log(`  REFUSE ${label}`);
    console.log(`        would link to inactive person ${person.id} (source=${person.source}). Refused.`);
    continue;
  }

  personLinks.push({ memberId: m.id, personId: person.id, m, person });
  console.log(`  LINK  ${label}`);
  console.log(`        → ${person.id}  (email=${m.email} owns an active ${prof.role_key} profile; ` +
    `display name "${m.display_name}" agrees with people.name "${person.name}"; dept=${person.department ?? "null"})`);
}

console.log(`\n  accepted ${personLinks.length} person link(s): ` +
  personLinks.map((l) => `${l.m.display_name}→${l.personId}`).join(", "));
const recoveredEntries = personLinks.reduce((a, l) => a + l.m.entries, 0);
const recoveredSecs = personLinks.reduce((a, l) => a + Number(l.m.secs), 0);
console.log(`  this makes ${recoveredEntries} entries / ${hours(recoveredSecs)}h attributable to a named person.`);

h("2. MEMBERS WITH TRACKED TIME AND NO PERSON ROW — reported, never auto-created");
console.log("  Creating a public.people row is not a repair. It puts a human into headcount,");
console.log("  into the org chart, and gives their account a visibility anchor through RLS.");
console.log("  It is also not reversible in the eyes of anyone who has already seen the app.");
console.log("  So each of these gets a recommendation and a decision left open.\n");

if (!noPersonRow.length) console.log("  (none)");
for (const m of noPersonRow) {
  const external = m.domain !== "hs-experts.com" || /extern/i.test(m.email || "");
  console.log(`  ${String(m.display_name).padEnd(28)} ${String(m.email).padEnd(34)}` +
    ` ${String(m.entries).padStart(4)} entries ${hours(m.secs).padStart(7)}h  status=${m.status ?? "?"} archived=${m.is_archived}`);
  if (external) {
    console.log(`     RECOMMEND: do NOT create a person row yet. The email domain is "${m.domain}"` +
      ` (not hs-experts.com)${/extern/i.test(m.email) ? ` and the local part says "extern"` : ""},`);
    console.log(`     which marks this as a contractor. ${hours(m.secs)}h of contractor time is a cost line, not`);
    console.log(`     headcount; it should land on a supplier/contractor record, and a people row would`);
    console.log(`     wrongly enrol them as staff. Confirm the employment relationship with HR first.`);
  } else if (Number(m.entries) <= 2) {
    console.log(`     RECOMMEND: leave unbridged for now. Only ${m.entries} entry/entries (${hours(m.secs)}h) — this looks`);
    console.log(`     like a stray or test booking rather than a working colleague. Verify the account is`);
    console.log(`     real and in use before spending a person row on it; the hours are immaterial.`);
  } else {
    console.log(`     RECOMMEND: create a person row, as a human decision. ${m.entries} entries / ${hours(m.secs)}h is`);
    console.log(`     substantial genuine work on an @hs-experts.com address, so this is very likely a real`);
    console.log(`     colleague who is simply missing from public.people. Suggested id "md-${m.local}" to match`);
    console.log(`     the existing convention, then re-run this script and the link will be made on two`);
    console.log(`     signals. Needs a name, department and active flag that only HR can supply.`);
  }
  console.log("");
}

h("3. PROJECTS — exact order-number match only");
const projCandidates = (await c.query(`
  select p.id, p.code, p.source_id, p.name, pr.id hub, pr.name hub_name,
         pr.customer hub_customer, tc.name time_customer,
         (select count(*)::int from time.entry e where e.project_id=p.id) entries,
         (select coalesce(sum(e.duration_seconds),0)::bigint from time.entry e where e.project_id=p.id) secs
    from time.project p
    join public.projects pr on pr.id = p.code
    left join time.customer tc on tc.id = p.customer_id
   where p.hub_project_id is null
   order by 10 desc`)).rows;

const conflicts = (await c.query(`
  select p.id, p.code, p.hub_project_id, p.name
    from time.project p
   where p.code is not null and p.hub_project_id is not null and p.hub_project_id <> p.code`)).rows;

const unmatched = (await c.query(`
  select p.id, p.code, p.name,
         (select count(*)::int from time.entry e where e.project_id=p.id) entries,
         (select coalesce(sum(e.duration_seconds),0)::bigint from time.entry e where e.project_id=p.id) secs
    from time.project p
   where p.hub_project_id is null
     and not exists (select 1 from public.projects pr where pr.id = p.code)
   order by 5 desc`)).rows;

console.log("  RULE: set hub_project_id = code where time.project.code is exactly equal to a");
console.log("        public.projects.id. public.projects.id and .code are identical for all 231");
console.log("        rows and are the order number (customer_order_service_seq), so this is an");
console.log("        identity match on a business key, not a heuristic. Nothing fuzzy is applied.\n");
console.log("  CORROBORATION: the order number is trusted, but it was checked against an");
console.log("  independent field before trusting it. For each candidate the client recorded on");
console.log("  the time side (time.customer.name + time.project.name) is compared with the client");
console.log("  on the hub side (public.projects.customer + .name) and must share at least one");
console.log("  distinctive word. This matters because the hub's project NAME alone is not");
console.log("  trustworthy: order 10234_00103_104_01 is named \"Mirantis Safety Engineer\" while its");
console.log("  customer is \"Netto ApS & Co. KG\", which is exactly what the time side says. The");
console.log("  order number and the customer agree, and the stale name is the odd one out. Any");
console.log("  candidate with no shared client word at all is reported and left NULL.\n");

// Customer corroboration by TOKEN OVERLAP, not string equality.
//
// The two systems record the same client at different levels of formality:
//   "AWB"                       vs "AWB Aluminiumwerk Berlin GmbH"
//   "Praxis Dr. Mungee"         vs "Dr. Aditya Mungee"
//   "Schlossshotel Blankenburg" vs "Schlosshotel Blankenburg UG &Co.OHG"  (typo)
//   "Intel"                     vs "Intel Deutschland GmbH"
// Demanding equality would refuse all of those, and refusing a correct link is
// not free: it leaves real hours unattributed. So the test is whether the two
// sides share at least one distinctive word. Legal forms and generic words are
// stripped first, because "GmbH" is shared by half the client base and carries
// no identifying information.
//
// Evidence considered per side is the customer name AND the project name, since
// the project name usually leads with the client ("Netto / 26 SiFa"). A single
// shared distinctive token is enough to corroborate; the order number is already
// the primary key and this is only a sanity check against it.
const STOP = new Set(["gmbh", "ag", "kg", "ug", "ohg", "co", "inc", "ltd", "llp", "ev", "se",
  "sl", "sa", "aps", "und", "der", "die", "das", "von", "the", "sifa", "sifa", "fasi", "bsb",
  "ba", "gu", "kk", "betreuung", "sicherheitstechnische", "safety", "support", "engineer",
  "occupational", "health", "basic", "technical", "supervision", "partnerschaft",
  "rechtsanwaelten", "praxis", "dr", "service", "germany", "deutschland", "berlin", "gmbhco"]);
const tokens = (...parts) => {
  const out = new Set();
  for (const p of parts) {
    for (const raw of String(p ?? "").split(/[^\p{L}\p{N}]+/u)) {
      const t = norm(raw);
      // Drop pure numbers: years ("2026") and customer numbers appear on both
      // sides for unrelated clients and would corroborate falsely.
      if (t.length >= 3 && !STOP.has(t) && !/^\d+$/.test(t)) out.add(t);
    }
  }
  return out;
};
const custAgrees = (timeCust, hubCust, timeName, hubName) => {
  const A = tokens(timeCust, timeName), B = tokens(hubCust, hubName);
  if (!A.size || !B.size) return null;   // nothing to corroborate with either way
  for (const t of A) {
    if (B.has(t)) return t;
    // catch typos / concatenations: "schlossshotel" vs "schlosshotel"
    for (const u of B) {
      if (t.length >= 5 && u.length >= 5 && (t.startsWith(u) || u.startsWith(t))) return `${t}~${u}`;
    }
  }
  return false;
};

const accepted = [], refusedByCustomer = [], uncorroborated = [];
for (const p of projCandidates) {
  const agree = custAgrees(p.time_customer, p.hub_customer, p.name, p.hub_name);
  if (agree === false) refusedByCustomer.push(p);
  else if (agree === null) uncorroborated.push(p);   // still accepted: order number alone
  else accepted.push({ ...p, token: agree });
}

console.log(`  ${projCandidates.length} time.project rows match a hub project by exact order number.`);
console.log(`    ${accepted.length} corroborated by customer  →  WILL LINK`);
console.log(`    ${uncorroborated.length} have no customer on one side to corroborate with  →  WILL LINK on the order`);
console.log(`      number alone, because the order number is itself the contract identifier and a`);
console.log(`      missing customer name is an absence of evidence, not evidence against.`);
console.log(`    ${refusedByCustomer.length} customer DISAGREES  →  REFUSED, reported below\n`);

for (const p of accepted) {
  console.log(`    LINK ${p.code}  ${String(p.entries).padStart(4)} entries ${hours(p.secs).padStart(7)}h  shared="${p.token}"`);
  console.log(`         "${p.name}" [${p.time_customer}] → "${p.hub_name}" [${p.hub_customer}]`);
}
for (const p of uncorroborated) {
  console.log(`    LINK ${p.code} (uncorroborated) "${p.name}" → "${p.hub_name}"` +
    `  time_customer=${JSON.stringify(p.time_customer)} hub_customer=${JSON.stringify(p.hub_customer)}`);
}
for (const p of refusedByCustomer) {
  console.log(`    REFUSE ${p.code}  ${p.entries} entries ${hours(p.secs)}h`);
  console.log(`         time side "${p.name}" [${p.time_customer}]`);
  console.log(`         hub side  "${p.hub_name}" [${p.hub_customer}]`);
  console.log(`         The order number matches but the two sides name no client word in common.`);
  console.log(`         One of the two systems has the wrong order number on this row; linking`);
  console.log(`         would attribute hours to the wrong client. Left NULL for a human.`);
}
const linkSet = new Set([...accepted, ...uncorroborated].map((p) => p.id));
// Several TrackingTime projects legitimately share one hub order: a single
// contract covering multiple sites is tracked per site ("RISE FX Berlin" and
// "RISE FX Stuttgart" both bill to 10443_00253_104_01). hub_project_id is not
// unique today (6 existing hub ids are already used twice or three times), so
// many-to-one is the intended shape, not a collision.
const byHub = new Map();
for (const p of [...accepted, ...uncorroborated]) {
  if (!byHub.has(p.code)) byHub.set(p.code, []);
  byHub.get(p.code).push(p.name);
}
const shared = [...byHub.entries()].filter(([, v]) => v.length > 1);
if (shared.length) {
  console.log(`\n  ${shared.length} hub order(s) receive more than one time.project — expected for`);
  console.log(`  multi-site contracts, and hub_project_id is already non-unique in the existing data:`);
  for (const [code, names] of shared) console.log(`    ${code} ← ${names.map((n) => `"${n}"`).join(" + ")}`);
}
const projEntries = [...accepted, ...uncorroborated].reduce((a, p) => a + p.entries, 0);
const projSecs = [...accepted, ...uncorroborated].reduce((a, p) => a + Number(p.secs), 0);
console.log(`\n  the ${linkSet.size} rows to be linked carry ${projEntries} entries / ${hours(projSecs)}h that` +
  ` currently reach no hub project.`);

console.log(`\n  ${conflicts.length} row(s) where an existing hub_project_id disagrees with the code — LEFT ALONE:`);
for (const p of conflicts) {
  console.log(`    time.project ${p.id}: code=${p.code} but hub=${p.hub_project_id}  "${p.name}"`);
  console.log(`      the order numbers differ in a segment, so one of the two is wrong. Overwriting`);
  console.log(`      an existing deliberate link on the strength of a code field is not defensible.`);
}

const unmatchedWithTime = unmatched.filter((p) => p.entries > 0);
console.log(`\n  ${unmatched.length + refusedByCustomer.length} time.project rows stay NULL` +
  ` (${unmatchedWithTime.length + refusedByCustomer.filter((p) => p.entries > 0).length} of them carry time,` +
  ` ${hours(unmatchedWithTime.reduce((a, p) => a + Number(p.secs), 0) + refusedByCustomer.reduce((a, p) => a + Number(p.secs), 0))}h).`);
console.log("  Reasons, measured not assumed:");
const noCode = unmatched.filter((p) => !p.code).length;
const badCode = unmatched.filter((p) => p.code);
console.log(`    ${noCode} have no code at all — nothing to match on. Their names are TrackingTime`);
console.log(`      labels like "10305_YPOG München / 25/26 BA": the leading 5 digits are the CUSTOMER`);
console.log(`      number, and a customer has several live orders, so it cannot identify one order.`);
console.log(`      Measured: that rule produced 0 unique and 18 ambiguous hits. Guessing here would`);
console.log(`      book hours against the wrong contract, so these are left NULL on purpose.`);
for (const p of badCode) {
  console.log(`    code="${p.code}" exists but matches no hub project: "${p.name}" (${p.entries} entries)`);
}

// ── RULE B: structured customer + service inference ──────────────────────────
//
// Rule A above (code == public.projects.id) is now EXHAUSTED: it finds 0 remaining
// candidates, because 154 of the 157 still-unbridged rows have no code at all.
// scripts/diagnose-project-bridge.mjs measured every text-based signal on those
// 154 and every one scored ZERO: source_id vs hub id (0/157), an order number
// embedded in the name (0), exact name equality (0), leading 5-digit customer
// number (0 unique, 16 ambiguous). Fuzzy name matching cannot rescue this.
//
// But two STRUCTURED foreign keys on time.project were never used: customer_id
// and service_id. Neither is a guess — both are real ids maintained by the
// source system. And the rows that are ALREADY bridged are ground truth
// that tells us what each one means in hub terms:
//
//   time.customer_id -> the 5-digit customer number of its hub orders
//     89 time customers appear in bridged data; 84 map to exactly one hub
//     customer number, 5 are inconsistent and are therefore not used.
//
//   time.service_id  -> the 3-digit SERVICE segment of the order number
//     service  7 (Grundunterweisung)  -> 701   10/10 = 100%
//     service  5 (Brandschutzbeauftr.)-> 501    7/7  = 100%
//     service  1 (SiFa)               -> 104   70/77 =  91%
//     service  6 (Risk Assessment)    -> 401    5/6  =  83%
//     service  2 (Betriebsarzt)       -> 205   40/56 =  71%   <- NOT pure
//
// An order number is customer_order_SERVICE_seq, so knowing the customer AND the
// service pins down the order — but only if exactly one hub order has that
// combination. That is the rule, and it is checked, not assumed.
//
// SIX GUARDS, each of which killed real false positives when measured:
//
//  1. If the time-side name states its own 5-digit number, it must equal the
//     inferred customer. This caught 14 rows, including the single most valuable
//     one: "Enercon W-10842-001-007 WF Georgsdorf" (270.3h). Its customer link
//     implies 10388, but the name says 10842. Investigating settled it: 10842 is
//     a wind-TURBINE site code (W-13085, W-13294, W-13019 are others), not a
//     customer number, and Enercon's three real hub orders are already bridged.
//     There is no fourth order for Georgsdorf in the hub at all. Those 270 hours
//     are unbillable because the ORDER IS MISSING UPSTREAM, and the honest
//     answer is NULL. Under a weaker rule this row would have been the biggest
//     single mis-attribution in the whole backfill.
//
//  2. The hub order must not already be claimed by another time.project. Caught 4.
//
//  3. The name must not carry a service word that the ground truth associates
//     with a DIFFERENT segment. This is what stops "Arden University / 25/26 BA"
//     being linked to 10259_00128_104_01, a SiFa order: BA is occupational-
//     physician work, a different service at a different rate.
//
//  4. The two customer names must share a distinctive word. A structural
//     inference that the humans' own labels contradict is not trustworthy.
//
//  5. The customer must be unambiguous in ground truth (the 5 inconsistent ones
//     are refused outright).
//
//  6. RUNNER-UP SEGMENT. service 2 maps to 205 only 71% of the time; the other
//     29% is 203. So "the customer has exactly one 205 order" is not enough —
//     if that customer ALSO has a 203 order, the true answer could be either and
//     the row must stay NULL. This guard makes an impure service mapping safe to
//     use instead of having to discard it.
//
// What this rule deliberately does NOT do: it never links travel time or
// internal/HSE work. Those are 1,495.3h of the 2,418.4h gap and they have no
// customer order BY DEFINITION — they are not sold under an order number, so no
// hub_project_id could ever be correct for them. Their NULL is the accurate
// value, not a defect. The remaining client-work gap is 923.2h, and most of it
// is orders that simply do not exist in public.projects yet.
h("3b. PROJECTS — structured customer + service inference (Rule B)");

const bridgedTruth = (await c.query(`
  select p.customer_id, p.service_id, p.hub_project_id, p.name
    from time.project p where p.hub_project_id is not null`)).rows;

const custMap = new Map();   // time.customer_id -> Map(hub 5-digit prefix -> count)
const svcMap = new Map();    // time.service_id  -> Map(hub 3-digit segment -> count)
const svcWords = new Map();  // hub segment      -> Map(word -> count) seen on the time side
for (const b of bridgedTruth) {
  if (b.customer_id != null) {
    const pre = String(b.hub_project_id).slice(0, 5);
    if (!custMap.has(b.customer_id)) custMap.set(b.customer_id, new Map());
    const m = custMap.get(b.customer_id); m.set(pre, (m.get(pre) ?? 0) + 1);
  }
  const seg = String(b.hub_project_id).split("_")[2];
  if (b.service_id != null) {
    if (!svcMap.has(b.service_id)) svcMap.set(b.service_id, new Map());
    const m = svcMap.get(b.service_id); m.set(seg, (m.get(seg) ?? 0) + 1);
  }
  if (!svcWords.has(seg)) svcWords.set(seg, new Map());
  const bag = svcWords.get(seg);
  for (const raw of String(b.name).split(/[^\p{L}\p{N}]+/u)) {
    const t = norm(raw);
    if (t.length >= 2 && !/^\d+$/.test(t)) bag.set(t, (bag.get(t) ?? 0) + 1);
  }
}
const segVocab = new Map();
for (const [seg, bag] of svcWords) {
  segVocab.set(seg, new Set([...bag.entries()].filter(([, n]) => n >= 2).map(([t]) => t)));
}
const takenHub = new Set(bridgedTruth.map((b) => b.hub_project_id));

console.log(`  learned from the ${bridgedTruth.length} already-bridged rows (ground truth, not assumption):`);
console.log(`    time.customer -> hub customer number : ${[...custMap.values()].filter((m) => m.size === 1).length}` +
  ` of ${custMap.size} customers map to exactly one (the rest are refused)`);
console.log("    time.service  -> hub service segment :");
for (const [sid, m] of [...svcMap.entries()].sort((a, b) => Number(a[0]) - Number(b[0]))) {
  const tot = [...m.values()].reduce((a, b) => a + b, 0);
  const ranked = [...m.entries()].sort((a, b) => b[1] - a[1]);
  console.log(`      service ${String(sid).padStart(2)} -> ${ranked[0][0]}  ${ranked[0][1]}/${tot} = ${((ranked[0][1] / tot) * 100).toFixed(0)}%` +
    (ranked.length > 1 ? `   (runner-up ${ranked[1][0]} x${ranked[1][1]})` : "   (pure)"));
}

const unbridgedRows = (await c.query(`
  select p.id, p.name, p.customer_id, p.service_id, tc.name tc_name,
         (select count(*)::int from time.entry e where e.project_id=p.id) entries,
         (select coalesce(sum(e.duration_seconds),0)::bigint from time.entry e where e.project_id=p.id) secs
    from time.project p left join time.customer tc on tc.id=p.customer_id
   where p.hub_project_id is null order by 7 desc`)).rows;
const hubRows = (await c.query(`select id, name, customer from public.projects`)).rows;

const ruleB = [], ruleBRefused = [];
for (const p of unbridgedRows) {
  const no = (r) => ruleBRefused.push({ p, r });
  if (p.customer_id == null || p.service_id == null) { no("no customer_id or service_id on the time row"); continue; }

  const cm = custMap.get(p.customer_id);
  if (!cm) { no("this customer never appears in the bridged ground truth"); continue; }
  if (cm.size !== 1) { no(`customer maps to ${cm.size} different hub customer numbers — inconsistent`); continue; }
  const pre = [...cm.keys()][0];
  const custSamples = [...cm.values()][0];

  // GUARD 1 — the name's own customer number must not contradict the inference.
  const own = /(?:^|\D)(\d{5})(?:\D|$)/.exec(String(p.name).trim());
  if (own && own[1] !== pre) { no(`name states customer ${own[1]} but the customer link implies ${pre} — CONTRADICTION`); continue; }

  const sm = svcMap.get(p.service_id);
  if (!sm) { no("this service never appears in the bridged ground truth (e.g. travel time, internal)"); continue; }
  const tot = [...sm.values()].reduce((a, b) => a + b, 0);
  const ranked = [...sm.entries()].sort((a, b) => b[1] - a[1]);
  const seg = ranked[0][0], purity = ranked[0][1] / tot;

  const matches = hubRows.filter((x) => String(x.id).startsWith(pre + "_") && String(x.id).split("_")[2] === seg);
  if (matches.length === 0) { no(`customer ${pre} has no hub order in service segment ${seg} — the order is missing upstream`); continue; }
  if (matches.length > 1) { no(`${matches.length} hub orders share customer ${pre} + segment ${seg} — ambiguous`); continue; }
  const hx = matches[0];

  // GUARD 6 — if this service also maps to other segments, and the customer has
  // an order in one of those too, the answer is genuinely undecidable.
  const rivals = ranked.slice(1).map(([s]) => s)
    .filter((s) => hubRows.some((x) => String(x.id).startsWith(pre + "_") && String(x.id).split("_")[2] === s));
  if (rivals.length) { no(`service ${p.service_id} also maps to segment(s) ${rivals.join("/")} and customer ${pre} has an order there too — undecidable`); continue; }

  // GUARD 2 — do not steal a hub order already bridged elsewhere.
  if (takenHub.has(hx.id)) { no(`hub order ${hx.id} is already bridged to another time.project`); continue; }

  // GUARD 3 — the name must not name a different service.
  const mine = new Set(String(p.name).split(/[^\p{L}\p{N}]+/u).map(norm).filter((t) => t.length >= 2 && !/^\d+$/.test(t)));
  const ownV = segVocab.get(seg) ?? new Set();
  const foreign = [];
  for (const [oseg, ov] of segVocab) {
    if (oseg === seg) continue;
    for (const t of mine) if (ov.has(t) && !ownV.has(t)) foreign.push(`${t}→${oseg}`);
  }
  if (foreign.length) { no(`name carries service words of another segment: ${[...new Set(foreign)].slice(0, 3).join(", ")}`); continue; }

  // GUARD 4 — the humans' own client labels must agree on at least one word.
  const A = new Set([...String(p.name).split(/[^\p{L}\p{N}]+/u), ...String(p.tc_name ?? "").split(/[^\p{L}\p{N}]+/u)]
    .map(norm).filter((t) => t.length >= 4 && !/^\d+$/.test(t)));
  const B = new Set([...String(hx.name).split(/[^\p{L}\p{N}]+/u), ...String(hx.customer ?? "").split(/[^\p{L}\p{N}]+/u)]
    .map(norm).filter((t) => t.length >= 4 && !/^\d+$/.test(t)));
  const sharedTok = [...A].filter((t) => B.has(t) ||
    [...B].some((u) => u.length >= 5 && t.length >= 5 && (u.startsWith(t) || t.startsWith(u))));
  if (!sharedTok.length) { no(`client names share no distinctive word: "${p.tc_name}" vs "${hx.customer}"`); continue; }

  takenHub.add(hx.id);   // one hub order is claimed at most once by this run
  ruleB.push({ p, hx, pre, seg, purity, tot, custSamples, sharedTok });
}

console.log(`\n  ${ruleB.length} row(s) pass all six guards, carrying ${hours(ruleB.reduce((a, x) => a + Number(x.p.secs), 0))}h:`);
for (const a of ruleB.sort((x, y) => Number(y.p.secs) - Number(x.p.secs))) {
  console.log(`    LINK ${hours(a.p.secs).padStart(7)}h ${String(a.p.entries).padStart(3)}e  "${a.p.name}" [${a.p.tc_name}]`);
  console.log(`         → ${a.hx.id} "${a.hx.name}"`);
  console.log(`         customer ${a.pre} (seen ${a.custSamples}x in ground truth), service ${a.p.service_id}→${a.seg} ` +
    `(${(a.purity * 100).toFixed(0)}% over ${a.tot}), client word ${JSON.stringify(a.sharedTok.slice(0, 2))}, sole order for that pair`);
}

console.log(`\n  ${ruleBRefused.length} row(s) refused. Reasons, grouped:`);
const rg = new Map();
for (const r of ruleBRefused) {
  const k = r.r.replace(/\d{5}/g, "NNNNN").replace(/\b\d+\b/g, "N");
  if (!rg.has(k)) rg.set(k, { n: 0, secs: 0 });
  const e = rg.get(k); e.n++; e.secs += Number(r.p.secs);
}
for (const [k, v] of [...rg.entries()].sort((a, b) => b[1].secs - a[1].secs)) {
  console.log(`    ${String(v.n).padStart(3)} rows  ${hours(v.secs).padStart(8)}h   ${k}`);
}
console.log(`\n  the ten most valuable refusals, so the cost of caution is visible:`);
for (const r of ruleBRefused.filter((x) => Number(x.p.secs) > 0)
  .sort((a, b) => Number(b.p.secs) - Number(a.p.secs)).slice(0, 10)) {
  console.log(`    ${hours(r.p.secs).padStart(7)}h "${r.p.name}" [${r.p.tc_name}]`);
  console.log(`             ${r.r}`);
}


// ── write ────────────────────────────────────────────────────────────────────
h("4. WRITE");
// Rule A and Rule B are disjoint by construction: Rule A only considers rows
// whose code matches a hub project, Rule B only rows reached via customer+service,
// and both re-assert "hub_project_id is null" in the UPDATE.
const projectWrites = [
  ...[...accepted, ...uncorroborated].map((p) => ({ id: p.id, hub: p.code, rule: "A" })),
  ...ruleB.map((a) => ({ id: a.p.id, hub: a.hx.id, rule: "B" })),
];
if (!APPLY) {
  console.log("  dry run — nothing written.");
  console.log(`  --apply would: set hub_person_id on ${personLinks.length} member(s),` +
    ` set hub_project_id on ${projectWrites.length} project(s)` +
    ` (${projectWrites.filter((x) => x.rule === "A").length} by Rule A, ${projectWrites.filter((x) => x.rule === "B").length} by Rule B),`);
  console.log(`                 create 0 people rows, touch 0 rows in public.timesheet_entries.`);
} else {
  await c.query("begin");
  try {
    let mUpd = 0;
    for (const l of personLinks) {
      // hub_person_id is still null is re-asserted in the WHERE so a concurrent
      // writer cannot be clobbered.
      const r = await c.query(
        `update time.member set hub_person_id=$1 where id=$2 and hub_person_id is null`,
        [l.personId, l.memberId]);
      mUpd += r.rowCount;
    }
    let pUpd = 0;
    const byRule = { A: 0, B: 0 };
    for (const w of projectWrites) {
      const r = await c.query(
        `update time.project set hub_project_id=$1 where id=$2 and hub_project_id is null`,
        [w.hub, w.id]);
      pUpd += r.rowCount;
      byRule[w.rule] += r.rowCount;
    }
    const pr = { rowCount: pUpd };

    // Guard: never leave a dangling bridge behind. If either column now points at
    // something that does not exist, the whole transaction is worthless.
    const dangle = (await c.query(`
      select (select count(*)::int from time.member m where m.hub_person_id is not null
                and not exists (select 1 from public.people p where p.id=m.hub_person_id)) mem,
             (select count(*)::int from time.project p where p.hub_project_id is not null
                and not exists (select 1 from public.projects x where x.id=p.hub_project_id)) proj`)).rows[0];
    if (dangle.mem || dangle.proj) {
      throw new Error(`post-write integrity check failed: ${dangle.mem} dangling member links, ${dangle.proj} dangling project links`);
    }
    await c.query("commit");
    console.log(`  committed: ${mUpd} time.member rows, ${pr.rowCount} time.project rows` +
      ` (${byRule.A} by Rule A, ${byRule.B} by Rule B).`);
    console.log("  post-write integrity: 0 dangling hub_person_id, 0 dangling hub_project_id.");
  } catch (e) {
    await c.query("rollback");
    console.log(`  ROLLED BACK: ${e.message}`);
    await c.end();
    process.exit(1);
  }
}

h("5. COVERAGE AFTER");
const after = await coverage();
printCoverage("before:", before);
console.log("");
printCoverage("after: ", after);
console.log("");
console.log(`  delta: members bridged ${before.m.bridged} → ${after.m.bridged}` +
  `, projects bridged ${before.p.bridged} → ${after.p.bridged}`);
console.log(`  delta: hours reaching a hub project ${hours(before.reach.secs)}h → ${hours(after.reach.secs)}h` +
  `  (+${(Number(after.reach.secs - before.reach.secs) / 3600).toFixed(1)}h)`);
console.log(`  delta: hours reaching a hub person  ${hours(before.person.secs)}h → ${hours(after.person.secs)}h` +
  `  (+${(Number(after.person.secs - before.person.secs) / 3600).toFixed(1)}h)`);

h("6. WHAT THE NEWLY BRIDGED PEOPLE CAN NOW SEE");
console.log("  Asked the way the browser asks it: impersonate the account and count. Every");
console.log("  impersonation runs in a transaction that is unconditionally rolled back.\n");
const check = personLinks.length ? personLinks.map((l) => l.personId)
  : ["md-yasemin", "md-hannes", "md-kurt", "md-simone", "md-hitul"];
for (const pid of check) {
  const acct = (await c.query(`
    select aup.user_id, u.email, aup.role_key from public.app_user_profile aup
      join auth.users u on u.id=aup.user_id where aup.person_id=$1 and aup.is_active limit 1`, [pid])).rows[0];
  const own = (await c.query(`
    select (select count(*)::int from time.entry e join time.member m on m.id=e.member_id
              where m.hub_person_id=$1) own_entries,
           (select coalesce(round(sum(e.duration_seconds)/3600.0,1),0)::text from time.entry e
              join time.member m on m.id=e.member_id where m.hub_person_id=$1) own_hours,
           (select count(*)::int from time.entry e join time.member m on m.id=e.member_id
              join time.project p on p.id=e.project_id
             where m.hub_person_id=$1 and p.hub_project_id is not null) entries_on_hub_project`,
    [pid])).rows[0];
  if (!acct) {
    console.log(`  ${pid}: no active account; data is attributable but nobody logs in as them.`);
    continue;
  }
  const seen = {};
  for (const [k, sql] of [["projects", "select count(*)::int n from public.projects"],
    ["time.entry", "select count(*)::int n from time.entry"],
    ["timesheet_entries", "select count(*)::int n from public.timesheet_entries"]]) {
    await c.query("begin");
    try {
      await c.query("select set_config('role','authenticated',true)");
      await c.query("select set_config('request.jwt.claims',$1,true)",
        [JSON.stringify({ sub: acct.user_id, role: "authenticated", email: acct.email })]);
      seen[k] = (await c.query(sql)).rows[0].n;
    } catch (e) { seen[k] = `ERR ${e.message.slice(0, 40)}`; } finally { await c.query("rollback"); }
  }
  console.log(`  ${String(pid).padEnd(13)} ${String(acct.email).padEnd(30)} (${acct.role_key})`);
  console.log(`     own tracked time now attributable: ${own.own_entries} entries / ${own.own_hours}h` +
    ` (${own.entries_on_hub_project} of those also reach a hub project)`);
  console.log(`     through RLS sees: projects=${seen.projects}  time.entry=${seen["time.entry"]}` +
    `  timesheet_entries=${seen.timesheet_entries}`);
}

h("7. WHAT IS STILL BROKEN AFTER THIS");
console.log(`  - ${after.p.projects - after.p.bridged} of ${after.p.projects} time.project rows still have no hub_project_id, and no`);
console.log(`    evidence in the database can supply one. They need either a code on the`);
console.log(`    TrackingTime side or a human mapping; the honest state is NULL.`);
console.log(`  - ${after.total.entries - after.reach.entries} entries (${(Number(after.total.secs - after.reach.secs) / 3600).toFixed(1)}h) still reach no hub project, so project-level`);
console.log(`    hour burn remains understated. That is a data-entry gap upstream, not a bug here.`);
console.log(`  - ${noPersonRow.length} member(s) with real tracked time still have no person row (section 2).`);
console.log(`  - public.timesheet_entries is untouched and still a 28-row mockup. The /timesheets`);
console.log(`    route reads it, so that screen stays a demo surface no matter what this fixes.`);
console.log(`  - crm.trackingtime_project_reference / factorial_person_reference /`);
console.log(`    trackingtime_customer_reference are still empty. This script bridged the inline`);
console.log(`    columns because that is what the app reads; the documented mapping tables remain`);
console.log(`    dead weight and should be either populated by the sync or dropped.`);

await c.end();
console.log(APPLY ? "\nAPPLIED." : "\nDRY RUN COMPLETE — re-run with --apply to write.");
