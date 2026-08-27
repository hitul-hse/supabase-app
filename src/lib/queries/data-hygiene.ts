/*
 * The data-hygiene reader.
 *
 * Every finding here was MEASURED before this file existed
 * (scripts/audit-data-inefficiencies.mjs, 27 Aug 2026). 19 probes were run; the 5
 * that returned nothing get no panel, because a page of empty panels teaches the
 * reader to stop looking.
 *
 * Two kinds of finding, kept visually distinct because they demand different
 * responses:
 *
 *   exact      two rows that must be one, proven by a key. Actionable as-is.
 *   heuristic  worth a human look, with the suspicion stated. NEVER auto-fixable.
 *
 * ADR-001 applies to what this page CLAIMS, not just to what the app writes: a
 * panel asserting "these are the same customer" on name similarity alone would be
 * the same error as merging them. So a heuristic panel says what it noticed and
 * leaves the judgement to the reader.
 *
 * Read-only by construction: this module has no write path. Fixing anything here
 * happens in the owning module or the source workbook, which is stated on the
 * page so nobody expects a button that does not exist.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";

type SupabaseTyped = SupabaseClient<Database>;

/** How a finding was established. Drives the badge and the wording. */
export type FindingKind = "exact" | "heuristic";

export type HygieneRow = {
  /** Stable identity for the row, so React keys do not depend on order. */
  id: string;
  /** The primary thing: a customer name, an order number, a person. */
  subject: string;
  /** What is wrong with it, in one line, using the real values. */
  detail: string;
  /** Where to go to fix it, or null when the fix is outside the app. */
  href: string | null;
};

export type HygieneFinding = {
  key: string;
  title: string;
  kind: FindingKind;
  /**
   * What the reader should do. Present tense, specific, and honest about where
   * the fix lives -- several of these are fixed in the source workbook rather
   * than in the app, and a page that implies otherwise wastes someone's morning.
   */
  action: string;
  /** Total matching rows. `rows` may be a capped sample; this is never capped. */
  count: number;
  rows: HygieneRow[];
  /** Set when the probe itself failed, so an error is never rendered as "clean". */
  error: string | null;
};

export type DataHygiene = {
  findings: HygieneFinding[];
  /** Probes that ran and found nothing. Named, so "clean" is visible evidence. */
  clean: string[];
  checkedAt: string;
  /** True when the reader lacks the grants these probes need. */
  unavailable: boolean;
};

const PAGE = 1000;

/**
 * Page a table fully. `.order()` before `.range()` per the house rule, and a
 * truncation flag rather than a silently short list -- an incomplete hygiene
 * report is worse than none, because it reads as "nothing more to fix".
 */
async function readAll<T>(
  supabase: SupabaseTyped,
  table: string,
  columns: string,
  orderBy: string,
): Promise<{ rows: T[]; truncated: boolean }> {
  const rows: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await (supabase as never as SupabaseClient)
      .from(table)
      .select(columns)
      .order(orderBy)
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`${table}: ${error.message}`);
    if (!data?.length) break;
    rows.push(...(data as T[]));
    if (data.length < PAGE) break;
    // 20 pages is 20,000 rows, far beyond this dataset. Hitting it means
    // something is wrong with the query, not with the data.
    if (rows.length >= PAGE * 20) return { rows, truncated: true };
  }
  return { rows, truncated: false };
}

const norm = (s: string | null | undefined) =>
  String(s ?? "").toLowerCase().replace(/\s+/g, " ").trim();

/** The 5-digit Lexware customer number that prefixes every order id. */
const lexwareOf = (orderId: string) => /^(\d{5})_/.exec(orderId)?.[1] ?? null;

type ProjectRow = {
  id: string;
  name: string | null;
  customer: string | null;
  customer_legal_entity_id: string | null;
  owner_person_id: string | null;
  contract_hours: number | null;
};

export async function getDataHygiene(supabase: SupabaseTyped): Promise<DataHygiene> {
  const findings: HygieneFinding[] = [];
  const clean: string[] = [];
  const checkedAt = new Date().toISOString();

  let projects: ProjectRow[];
  try {
    const res = await readAll<ProjectRow>(
      supabase,
      "projects",
      "id, name, customer, customer_legal_entity_id, owner_person_id, contract_hours",
      "id",
    );
    projects = res.rows;
    if (res.truncated) {
      // Refuse to report on a partial read rather than understate the problem.
      return { findings: [], clean: [], checkedAt, unavailable: true };
    }
  } catch {
    /*
     * RLS, not a bug: these probes need to see the whole order book, which only
     * exec does. Reporting "unavailable" is honest; reporting zero findings to a
     * reader who simply cannot see the rows would be a lie.
     */
    return { findings: [], clean: [], checkedAt, unavailable: true };
  }

  /*
   * One cap, applied centrally, so no probe can make the page unscrollable by
   * finding a lot. 55 unowned orders rendered in full pushed the page to 4.63
   * screens against a house budget of 3, and a report nobody scrolls to the end
   * of is a report that hides its own later panels.
   *
   * `count` is always the TRUE total and is set by each probe before this runs,
   * so capping here cannot make a number wrong -- it only limits what is drawn,
   * and the page renders "showing N of M" whenever the two differ. The panels
   * are homogeneous lists: row 9 of 55 teaches nothing row 8 did not, and the
   * fix for all of them is the same bulk edit in the workbook.
   */
  const ROWS_PER_FINDING = 8;

  const record = (f: Omit<HygieneFinding, "error">) => {
    if (f.count === 0) clean.push(f.title);
    else findings.push({ ...f, rows: f.rows.slice(0, ROWS_PER_FINDING), error: null });
  };

  /* ------------------- 1. one customer name, several Lexware numbers ------ */

  {
    const byName = new Map<string, Set<string>>();
    const displayName = new Map<string, string>();
    for (const p of projects) {
      const lex = lexwareOf(p.id);
      const n = norm(p.customer);
      if (!lex || !n) continue;
      if (!byName.has(n)) byName.set(n, new Set());
      byName.get(n)!.add(lex);
      if (!displayName.has(n)) displayName.set(n, (p.customer ?? "").trim());
    }
    const rows: HygieneRow[] = [];
    for (const [n, nums] of byName) {
      if (nums.size < 2) continue;
      rows.push({
        id: `name-${n}`,
        subject: displayName.get(n) ?? n,
        detail: `${nums.size} customer numbers: ${[...nums].sort().join(", ")}`,
        href: null,
      });
    }
    rows.sort((a, b) => a.subject.localeCompare(b.subject));
    record({
      key: "name_many_numbers",
      title: "One customer, several customer numbers",
      kind: "exact",
      action:
        "Each of these companies is billed under more than one Lexware number, so "
        + "their orders, hours and revenue split across accounts that no report joins "
        + "back together. Decide which number is canonical, then merge in Lexware.",
      count: rows.length,
      rows,
    });
  }

  /* ------------------- 2. one Lexware number, several customer names ------ */

  {
    const byLex = new Map<string, Set<string>>();
    for (const p of projects) {
      const lex = lexwareOf(p.id);
      const cust = (p.customer ?? "").trim();
      if (!lex || !cust) continue;
      if (!byLex.has(lex)) byLex.set(lex, new Set());
      byLex.get(lex)!.add(cust);
    }
    const rows: HygieneRow[] = [];
    for (const [lex, names] of byLex) {
      if (names.size < 2) continue;
      const sorted = [...names].sort();
      /*
       * Distinguish a spelling variant from genuinely different companies. If
       * every name shares its first significant word, it is one customer spelled
       * inconsistently ("DRIVE beta" / "DRIVE Beta"). If not, one account number
       * is being used for separate legal entities, which is a billing problem
       * rather than a tidiness one -- 10305 covers Susell AND three YPOG entities.
       */
      const firstWords = new Set(sorted.map((x) => norm(x).split(" ")[0]));
      const sameCompany = firstWords.size === 1;
      rows.push({
        id: `lex-${lex}`,
        subject: lex,
        detail: sameCompany
          ? `${names.size} spellings of one name: ${sorted.join(" · ")}`
          : `${names.size} DIFFERENT companies share this number: ${sorted.join(" · ")}`,
        href: null,
      });
    }
    // Worst first: different companies before mere spellings, then by count.
    rows.sort((a, b) => {
      const aBad = a.detail.includes("DIFFERENT") ? 0 : 1;
      const bBad = b.detail.includes("DIFFERENT") ? 0 : 1;
      return aBad - bBad || a.subject.localeCompare(b.subject);
    });
    record({
      key: "number_many_names",
      title: "One customer number, several customer names",
      kind: "exact",
      action:
        "Rows marked DIFFERENT are the serious ones: one Lexware account is carrying "
        + "orders for separate legal entities, so their invoices and hours are pooled. "
        + "The rest are spelling variants, fixable by standardising the name in the "
        + "source workbook.",
      count: rows.length,
      rows,
    });
  }

  /* ------------------------------ 3. placeholder order names -------------- */

  {
    const PLACEHOLDER = new Set(["missing", "n/a", "na", "tbd", "todo", "-", "?", "unknown", ""]);
    const rows = projects
      .filter((p) => PLACEHOLDER.has(norm(p.name)))
      .map((p) => ({
        id: p.id,
        subject: p.id,
        detail: `${(p.customer ?? "unknown customer").trim()} — order name is "${(p.name ?? "").trim()}"`,
        href: null,
      }));
    record({
      key: "placeholder_names",
      title: "Orders named with a placeholder",
      kind: "exact",
      action:
        "Somebody typed a placeholder and never replaced it. The name is customer-facing "
        + "and appears in the ledger, so fix it in the source workbook — a database edit "
        + "is reverted by the next import.",
      count: rows.length,
      rows,
    });
  }

  /* ------------------ 4. order name that does not match its customer ----- */

  {
    /*
     * HEURISTIC, and labelled so. The test is whether the order name shares any
     * significant word with its own customer. That catches a spreadsheet row
     * shift (an order named "Intel GmbH / SiFa" filed under Unity Technologies)
     * and ALSO catches a perfectly good name for a differently-named site or
     * product ("Reteach" is a product Susell may genuinely have bought). The page
     * must not pretend to know which.
     */
    const STOP = new Set([
      "gmbh", "co", "kg", "ag", "ug", "ohg", "inc", "llp", "mbb", "und", "der", "die",
      "das", "the", "and", "für", "fur", "sifa", "fasi", "ba", "gu", "gbu", "bsb", "kk",
      "sigeko", "safety", "engineer", "sicherheitstechnische", "betreuung", "support",
      "basic", "instruction", "risk", "assessment", "occupational", "health", "care",
      "grundunterweisung", "arbeitsschutz", "dguv", "technical", "supervision", "jahresvertrag",
    ]);
    const words = (s: string | null) =>
      norm(s)
        .replace(/^\d{5}_/, "")
        .replace(/\d{2,4}\s*\/\s*\d{2,4}/g, " ")
        .replace(/[^a-zäöüß\s]/g, " ")
        .split(/\s+/)
        .filter((w) => w.length > 2 && !STOP.has(w));

    const rows: HygieneRow[] = [];
    for (const p of projects) {
      const nw = words(p.name);
      const cw = words(p.customer);
      if (!nw.length || !cw.length) continue;
      const shares = cw.some((w) => nw.includes(w) || nw.some((x) => x.startsWith(w.slice(0, 4))));
      if (shares) continue;
      rows.push({
        id: p.id,
        subject: p.id,
        detail: `"${(p.name ?? "").trim()}" filed under ${(p.customer ?? "").trim()}`,
        href: null,
      });
    }
    record({
      key: "order_name_conflict",
      title: "Order name shares no word with its customer",
      kind: "heuristic",
      action:
        "Some of these are spreadsheet row shifts — an order carrying another company's "
        + "name. Others are legitimate: a site name, or a product the customer bought. "
        + "Check each against the workbook; do not bulk-edit. See "
        + "docs/order-name-corruption-findings.md.",
      count: rows.length,
      rows,
    });
  }

  /* ------------------------- 5. customer text with no entity link -------- */

  {
    const rows = projects
      .filter((p) => !p.customer_legal_entity_id && (p.customer ?? "").trim() !== "")
      .map((p) => ({
        id: p.id,
        subject: p.id,
        detail: `"${(p.customer ?? "").trim()}" matches no legal entity`,
        href: "/customer-master/import-review",
      }));
    record({
      key: "unlinked_customer",
      title: "Order customer not linked to a legal entity",
      kind: "exact",
      action:
        "The order names a customer that exact-key matching cannot resolve, so it is "
        + "absent from every entity-level total. Add an alias for the spelling, or pick "
        + "the entity by hand when the name is genuinely ambiguous.",
      count: rows.length,
      rows,
    });
  }

  /* ------------------------------ 6. orders with no owner ---------------- */

  {
    const unowned = projects.filter((p) => !p.owner_person_id);
    record({
      key: "no_owner",
      title: "Orders with no responsible person",
      kind: "exact",
      action:
        "Nobody is accountable for these orders, so nothing routes to a desk when a "
        + "budget or a deadline moves. Assign a responsible in the source workbook.",
      count: unowned.length,
      rows: unowned.slice(0, 60).map((p) => ({
        id: p.id,
        subject: p.id,
        detail: `${(p.customer ?? "unknown customer").trim()} — ${(p.name ?? "").trim()}`,
        href: null,
      })),
    });
  }

  /* --------------------------- 7. orders with no contracted hours -------- */

  {
    const zero = projects.filter((p) => Number(p.contract_hours ?? 0) === 0);
    record({
      key: "zero_contract",
      title: "Orders with no contracted hours",
      kind: "exact",
      action:
        "With no contract figure there is nothing to burn against, so these orders "
        + "cannot be over budget and are excluded from every utilisation figure. Enter "
        + "the contracted hours, or close the order if it is not real.",
      count: zero.length,
      rows: zero.slice(0, 60).map((p) => ({
        id: p.id,
        subject: p.id,
        detail: `${(p.customer ?? "unknown customer").trim()} — ${(p.name ?? "").trim()}`,
        href: null,
      })),
    });
  }

  // Worst first, and heuristics after exact findings of the same size: a reader
  // should meet provable problems before suspicions.
  findings.sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === "exact" ? -1 : 1;
    return b.count - a.count;
  });

  return { findings, clean, checkedAt, unavailable: false };
}
