/*
 * Did widening the shared-mailbox pattern during the refactor silently reclassify
 * anyone?
 *
 * When the classifier moved from check-factorial-identity-baseline.mjs into
 * lib/factorial.mjs I added `support` and `no-reply` to the pattern. The reported
 * 18/29/2 was unchanged afterwards, which I took as evidence the refactor was
 * behaviour-preserving. That is weak evidence: the totals can be unchanged while
 * an individual address moves, and a widened exclusion pattern is exactly the
 * kind of change that quietly drops a real person.
 *
 * This runs BOTH patterns over every live address and reports any disagreement,
 * so "unchanged" is a measurement rather than an assumption.
 *
 * READ-ONLY.
 */
import { readFileSync } from "node:fs";
import pg from "pg";
import { SHARED_MAILBOX_RE, normaliseEmail } from "./lib/factorial.mjs";

// The pattern as it stood in the baseline script before the refactor (f685516).
const ORIGINAL = /^(info|jobs|office|kontakt|kontact|mail|hello|admin|noreply|no-reply)@/i;

const env = Object.fromEntries(
  readFileSync("C:/Supabase/.env.local", "utf8").split(/\r?\n/)
    .filter((l) => l && !l.startsWith("#") && l.includes("="))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^"|"$/g, "")]; }));

const c = new pg.Client({ connectionString: env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
await c.connect();
const { rows } = await c.query(`
  select m.email, m.display_name, m.is_archived, m.hub_person_id,
         (select count(*) from time.entry e
           where e.member_id = m.id and e.started_at::date <= current_date) as entries
    from time.member m order by m.email`);
await c.end();

let failures = 0;
const check = (l, ok, d = "") => { console.log(`${ok ? "PASS" : "FAIL"}: ${l}${d ? `\n        ${d}` : ""}`); if (!ok) failures += 1; };

const disagree = [];
for (const r of rows) {
  const e = normaliseEmail(r.email);
  const was = ORIGINAL.test(e);
  const now = SHARED_MAILBOX_RE.test(e);
  if (was !== now) disagree.push({ ...r, email: e, was, now });
}

console.log(`live addresses: ${rows.length}`);
console.log(`excluded by the ORIGINAL pattern: ${rows.filter((r) => ORIGINAL.test(normaliseEmail(r.email))).length}`);
console.log(`excluded by the CURRENT  pattern: ${rows.filter((r) => SHARED_MAILBOX_RE.test(normaliseEmail(r.email))).length}\n`);

check("the widened pattern reclassifies nobody on the live roster",
  disagree.length === 0,
  disagree.length === 0
    ? "so the refactor was genuinely behaviour-preserving here, not merely equal in total"
    : `${disagree.length} address(es) moved: ${disagree.map((d) => `${d.email} (${d.was ? "was excluded" : "was a person"} -> ${d.now ? "now excluded" : "now a person"})`).join("; ")}`);

/*
 * The forward-looking risk matters more than today's roster: the pattern excludes
 * by LOCAL PART, and some of those words are plausible human names or name
 * fragments. `mail` and `admin` are the dangerous ones -- and `support` is the
 * word I added, so it gets the same scrutiny.
 *
 * An excluded address is TERMINAL in the review queue, so a false positive here
 * means a real colleague is permanently marked "not a person" and their hours
 * vanish from the rollup with no queue row to notice.
 */
console.log("\n--- would the pattern wrongly exclude a plausible real person?\n");

const mustBePerson = [
  "administrator@hs-experts.com",   // a person whose local part starts with "admin"
  "mailin.schmidt@hs-experts.com",  // Mailin is a German given name
  "hellosaurus@hs-experts.com",
  "officer.jones@hs-experts.com",
  "supportive.person@hs-experts.com",
  "info.rmatiker@hs-experts.com",
];
for (const e of mustBePerson) {
  // The pattern requires the local part to be EXACTLY the word before @, so all
  // of these must pass through as people.
  check(`${e} is treated as a person`, !SHARED_MAILBOX_RE.test(normaliseEmail(e)));
}

const mustBeExcluded = [
  "info@hs-experts.com", "jobs@hs-experts.com", "support@hs-experts.com",
  "no-reply@hs-experts.com", "INFO@HS-EXPERTS.COM",
];
for (const e of mustBeExcluded) {
  check(`${e} is excluded as a mailbox`, SHARED_MAILBOX_RE.test(normaliseEmail(e)));
}

console.log(failures === 0
  ? "\nPATTERN: anchored on the whole local part. It excludes mailboxes and lets people through."
  : `\n${failures} problem(s) — a false exclusion is TERMINAL and loses a colleague's hours`);
process.exit(failures === 0 ? 0 : 1);
