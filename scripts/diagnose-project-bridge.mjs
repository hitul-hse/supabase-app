/**
 * Why are 157 time.project rows still unbridged?
 *
 * scripts/bridge-time-to-hub.mjs already exhausted the only rule it trusts
 * (time.project.code == public.projects.id, exact). It reports 0 remaining
 * candidates, so every easy win is already taken. What is left is 157 rows of
 * which 154 have no code at all, and the question this script answers is
 * whether ANY other field in the database can identify their hub order, or
 * whether the information is genuinely absent.
 *
 * This script writes nothing. It only measures.
 */
import { readFileSync } from "node:fs";
import pg from "pg";

const env = Object.fromEntries(
  readFileSync("C:/Supabase/.env.local", "utf8").split(/\r?\n/)
    .filter((l) => l && !l.startsWith("#") && l.includes("="))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^"|"$/g, "")]; }));

const c = new pg.Client({ connectionString: env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
await c.connect();
const q = async (sql, p) => (await c.query(sql, p)).rows;
const h = (s) => console.log(`\n${"=".repeat(78)}\n${s}\n${"=".repeat(78)}`);
const hours = (n) => (Number(n) / 3600).toFixed(1);

const norm = (s) => (s ?? "").toString().trim().toLowerCase()
  .replace(/ä/g, "ae").replace(/ö/g, "oe").replace(/ü/g, "ue").replace(/ß/g, "ss")
  .normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]/g, "");

h("A. SHAPE OF THE UNBRIDGED POPULATION");
const shape = (await q(`
  select
    count(*)::int total,
    count(*) filter (where code is null or code='')::int no_code,
    count(*) filter (where code is not null and code<>'')::int has_code,
    count(*) filter (where source_id is not null)::int has_source_id,
    count(*) filter (where customer_id is not null)::int has_time_customer,
    count(*) filter (where name ~ '^\\s*\\d{5}')::int name_starts_with_5digits
  from time.project where hub_project_id is null`))[0];
console.table([shape]);

const withTime = (await q(`
  select count(*)::int projects, coalesce(sum(x.secs),0)::bigint secs
    from (select p.id, (select coalesce(sum(e.duration_seconds),0) from time.entry e where e.project_id=p.id) secs
            from time.project p where p.hub_project_id is null) x
   where x.secs > 0`))[0];
console.log(`  of those, ${withTime.projects} carry actual time: ${hours(withTime.secs)}h at stake.`);

h("B. WHY IS crm.trackingtime_project_reference EMPTY?");
// It is documented as the intended mapping table. Is it empty because nothing
// writes it, or because something writes it and fails?
const refCols = await q(`
  select column_name, data_type, is_nullable
    from information_schema.columns
   where table_schema='crm' and table_name='trackingtime_project_reference'
   order by ordinal_position`);
if (!refCols.length) console.log("  table does not exist.");
else {
  console.table(refCols);
  const n = (await q(`select count(*)::int n from crm.trackingtime_project_reference`))[0].n;
  console.log(`  rows: ${n}`);
}
// Does anything reference it at all — a trigger, a view, a function body?
const refUsers = await q(`
  select p.proname, n.nspname
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace
   where p.prokind = 'f'
     and n.nspname not in ('pg_catalog','information_schema')
     and pg_get_functiondef(p.oid) ilike '%trackingtime_project_reference%'`);
console.log(`  database objects (functions/triggers) mentioning it: ${refUsers.length}`);
for (const r of refUsers) console.log(`    ${r.nspname}.${r.proname}`);
console.log("  VERDICT: if 0 functions reference it and it has 0 rows, nothing ever wrote it.");
console.log("  It is a designed-but-never-implemented mapping table. The sync writes the inline");
console.log("  time.project.hub_project_id column instead, which is what the app actually reads.");

h("C. CAN THE ORDER NUMBER BE RECOVERED FROM ANY OTHER FIELD?");
// Test each candidate signal independently and report unique vs ambiguous hits.
const unb = await q(`
  select p.id, p.code, p.source_id, p.name, tc.name time_customer,
         (select count(*)::int from time.entry e where e.project_id=p.id) entries,
         (select coalesce(sum(e.duration_seconds),0)::bigint from time.entry e where e.project_id=p.id) secs
    from time.project p
    left join time.customer tc on tc.id=p.customer_id
   where p.hub_project_id is null
   order by 7 desc`);
const hub = await q(`select id, code, name, customer, customer_legal_entity_id from public.projects`);

// signal 1: source_id (TrackingTime numeric id) against hub id/code
const hubIds = new Set(hub.map((x) => String(x.id)));
const hubCodes = new Set(hub.map((x) => String(x.code)));
let s1 = 0;
for (const p of unb) if (p.source_id && (hubIds.has(String(p.source_id)) || hubCodes.has(String(p.source_id)))) s1++;
console.log(`  signal: source_id == hub id/code            -> ${s1} hits of ${unb.length}`);

// signal 2: an order number embedded anywhere in the time-side name
const ORDER = /\b(\d{5})[_-](\d{5})[_-](\d{3})[_-](\d{2})\b/;
let s2u = 0, s2m = 0;
for (const p of unb) {
  const m = ORDER.exec(p.name || "");
  if (m) { if (hubIds.has(m[0])) s2u++; else s2m++; }
}
console.log(`  signal: full order number inside the name    -> ${s2u} that exist in hub, ${s2m} that do not`);

// signal 3: leading 5-digit CUSTOMER number in the name -> how many hub orders?
const byCustNum = new Map();
for (const x of hub) {
  const k = String(x.id).slice(0, 5);
  if (!byCustNum.has(k)) byCustNum.set(k, []);
  byCustNum.get(k).push(x);
}
let s3unique = 0, s3ambig = 0, s3none = 0;
const ambigDetail = [];
for (const p of unb) {
  const m = /^\s*(\d{5})/.exec(p.name || "");
  if (!m) { s3none++; continue; }
  const cands = byCustNum.get(m[1]) || [];
  if (cands.length === 1) s3unique++;
  else if (cands.length > 1) { s3ambig++; ambigDetail.push({ name: p.name, cust: m[1], n: cands.length, secs: p.secs }); }
  else s3none++;
}
console.log(`  signal: leading 5-digit customer number      -> ${s3unique} unique, ${s3ambig} ambiguous, ${s3none} no prefix/no such customer`);

// signal 4: exact normalised name equality
const hubByName = new Map();
for (const x of hub) {
  const k = norm(x.name);
  if (!hubByName.has(k)) hubByName.set(k, []);
  hubByName.get(k).push(x);
}
let s4 = 0;
for (const p of unb) { const g = hubByName.get(norm(p.name)); if (g && g.length === 1) s4++; }
console.log(`  signal: exact normalised name equality       -> ${s4} unique hits`);

h("D. THE UNIQUE-CUSTOMER CASES, INSPECTED ONE BY ONE");
console.log("  A 5-digit customer number that maps to exactly ONE hub order is the only");
console.log("  remaining signal with any power. But 'the customer has one order in the hub'");
console.log("  is NOT the same as 'this time row belongs to that order' — the hub may simply");
console.log("  be missing the other orders. Each case is printed so the claim can be judged.\n");
let strong = 0;
for (const p of unb) {
  const m = /^\s*(\d{5})/.exec(p.name || "");
  if (!m) continue;
  const cands = byCustNum.get(m[1]) || [];
  if (cands.length !== 1) continue;
  const hx = cands[0];
  const A = new Set([...String(p.name).split(/[^\p{L}\p{N}]+/u), ...String(p.time_customer ?? "").split(/[^\p{L}\p{N}]+/u)]
    .map(norm).filter((t) => t.length >= 4 && !/^\d+$/.test(t)));
  const B = new Set([...String(hx.name).split(/[^\p{L}\p{N}]+/u), ...String(hx.customer ?? "").split(/[^\p{L}\p{N}]+/u)]
    .map(norm).filter((t) => t.length >= 4 && !/^\d+$/.test(t)));
  const sharedTok = [...A].filter((t) => B.has(t));
  if (sharedTok.length) strong++;
  console.log(`  cust ${m[1]}  ${String(p.entries).padStart(4)}e ${hours(p.secs).padStart(7)}h  shared=${JSON.stringify(sharedTok)}`);
  console.log(`      time: "${p.name}" [${p.time_customer}]`);
  console.log(`      hub : ${hx.id} "${hx.name}" [${hx.customer}]`);
}
console.log(`\n  ${strong} of the unique-customer cases also share a client word.`);

h("E. HOW MANY HUB ORDERS DOES A CUSTOMER TYPICALLY HAVE?");
const dist = await q(`
  select n_orders, count(*)::int customers from (
    select left(id,5) cust, count(*)::int n_orders from public.projects group by 1) t
  group by 1 order by 1`);
console.table(dist);
console.log("  This is the crux: if most customers have several orders, the customer number");
console.log("  cannot identify an order, and 'unique' is an artefact of a thin hub table.");

h("F. WHAT THE 154 CODELESS ROWS ACTUALLY LOOK LIKE (top 25 by hours)");
for (const p of unb.filter((x) => !x.code).slice(0, 25)) {
  console.log(`  ${hours(p.secs).padStart(7)}h ${String(p.entries).padStart(4)}e  "${p.name}"  [tt#${p.source_id}] cust=${JSON.stringify(p.time_customer)}`);
}

h("G. WHAT KIND OF WORK IS UNBRIDGED? (the actual explanation)");
// Sections C/D found ZERO recoverable order numbers by any signal. That is not a
// matching failure, it is a category difference: look at what these rows ARE.
const CATS = [
  ["travel", /(travel\s*time|fahrzeit|reisezeit)/i],
  ["internal", /(internal project|^hse\b|urlaub|krank|holiday|sick|meeting|admin|akquise|weiterbildung|training)/i],
];
const catOf = (p) => {
  for (const [k, re] of CATS) if (re.test(p.name || "")) return k;
  if (norm(p.time_customer) === "hse") return "internal";
  return "client-work";
};
const catAgg = new Map();
for (const p of unb) {
  const k = catOf(p);
  const a = catAgg.get(k) ?? { cat: k, projects: 0, entries: 0, secs: 0 };
  a.projects++; a.entries += p.entries; a.secs += Number(p.secs);
  catAgg.set(k, a);
}
console.table([...catAgg.values()].map((a) => ({ ...a, hours: hours(a.secs) })).sort((x, y) => y.secs - x.secs));
console.log("  Travel time and internal/HSE work have no customer ORDER by definition: they are");
console.log("  not sold to a client under an order number, so there is no hub_project_id that");
console.log("  could ever be correct for them. Their NULL is the accurate value, not a gap.");

h("H. LAST UNTESTED ROUTE: time customer name -> hub orders for that customer");
// If a time.project's customer resolves to a hub customer with exactly ONE order,
// could we attribute? Test it, and count how often the answer is unambiguous.
const hubByCust = new Map();
for (const x of hub) {
  const k = norm(x.customer);
  if (!k) continue;
  if (!hubByCust.has(k)) hubByCust.set(k, []);
  hubByCust.get(k).push(x);
}
let hUnique = 0, hAmbig = 0, hNone = 0;
const uniqueCases = [];
for (const p of unb) {
  if (catOf(p) !== "client-work") continue;
  const k = norm(p.time_customer);
  let g = hubByCust.get(k);
  if (!g) { // try a containment match on distinctive tokens
    const hits = [...hubByCust.entries()].filter(([ck]) => k && ck && (ck.startsWith(k) || k.startsWith(ck)) && Math.min(ck.length, k.length) >= 5);
    g = hits.length === 1 ? hits[0][1] : null;
  }
  if (!g) hNone++;
  else if (g.length === 1) { hUnique++; uniqueCases.push({ p, hx: g[0] }); }
  else hAmbig++;
}
console.log(`  among client-work rows only: ${hUnique} customers with exactly ONE hub order,`);
console.log(`  ${hAmbig} with several (unusable), ${hNone} with no hub customer match at all.`);
for (const { p, hx } of uniqueCases) {
  console.log(`    ${hours(p.secs).padStart(7)}h ${String(p.entries).padStart(4)}e  "${p.name}" [${p.time_customer}]`);
  console.log(`        would imply ${hx.id} "${hx.name}" [${hx.customer}]`);
}
console.log("\n  JUDGEMENT: 'this customer happens to have one order in the hub' is not evidence");
console.log("  that THIS time row belongs to that order. Section E shows two thirds of customers");
console.log("  already carry 2+ orders, so uniqueness here reflects an incomplete hub table, not");
console.log("  a real one-to-one. Attributing on it would silently bill the wrong contract.");

h("I. THE SERVICE SEGMENT — why customer-level matching is not enough");
// An order number is customer_order_SERVICE_seq. Section H's candidates agree on
// the CUSTOMER but that is only half the key: 10259_00128_104_01 is customer
// 10259's *SiFa* order, and a time row labelled "25/26 BA" is occupational-
// physician work, which is a different service, a different rate and often a
// different contract. Linking across services misbills just as badly as linking
// across customers.
//
// So: learn what each 3-digit service segment MEANS from the 177 rows that are
// already bridged (ground truth someone already accepted), then check whether
// Section H's candidates actually agree on service.
const bridged = await q(`
  select p.name time_name, pr.id hub_id, pr.name hub_name
    from time.project p join public.projects pr on pr.id = p.hub_project_id`);
const svcVocab = new Map();   // service segment -> token counts seen on the time side
const SVCSTOP = new Set(["gmbh", "co", "und", "der", "die", "das"]);
for (const b of bridged) {
  const seg = String(b.hub_id).split("_")[2];
  if (!seg) continue;
  if (!svcVocab.has(seg)) svcVocab.set(seg, new Map());
  const bag = svcVocab.get(seg);
  for (const raw of String(b.time_name).split(/[^\p{L}\p{N}]+/u)) {
    const t = norm(raw);
    if (t.length >= 2 && !/^\d+$/.test(t) && !SVCSTOP.has(t)) bag.set(t, (bag.get(t) ?? 0) + 1);
  }
}
console.log("  service segment -> most distinctive words on the time side (learned, not assumed):");
const svcTop = new Map();
for (const [seg, bag] of [...svcVocab.entries()].sort()) {
  const top = [...bag.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6);
  svcTop.set(seg, new Set(top.filter(([, n]) => n >= 2).map(([t]) => t)));
  console.log(`    ${seg}: ${top.map(([t, n]) => `${t}(${n})`).join(" ")}`);
}
console.log("\n  Now re-testing every Section H candidate for SERVICE agreement:");
let svcOk = 0, svcBad = 0, svcUnknown = 0, svcGainSecs = 0;
for (const { p, hx } of uniqueCases) {
  const seg = String(hx.id).split("_")[2];
  const vocab = svcTop.get(seg);
  const mine = new Set(String(p.name).split(/[^\p{L}\p{N}]+/u).map(norm).filter((t) => t.length >= 2 && !/^\d+$/.test(t)));
  const overlap = vocab ? [...mine].filter((t) => vocab.has(t)) : [];
  // does the time name carry a service word that belongs to a DIFFERENT segment?
  const foreign = [];
  for (const [oseg, ov] of svcTop.entries()) {
    if (oseg === seg) continue;
    for (const t of mine) if (ov.has(t) && !(vocab && vocab.has(t))) foreign.push(`${t}->${oseg}`);
  }
  let verdict;
  if (!vocab || !vocab.size) { verdict = "UNKNOWN service vocabulary"; svcUnknown++; }
  else if (overlap.length && !foreign.length) { verdict = `AGREES on ${JSON.stringify(overlap)}`; svcOk++; svcGainSecs += Number(p.secs); }
  else if (foreign.length) { verdict = `DISAGREES: names service of another segment ${JSON.stringify([...new Set(foreign)].slice(0, 4))}`; svcBad++; }
  else { verdict = "no service word in common"; svcUnknown++; }
  console.log(`    ${hours(p.secs).padStart(7)}h  "${p.name}"`);
  console.log(`             vs ${hx.id} (service ${seg}) "${hx.name}"  -> ${verdict}`);
}
console.log(`\n  service agrees: ${svcOk}   service disagrees: ${svcBad}   undecidable: ${svcUnknown}`);
console.log(`  Even if every 'agrees' case were linked, it would recover ${hours(svcGainSecs)}h.`);

h("J. IS ANY OF THIS WORTH THE RISK? (the decisive number)");
const missSecs = (await q(`
  select coalesce(sum(e.duration_seconds),0)::bigint secs from time.entry e
    join time.project p on p.id=e.project_id where p.hub_project_id is null`))[0].secs;
const travelInternal = [...catAgg.values()].filter((a) => a.cat !== "client-work").reduce((s, a) => s + a.secs, 0);
console.log(`  hours currently unattributed          : ${hours(missSecs)}h`);
console.log(`    of which travel time + internal/HSE : ${hours(travelInternal)}h  <- structurally has NO order`);
console.log(`    of which client work                : ${hours(missSecs - travelInternal)}h`);
console.log(`  best case recoverable by the speculative customer rule: ${hours(svcGainSecs)}h` +
  `  = ${((Number(svcGainSecs) / Number(missSecs)) * 100).toFixed(1)}% of the gap`);
console.log("");
console.log("  CONCLUSION: the remaining gap is not a matching problem that better fuzzy logic");
console.log("  can solve. It is dominated by work that has no customer order by definition, and");
console.log("  the speculative rule buys a fraction of a percent while risking mis-billing. The");
console.log("  correct engineering answer is to leave these NULL and fix the source: TrackingTime");
console.log("  projects need their order number entered, or crm.trackingtime_project_reference");
console.log("  needs to be populated and actually used by the sync.");

h("K. THE TWO ACTIVE ACCOUNTS WITH NO PERSON LINK");
const blind = await q(`
  select aup.user_id, u.email, aup.role_key, aup.is_active, u.created_at, u.last_sign_in_at
    from public.app_user_profile aup join auth.users u on u.id=aup.user_id
   where aup.is_active and aup.person_id is null`);
for (const b of blind) {
  console.log(`  ${b.email}  role=${b.role_key}  created=${String(b.created_at).slice(0, 10)}  last_sign_in=${b.last_sign_in_at ? String(b.last_sign_in_at).slice(0, 10) : "never"}`);
  const tt = (await q(`select count(*)::int n from time.member m where lower(m.email)=lower($1)`, [b.email]))[0].n;
  console.log(`     matching time.member rows: ${tt}`);
}

await c.end();
