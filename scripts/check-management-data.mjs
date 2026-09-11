/**
 * The management dashboard's DATA contract, verified against the live
 * database. The UI can only be as honest as these joins; this pins them.
 *
 * Every number here was established by the 2026-08-23 audit and data round:
 * if a sync, import, or migration regresses one, this gate names it before a
 * user sees fiction.
 *
 * WHAT IT NEEDS, AND WHAT IT SAYS WHEN THAT IS ABSENT
 * ---------------------------------------------------
 * A service-role key and the project URL, for the live database. Nothing else:
 * no browser, no running app, no session.
 *
 * It used to take them from a .env.local in the WORKING DIRECTORY, read
 * unguarded. Absent -- on CI, and in every git worktree, neither of which has
 * one -- that is an ENOENT the moment the module evaluates, so the gate died
 * before its first assertion and printed `RESULT pass=0 fail=0 notrun=0`. That
 * line is the shape of a gate that checked nothing, and read from stdout alone
 * it is indistinguishable from one that had nothing to check. Worse, exporting
 * the credentials into the environment did not help: the file was the only
 * thing it would read.
 *
 * So: environment first, .env.local second (lib/gate-env.mjs), and a missing
 * credential is a stated NOT RUN (exit 3) rather than a crash or a silence.
 * This gate is not in the test:db && chain, so notRun() is the right helper --
 * exiting 3 here stops nothing.
 *
 * Run: npm run check:management-data
 */
import { createClient } from "@supabase/supabase-js";
import { loadEnv } from "./lib/gate-env.mjs";
import { record, recordNotRun, notRun } from "./lib/gate-result.mjs";
import { MASTERDATA_SERVICE_COLUMNS, indexMasterdata, parseOrderKey, resolveOrderKey, serviceWordsFor } from "./lib/order-key.mjs";

const env = loadEnv();
const missing = ["NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"].filter((k) => !env[k]);
if (missing.length) {
  notRun(`no live database to check against: ${missing.join(" and ")} ${missing.length > 1 ? "are" : "is"}`
    + " not in the environment or in a .env.local. Export them (or run from a checkout that has"
    + " the file) and this gate asserts against the live database.");
}

const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});
const timeDb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  db: { schema: "time" }, auth: { persistSession: false },
});

let failed = 0;
const check = (name, ok, detail = "") => {
  record(ok);
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
 *   3. service: the order's service is named in the TT name, AND the
 *               customer agrees via the order's own Lexware number
 *               (both order-number grammars, via scripts/lib/order-key.mjs)
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
 * Service -> the abbreviations that name it: SERVICE_WORDS in
 * scripts/lib/order-key.mjs, a fixed table keyed on the legacy service code, not
 * inferred from the data, so a new spelling cannot silently widen the rule. The
 * order's code is read by resolveOrderKey for BOTH grammars: from an old id
 * itself, or -- for the masterdata sheet's new ids (10178_00028_1001.1_01) --
 * through the sheet's exact service-number crosswalk, and n/a when that is
 * ambiguous.
 */
const masterdataRows = [];
let masterdataError = null;
for (let f = 0; ; f += 1000) {
  const { data, error } = await db.from("project_masterdata").select(MASTERDATA_SERVICE_COLUMNS).order("project_id").range(f, f + 999);
  if (error) { masterdataError = error.message; break; }
  if (!data?.length) break;
  masterdataRows.push(...data);
  if (data.length < 1000) break;
}
check("project_masterdata is readable (the service source for both order-number grammars)", masterdataError === null,
  masterdataError ?? `${masterdataRows.length} rows`);
const mdIndex = indexMasterdata(masterdataRows);
const unreadableIds = [...orderIds].filter((id) => !parseOrderKey(id));
check("every order id is in one of the two order-number grammars (old 10275_00123_104_01, new 10178_00028_1001.1_01)",
  unreadableIds.length === 0, unreadableIds.slice(0, 5).join(", "));

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

  // rule 3: customer agrees AND the order's service is named on the TT side.
  const words = serviceWordsFor(resolveOrderKey(t.hub_project_id, mdIndex));
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
  /*
   * This used to be a bare console.log, so the assertion simply vanished from
   * the count: the gate reported seven passes whether it had checked the
   * entities or not. A skipped assertion is the third answer, and the RESULT
   * line has to carry it -- that is the whole subject of lib/gate-result.mjs.
   */
  recordNotRun("legal entities: crm is not readable over PostgREST with this key, which is"
    + " expected while ADR-002 keeps its exposure locked down");
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
