/*
 * check-management-data.mjs asserts every time.project -> public.projects link
 * satisfies one of two exact-key rules (ADR-001): the TT name begins with the
 * order's 5-digit Lexware customer number, or the TT name normalises to the
 * order's name exactly. Three links satisfy neither.
 *
 * Before touching data or relaxing a rule, establish WHY. A link that is
 * actually correct but fails the gate means the RULE is too narrow; a link that
 * is wrong means the DATA needs unlinking. Those are opposite fixes, so this
 * script prints the raw bytes needed to tell them apart.
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

// The same two rules the gate applies, so this script cannot disagree with it.
const norm = (s) => String(s ?? "").toLowerCase().replace(/[\u200b-\u200d\ufeff]/g, "").replace(/\s+/g, " ").trim();
const lawful = (ttName, orderId, orderName) => {
  const lexware = /^(\d{5})_/.exec(orderId)?.[1];
  const byPrefix = Boolean(lexware) && new RegExp(`^${lexware}[_\\s]`).test(ttName);
  const byName = norm(ttName) === norm(orderName);
  return { byPrefix, byName, lawful: byPrefix || byName };
};

const { rows } = await c.query(`
  select tp.id as tt_id, tp.name as tt_name, tp.hub_project_id as order_id,
         pr.name as order_name, pr.customer as order_customer,
         coalesce(sum(te.duration_seconds), 0) as secs,
         count(te.id) as entries
    from time.project tp
    join public.projects pr on pr.id = tp.hub_project_id
    left join time.entry te on te.project_id = tp.id
   where tp.hub_project_id is not null
   group by tp.id, tp.name, tp.hub_project_id, pr.name, pr.customer
   order by tp.id`);

console.log(`links examined: ${rows.length}`);

const bad = rows.filter((r) => !lawful(r.tt_name, r.order_id, r.order_name).lawful);
console.log(`links satisfying NEITHER exact-key rule: ${bad.length}\n`);

const show = (s) => JSON.stringify(s);
const codepoints = (s) => [...String(s).slice(0, 12)].map((ch) => {
  const cp = ch.codePointAt(0);
  return cp < 0x20 || cp > 0x7e ? `U+${cp.toString(16).toUpperCase().padStart(4, "0")}` : ch;
}).join(" ");

for (const r of bad) {
  const v = lawful(r.tt_name, r.order_id, r.order_name);
  const lexware = /^(\d{5})_/.exec(r.order_id)?.[1] ?? "(none)";
  console.log("=".repeat(78));
  console.log(`tt#${r.tt_id}  ${(Number(r.secs) / 3600).toFixed(1)}h across ${r.entries} entries`);
  console.log(`  TT name      ${show(r.tt_name)}`);
  console.log(`  first chars  ${codepoints(r.tt_name)}`);
  console.log(`  order id     ${r.order_id}   (lexware ${lexware})`);
  console.log(`  order name   ${show(r.order_name)}`);
  console.log(`  customer     ${show(r.order_customer)}`);
  console.log(`  byPrefix=${v.byPrefix}  byName=${v.byName}`);

  // Does it become lawful once leading/trailing whitespace is removed? If so the
  // link is right and only the rule's anchoring is wrong.
  const trimmed = String(r.tt_name).trim();
  const vTrim = lawful(trimmed, r.order_id, r.order_name);
  console.log(`  after trim:  byPrefix=${vTrim.byPrefix}  byName=${vTrim.byName}  -> ${vTrim.lawful ? "LAWFUL (rule is too strict: it anchors ^ on an untrimmed name)" : "still unlawful"}`);

  if (!vTrim.lawful) {
    // Last honest question: is the customer number simply absent from the TT
    // name while the customer itself agrees? That is a source-data gap, not a
    // bad link, and it must be judged by a human rather than auto-repaired.
    const ttDigits = /(\d{5})/.exec(trimmed)?.[1] ?? null;
    console.log(`  any 5-digit run in TT name: ${ttDigits ?? "none"}  (order expects ${lexware})`);
    console.log(`  normalised TT   ${show(norm(trimmed))}`);
    console.log(`  normalised order ${show(norm(r.order_name))}`);
  }
}

await c.end();
console.log("\nREAD-ONLY: nothing was written.");
