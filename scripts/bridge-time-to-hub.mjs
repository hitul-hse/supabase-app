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
 * PROJECTS use the order number, which is the only strong identifier present.
 * public.projects.id and .code are identical for all 231 rows and have the shape
 * 10121_00359_104_01 (customer_order_service_seq). The rule is therefore an
 * EXACT equality: time.project.code = public.projects.id.
 * Rules deliberately NOT used, because they were measured and found unsafe:
 *   - time.project.source_id: a TrackingTime numeric id (e.g. 2728565). Zero of
 *     334 match any project id or code. Useless here.
 *   - exact name equality: zero matches out of 334. The two systems name
 *     projects differently ("KIKO Germany GmbH / 26 SiFa" vs "Caseking
 *     (Arbeitsschutz) 25/26").
 *   - the 5-digit customer prefix inside the name: 0 unique hits, 18 ambiguous.
 *     A customer has several concurrent orders, so the customer number cannot
 *     identify an order. This is exactly the guess that must not be made:
 *     picking any one of a customer's orders would silently book hours against
 *     the wrong contract and corrupt budget burn.
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

// ── write ────────────────────────────────────────────────────────────────────
h("4. WRITE");
if (!APPLY) {
  console.log("  dry run — nothing written.");
  console.log(`  --apply would: set hub_person_id on ${personLinks.length} member(s),` +
    ` set hub_project_id on ${linkSet.size} project(s),`);
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
    for (const p of [...accepted, ...uncorroborated]) {
      const r = await c.query(
        `update time.project set hub_project_id=$1 where id=$2 and hub_project_id is null`,
        [p.code, p.id]);
      pUpd += r.rowCount;
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
    console.log(`  committed: ${mUpd} time.member rows, ${pr.rowCount} time.project rows.`);
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
