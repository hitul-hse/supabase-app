/*
 * Two findings that fell out of the Stefan lookup and are bigger than Stefan.
 *
 * 1. Every ACTIVE hub person has a real full name in time.member.display_name
 *    ("Mathias Schwenteit", "Stephan Herrmann", "Ulf Schoenemann"), while
 *    public.people carries first names only ("Mathias", "Stephan", "Ulf").
 *    Surnames are already in the database and the people table is not using them.
 *
 * 2. serhii@hs-experts.com is ARCHIVED in TrackingTime yet still linked to
 *    md-serhii and still active in public.people. An archived member is a
 *    departure signal; a mismatch between the two is exactly the drift the
 *    Factorial sync is meant to end.
 *
 * Both are exact-key facts, not guesses: the join is time.member.hub_person_id,
 * which the hub itself set. READ-ONLY.
 */
import { readFileSync } from "node:fs";
import pg from "pg";

const env = Object.fromEntries(
  readFileSync("C:/Supabase/.env.local", "utf8").split(/\r?\n/)
    .filter((l) => l && !l.startsWith("#") && l.includes("="))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^"|"$/g, "")]; }));

const c = new pg.Client({ connectionString: env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
await c.connect();

let failures = 0;
const check = (l, ok, d = "") => { console.log(`${ok ? "PASS" : "FAIL"}: ${l}${d ? `\n        ${d}` : ""}`); if (!ok) failures += 1; };

/* ------------------------------------- 1. surnames the hub already knows ---- */

const { rows: names } = await c.query(`
  select p.id, p.name as people_name, m.display_name as tt_name, m.email
    from public.people p
    join time.member m on m.hub_person_id = p.id
   where p.is_active
     and trim(m.display_name) <> ''
     -- a surname exists on the TT side that the people row does not carry
     and position(' ' in trim(m.display_name)) > 0
     and lower(trim(p.name)) <> lower(trim(m.display_name))
   order by p.id`);

console.log(`\n### active people whose full name is known but not stored (${names.length})\n`);
console.table(names.map((r) => ({ id: r.id, people: r.people_name, trackingtime: r.tt_name })));

check("no active person is stored under a partial name",
  names.length === 0,
  names.length
    ? `${names.length} of them. Every surname above is already in time.member.display_name, `
      + "linked by hub_person_id -- the hub's own key, so this is a data-completeness gap "
      + "rather than a matching problem. It matters for Factorial: the identity doc says "
      + "full_name is display-only and never a matching input, so a first-name-only people "
      + "row cannot be sanity-checked against a Factorial employee by a human reviewer."
    : "");

/* --------------------------------- 2. archived in TT but active in the hub -- */

const { rows: drift } = await c.query(`
  select p.id, p.name, m.email, m.is_archived as tt_archived, p.is_active as hub_active,
         (select count(*) from time.entry e
           where e.member_id = m.id and e.started_at::date <= current_date) as entries,
         (select max(e.started_at)::date from time.entry e
           where e.member_id = m.id and e.started_at::date <= current_date) as last_entry
    from public.people p
    join time.member m on m.hub_person_id = p.id
   where m.is_archived and p.is_active
   order by 7 desc nulls last`);

console.log(`\n### archived in TrackingTime but still active in the hub (${drift.length})\n`);
if (drift.length) console.table(drift);
else console.log("   (none)");

check("no person is archived in TrackingTime yet active in the hub",
  drift.length === 0,
  drift.length
    ? `${drift.length}: archived in the vendor system while public.people still says active. `
      + "That is a departure the hub has not registered. It is a JUDGEMENT call, not a fix: "
      + "TrackingTime archival may mean 'left the company' or merely 'stopped tracking time', "
      + "and deactivating a person changes who appears in pickers and org charts."
    : "");

/* --------------------------- the inverse, which would be worse ------------- */

const { rows: inverse } = await c.query(`
  select p.id, p.name, m.email
    from public.people p
    join time.member m on m.hub_person_id = p.id
   where not m.is_archived and not p.is_active`);
console.log(`\n### active in TrackingTime but deactivated in the hub (${inverse.length})\n`);
if (inverse.length) console.table(inverse);
else console.log("   (none)");
check("nobody actively tracking time is deactivated in the hub",
  inverse.length === 0,
  "such a person would be logging hours the hub attributes to an inactive colleague");

await c.end();
console.log(failures === 0
  ? "\nPERSON RECORDS AGREE with TrackingTime."
  : `\n${failures} finding(s). Each needs a human decision; nothing was written.`);
// Exit 2, the repo's "blocked, needs a human" convention, rather than 1: these are
// data decisions rather than code faults.
process.exit(failures === 0 ? 0 : 2);
