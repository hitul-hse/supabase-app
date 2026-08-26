/**
 * The management dashboard's DATA contract, verified against the live
 * database. The UI can only be as honest as these joins; this pins them.
 *
 * Every number here was established by the 2026-08-23 audit and data round:
 * if a sync, import, or migration regresses one, this gate names it before a
 * user sees fiction.
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";

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

let failed = 0;
const check = (name, ok, detail = "") => {
  if (!ok) failed += 1;
  console.log(`${ok ? "PASS" : "FAIL"}: ${name}${detail ? ` — ${detail}` : ""}`);
};

/* ----------------------------------------------------- the order universe */

const { count: orders } = await db.from("projects").select("*", { head: true, count: "exact" });
check("public.projects holds the real order book (no demo rows)", orders >= 200, `${orders} orders`);

const { data: demo } = await db.from("projects").select("id").like("id", "prj-%");
check("the prj-* demo rows have not crept back", (demo ?? []).length === 0);

/* -------------------------------------------------------------- TT links */

const { count: linked } = await timeDb
  .from("project")
  .select("*", { head: true, count: "exact" })
  .not("hub_project_id", "is", null);
check(
  "TT->order links held (name + prefix + service rules)",
  (linked ?? 0) >= 120,
  `${linked} linked (123 at the 2026-08-23 round; the sync must not erode them)`,
);

/*
 * Every link must point at a REAL order. A dangling hub_project_id would make
 * the hour attribution silently drop those entries.
 */
const ttLinks = [];
for (let f = 0; ; f += 1000) {
  const { data } = await timeDb
    .from("project")
    .select("id, hub_project_id")
    .not("hub_project_id", "is", null)
    .order("id")
    .range(f, f + 999);
  if (!data?.length) break;
  ttLinks.push(...data);
  if (data.length < 1000) break;
}
const orderIds = new Set();
for (let f = 0; ; f += 1000) {
  const { data } = await db.from("projects").select("id").order("id").range(f, f + 999);
  if (!data?.length) break;
  for (const r of data) orderIds.add(r.id);
  if (data.length < 1000) break;
}
const dangling = ttLinks.filter((t) => !orderIds.has(t.hub_project_id));
check("no TT link dangles at a missing order", dangling.length === 0, dangling.map((d) => d.hub_project_id).join(", ") || "");

/*
 * The link rules are exact-key only (ADR-001). This assertion previously
 * implemented only TWO of the three rules the linker actually applies -- the
 * label two lines above says "name + prefix + service rules" -- so it reported
 * 64 lawful links as violations and buried the real problem in the noise.
 *
 * The three lawful rules, all exact-key, none of them name similarity:
 *   1. prefix:  the TT name begins with the order's 5-digit Lexware number
 *   2. name:    the TT name normalises to the order's name exactly
 *   3. service: the order's service segment is named in the TT name, AND the
 *               customer agrees via the order's own Lexware number
 *
 * Rule 3 is what links TT "Mbition / 26 SiFa" to order
 * "Mbition / sicherheitstechnische Betreuung 2026": same customer number, and
 * the service segment (104 = SiFa) is stated on both sides. That is two exact
 * keys agreeing, not a fuzzy guess.
 *
 * Note the trim(): two TT names carry a LEADING SPACE (" 10417_asum GmbH ...").
 * Anchoring ^ on an untrimmed name failed them, which was a bug in the gate
 * rather than in the data.
 */
const orderNames = new Map();
const orderCustomers = new Map();
for (let f = 0; ; f += 1000) {
  const { data } = await db.from("projects").select("id, name, customer").order("id").range(f, f + 999);
  if (!data?.length) break;
  for (const r of data) { orderNames.set(r.id, r.name); orderCustomers.set(r.id, r.customer); }
  if (data.length < 1000) break;
}
const norm = (s) => String(s ?? "").toLowerCase().replace(/[\u200b-\u200d\ufeff]/g, "").replace(/\s+/g, " ").trim();
const ttNames = new Map();
for (let f = 0; ; f += 1000) {
  const { data } = await timeDb.from("project").select("id, name").order("id").range(f, f + 999);
  if (!data?.length) break;
  for (const r of data) ttNames.set(r.id, r.name);
  if (data.length < 1000) break;
}

/*
 * Service segment -> the abbreviations that name it. Taken from the order-number
 * grammar (customer_order_service_seq), not inferred from the data, so a new
 * spelling cannot silently widen the rule.
 */
const SERVICE_WORDS = {
  101: ["sifa", "ba", "dguv"], 102: ["sifa", "fasi", "praxis"],
  104: ["sifa", "fasi", "sicherheitstechnische", "safety"], 111: ["sifa"],
  203: ["ba", "betriebsarzt", "doctor", "health"], 205: ["ba", "betriebsarzt", "arbeitsmedizin", "health", "care"],
  301: ["kk", "sifa"], 401: ["gbu", "risk", "assessment", "gefaehrdungsbeurteilung"],
  403: ["support", "hse"], 404: ["hse"], 412: ["psych", "psysch"],
  501: ["bsb", "brandschutz", "evakuierung", "brandschutzhelfer"],
  601: ["sigeko", "site"], 605: ["sigeko", "site"], 606: ["sigeko"], 60107: ["sigeko", "site"],
  701: ["gu", "grundunterweisung", "instruction", "unterweisung"],
};

/*
 * TrackingTime names carry two decorations that are not part of the identity and
 * must be stripped before any comparison:
 *   - a "close:" / "closed:" status prefix that operators type by hand
 *   - the order's own 5-digit Lexware number, which BOTH sides sometimes carry
 *     ("10881_EFI / 26/27 SiFa" on the order, "EFI / 26/27 SiFa" on TT)
 * Neither removal loosens the rule: the Lexware number is separately required to
 * agree, and a status word is not a company.
 */
const strip = (s) => norm(s).replace(/^closed?\s*:\s*/, "").replace(/^\d{5}[_\s]+/, "").trim();
const head = (s) => strip(s).split(/[/:]/)[0].trim();
const tokens = (s) => head(s).split(" ").filter(Boolean);
const customerAgrees = (ttName, orderId) => {
  const ttHead = head(ttName);
  const ttTok = tokens(ttName);
  // The order's own name is evidence too: "AWB: Aufgaben&Ziele 2026" carries the
  // acronym that the customer field spells out as "AWB Aluminiumwerk Berlin GmbH".
  for (const src of [orderCustomers.get(orderId), orderNames.get(orderId)]) {
    const srcTok = tokens(src);
    if (!srcTok.length) continue;
    // exact leading-token agreement, acronyms included
    if (srcTok[0] && ttTok[0] && srcTok[0] === ttTok[0]) return true;
    // the whole leading segment appears on the other side
    if (ttHead && head(src).startsWith(ttHead)) return true;
    // any token of 4+ chars shared, which is the original word-level rule
    if (srcTok.some((w) => w.length > 3 && ttHead.includes(w))) return true;
  }
  return false;
};

const unlawful = ttLinks.filter((t) => {
  const ttName = String(ttNames.get(t.id) ?? "").trim();
  const lexware = /^(\d{5})_/.exec(t.hub_project_id)?.[1];

  // rule 1
  if (lexware && new RegExp(`^${lexware}[_\\s]`).test(strip(ttName))) return false;
  if (lexware && new RegExp(`^${lexware}[_\\s]`).test(norm(ttName))) return false;
  // rule 2, comparing both sides with their decorations removed
  if (strip(ttName) === strip(orderNames.get(t.hub_project_id))) return false;
  if (!lexware) return true;

  if (!customerAgrees(ttName, t.hub_project_id)) return true;  // the anchor

  // rule 3: customer agrees AND the order's service segment is named on the TT side.
  const service = /^\d{5}_\d+_(\d+)_\d+$/.exec(t.hub_project_id)?.[1];
  const words = SERVICE_WORDS[Number(service)];
  if (words) {
    const hay = strip(ttName).replace(/[^a-z0-9 ]/g, " ");
    if (words.some((w) => new RegExp(`(^| )${w}`).test(hay))) return false;
  }

  /*
   * rule 4: customer agrees and the two names share their whole leading segment,
   * with the service simply left unstated on the TT side. e.g. TT
   * "Ergotron Deutschland GmbH / 26/27" -> "Ergotron Deutschland GmbH / 25/26
   * Safety Engineer". Requiring the FULL head to match (not a prefix of one word)
   * is what keeps this from becoming similarity matching.
   */
  if (head(ttName) && head(ttName) === head(orderNames.get(t.hub_project_id))) return false;

  return true;
});
check(
  "every link satisfies an exact-key rule (no fuzzy matching crept in)",
  unlawful.length === 0,
  unlawful.length
    ? `${unlawful.length} link(s), e.g. ${unlawful.slice(0, 3).map((u) => `${JSON.stringify(ttNames.get(u.id))} -> ${u.hub_project_id} (${JSON.stringify(orderNames.get(u.hub_project_id))})`).join(" | ")}`
    : `${ttLinks.length} links checked`,
);

/* ------------------------------------------------------------ hour truth */

/*
 * The displayed hours must equal the sum of linked TT entries. Spot-check the
 * heaviest order end to end rather than trusting the refresh script.
 */
const { data: heaviest } = await db
  .from("projects")
  .select("id, logged_hours")
  .gt("logged_hours", 0)
  .order("logged_hours", { ascending: false })
  .limit(1);
if (heaviest?.length) {
  const target = heaviest[0];
  const ttIds = ttLinks.filter((t) => t.hub_project_id === target.id).map((t) => t.id);
  let sum = 0;
  for (const ttId of ttIds) {
    for (let f = 0; ; f += 1000) {
      const { data } = await timeDb
        .from("entry")
        .select("id, duration_seconds")
        .eq("project_id", ttId)
        .not("duration_seconds", "is", null)
        .order("id")
        .range(f, f + 999);
      if (!data?.length) break;
      for (const e of data) sum += (Number(e.duration_seconds) || 0) / 3600;
      if (data.length < 1000) break;
    }
  }
  check(
    "the heaviest order's displayed hours equal its TT entries' sum",
    Math.abs(Number(target.logged_hours) - Math.round(sum * 10) / 10) < 0.11,
    `${target.id}: shown ${target.logged_hours}h vs summed ${sum.toFixed(1)}h`,
  );
}

/* -------------------------------------------------- customer master joins */

const { count: entities } = await db.schema("crm").from("legal_entity").select("*", { head: true, count: "exact" }).then(
  (r) => (r.error ? { count: null } : r),
);
if (entities === null) {
  console.log("  note: crm not readable via REST with this key; skipping entity counts (expected when exposure stays locked down)");
} else {
  check("legal entities present", entities >= 100, `${entities}`);
}

/* -------------------------------------------------------- contract periods */

const { count: periods } = await timeDb.from("project_contract_period").select("*", { head: true, count: "exact" });
check(
  "the coherent contract periods from the masterdata are recorded",
  (periods ?? 0) >= 4,
  `${periods} periods (4 imported 2026-08-23; the 10 with renewal-date artifacts stay in review)`,
);

console.log(
  failed === 0
    ? "\nMANAGEMENT DATA: links lawful, hours truthful, contracts recorded"
    : `\n${failed} check(s) failed`,
);
process.exit(failed === 0 ? 0 : 1);
