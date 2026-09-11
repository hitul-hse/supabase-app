/*
 * A gate that has been widened until it passes is worthless unless you prove it
 * still fails on a genuinely wrong link.
 *
 * check-management-data's ADR-001 assertion went from "3 violations" (with 61
 * lawful links hidden behind a too-narrow rule) to "187 links checked, 0
 * violations". This script proves the widening did not turn it into a rubber
 * stamp: it replays the exact rule against DELIBERATELY WRONG pairings built from
 * real rows, and asserts each one is still rejected.
 *
 * READ-ONLY: it never writes, and never touches the real links.
 */

import pg from "pg";
import { loadEnv } from "./lib/gate-env.mjs";
import { record, notRunInChain } from "./lib/gate-result.mjs";
import { MASTERDATA_SERVICE_SQL, indexMasterdata, resolveOrderKey, serviceWordsFor } from "./lib/order-key.mjs";

const env = loadEnv();

// No database URL means no live database to check -- on CI without secrets, or
// on a clean checkout. Skipping says so; passing pg an undefined connection
// string makes it default to localhost:5432 and fail with ECONNREFUSED, which
// reads like a broken gate rather than an absent credential.
if (!env.SUPABASE_DB_URL) {
  console.log("SKIP: no SUPABASE_DB_URL, so there is no live database to check");
  notRunInChain();
}

const c = new pg.Client({ connectionString: env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
await c.connect();

const { rows: orders } = await c.query("select id, name, customer from public.projects order by id");
const orderNames = new Map(orders.map((o) => [o.id, o.name]));
const orderCustomers = new Map(orders.map((o) => [o.id, o.customer]));
// Both order-number grammars through scripts/lib/order-key.mjs, the reader
// check-management-data.mjs uses; SERVICE_WORDS lives there too.
const mdIndex = indexMasterdata((await c.query(MASTERDATA_SERVICE_SQL)).rows);
const orderKey = (id) => resolveOrderKey(id, mdIndex);

/* ---- the rule, copied verbatim from check-management-data.mjs ---- */
const norm = (s) => String(s ?? "").toLowerCase().replace(/[\u200b-\u200d\ufeff]/g, "").replace(/\s+/g, " ").trim();
const strip = (s) => norm(s).replace(/^closed?\s*:\s*/, "").replace(/^\d{5}[_\s]+/, "").trim();
const head = (s) => strip(s).split(/[/:]/)[0].trim();
const tokens = (s) => head(s).split(" ").filter(Boolean);
const customerAgrees = (ttName, orderId) => {
  const ttHead = head(ttName);
  const ttTok = tokens(ttName);
  for (const src of [orderCustomers.get(orderId), orderNames.get(orderId)]) {
    const srcTok = tokens(src);
    if (!srcTok.length) continue;
    if (srcTok[0] && ttTok[0] && srcTok[0] === ttTok[0]) return true;
    if (ttHead && head(src).startsWith(ttHead)) return true;
    if (srcTok.some((w) => w.length > 3 && ttHead.includes(w))) return true;
  }
  return false;
};
const isUnlawful = (ttName0, orderId) => {
  const ttName = String(ttName0 ?? "").trim();
  const lexware = /^(\d{5})_/.exec(orderId)?.[1];
  if (lexware && new RegExp(`^${lexware}[_\\s]`).test(strip(ttName))) return false;
  if (lexware && new RegExp(`^${lexware}[_\\s]`).test(norm(ttName))) return false;
  if (strip(ttName) === strip(orderNames.get(orderId))) return false;
  if (!lexware) return true;
  if (!customerAgrees(ttName, orderId)) return true;
  const words = serviceWordsFor(orderKey(orderId));
  if (words) {
    const hay = strip(ttName).replace(/[^a-z0-9 ]/g, " ");
    if (words.some((w) => new RegExp(`(^| )${w}`).test(hay))) return false;
  }
  if (head(ttName) && head(ttName) === head(orderNames.get(orderId))) return false;
  return true;
};

let failures = 0;
const mustReject = (label, ttName, orderId) => {
  const rejected = isUnlawful(ttName, orderId);
  record(rejected);
  console.log(`${rejected ? "PASS" : "FAIL"}: rejects ${label}`);
  if (!rejected) {
    console.log(`        ${JSON.stringify(ttName)} -> ${orderId} (${JSON.stringify(orderNames.get(orderId))}) WAS ACCEPTED`);
    failures += 1;
  }
};

console.log("Negative controls: each pairing below is wrong and must be rejected.\n");

// 1. Right service, completely different company.
mustReject("a different company with the same service",
  "Mbition / 26 SiFa", "10275_00123_104_01");           // On Cloud Service
mustReject("a different company, acronym form",
  "AWB / 26 SiFA", "10210_00056_104_01");                // TKS

// 2. Right company, but the order belongs to a different service segment.
const gu = orders.find((o) => orderKey(o.id).legacy_service_code === "701" && /mirantis/i.test(o.customer ?? ""));
if (gu) {
  mustReject("the right customer against the wrong service segment (SiFa name -> GU order)",
    "Mirantis / 26/27 SiFa", gu.id);
}

// 2b. The masterdata sheet's new grammar (10178_00028_1001.1_01) gets the same
//     protection: a SiFa name from another company against a new-format order.
const newFormat = orders.find((o) => orderKey(o.id).grammar === "new" && !customerAgrees("Mbition / 26 SiFa", o.id));
if (newFormat) {
  mustReject("a different company against a new-format (masterdata sheet) order",
    "Mbition / 26 SiFa", newFormat.id);
}

// 3. A real TT name against an unrelated real order, sampled broadly. This is the
//    volume test: 200 random wrong pairings must all be rejected.
const { rows: tt } = await c.query("select name from time.project where name is not null order by id limit 400");
let sampled = 0;
let accepted = 0;
const examples = [];
for (let i = 0; i < tt.length; i += 1) {
  const o = orders[(i * 7 + 3) % orders.length];
  const n = tt[i].name;
  // Skip pairings that are accidentally CORRECT (same company), which would not
  // be a negative control at all.
  if (customerAgrees(n, o.id)) continue;
  sampled += 1;
  if (!isUnlawful(n, o.id)) { accepted += 1; if (examples.length < 3) examples.push(`${JSON.stringify(n)} -> ${o.id}`); }
  if (sampled >= 200) break;
}
record(accepted === 0);
console.log(`${accepted === 0 ? "PASS" : "FAIL"}: rejects all ${sampled} mismatched-company pairings sampled`);
if (accepted) { console.log(`        ${accepted} accepted, e.g. ${examples.join(" | ")}`); failures += 1; }

// 4. The rule must not accept an empty or junk name.
mustReject("an empty TT name", "", "10275_00123_104_01");
mustReject("a junk TT name", "asdf qwer", "10275_00123_104_01");

await c.end();
console.log(failures === 0
  ? "\nADR-001 RULE STILL DISCRIMINATES: widened for real links, closed to wrong ones"
  : `\n${failures} negative control(s) leaked — the rule has become too permissive`);
process.exit(failures === 0 ? 0 : 1);
