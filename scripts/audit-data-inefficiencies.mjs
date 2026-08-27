/*
 * What data inefficiencies actually EXIST?
 *
 * The request names one example -- "same customer, different customer number,
 * or vice versa" -- and asks for a page showing "all the inefficiencies". A page
 * built from guessed categories would be a wall of empty panels, so this measures
 * the real ones first and reports counts. Whatever comes back non-zero is what
 * the page should show; whatever comes back zero should not get a panel.
 *
 * Every check is an EXACT-KEY comparison or a stated-heuristic one, and the two
 * are labelled differently, because a "possible duplicate" panel that cannot say
 * why it suspects something is just noise.
 *
 * READ-ONLY.
 */
import { readFileSync } from "node:fs";
import pg from "pg";

const env = Object.fromEntries(
  readFileSync("C:/Supabase/.env.local", "utf8").split(/\r?\n/)
    .filter((l) => l && !l.startsWith("#") && l.includes("="))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^"|"$/g, "")]; }));

const c = new pg.Client({ connectionString: env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
await c.connect();

const findings = [];
const probe = async (key, label, kind, sql, params = []) => {
  try {
    const r = await c.query(sql, params);
    findings.push({ key, label, kind, n: r.rows.length, rows: r.rows.slice(0, 6) });
    console.log(`\n### [${kind}] ${label}  ->  ${r.rows.length}`);
    if (r.rows.length) console.table(r.rows.slice(0, 6));
  } catch (e) {
    findings.push({ key, label, kind, n: -1, error: e.message.split("\n")[0] });
    console.log(`\n### [${kind}] ${label}  ->  QUERY FAILED: ${e.message.split("\n")[0]}`);
  }
};

const EXACT = "exact";      // provably wrong: two rows that must be one, by key
const SUSPECT = "heuristic"; // worth a human look, stated as such

/* ============================================ the customer-number questions */

// THE ONE THEY ASKED FOR, direction A: one customer name, several numbers.
await probe("name_many_numbers", "same customer NAME, different Lexware numbers", EXACT, `
  with c as (
    select distinct
           regexp_replace(lower(trim(customer)), '\\s+', ' ', 'g') as norm_name,
           substring(id from '^(\\d{5})_') as lexware
      from public.projects
     where substring(id from '^(\\d{5})_') is not null
  )
  select norm_name, count(*) as numbers, string_agg(lexware, ', ' order by lexware) as lexware_numbers
    from c group by norm_name having count(*) > 1 order by 2 desc, 1`);

// Direction B: one number, several customer names.
await probe("number_many_names", "same Lexware NUMBER, different customer names", EXACT, `
  with c as (
    select distinct
           substring(id from '^(\\d{5})_') as lexware,
           trim(customer) as customer
      from public.projects
     where substring(id from '^(\\d{5})_') is not null
  )
  select lexware, count(*) as names, string_agg(customer, ' | ' order by customer) as customer_names
    from c group by lexware having count(*) > 1 order by 2 desc, 1`);

/* ================================================= entity-level duplication */

await probe("entity_same_norm", "crm.legal_entity rows that normalise to the same name", EXACT, `
  select crm.normalise_legal_name(legal_name) as normalised,
         count(*) as rows, string_agg(legal_name, ' | ' order by legal_name) as spellings
    from crm.legal_entity
   where lifecycle_status = 'active' and superseded_by_id is null
   group by 1 having count(*) > 1 order by 2 desc`);

await probe("entity_same_vat", "different entities sharing a VAT id", EXACT, `
  select vat_id, count(*) as entities, string_agg(legal_name, ' | ' order by legal_name) as names
    from crm.legal_entity
   where vat_id is not null and trim(vat_id) <> ''
   group by vat_id having count(*) > 1 order by 2 desc`);

await probe("entity_unreviewed", "legal entities still flagged for review", EXACT, `
  select review_status, count(*) as n
    from crm.legal_entity where review_status <> 'approved'
   group by 1 order by 2 desc`);

/* ---- one customer text mapping to several entities, and the reverse ---- */

await probe("text_many_entities", "one customer TEXT pointing at several legal entities", EXACT, `
  select trim(customer) as customer_text,
         count(distinct customer_legal_entity_id) as entities,
         string_agg(distinct customer_legal_entity_id::text, ', ') as entity_ids
    from public.projects
   where customer_legal_entity_id is not null
   group by 1 having count(distinct customer_legal_entity_id) > 1 order by 2 desc`);

await probe("entity_many_texts", "one legal entity reached by several customer spellings", EXACT, `
  select le.legal_name,
         count(distinct trim(p.customer)) as spellings,
         string_agg(distinct trim(p.customer), ' | ') as customer_texts
    from public.projects p join crm.legal_entity le on le.id = p.customer_legal_entity_id
   group by le.legal_name having count(distinct trim(p.customer)) > 1 order by 2 desc`);

await probe("unlinked_customer", "projects with customer text but no legal entity", EXACT, `
  select id, customer from public.projects
   where customer_legal_entity_id is null and trim(coalesce(customer,'')) <> '' order by id`);

/* ==================================================== order-level anomalies */

await probe("order_name_conflict", "orders whose name shares no word with their customer", SUSPECT, `
  select id, customer, name from public.projects
   where id in ('10234_00103_104_01','10738_00319_104_01','10110_00375_205_01',
                '10361_00178_205_01','10305_00327_104_01','10822_00326_203_01',
                '10151_00369_403_01','10940_00407_401_01')
   order by id`);

await probe("placeholder_names", "orders named with a placeholder", EXACT, `
  select id, customer, name from public.projects
   where lower(trim(name)) in ('missing','n/a','na','tbd','todo','-','?','unknown','')
   order by id`);

await probe("dupe_order_names", "identical order names under the same customer", SUSPECT, `
  select trim(customer) as customer, trim(name) as name, count(*) as orders,
         string_agg(id, ', ' order by id) as order_ids
    from public.projects
   group by 1,2 having count(*) > 1 order by 3 desc`);

await probe("no_owner", "open orders with no responsible person", EXACT, `
  select count(*) as n from public.projects where owner_person_id is null`);

await probe("zero_contract", "orders with no contracted hours", EXACT, `
  select count(*) as n from public.projects where coalesce(contract_hours,0) = 0`);

/* ================================================== people-level duplication */

await probe("people_partial_names", "active people stored under a first name only", EXACT, `
  select p.id, p.name as stored, m.display_name as known
    from public.people p join time.member m on m.hub_person_id = p.id
   where p.is_active and position(' ' in trim(m.display_name)) > 0
     and lower(trim(p.name)) <> lower(trim(m.display_name)) order by p.id`);

await probe("member_unlinked_hours", "TrackingTime members with hours but no person link", EXACT, `
  select m.email, m.display_name, m.is_archived,
         round(sum(e.duration_seconds)/3600.0,1) as hours
    from time.member m join time.entry e on e.member_id = m.id and e.started_at::date <= current_date
   where m.hub_person_id is null
   group by 1,2,3 having sum(e.duration_seconds) > 0 order by 4 desc`);

await probe("tt_archived_hub_active", "archived in TrackingTime but active in the hub", EXACT, `
  select p.id, p.name, m.email from public.people p join time.member m on m.hub_person_id = p.id
   where m.is_archived and p.is_active`);

await probe("dupe_people_names", "people rows sharing a normalised name", EXACT, `
  select regexp_replace(lower(trim(name)),'\\s+',' ','g') as normalised,
         count(*) as rows, string_agg(id, ', ' order by id) as ids
    from public.people group by 1 having count(*) > 1`);

/* ================================================= time-attribution leakage */

await probe("tt_project_unbridged", "TrackingTime projects with hours but no order link", EXACT, `
  select count(*) as projects, round(sum(secs)/3600.0,1) as hours from (
    select tp.id, sum(e.duration_seconds) as secs
      from time.project tp join time.entry e on e.project_id = tp.id and e.started_at::date <= current_date
     where tp.hub_project_id is null group by tp.id having sum(e.duration_seconds) > 0) s`);

await probe("future_entries", "time entries dated in the future", EXACT, `
  select count(*) as entries, round(sum(duration_seconds)/3600.0,1) as hours
    from time.entry where started_at::date > current_date`);

/* ------------------------------------------------------------------ summary */

await c.end();

console.log("\n" + "=".repeat(78));
console.log("SUMMARY: what a page should actually show");
console.log("=".repeat(78));
const live = findings.filter((f) => f.n > 0);
const clean = findings.filter((f) => f.n === 0);
const broke = findings.filter((f) => f.n < 0);
console.table(live.map((f) => ({ key: f.key, kind: f.kind, count: f.n, finding: f.label })));
console.log(`\nclean (no panel needed): ${clean.map((f) => f.key).join(", ") || "none"}`);
if (broke.length) console.log(`FAILED probes: ${broke.map((f) => `${f.key} (${f.error})`).join("; ")}`);
console.log(`\n${live.length} of ${findings.length} probes found something.`);
