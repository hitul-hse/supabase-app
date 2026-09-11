/**
 * Widen the TT->order links beyond exact names, still ADR-001-clean.
 *
 * Round 1 linked 54 TT projects by EXACT normalised name. The audit showed the
 * gap: 207/231 orders display 0h logged because their TT hours are unmatched.
 *
 * Two additional EXACT-KEY rules (no name similarity anywhere):
 *
 *  RULE B - unique Lexware prefix. A TT project whose NAME starts with a
 *    five-digit Lexware customer number ("10744_Closer Go Hamburg / ...") and
 *    where that customer has EXACTLY ONE order: the pairing cannot be wrong
 *    without the Excel itself being wrong.
 *
 *  RULE C - prefix + service code. The order number's third segment encodes
 *    the service family (104x=Sifa, 6xx=SiGeKo, 501=Brandschutz, 2xx=
 *    Betriebsarzt, 4xx=H&S Consulting, 70x=Trainings). When a customer has
 *    multiple orders, a TT project whose SERVICE maps to exactly one of those
 *    orders' code families is matched to it. Both keys (customer number,
 *    service family) are exact; only their combination is new.
 *    Since 2026-09-10 the hub also holds the masterdata sheet's key
 *    (10178_00028_1001.1_01); its legacy code comes from scripts/lib/order-key.mjs
 *    (the sheet's exact crosswalk) or is unknown, and a customer with an order
 *    of unknown code is ambiguous rather than silently narrowed.
 *
 * Anything still ambiguous is REPORTED, not guessed.
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync, writeFileSync } from "node:fs";
import { MASTERDATA_SERVICE_COLUMNS, indexMasterdata, resolveOrderKey } from "./lib/order-key.mjs";

const DRY = process.argv.includes("--dry-run");

for (const line of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
  const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});
const timeDb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  db: { schema: "time" }, auth: { persistSession: false },
});

/*
 * TT service name -> order-number code families. Derived from the masterdata
 * Excel itself: each service sheet's order numbers use these code segments.
 * A TT service maps to a FAMILY (list of prefixes), and a code matches when it
 * starts with any of them.
 */
const SERVICE_FAMILIES = [
  { match: /sifa|safety engeineer|safety engineer/i, codes: ["101", "102", "104", "111", "301"] },
  { match: /sigeko|construction/i, codes: ["601", "605", "606", "60107"] },
  { match: /brandschutzbeauftragter|fire safety officer/i, codes: ["501"] },
  { match: /betriebsarzt|company doctor/i, codes: ["2", "203", "205"] },
  { match: /health & safety consulting|risk assessment/i, codes: ["401", "402", "403", "404", "405", "412"] },
  { match: /grundunterweisung|training|brandschutzhelfer/i, codes: ["701", "702", "401"] },
];

const familyFor = (serviceName) => {
  if (!serviceName) return null;
  const hits = SERVICE_FAMILIES.filter((f) => f.match.test(serviceName));
  // A service matching two families would make the rule ambiguous by
  // construction; refuse it entirely rather than order-dependently.
  return hits.length === 1 ? hits[0].codes : null;
};

const page = async (client, table, select, orderBy = "id") => {
  const out = [];
  for (let f = 0; ; f += 1000) {
    const { data, error } = await client.from(table).select(select).order(orderBy).range(f, f + 999);
    if (error) throw new Error(`${table}: ${error.message}`);
    if (!data?.length) break;
    out.push(...data);
    if (data.length < 1000) break;
  }
  return out;
};

const hub = await page(db, "projects", "id, name");
const tt = await page(timeDb, "project", "id, name, hub_project_id, service:service_id(name)");
// Both order-number grammars through one reader (scripts/lib/order-key.mjs). A
// new-format order (10178_00028_1001.1_01) has no legacy code in its id; it gets
// one only through the sheet's exact crosswalk, and otherwise stays unknown.
const mdIndex = indexMasterdata(await page(db, "project_masterdata", MASTERDATA_SERVICE_COLUMNS, "project_id"));
const codeOf = (orderNo) => resolveOrderKey(orderNo, mdIndex).legacy_service_code;

const ordersByLexware = new Map();
for (const h of hub) {
  const customer = resolveOrderKey(h.id, mdIndex).customer_number;
  if (!customer) continue;
  if (!ordersByLexware.has(customer)) ordersByLexware.set(customer, []);
  ordersByLexware.get(customer).push(h);
}

const links = [];
const ambiguous = [];
let already = 0;

for (const p of tt) {
  if (p.hub_project_id) { already += 1; continue; }
  const m = /^(\d{5})[_\s]/.exec(p.name ?? "");
  if (!m) continue;
  const orders = ordersByLexware.get(m[1]) ?? [];
  if (orders.length === 0) continue;

  if (orders.length === 1) {
    links.push({ tt: p, order: orders[0], rule: "B: unique prefix" });
    continue;
  }

  // RULE C: disambiguate by service family.
  const family = familyFor(p.service?.name);
  if (!family) { ambiguous.push({ p, why: `no service family for '${p.service?.name ?? "none"}'` }); continue; }
  // An order whose service code cannot be read could be the right one; leaving
  // it out of the comparison is how a wrong order starts to look unique.
  const unreadable = orders.filter((o) => !codeOf(o.id));
  if (unreadable.length) { ambiguous.push({ p, why: `${unreadable.length} of the customer's orders have no readable service code (e.g. ${unreadable[0].id})` }); continue; }
  const matching = orders.filter((o) => {
    const code = codeOf(o.id);
    return code && family.some((f) => code === f || code.startsWith(f));
  });
  if (matching.length === 1) {
    links.push({ tt: p, order: matching[0], rule: `C: prefix+service(${p.service.name.slice(0, 24)})` });
  } else {
    ambiguous.push({ p, why: `${matching.length} orders match service family` });
  }
}

console.log(`TT: ${tt.length} | already linked: ${already} | new links: ${links.length} | still ambiguous: ${ambiguous.length}`);
console.log("\nnew links:");
for (const l of links) console.log(`  [${l.rule}] ${l.order.id}  <-  ${String(l.tt.name).slice(0, 55)}`);
console.log("\nstill ambiguous (correctly left for a human):");
for (const a of ambiguous.slice(0, 12)) console.log(`  ${String(a.p.name).slice(0, 50).padEnd(52)} ${a.why}`);

writeFileSync(
  ".context-bridge/tt-link-round2.json",
  JSON.stringify({
    generatedAt: new Date().toISOString(),
    linked: links.map((l) => ({ order: l.order.id, tt: l.tt.name, rule: l.rule })),
    ambiguous: ambiguous.map((a) => ({ tt: a.p.name, why: a.why })),
  }, null, 2),
);

if (DRY) { console.log("\nDRY RUN: nothing written."); process.exit(0); }

let written = 0;
for (const l of links) {
  const { error } = await timeDb.from("project").update({ hub_project_id: l.order.id }).eq("id", l.tt.id);
  if (error) throw new Error(`${l.tt.name}: ${error.message}`);
  written += 1;
}
console.log(`\nlinked ${written} more TT projects. Total now: ${already + written}.`);
