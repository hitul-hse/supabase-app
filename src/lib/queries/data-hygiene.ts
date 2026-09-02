/*
 * The data-hygiene reader.
 *
 * Every finding here was MEASURED before this file existed
 * (scripts/audit-data-inefficiencies.mjs, 27 Aug 2026). 19 probes were run; the 5
 * that returned nothing get no panel, because a page of empty panels teaches the
 * reader to stop looking.
 *
 * EIGHT of those 19 are implemented here. The other 11 read `crm.legal_entity`,
 * `people` and `time.entry` rather than the order book, so they need reads this
 * module does not make; they are listed in the audit script and are the obvious
 * next additions, NOT checks that were considered and dismissed.
 *
 * FOUR MORE come from the rig's nightly data audit (~/.data-audit/checks, first
 * run 1 Sep 2026): checks A, B, D3 and E4, ported with the audit's own pairing
 * rules so the panel and the audit's markdown report state the same figure. They
 * read `time.project`, `time.project_summary`, `projects.project_order`,
 * `crm.legal_entity`, `crm.factorial_person_reference` and `people` beside the
 * order book. A supporting read that fails does NOT take the report down and
 * does NOT render as clean: the probe is listed as one that COULD NOT RUN, with
 * the reason. Today that is the state of D3 and E4 -- ADR-002 §2 keeps the `crm`
 * and `projects` schemas out of PostgREST until they carry RLS, so the exec's
 * own client cannot read them and the page says so rather than guessing.
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
 *
 * PAGING, AND WHY IT REPLACED THE CAP
 * -----------------------------------
 * Every panel used to render `rows.slice(0, 8)` and disclose "showing 8 of 55".
 * That was honest, and it was still a dead end: the remaining 47 orders existed
 * in no reachable place. The reader was told the size of the problem and then
 * denied the list they needed to fix it, so the page could report work but not
 * be worked THROUGH -- exactly the distinction docs/UI-CONVENTIONS.md rule 1
 * draws between a dashboard and a queue.
 *
 * So a finding now returns ONE PAGE of its rows, not a sample. `count` is still
 * the true, uncapped total; `rows` is the slice for `page`; `pageCount` says how
 * many pages exist. The page height is unchanged -- a page is bounded exactly as
 * the cap was -- but every row is now reachable by paging.
 *
 * The paging decision lives HERE rather than in the page component on purpose.
 * Slicing in the component would mean serialising all 55 rows into the RSC
 * payload to render 10, and every probe's full row set would cross the wire on
 * every request. Clamping here also gives one place where an out-of-range `?page`
 * is resolved, so a stale bookmark degrades to the last page instead of
 * rendering an empty table that reads as "nothing left to fix".
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { fetchAllPaged } from "./paged";

type SupabaseTyped = SupabaseClient<Database>;

/**
 * The generated types cover public only. The other schemas are read through the
 * same typed server client, exactly as management-data-quality.ts does, and never
 * written to from here.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const schema = (supabase: SupabaseTyped, name: string) => (supabase as any).schema(name);

/** How a finding was established. Drives the badge and the wording. */
export type FindingKind = "exact" | "heuristic";

/**
 * What one row of a finding IS. Drives the count noun ("12 customers", not the
 * generic "12 cases") and decides which findings contribute to the
 * order-level affected total -- summing customers and orders into one figure
 * would be meaningless. `group` is a cluster of orders (a repeated order name),
 * which is why it counts towards neither.
 */
export type SubjectKind = "order" | "customer" | "account" | "group" | "person";

/**
 * A column of a finding's table, beyond the subject.
 *
 * Findings are heterogeneous -- one lists customers with several account
 * numbers, another lists orders with no owner -- so the columns travel WITH the
 * finding instead of the page hard-coding a union of every field any probe might
 * emit. `secondary` columns are dropped below `sm`, where a six-column table
 * would wrap into an unreadable block.
 */
export type HygieneColumn = {
  key: string;
  label: string;
  /** Numbers right-align and get tabular figures, per the house tokens. */
  align?: "left" | "right";
  /** Rendered in the mono face: ids, account numbers, counts. */
  mono?: boolean;
  /** Hidden below `sm`. Use for anything the phone row can survive without. */
  secondary?: boolean;
  /**
   * The full meaning of a short label, shown as the header's `title`.
   *
   * Headers have to stay ONE LINE: a wrapping `<th>` in a 5rem numeric column
   * measured a 53px header against the 26px its neighbours produced, and a
   * table header is the last place a reader wants to spend three lines. So the
   * label is abbreviated and the sentence lives here, one hover away, rather
   * than being deleted.
   */
  hint?: string;
};

export type HygieneRow = {
  /** Stable identity for the row, so React keys do not depend on order. */
  id: string;
  /** The primary thing: a customer name, an order number, a person. */
  subject: string;
  /** What is wrong with it, in one line, using the real values. */
  detail: string;
  /** Where to go to fix it, or null when the fix is outside the app. */
  href: string | null;
  /** Values for this finding's `columns`, keyed by column key. */
  cells: Record<string, string>;
  /**
   * True for the rows within a finding that are worse than the rest -- two
   * separate companies on one account number, rather than two spellings of one
   * name. Rows are already sorted worst-first; this marks WHERE that ordering
   * stops mattering, so a reader can see how far the serious ones run.
   */
  severe: boolean;
};

export type HygieneFinding = {
  key: string;
  title: string;
  kind: FindingKind;
  /** What one row is, so the panel can count in the right noun. */
  subjectKind: SubjectKind;
  /**
   * What the reader should do. Present tense, specific, and honest about where
   * the fix lives -- several of these are fixed in the source workbook rather
   * than in the app, and a page that implies otherwise wastes someone's morning.
   */
  action: string;
  /**
   * How the probe decided, in one line. A finding a reader cannot audit is a
   * finding they either trust blindly or ignore, and both are wrong -- this is
   * what lets someone judge a heuristic instead of taking it on faith.
   */
  method: string;
  /**
   * What it costs, quantified against the population actually scanned. Computed,
   * never asserted: a hard-coded "affects most orders" would drift the moment
   * the data did.
   */
  impact: string;
  /** Total matching rows. Never capped, never paged -- the true size. */
  count: number;
  /** The columns `rows[].cells` are keyed by. */
  columns: HygieneColumn[];
  /** The rows of the CURRENT page only. Length <= `rowsPerPage`. */
  rows: HygieneRow[];
  /** 1-based, already clamped into [1, pageCount]. */
  page: number;
  pageCount: number;
  /** 1-based index of `rows[0]` within the full result, for "11-20 of 55". */
  rowStart: number;
  rowsPerPage: number;
  /**
   * Rows in the WHOLE finding that are `severe`, not just on this page.
   *
   * The panel says "N of these are the serious ones". Counted from the current
   * page that sentence is false on every page after the first -- rows sort
   * severe-first, so page 3 of a finding with 12 severe rows would report zero
   * and read as "this panel has nothing urgent in it".
   */
  severeTotal: number;
  /**
   * Whether ANY row in the finding has a link, so the FIX column is present or
   * absent for the whole finding. Decided per page, a finding with mixed links
   * would gain and lose a column as the reader pages, and under `table-fixed`
   * every other column would shift with it.
   */
  hasLinks: boolean;
};
/*
 * There is deliberately no `error` field. One was declared here, documented as
 * "set when the probe itself failed, so an error is never rendered as clean",
 * and hard-coded to null by the only thing that ever set it -- no probe was
 * wrapped, and no caller read it. A safety property that exists only in a type
 * is worse than an absent one, because it answers the question "is this
 * handled?" wrongly. A probe that throws takes the request down, which is at
 * least honest; if per-probe recovery is wanted it needs a real try/catch here
 * and a rendered state on the page.
 */

/**
 * What the report actually looked at. Without this the reader cannot size any
 * finding: "55 orders with no owner" is a rounding error against 40,000 and a
 * crisis against 300, and the page previously showed the numerator alone.
 */
export type HygieneScope = {
  /** Orders read. The denominator for every order-level finding. */
  orders: number;
  /** Distinct customer spellings across those orders. */
  customers: number;
  /** Distinct 5-digit Lexware account numbers. */
  accountNumbers: number;
  /**
   * Orders carrying at least one PROVEN order-level finding, counted ONCE.
   * Seven findings summing to 300 may be 300 orders or 60; only this
   * distinguishes a broad problem from a few bad records failing every check at
   * once. Heuristic findings are excluded: a suspicion must not be counted into
   * a figure a reader will act on.
   */
  affectedOrders: number;
  /** Probes run: findings + clean. */
  probes: number;
};

/**
 * WHY the report could not be produced. Three different faults used to render
 * one message, and the message named the only cause that essentially cannot
 * apply: the route is gated to exec, so anybody who can read the card already
 * has the grants it tells them to go and ask somebody else for. Meanwhile the
 * thrown error was swallowed by a bare `catch {}` and never logged, so a
 * database outage looked like a permissions nudge.
 */
export type UnavailableReason =
  /** The read was refused or filtered — RLS, or no session. */
  | "denied"
  /** The read threw. The message is logged server-side, never rendered. */
  | "failed"
  /** More rows came back than the probes are willing to reason about. */
  | "truncated"
  /**
   * The table lives in a schema PostgREST does not serve to the app at all
   * (406 PGRST106). Not a permissions fault and not an outage: ADR-002 §2 keeps
   * `crm` and `projects` unexposed until they carry RLS, so this is the expected
   * state of any probe that needs them, and it must read as "not run" rather
   * than as either of the other two.
   */
  | "unexposed";

/**
 * A probe that could not run, and why. The third outcome beside a finding and a
 * clean check. A supporting read that faults must land HERE: routed to `clean`
 * it would be a clean bill of health for a table nobody read, and taking the
 * whole report down for it would hide eight working probes behind one that
 * ADR-002 says cannot work yet.
 */
export type HygieneSkipped = {
  key: string;
  title: string;
  reason: UnavailableReason;
  /** The read that faulted, as `schema.table`, so the reader knows which one. */
  source: string;
};

export type DataHygiene = {
  findings: HygieneFinding[];
  /** Probes that ran and found nothing. Named, so "clean" is visible evidence. */
  clean: string[];
  /** Probes that could not run. Named, so a missing panel is never read as clean. */
  skipped: HygieneSkipped[];
  scope: HygieneScope;
  checkedAt: string;
  /** True when no report could be produced. See `unavailableReason` for why. */
  unavailable: boolean;
  /** Set whenever `unavailable` is true, so the page can say which fault it was. */
  unavailableReason: UnavailableReason | null;
};

/** Per-finding page numbers, keyed by finding key. 1-based; missing means 1. */
export type HygienePages = Record<string, number>;

/**
 * The four probes ported from the nightly audit, by key and title.
 *
 * Exported because `clean` lists probes by TITLE, and a gate that wants to
 * prove "this probe ran and found nothing" needs the title for a key without
 * restating it -- a restated title drifts, and then the gate infers "clean"
 * from absence, which is exactly the inference a silently missing probe would
 * pass. check-data-hygiene-audit-findings reads these.
 */
export const AUDIT_PROBES = {
  unlinked_hub_project: "Orders no TrackingTime project points at",
  budget_disagreement: "Contracted hours disagree with the TrackingTime budget",
  customer_master_drift: "Order filed under two different customers",
  factorial_reference_mismatch: "Factorial reference disagrees with the person's profile",
} as const;

export type HygieneOptions = {
  /**
   * Which page of each finding to return, keyed by `finding.key`. Every finding
   * pages independently, because they are independent lists that happen to share
   * a page -- moving through the unowned orders must not reset your place in the
   * duplicate account numbers.
   */
  pages?: HygienePages;
  /** Rows per page. Bounded below; see DEFAULT_ROWS_PER_PAGE. */
  rowsPerPage?: number;
};

const PAGE = 1000;

/**
 * Rows drawn per finding, per page.
 *
 * Ten, from docs/UI-CONVENTIONS.md rule 1: this page is a queue somebody works
 * THROUGH, and ten is the queue size the rest of the app already uses. It is
 * also what holds the panel to the height the old 8-row cap produced, which is
 * what keeps /data-hygiene inside its scroll budget with seven panels stacked.
 */
const DEFAULT_ROWS_PER_PAGE = 10;
/**
 * The hard ceiling on a page, whatever a caller asks for.
 *
 * No UI passes `rowsPerPage` today -- the page component calls this with `pages`
 * alone. The clamp is here so that if one ever does (a `?rows=` param is the
 * obvious next request), it cannot reintroduce the unbounded panel that paging
 * replaced. 12 is also the bound check-data-hygiene-page asserts against live
 * data, so the two agree by construction rather than by coincidence.
 */
const MAX_ROWS_PER_PAGE = 12;

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

/**
 * Words that carry no identity in a German company name: legal forms and the
 * articles that begin one. Used when deciding whether two names under one
 * account number are one company spelled twice or two companies sharing a
 * number.
 */
/**
 * Names that mean "nobody filled this in". Shared, because probe 4 has to skip
 * exactly what probe 3 reports — otherwise one defect is counted twice, in two
 * different confidence classes.
 */
const PLACEHOLDER_NAMES = new Set([
  "missing", "n/a", "na", "tbd", "todo", "-", "?", "unknown", "",
]);

const NAME_STOP = new Set([
  "der", "die", "das", "den", "dem", "des", "the", "und", "and",
  "gmbh", "mbh", "ug", "kg", "ohg", "gbr", "inc", "ltd", "llc", "llp", "mbb",
]);

type ProjectRow = {
  id: string;
  /** The order number `projects.project_order.order_number` joins on. */
  code: string | null;
  name: string | null;
  customer: string | null;
  customer_legal_entity_id: string | null;
  owner_person_id: string | null;
  contract_hours: number | null;
};

/**
 * One supporting read: its rows, or the reason it produced none.
 *
 * `fault` is a discriminant, so `if (x.fault)` narrows to the failed shape and
 * the success branch sees `rows: T[]` without an assertion.
 */
type Support<T> =
  | { rows: T[]; fault: null; message: null }
  | { rows: null; fault: UnavailableReason; message: string };

/**
 * What kind of fault a thrown read was. PGRST106 is checked FIRST: its message
 * does not mention permissions, but a schema PostgREST refuses to name is a
 * configuration state (ADR-002 §2), and reporting it as "the read failed" would
 * send somebody to look for an outage that is not there.
 */
const classifyFault = (message: string): UnavailableReason => {
  if (/PGRST106|schemas are exposed|invalid schema/i.test(message)) return "unexposed";
  if (/permission|denied|rls|jwt|not authorized|row-level/i.test(message)) return "denied";
  return "failed";
};

/**
 * Read a supporting table fully, or say why it could not be read.
 *
 * `.order()` before `.range()` on every page (house rule), batches in parallel
 * via fetchAllPaged. An EMPTY read is a fault, not a result, for the same reason
 * the order book's is: RLS filters rows rather than raising, and none of these
 * tables is legitimately empty in this company -- an empty `time.project` would
 * make every order "unlinked" and an empty reference table would make the
 * Factorial check "clean", both of them lies told in the reassuring direction.
 */
async function readSupport<T>(
  supabase: SupabaseTyped,
  schemaName: string,
  table: string,
  columns: string,
  orderBy: string,
): Promise<Support<T>> {
  const source = `${schemaName}.${table}`;
  /*
   * A client with no `.schema()` cannot address anything outside `public` --
   * the fixture stub the gates drive is one. That is the same state as a schema
   * PostgREST does not serve, seen from the client's side, and it is filed the
   * same way rather than as an outage: nothing failed, nothing is logged, the
   * probe simply cannot run through this client.
   */
  if (schemaName !== "public" && typeof (supabase as { schema?: unknown }).schema !== "function") {
    return { rows: null, fault: "unexposed", message: `${source}: client cannot address schema ${schemaName}` };
  }
  try {
    const client = schemaName === "public"
      ? (supabase as never as SupabaseClient)
      : schema(supabase, schemaName);
    const res = await fetchAllPaged<T>((from, to) =>
      client.from(table).select(columns).order(orderBy).range(from, to));
    if (res.truncated) {
      return { rows: null, fault: "truncated", message: `${source}: more rows than the probes will reason about` };
    }
    if (res.rows.length === 0) {
      return { rows: null, fault: "denied", message: `${source}: empty read` };
    }
    return { rows: res.rows, fault: null, message: null };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { rows: null, fault: classifyFault(message), message: `${source}: ${message}` };
  }
}

/** Hours to one decimal, or an em dash for a figure nobody entered. */
const hoursCell = (v: number | string | null | undefined) =>
  v === null || v === undefined ? "\u2014" : Number(v).toFixed(1);

/** An empty scope, for the paths that return before anything is measured. */
const NO_SCOPE: HygieneScope = {
  orders: 0,
  customers: 0,
  accountNumbers: 0,
  affectedOrders: 0,
  probes: 0,
};

export async function getDataHygiene(
  supabase: SupabaseTyped,
  options: HygieneOptions = {},
): Promise<DataHygiene> {
  const findings: HygieneFinding[] = [];
  const clean: string[] = [];
  const checkedAt = new Date().toISOString();

  /*
   * Clamp the page size before any probe runs -- see MAX_ROWS_PER_PAGE. Nothing
   * passes this yet; the clamp exists so that the first caller that does cannot
   * reintroduce the unbounded panel paging replaced.
   */
  const rowsPerPage = Math.min(
    MAX_ROWS_PER_PAGE,
    Math.max(1, Math.floor(options.rowsPerPage ?? DEFAULT_ROWS_PER_PAGE)),
  );
  const requestedPages = options.pages ?? {};

  let projects: ProjectRow[];
  try {
    const res = await readAll<ProjectRow>(
      supabase,
      "projects",
      "id, code, name, customer, customer_legal_entity_id, owner_person_id, contract_hours",
      "id",
    );
    projects = res.rows;
    if (res.truncated) {
      // Refuse to report on a partial read rather than understate the problem.
      return {
        findings: [], clean: [], skipped: [], scope: NO_SCOPE, checkedAt,
        unavailable: true, unavailableReason: "truncated",
      };
    }
    /*
     * An EMPTY read is the same fault as a refused one, and it is the shape RLS
     * actually takes: Postgres filters rows rather than raising, so a reader
     * without the grants gets `[]` and no error at all. Without this the empty
     * list flows on into the probes, every one of them finds nothing, all eight
     * findings route to `clean`, and the page renders PROVEN ISSUES 0 in the
     * `good` tone beside CHECKS CLEAN 8 -- a clean bill of health issued to
     * somebody who could not see a single order. That is exactly the lie the
     * catch block below refuses to tell, and it was reachable by the one path
     * the catch cannot observe.
     *
     * Reported as `denied` rather than as a fourth reason because that is what
     * it almost always is, and the card's wording already covers it: any report
     * would be "a partial one that looks complete". The remaining cause -- a
     * genuinely empty order book -- is not a state this company can be in, and
     * "we could not read the orders" is the safe way to be wrong about it.
     */
    if (projects.length === 0) {
      return {
        findings: [], clean: [], skipped: [], scope: NO_SCOPE, checkedAt,
        unavailable: true, unavailableReason: "denied",
      };
    }
  } catch (err) {
    /*
     * Two very different faults land here. A read REFUSED loudly enough to
     * throw is RLS -- these probes need the whole order book, which only exec
     * sees, and reporting zero findings to a reader who simply cannot see the
     * rows would be a lie. (The quiet version of that fault, an empty read with
     * no error, cannot reach this block at all and is caught by the length
     * check above.) Anything else is an outage, and it gets LOGGED rather than
     * silently dressed up as a permissions problem: the previous bare `catch {}`
     * threw the message away, so the one piece of evidence that could explain a
     * blank report never reached anyone.
     */
    const message = err instanceof Error ? err.message : String(err);
    const denied = /permission|denied|rls|jwt|not authorized|row-level/i.test(message);
    if (!denied) console.error("[data-hygiene] probe read failed:", message);
    return {
      findings: [], clean: [], skipped: [], scope: NO_SCOPE, checkedAt,
      unavailable: true, unavailableReason: denied ? "denied" : "failed",
    };
  }

  /* ------------------------------------------------ shared denominators ---- */

  const orderCount = projects.length;
  /**
   * Orders per customer spelling and per account number, computed once. Several
   * probes want "and how many orders does that affect?", which is the figure
   * that turns a tidiness complaint into a priority.
   */
  const ordersByCustomerText = new Map<string, number>();
  const ordersByAccount = new Map<string, number>();
  for (const p of projects) {
    const cust = (p.customer ?? "").trim();
    if (cust) ordersByCustomerText.set(cust, (ordersByCustomerText.get(cust) ?? 0) + 1);
    const lex = lexwareOf(p.id);
    if (lex) ordersByAccount.set(lex, (ordersByAccount.get(lex) ?? 0) + 1);
  }
  const accountNumbers = ordersByAccount.size;
  const customers = ordersByCustomerText.size;

  /** `12 of 480 orders (2.5%)`, or an honest `n/a` when there is no denominator. */
  const shareOfOrders = (n: number) => {
    if (orderCount === 0) return "n/a — no orders were read";
    const pct = (n / orderCount) * 100;
    // Below 0.1% "0%" would read as "none", which is the opposite of the truth.
    const shown = pct > 0 && pct < 0.1 ? "<0.1" : pct.toFixed(1);
    return `${n} of ${orderCount} orders (${shown}%)`;
  };

  /**
   * Distinct orders carrying at least one PROVEN order-level finding. Collected
   * from the FULL row sets, before paging, or it would shrink as the reader pages.
   */
  const affected = new Set<string>();

  const record = (
    f: Omit<HygieneFinding, "page" | "pageCount" | "rowStart" | "rowsPerPage" | "severeTotal" | "hasLinks">,
  ) => {
    if (f.count === 0) clean.push(f.title);
    else findings.push(paginate(f));
  };

  /**
   * Turn a probe's FULL row list into the one page the reader asked for.
   *
   * `count` is taken from the probe and never recomputed from `rows`, so the
   * total the page states can never be a restatement of the slice it drew --
   * that identity is what check-data-hygiene-page asserts, and it is only
   * meaningful while the two come from different places.
   */
  function paginate(
    f: Omit<HygieneFinding, "page" | "pageCount" | "rowStart" | "rowsPerPage" | "severeTotal" | "hasLinks">,
  ): HygieneFinding {
    /*
     * PROVEN findings only. `order_name_conflict` is a heuristic whose own
     * impact line says "a suspicion, not a defect count", and folding it in here
     * would put suspected orders inside a warning-toned tile with a progress bar
     * across the whole order book -- the exact merge of proven and suspected
     * that the two headline tiles are kept apart to prevent.
     */
    if (f.subjectKind === "order" && f.kind === "exact") for (const r of f.rows) affected.add(r.id);

    const pageCount = Math.max(1, Math.ceil(f.rows.length / rowsPerPage));
    const asked = Number(requestedPages[f.key] ?? 1);
    /*
     * Clamp, never error. A bookmark to page 6 of a list that shrank to 2 pages
     * should land on page 2; rendering an empty table instead would read as
     * "nothing left to fix", which is the one lie this page cannot afford.
     * NaN from a junk query string collapses to 1 by the same route.
     */
    const page = Number.isFinite(asked)
      ? Math.min(pageCount, Math.max(1, Math.floor(asked)))
      : 1;
    const start = (page - 1) * rowsPerPage;
    return {
      ...f,
      rows: f.rows.slice(start, start + rowsPerPage),
      page,
      pageCount,
      rowStart: f.rows.length === 0 ? 0 : start + 1,
      rowsPerPage,
      severeTotal: f.rows.filter((r) => r.severe).length,
      hasLinks: f.rows.some((r) => r.href),
    };
  }

  /* ------------------- 1. one customer name, several Lexware numbers ------ */

  {
    const byName = new Map<string, Set<string>>();
    const displayName = new Map<string, string>();
    const ordersForName = new Map<string, number>();
    for (const p of projects) {
      const lex = lexwareOf(p.id);
      const n = norm(p.customer);
      if (!lex || !n) continue;
      if (!byName.has(n)) byName.set(n, new Set());
      byName.get(n)!.add(lex);
      ordersForName.set(n, (ordersForName.get(n) ?? 0) + 1);
      if (!displayName.has(n)) displayName.set(n, (p.customer ?? "").trim());
    }
    const rows: HygieneRow[] = [];
    let splitOrders = 0;
    for (const [n, nums] of byName) {
      if (nums.size < 2) continue;
      const sorted = [...nums].sort();
      const orders = ordersForName.get(n) ?? 0;
      splitOrders += orders;
      rows.push({
        id: `name-${n}`,
        subject: displayName.get(n) ?? n,
        detail: `${nums.size} customer numbers: ${sorted.join(", ")}`,
        href: null,
        cells: {
          numbers: sorted.join(" · "),
          accounts: String(nums.size),
          orders: String(orders),
        },
        // Three or more accounts for one company is the version of this that
        // no single merge fixes, so it leads.
        severe: nums.size > 2,
      });
    }
    // Worst first: most accounts, then most orders at stake, then name.
    rows.sort(
      (a, b) =>
        Number(b.cells.accounts) - Number(a.cells.accounts)
        || Number(b.cells.orders) - Number(a.cells.orders)
        || a.subject.localeCompare(b.subject),
    );
    record({
      key: "name_many_numbers",
      title: "One customer, several customer numbers",
      kind: "exact",
      subjectKind: "customer",
      action:
        "Each of these companies is billed under more than one Lexware number, so "
        + "their orders, hours and revenue split across accounts that no report joins "
        + "back together. Decide which number is canonical, then merge in Lexware.",
      method:
        "Orders grouped by their customer name, lower-cased and whitespace-collapsed, "
        + "then counted by the 5-digit Lexware number prefixing the order id. Two or "
        + "more numbers under one name is the finding.",
      impact: `${rows.length} customers, ${shareOfOrders(splitOrders)} billed across split accounts`,
      count: rows.length,
      columns: [
        { key: "accounts", label: "ACCOUNTS", align: "right", mono: true,
          hint: "How many distinct Lexware numbers this one company is billed under." },
        { key: "orders", label: "ORDERS", align: "right", mono: true },
        { key: "numbers", label: "CUSTOMER NUMBERS", mono: true, secondary: true },
      ],
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
    let pooledOrders = 0;
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
      /*
       * The first word that is not an article or a legal form.
       *
       * Taking `[0]` raw made "Die Werkstatt Nord" and "Die Firma Mueller" read
       * as one company spelled twice, because they share a leading "Die".
       * Dropping the article fixes that.
       *
       * What it must NOT also do is drop SHORT words. A first attempt required
       * `w.length > 2`, which meant a name like "3M" or "X" yielded no word at
       * all; the empty result then failed to match its sibling and the account
       * was asserted to carry DIFFERENT COMPANIES -- "3M" and "3M Deutschland"
       * reported as two legal entities sharing a number. That is the ADR-001
       * error in its purest form: a positive claim about identity made on
       * evidence that does not support it, and it lands in the `severe` class
       * that leads the panel and drives the impact line. Under-claiming here is
       * recoverable; over-claiming sends somebody to Lexware to split an account
       * that was never pooled.
       *
       * So: skip stop words, and if a name is nothing BUT stop words, fall back
       * to its first token rather than to nothing.
       */
      const firstSignificant = (x: string) => {
        const words = norm(x).split(" ").filter(Boolean);
        return words.find((w) => !NAME_STOP.has(w)) ?? words[0] ?? "";
      };
      const firstWords = new Set(sorted.map(firstSignificant));
      const sameCompany = firstWords.size === 1;
      const orders = ordersByAccount.get(lex) ?? 0;
      if (!sameCompany) pooledOrders += orders;
      rows.push({
        id: `lex-${lex}`,
        subject: lex,
        detail: sameCompany
          ? `${names.size} spellings of one name: ${sorted.join(" · ")}`
          : `${names.size} DIFFERENT companies share this number: ${sorted.join(" · ")}`,
        href: null,
        cells: {
          verdict: sameCompany ? "spelling" : "DIFFERENT COMPANIES",
          names: sorted.join(" · "),
          distinct: String(names.size),
          orders: String(orders),
        },
        severe: !sameCompany,
      });
    }
    // Worst first: different companies before mere spellings, then by count.
    rows.sort((a, b) => {
      const aBad = a.severe ? 0 : 1;
      const bBad = b.severe ? 0 : 1;
      return aBad - bBad || Number(b.cells.orders) - Number(a.cells.orders)
        || a.subject.localeCompare(b.subject);
    });
    const severeCount = rows.filter((r) => r.severe).length;
    record({
      key: "number_many_names",
      title: "One customer number, several customer names",
      kind: "exact",
      subjectKind: "account",
      action:
        "Rows marked DIFFERENT are the serious ones: one Lexware account is carrying "
        + "orders for separate legal entities, so their invoices and hours are pooled. "
        + "The rest are spelling variants, fixable by standardising the name in the "
        + "source workbook.",
      method:
        "Orders grouped by their 5-digit Lexware number, collecting the RAW customer "
        + "names filed under each. Names sharing a first significant word are read as "
        + "one company spelled inconsistently; the rest as separate legal entities.",
      impact:
        `${severeCount} of ${rows.length} accounts carry separate companies · `
        + `${shareOfOrders(pooledOrders)} pooled under a shared account`,
      count: rows.length,
      columns: [
        { key: "verdict", label: "VERDICT" },
        { key: "distinct", label: "NAMES", align: "right", mono: true,
          hint: "How many distinct customer names are filed under this one account number." },
        { key: "orders", label: "ORDERS", align: "right", mono: true },
        { key: "names", label: "NAMES ON THIS ACCOUNT", secondary: true },
      ],
      rows,
    });
  }

  /* ------------------------------ 3. placeholder order names -------------- */

  {
    const rows: HygieneRow[] = projects
      .filter((p) => PLACEHOLDER_NAMES.has(norm(p.name)))
      .map((p) => ({
        id: p.id,
        subject: p.id,
        detail: `${(p.customer ?? "unknown customer").trim()} — order name is "${(p.name ?? "").trim()}"`,
        href: null,
        cells: {
          customer: (p.customer ?? "unknown customer").trim(),
          value: (p.name ?? "").trim() === "" ? "(blank)" : `"${(p.name ?? "").trim()}"`,
          account: lexwareOf(p.id) ?? "\u2014",
        },
        severe: norm(p.name) === "",
      }));
    // Blank names first: they render as nothing at all downstream, where a "TBD"
    // at least tells a reader that somebody meant to come back.
    rows.sort((a, b) => Number(b.severe) - Number(a.severe) || a.subject.localeCompare(b.subject));
    record({
      key: "placeholder_names",
      title: "Orders named with a placeholder",
      kind: "exact",
      subjectKind: "order",
      action:
        "Somebody typed a placeholder and never replaced it. The name is customer-facing "
        + "and appears in the ledger, so fix it in the source workbook — a database edit "
        + "is reverted by the next import.",
      method:
        "Order names compared, lower-cased, against a fixed placeholder list "
        + "(missing, n/a, na, tbd, todo, -, ?, unknown, blank). Exact matches only, so "
        + "a real name containing one of those words is not swept up.",
      impact: shareOfOrders(rows.length),
      count: rows.length,
      columns: [
        { key: "value", label: "NAME AS TYPED" },
        { key: "customer", label: "CUSTOMER", secondary: true },
        { key: "account", label: "ACCOUNT", mono: true, secondary: true },
      ],
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
      /*
       * Skip anything probe 3 already reports. A placeholder name shares no word
       * with its customer BY DEFINITION, so leaving these in reported the same
       * defect twice -- once as a fact and once as a suspicion -- and inflated
       * the heuristic's count with rows whose real fix is stated elsewhere.
       */
      if (PLACEHOLDER_NAMES.has(norm(p.name))) continue;
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
        cells: {
          orderName: (p.name ?? "").trim(),
          customer: (p.customer ?? "").trim(),
          /*
           * The words the comparison actually ran on. This is the difference
           * between "the computer says these disagree" and a reader being able
           * to see WHY in one glance and dismiss a false positive in a second.
           */
          compared: `${nw.slice(0, 4).join(", ")} vs ${cw.slice(0, 4).join(", ")}`,
        },
        severe: false,
      });
    }
    /*
     * This is the one finding with no severity axis -- every row is equally a
     * suspicion -- but it still needs a STATED order. Under paging, page 1 is
     * the only page most readers see, so "whatever order the table came back in"
     * decides what gets looked at. Customer, then order id: it groups a
     * spreadsheet row-shift's worth of consecutive damage together, which is the
     * shape a real corruption takes.
     */
    rows.sort(
      (a, b) => a.cells.customer.localeCompare(b.cells.customer)
        || a.subject.localeCompare(b.subject),
    );
    record({
      key: "order_name_conflict",
      title: "Order name shares no word with its customer",
      kind: "heuristic",
      subjectKind: "order",
      action:
        "Some of these are spreadsheet row shifts — an order carrying another company's "
        + "name. Others are legitimate: a site name, or a product the customer bought. "
        + "Check each against the workbook; do not bulk-edit. See "
        + "docs/order-name-corruption-findings.md.",
      method:
        "Both strings reduced to significant words — legal forms, service names and "
        + "words under three letters dropped — then tested for any shared word or "
        + "4-letter prefix. No overlap at all is the finding. The COMPARED column shows "
        + "the words each side was reduced to.",
      impact: `${shareOfOrders(rows.length)} · a suspicion, not a defect count`,
      count: rows.length,
      columns: [
        { key: "orderName", label: "ORDER NAME" },
        { key: "customer", label: "FILED UNDER" },
        { key: "compared", label: "COMPARED", mono: true, secondary: true },
      ],
      rows,
    });
  }

  /* ------------------------- 5. customer text with no entity link -------- */

  {
    const unlinked = projects.filter(
      (p) => !p.customer_legal_entity_id && (p.customer ?? "").trim() !== "",
    );
    /*
     * Counted over the UNLINKED orders only, not over every order carrying the
     * spelling. The column claims "one alias clears all of them at once", and an
     * order that is already linked is not cleared by anything -- counting it
     * overstated the work an alias saves and, because this is the worst-first
     * sort key, put the wrong spellings at the top of the queue.
     */
    const unlinkedPerText = new Map<string, number>();
    for (const p of unlinked) {
      const c = (p.customer ?? "").trim();
      unlinkedPerText.set(c, (unlinkedPerText.get(c) ?? 0) + 1);
    }
    const rows: HygieneRow[] = unlinked.map((p) => {
      const cust = (p.customer ?? "").trim();
      const sharing = unlinkedPerText.get(cust) ?? 1;
      return {
        id: p.id,
        subject: p.id,
        detail: `"${cust}" matches no legal entity`,
        href: "/customer-master/import-review",
        cells: {
          customer: cust,
          sharing: String(sharing),
          account: lexwareOf(p.id) ?? "\u2014",
        },
        // One alias clears every order sharing the spelling, so the spellings
        // carrying the most orders are the ones worth doing first.
        severe: sharing > 1,
      };
    });
    rows.sort(
      (a, b) => Number(b.cells.sharing) - Number(a.cells.sharing)
        || a.cells.customer.localeCompare(b.cells.customer),
    );
    const spellings = new Set(rows.map((r) => r.cells.customer)).size;
    record({
      key: "unlinked_customer",
      title: "Order customer not linked to a legal entity",
      kind: "exact",
      subjectKind: "order",
      action:
        "The order names a customer that exact-key matching cannot resolve, so it is "
        + "absent from every entity-level total. Add an alias for the spelling, or pick "
        + "the entity by hand when the name is genuinely ambiguous.",
      method:
        "Orders with a non-empty customer text but a null customer_legal_entity_id. "
        + "The link is made by exact key (ADR-001), never by name similarity, so an "
        + "unmatched spelling stays unmatched until somebody adds the alias.",
      impact:
        `${shareOfOrders(rows.length)} missing from entity totals, across `
        + `${spellings} distinct ${spellings === 1 ? "spelling" : "spellings"}`,
      count: rows.length,
      columns: [
        { key: "customer", label: "CUSTOMER TEXT" },
        { key: "sharing", label: "SAME TEXT", align: "right", mono: true,
          hint: "How many orders carry this exact customer spelling. One alias clears all of them at once." },
        { key: "account", label: "ACCOUNT", mono: true, secondary: true },
      ],
      rows,
    });
  }

  /* ------------------------------ 6. orders with no owner ---------------- */

  {
    const unowned = projects.filter((p) => !p.owner_person_id);
    const rows: HygieneRow[] = unowned.map((p) => ({
      id: p.id,
      subject: p.id,
      detail: `${(p.customer ?? "unknown customer").trim()} — ${(p.name ?? "").trim()}`,
      href: null,
      cells: {
        customer: (p.customer ?? "unknown customer").trim(),
        orderName: (p.name ?? "").trim() === "" ? "(unnamed)" : (p.name ?? "").trim(),
        /*
         * Em dash, not 0 and not "n/a": DESIGN.md rule 6 -- a missing NUMBER in
         * a table is a dash, because a plausible 0 is indistinguishable from a
         * measured 0 and prose in a numeric column breaks the alignment that
         * makes the column scannable. An order with no contract figure has no
         * hours at stake RECORDED, which is a different statement from
         * "0 hours at stake" and the two must not render alike.
         */
        contracted:
          p.contract_hours === null || p.contract_hours === undefined
            ? "\u2014"
            : Number(p.contract_hours).toFixed(1),
      },
      // Unowned AND carrying contracted hours is the combination that costs
      // money: work is committed and nobody is watching it.
      severe: Number(p.contract_hours ?? 0) > 0,
    }));
    rows.sort(
      (a, b) => Number(b.severe) - Number(a.severe)
        || Number(b.cells.contracted === "\u2014" ? 0 : b.cells.contracted)
          - Number(a.cells.contracted === "\u2014" ? 0 : a.cells.contracted)
        || a.subject.localeCompare(b.subject),
    );
    /*
     * Negatives are floored at 0 rather than subtracted. A negative contract
     * figure is itself broken data, and letting one cancel out real committed
     * hours makes the headline UNDERSTATE how much unwatched work there is --
     * the one direction this page must never round in.
     */
    const atStake = unowned.reduce(
      (sum, p) => sum + Math.max(0, Number(p.contract_hours ?? 0) || 0), 0);
    record({
      key: "no_owner",
      title: "Orders with no responsible person",
      kind: "exact",
      subjectKind: "order",
      action:
        "Nobody is accountable for these orders, so nothing routes to a desk when a "
        + "budget or a deadline moves. Assign a responsible in the source workbook.",
      method:
        "Orders whose owner_person_id is null. Sorted by contracted hours, so the "
        + "unwatched work with the most committed against it comes first.",
      impact: `${shareOfOrders(unowned.length)} · ${atStake.toFixed(1)} contracted hours unwatched`,
      count: unowned.length,
      columns: [
        { key: "orderName", label: "ORDER" },
        { key: "customer", label: "CUSTOMER" },
        { key: "contracted", label: "HOURS", align: "right", mono: true,
          hint: "Contracted hours on this order. A dash means no figure was ever entered." },
      ],
      rows,
    });
  }

  /* --------------------------- 7. orders with no contracted hours -------- */

  {
    const zero = projects.filter((p) => Number(p.contract_hours ?? 0) === 0);
    const rows: HygieneRow[] = zero.map((p) => ({
      id: p.id,
      subject: p.id,
      detail: `${(p.customer ?? "unknown customer").trim()} — ${(p.name ?? "").trim()}`,
      href: null,
      cells: {
        customer: (p.customer ?? "unknown customer").trim(),
        orderName: (p.name ?? "").trim() === "" ? "(unnamed)" : (p.name ?? "").trim(),
        /*
         * Null and 0 are different defects and are named differently: a null is
         * a figure nobody entered, a 0 is a figure somebody entered as zero.
         * Collapsing them would hide which of the two you are looking at.
         */
        recorded: p.contract_hours === null || p.contract_hours === undefined ? "not set" : "entered as 0",
        responsible: p.owner_person_id ? "assigned" : "nobody",
      },
      // No hours AND no owner: excluded from utilisation and unwatched at once.
      severe: !p.owner_person_id,
    }));
    rows.sort((a, b) => Number(b.severe) - Number(a.severe) || a.subject.localeCompare(b.subject));
    const alsoUnowned = rows.filter((r) => r.severe).length;
    record({
      key: "zero_contract",
      title: "Orders with no contracted hours",
      kind: "exact",
      subjectKind: "order",
      action:
        "With no contract figure there is nothing to burn against, so these orders "
        + "cannot be over budget and are excluded from every utilisation figure. Enter "
        + "the contracted hours, or close the order if it is not real.",
      method:
        "Orders whose contract_hours is null or zero. The two are reported separately "
        + "in the RECORDED column, because a missing figure and a deliberate zero are "
        + "different mistakes with different fixes.",
      impact:
        `${shareOfOrders(zero.length)} excluded from every utilisation figure · `
        + `${alsoUnowned} of them also have no responsible`,
      count: zero.length,
      columns: [
        { key: "orderName", label: "ORDER" },
        { key: "customer", label: "CUSTOMER" },
        { key: "recorded", label: "RECORDED", secondary: true },
        { key: "responsible", label: "RESPONSIBLE", secondary: true },
      ],
      rows,
    });
  }

  /* ------------------- 8. the same order name twice for one customer ----- */

  {
    /*
     * HEURISTIC. Probe 11 of the original audit, which the page has been
     * dropping since it shipped. Two orders under one customer carrying the same
     * name is EITHER a genuine annual repeat ("Jahresvertrag" renewed each year,
     * legitimately named the same thing) OR the same order imported twice, which
     * double-counts its contracted hours in every total on every other page.
     *
     * The two are indistinguishable from the name alone, so this states what it
     * found and shows the contracted hours side by side -- identical hours on
     * identical names is what a duplicate import looks like, and a reader can
     * see that in the row without the page having to guess.
     */
    const groups = new Map<string, ProjectRow[]>();
    for (const p of projects) {
      const n = norm(p.name);
      const c = norm(p.customer);
      if (!n || !c) continue;
      // \u0000 cannot appear in either value, unlike a "||" a name could carry.
      const k = `${c}\u0000${n}`;
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k)!.push(p);
    }
    const rows: HygieneRow[] = [];
    let duplicatedOrders = 0;
    for (const [k, group] of groups) {
      if (group.length < 2) continue;
      duplicatedOrders += group.length;
      /*
       * Nulls stay null. Collapsing them to 0 made two orders that share a name
       * and have NO contracted hours entered report "0.0 each" and carry the
       * sentence "all with identical contracted hours" -- a measured agreement
       * asserted about two figures nobody ever entered, which then sorted them
       * to the top of the panel as suspected double imports. Same rule as
       * probe 7, which exists precisely to keep null and 0 apart.
       */
      const hours = group.map((p) =>
        p.contract_hours === null || p.contract_hours === undefined ? null : Number(p.contract_hours));
      const allRecorded = hours.every((h) => h !== null);
      const identicalHours = allRecorded && new Set(hours.map((h) => h!.toFixed(2))).size === 1;
      rows.push({
        id: `dupe-${k}`,
        subject: (group[0].name ?? "").trim() || "(unnamed)",
        detail:
          `${group.length} orders named this for ${(group[0].customer ?? "").trim()}`
          + `${identicalHours ? ", all with identical contracted hours" : ""}`,
        href: null,
        cells: {
          customer: (group[0].customer ?? "").trim(),
          copies: String(group.length),
          hours: identicalHours
            ? `${hours[0]!.toFixed(1)} each`
            : hours.map((h) => (h === null ? "\u2014" : h.toFixed(1))).join(" / "),
          orders: group.map((p) => p.id).join(" · "),
        },
        // Identical hours on an identical name is the shape of a double import
        // rather than of a renewal, so those lead.
        severe: identicalHours,
      });
    }
    rows.sort(
      (a, b) => Number(b.severe) - Number(a.severe)
        || Number(b.cells.copies) - Number(a.cells.copies)
        || a.subject.localeCompare(b.subject),
    );
    const identical = rows.filter((r) => r.severe).length;
    record({
      key: "dupe_order_names",
      title: "The same order name twice for one customer",
      kind: "heuristic",
      subjectKind: "group",
      action:
        "Check whether each of these is a renewal or the same order imported twice. "
        + "A duplicate import double-counts its contracted hours in every total on "
        + "every other page, so it is worth confirming before trusting a utilisation "
        + "figure. Renewals are legitimate and should be left alone.",
      method:
        "Orders grouped by customer and order name, both lower-cased and "
        + "whitespace-collapsed. Groups of two or more are reported, with the "
        + "contracted hours of each shown so a repeat and a re-import can be told "
        + "apart by eye.",
      impact:
        `${shareOfOrders(duplicatedOrders)} share a name with another order · `
        + `${identical} ${identical === 1 ? "group carries" : "groups carry"} identical hours`,
      count: rows.length,
      columns: [
        { key: "customer", label: "CUSTOMER" },
        { key: "copies", label: "COPIES", align: "right", mono: true,
          hint: "How many orders share this exact name under this customer." },
        { key: "hours", label: "HOURS", align: "right", mono: true,
          hint: "Contracted hours of each order in the group. Identical figures look like a re-import." },
        { key: "orders", label: "ORDER IDS", mono: true, secondary: true },
      ],
      rows,
    });
  }

  /* ------------- 9-12. the nightly audit's findings, ported (A, B, D3, E4) --- */

  /*
   * Six supporting reads, in parallel, each returning rows OR a fault. A probe
   * whose read faulted is recorded in `skipped` with the reason and never
   * reaches `clean`. Failures that are neither RLS nor an unexposed schema are
   * logged once here, so an outage leaves evidence somewhere.
   */
  type TimeProjectRow = { id: number | string; hub_project_id: string | null };
  type SummaryRow = { project_id: number | string; estimated_hours: number | string | null };
  type OrderRow = { order_number: string | null; legal_entity_id: string | null };
  type EntityRow = { id: string; legal_name: string | null };
  type ReferenceRow = { id: number | string; person_id: string | null; external_id: string | null };
  type PersonRow = { id: string; name: string | null; factorial_employee_id: string | null };

  const [timeProjects, summaries, orders, entities, references, people] = await Promise.all([
    readSupport<TimeProjectRow>(supabase, "time", "project", "id, hub_project_id", "id"),
    readSupport<SummaryRow>(supabase, "time", "project_summary", "project_id, estimated_hours", "project_id"),
    readSupport<OrderRow>(supabase, "projects", "project_order", "order_number, legal_entity_id", "order_number"),
    readSupport<EntityRow>(supabase, "crm", "legal_entity", "id, legal_name", "id"),
    readSupport<ReferenceRow>(supabase, "crm", "factorial_person_reference", "id, person_id, external_id", "id"),
    readSupport<PersonRow>(supabase, "public", "people", "id, name, factorial_employee_id", "id"),
  ]);
  {
    const outages = [timeProjects, summaries, orders, entities, references, people]
      .filter((s) => s.fault === "failed")
      .map((s) => s.message);
    if (outages.length) console.error("[data-hygiene] supporting read failed:", outages.join(" | "));
  }

  const skipped: HygieneSkipped[] = [];
  /** Record a probe as not run because `source` faulted. */
  const skip = (key: string, title: string, source: string, reason: UnavailableReason) =>
    skipped.push({ key, title, reason, source });

  /* ------------------ 9. hub orders no TrackingTime project points at ----- */

  {
    const title = AUDIT_PROBES.unlinked_hub_project;
    if (timeProjects.fault) {
      skip("unlinked_hub_project", title, "time.project", timeProjects.fault);
    } else {
      /*
       * Audit check A, bucket `unlinked`. The ONLY link between an order and
       * its TrackingTime hours is time.project.hub_project_id (the reference
       * table crm.trackingtime_project_reference is empty), so an order nothing
       * points at can never receive a logged hour: its contracted hours sit in
       * "Nicht zugeordnet" on every management view for the life of the order.
       */
      const linked = new Set<string>();
      for (const t of timeProjects.rows) if (t.hub_project_id) linked.add(t.hub_project_id);
      const unlinked = projects.filter((p) => !linked.has(p.id));
      const rows: HygieneRow[] = unlinked.map((p) => ({
        id: p.id,
        subject: p.id,
        detail:
          `${(p.customer ?? "unknown customer").trim()} — ${(p.name ?? "").trim() || "(unnamed)"}: `
          + "no TrackingTime project links to this order",
        href: null,
        cells: {
          orderName: (p.name ?? "").trim() === "" ? "(unnamed)" : (p.name ?? "").trim(),
          customer: (p.customer ?? "unknown customer").trim(),
          contracted: hoursCell(p.contract_hours),
        },
        // Contracted hours with no way to ever burn them is the costly case; an
        // unlinked order with no figure is only unlinked.
        severe: Number(p.contract_hours ?? 0) > 0,
      }));
      rows.sort(
        (a, b) => Number(b.severe) - Number(a.severe)
          || Number(b.cells.contracted === "—" ? 0 : b.cells.contracted)
            - Number(a.cells.contracted === "—" ? 0 : a.cells.contracted)
          || a.subject.localeCompare(b.subject),
      );
      // Floored at 0, as in probe 6: a negative must not cancel real hours.
      const stranded = unlinked.reduce(
        (sum, p) => sum + Math.max(0, Number(p.contract_hours ?? 0) || 0), 0);
      record({
        key: "unlinked_hub_project",
        title,
        kind: "exact",
        subjectKind: "order",
        action:
          "No hours can reach these orders, so their burn is 0% for ever and their "
          + "contracted hours land in “not assigned” on every management view. "
          + "Link the TrackingTime project to the order by its exact id — never by "
          + "name — or close the order if no work is tracked against it.",
        method:
          "Every order in the book checked for at least one time.project row whose "
          + "hub_project_id equals the order id. None is the finding. This is the "
          + "audit's check A; name-based suspicions are deliberately not used, "
          + "because the link itself is the thing that must be exact (ADR-001).",
        impact:
          `${shareOfOrders(unlinked.length)} unreachable from TrackingTime · `
          + `${stranded.toFixed(1)} contracted hours can never receive logged time`,
        count: unlinked.length,
        columns: [
          { key: "orderName", label: "ORDER" },
          { key: "customer", label: "CUSTOMER" },
          { key: "contracted", label: "HOURS", align: "right", mono: true,
            hint: "Contracted hours on this order. A dash means no figure was ever entered." },
        ],
        rows,
      });
    }
  }

  /* --------------- 10. contracted hours vs TrackingTime budget ----------- */

  {
    const title = AUDIT_PROBES.budget_disagreement;
    if (timeProjects.fault) {
      skip("budget_disagreement", title, "time.project", timeProjects.fault);
    } else if (summaries.fault) {
      skip("budget_disagreement", title, "time.project_summary", summaries.fault);
    } else {
      /*
       * Audit check B, bucket `mismatch`, with its pairing rule copied rather
       * than approximated so the panel reproduces the audit's headline:
       *
       *   - pair via time.project.hub_project_id, and only TT projects that
       *     have a project_summary row (the audit's inner join);
       *   - one hub order with several TT projects compares against the SUM of
       *     their estimated_hours, and is reported once;
       *   - "no budget" is 0 on both sides by convention, so a pair where either
       *     side is not > 0 is a MISSING budget, not a disagreement, and is
       *     counted but not listed (see `method`);
       *   - the difference is rounded to 0.01 h first, and anything under 0.05 h
       *     is agreement.
       */
      const EPS = 0.05;
      const estimateByTt = new Map<string, number | null>();
      for (const s of summaries.rows) {
        estimateByTt.set(
          String(s.project_id),
          s.estimated_hours === null || s.estimated_hours === undefined ? null : Number(s.estimated_hours),
        );
      }
      const estimatesByHub = new Map<string, (number | null)[]>();
      for (const t of timeProjects.rows) {
        if (!t.hub_project_id || !estimateByTt.has(String(t.id))) continue;
        if (!estimatesByHub.has(t.hub_project_id)) estimatesByHub.set(t.hub_project_id, []);
        estimatesByHub.get(t.hub_project_id)!.push(estimateByTt.get(String(t.id))!);
      }
      const rows: HygieneRow[] = [];
      let paired = 0;
      let oneSided = 0;
      let disputed = 0;
      for (const p of projects) {
        const estimates = estimatesByHub.get(p.id);
        if (!estimates) continue;
        paired += 1;
        const n = estimates.length;
        const sum = estimates.reduce<number>((s, e) => s + (e ?? 0), 0);
        const tt = n > 1 ? sum : (estimates[0] ?? 0);
        const contract = Number(p.contract_hours ?? 0);
        const delta = Math.round((tt - contract) * 100) / 100;
        if (!(tt > 0) || !(contract > 0)) {
          // Both none is nothing to say; one side none is a missing budget.
          if (tt > 0 || contract > 0) oneSided += 1;
          continue;
        }
        if (Math.abs(delta) < EPS) continue;
        disputed += Math.abs(delta);
        const signed = `${delta > 0 ? "+" : "-"}${Math.abs(delta).toFixed(1)}`;
        rows.push({
          id: p.id,
          subject: p.id,
          detail:
            `${(p.customer ?? "unknown customer").trim()} — contract ${contract.toFixed(1)} h, `
            + `TrackingTime ${tt.toFixed(1)} h (${signed} h across ${n} TT ${n === 1 ? "project" : "projects"})`,
          href: null,
          cells: {
            customer: (p.customer ?? "unknown customer").trim(),
            contract: contract.toFixed(1),
            tracked: tt.toFixed(1),
            difference: signed,
            ttProjects: String(n),
          },
          // The audit's own "high" threshold: a hundred hours apart is a
          // different contract, not a rounding.
          severe: Math.abs(delta) >= 100,
        });
      }
      rows.sort(
        (a, b) => Math.abs(Number(b.cells.difference)) - Math.abs(Number(a.cells.difference))
          || a.subject.localeCompare(b.subject),
      );
      record({
        key: "budget_disagreement",
        title,
        kind: "heuristic",
        subjectKind: "order",
        action:
          "Both systems claim to know the ceiling for these orders and they differ, so "
          + "burn in TrackingTime and consumed-percent in the hub read against different "
          + "denominators. Decide which figure is the contract, then correct the other "
          + "at its source — the workbook for the hub, TrackingTime for the estimate.",
        method:
          "Orders paired with their TrackingTime projects by time.project.hub_project_id "
          + "(audit check B). One order with several TT projects is compared against the "
          + "SUM of their estimates and listed once. Listed only when BOTH sides are above "
          + "zero and differ by 0.05 h or more. One-sided budgets are NOT listed here: 0 "
          + "means “no budget set” on both sides by convention, so a figure on one "
          + "side only is a missing budget with a mechanical fix (enter it), not two "
          + "figures in dispute.",
        impact:
          `${rows.length} of ${paired} paired orders disagree · `
          + `${disputed.toFixed(1)} h in dispute (sum of |difference|) · `
          + `${oneSided} one-sided ${oneSided === 1 ? "budget" : "budgets"} not listed`,
        count: rows.length,
        columns: [
          { key: "customer", label: "CUSTOMER" },
          { key: "contract", label: "CONTRACT", align: "right", mono: true,
            hint: "Contracted hours on the hub order." },
          { key: "tracked", label: "TT", align: "right", mono: true,
            hint: "estimated_hours of the linked TrackingTime project, summed when there are several." },
          { key: "difference", label: "DIFF", align: "right", mono: true,
            hint: "TrackingTime minus contract, in hours. Positive means TrackingTime allows more." },
          { key: "ttProjects", label: "TT PROJ.", align: "right", mono: true, secondary: true,
            hint: "How many TrackingTime projects point at this order." },
        ],
        rows,
      });
    }
  }

  /* ------------ 11. the customer master disagrees with itself ------------ */

  {
    const title = AUDIT_PROBES.customer_master_drift;
    if (orders.fault) {
      skip("customer_master_drift", title, "projects.project_order", orders.fault);
    } else if (entities.fault) {
      skip("customer_master_drift", title, "crm.legal_entity", entities.fault);
    } else {
      /*
       * Audit check D3. public.projects.customer_legal_entity_id and
       * projects.project_order.legal_entity_id describe the same order, joined
       * on project_order.order_number = projects.code, and the management
       * matrix keys on one while the projects list keys on the other -- so the
       * order lands under a different customer depending on the page.
       *
       * The disagreement is proven by key; WHICH side is right is not, so the
       * panel is filed as worth-a-look. Rows where both sides are set and
       * differ are the serious ones (two real customers claim one order);
       * a null on one side is a link somebody has yet to make.
       */
      const orderEntity = new Map<string, string | null>();
      for (const o of orders.rows) if (o.order_number) orderEntity.set(o.order_number, o.legal_entity_id);
      const entityName = new Map<string, string>();
      for (const e of entities.rows) entityName.set(e.id, (e.legal_name ?? "").trim() || e.id);
      const nameOf = (id: string | null) => (id ? entityName.get(id) ?? id : "(not linked)");

      const rows: HygieneRow[] = [];
      let hours = 0;
      for (const p of projects) {
        if (!p.code || !orderEntity.has(p.code)) continue;
        const projectSide = p.customer_legal_entity_id ?? null;
        const orderSide = orderEntity.get(p.code) ?? null;
        if (projectSide === orderSide) continue;
        hours += Math.max(0, Number(p.contract_hours ?? 0) || 0);
        rows.push({
          id: p.id,
          subject: p.id,
          detail: `project side ${nameOf(projectSide)}, order side ${nameOf(orderSide)}`,
          href: null,
          cells: {
            projectEntity: nameOf(projectSide),
            orderEntity: nameOf(orderSide),
            contracted: hoursCell(p.contract_hours),
          },
          severe: Boolean(projectSide && orderSide),
        });
      }
      rows.sort(
        (a, b) => Number(b.severe) - Number(a.severe)
          || Number(b.cells.contracted === "—" ? 0 : b.cells.contracted)
            - Number(a.cells.contracted === "—" ? 0 : a.cells.contracted)
          || a.subject.localeCompare(b.subject),
      );
      const bothSet = rows.filter((r) => r.severe).length;
      record({
        key: "customer_master_drift",
        title,
        kind: "heuristic",
        subjectKind: "order",
        action:
          "Barred rows name two real customers for one order, and a human has to say "
          + "which is the contract partner before either record is touched. Rows with "
          + "one side not linked are a link waiting to be made — copy the known side "
          + "across in the customer master, never by name similarity.",
        method:
          "public.projects.customer_legal_entity_id compared with "
          + "projects.project_order.legal_entity_id for the same order number "
          + "(audit check D3). Any difference, including a null on one side, is the "
          + "finding. Names are shown for reading only; the comparison is on ids.",
        impact:
          `${shareOfOrders(rows.length)} filed under two customers · `
          + `${hours.toFixed(1)} contracted hours · ${bothSet} with both sides set`,
        count: rows.length,
        columns: [
          { key: "projectEntity", label: "PROJECT SIDE",
            hint: "The legal entity public.projects links to." },
          { key: "orderEntity", label: "ORDER SIDE",
            hint: "The legal entity projects.project_order links to." },
          { key: "contracted", label: "HOURS", align: "right", mono: true,
            hint: "Contracted hours on this order. A dash means no figure was ever entered." },
        ],
        rows,
      });
    }
  }

  /* --------- 12. Factorial id stored twice for one person, differently ---- */

  {
    const title = AUDIT_PROBES.factorial_reference_mismatch;
    if (references.fault) {
      skip("factorial_reference_mismatch", title, "crm.factorial_person_reference", references.fault);
    } else if (people.fault) {
      skip("factorial_reference_mismatch", title, "public.people", people.fault);
    } else {
      /*
       * Audit check E4. crm.factorial_person_reference.external_id and
       * public.people.factorial_employee_id both store the Factorial employee
       * id for one person. Backfilled on 2 Sep 2026, so this is expected to be
       * clean -- and it stays listed as a check that ran, because "clean today"
       * is only evidence while somebody keeps looking.
       */
      const personById = new Map<string, PersonRow>();
      for (const p of people.rows) personById.set(p.id, p);
      const rows: HygieneRow[] = [];
      for (const r of references.rows) {
        const person = r.person_id ? personById.get(r.person_id) : undefined;
        const profileId = person?.factorial_employee_id ?? null;
        const referenceId = r.external_id ?? null;
        if (r.person_id && profileId === referenceId) continue;
        rows.push({
          id: `ref-${r.id}`,
          subject: person?.name?.trim() || (r.person_id ? `person ${r.person_id}` : "(no person linked)"),
          detail: `reference says ${referenceId ?? "(empty)"}, profile says ${profileId ?? "(empty)"}`,
          href: null,
          cells: {
            reference: referenceId ?? "(empty)",
            profile: profileId ?? "(empty)",
          },
          // Two different ids is worse than one missing: it is two different
          // employees' records reaching one person.
          severe: Boolean(referenceId && profileId),
        });
      }
      rows.sort((a, b) => Number(b.severe) - Number(a.severe) || a.subject.localeCompare(b.subject));
      record({
        key: "factorial_reference_mismatch",
        title,
        kind: "exact",
        subjectKind: "person",
        action:
          "Two places store the Factorial id for one person and they disagree, or one "
          + "is empty. The reference table is the authority once a human confirms it; "
          + "backfilling the profile from it is then mechanical.",
        method:
          "Every crm.factorial_person_reference row compared, by person_id, with "
          + "public.people.factorial_employee_id (audit check E4). A missing person, "
          + "a missing id on either side, or two different ids is the finding.",
        impact: `${rows.length} of ${references.rows.length} references disagree with the profile`,
        count: rows.length,
        columns: [
          { key: "reference", label: "REFERENCE ID", mono: true,
            hint: "crm.factorial_person_reference.external_id" },
          { key: "profile", label: "PROFILE ID", mono: true,
            hint: "public.people.factorial_employee_id" },
        ],
        rows,
      });
    }
  }


  // Worst first, and heuristics after exact findings of the same size: a reader
  // should meet provable problems before suspicions.
  findings.sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === "exact" ? -1 : 1;
    return b.count - a.count;
  });

  return {
    findings,
    clean,
    skipped,
    scope: {
      orders: orderCount,
      customers,
      accountNumbers,
      affectedOrders: affected.size,
      probes: findings.length + clean.length,
    },
    checkedAt,
    unavailable: false,
    unavailableReason: null,
  };
}
