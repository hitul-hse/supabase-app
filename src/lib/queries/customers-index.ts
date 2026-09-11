/**
 * /customers — the list of customers this reader can see.
 *
 * WHY THIS EXISTS (2026-09-11)
 * ----------------------------
 * `customer-profile.ts` answers "who is this customer" for one five-digit
 * Lexware number. Nothing answered "which customers are there", so the profile
 * was reachable only by clicking a name on /my-work or the management
 * portfolio: a consultant who simply wanted to look a customer up had nowhere
 * to start, and there was no navigation entry because there was nothing to
 * point one at. hitul asked for a Customers tab; this is the page behind it.
 *
 * THE BOUNDARY IS THE SAME ONE THE PROFILE USES, NOT A WIDER READ
 * ---------------------------------------------------------------
 * Every row comes from `public.project_masterdata`, which carries the
 * `can_view_project()` select policy. The read runs on the READER'S OWN
 * session, so PostgREST returns only the orders that reader may see and the
 * grouping below can only ever count those. There is deliberately no service-
 * role read here and no filtering in the component: a page that fetched
 * everything and hid rows in the browser would be one `view-source` away from
 * leaking the customer list, and the redaction would live in the wrong layer.
 *
 * The consequence is that the list is per-reader, and the page says so in
 * words. Measured on live data on 2026-09-11:
 *
 *     exec                         101 of 101 customers
 *     dept_head in OPERATIONS       69 of 101
 *
 * That is not a defect of this module. `can_view_project()` grants a
 * department head only their own department's projects, and 66 of 242 projects
 * carry no department at all. Widening it is HSEHU-81 and is a policy change,
 * not a query change.
 *
 * WHY THE WHOLE VISIBLE SET IS READ AND THEN PAGED IN MEMORY
 * ----------------------------------------------------------
 * The list is one row per CUSTOMER, but the table is one row per ORDER, and
 * PostgREST cannot group. Paging the orders would put an arbitrary slice of a
 * customer's orders on each page and produce counts that change as you page,
 * which is the dishonest-number failure this codebase keeps paying for. So the
 * visible orders are read in full — bounded, 242 rows across the whole company
 * today and capped below — grouped once, and the CUSTOMERS are paged.
 *
 * `truncated` is reported rather than hidden. If the ceiling is ever reached
 * the counts are floors, and the page must say so instead of presenting a
 * short total as complete.
 */
import type { SupabaseTyped } from "./types";
import { fetchAllPaged } from "./paged";

/** One customer, as the index renders it. */
export type CustomerIndexRow = {
  /** The five-digit Lexware number. The identity, and the URL segment. */
  customerNumber: string;
  /**
   * The name to show, or null when every visible row for this customer left it
   * blank. Rendered as the number alone rather than as an invented name.
   */
  name: string | null;
  /** Orders of this customer this reader can see. Never a total of all orders. */
  visibleOrders: number;
  /**
   * Of those, the ones still running: the sheet has not marked them historical
   * and their contract has not ended. Null is impossible here — it is a count
   * of rows already in hand — but it can legitimately be 0, which means the
   * customer is dormant rather than that the figure is missing.
   */
  liveOrders: number;
  /** Where the work is, when the visible rows agree on one place. */
  city: string | null;
};

export type CustomersIndex = {
  rows: CustomerIndexRow[];
  /** Customers this reader can see, across every page. */
  total: number;
  /** Orders behind those customers. Shown so the two figures cannot be confused. */
  visibleOrders: number;
  page: number;
  perPage: number;
  pageCount: number;
  /** The safety ceiling stopped the read: every count below is a floor. */
  truncated: boolean;
};

/** docs/UI-CONVENTIONS.md: ten rows for a worked queue. */
export const CUSTOMERS_PER_PAGE = 10;

/**
 * A ceiling on ORDERS read, not customers. 242 exist company-wide today, so 30
 * pages of 1000 is far above any real answer and exists only so a runaway read
 * reports truncation instead of hanging.
 */
const MAX_ORDER_PAGES = 30;

type MasterdataRow = {
  project_id: string;
  customer_number: string | null;
  customer_display_name: string | null;
  customer_name: string | null;
  city: string | null;
  contract_end: string | null;
  lifecycle_status: string | null;
};

const COLUMNS =
  "project_id, customer_number, customer_display_name, customer_name, city, contract_end, lifecycle_status";

/*
 * `project_masterdata` is newer than the checked-in `database.types.ts`, which
 * this module does not own and must not regenerate, so a literal `.from()` of it
 * does not typecheck even though it is correct at runtime. The escape hatch is
 * confined to this one helper and every row is re-narrowed immediately as
 * `MasterdataRow` — the same shape `customer-profile.ts` uses for the same table.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const anyClient = (supabase: SupabaseTyped) => supabase as any;

/** The sheet's own absence markers. Kept in step with customer-profile.ts. */
const SHEET_NA = new Set(["-", "–", "—", "n/a", "na", "k.a.", "keine"]);

function textOrNull(v: string | null | undefined): string | null {
  if (v === null || v === undefined) return null;
  const t = v.trim();
  return t === "" || SHEET_NA.has(t.toLowerCase()) ? null : t;
}

/**
 * Still running, as of `today`. Two independent reasons an order is not:
 * the promotion step marked it historical because it left the sheet, or its
 * contract has an end date in the past. A missing end date is an OPEN contract,
 * not an unknown one — that is what the sheet means by leaving it blank — so it
 * counts as live.
 */
function isLive(r: MasterdataRow, today: string): boolean {
  if ((r.lifecycle_status ?? "active") !== "active") return false;
  const end = textOrNull(r.contract_end);
  return end === null || end >= today;
}

/**
 * Read every order this reader can see, group to customers, page the customers.
 *
 * `now` is injected so a gate can pin the day rather than race midnight. It
 * defaults to the real clock.
 */
export async function getCustomersIndex(
  supabase: SupabaseTyped,
  opts: { page?: number; perPage?: number; now?: Date } = {},
): Promise<CustomersIndex> {
  const perPage = opts.perPage ?? CUSTOMERS_PER_PAGE;
  const requestedPage = Math.max(1, Math.floor(opts.page ?? 1));
  const today = (opts.now ?? new Date()).toISOString().slice(0, 10);

  // `.order()` BEFORE `.range()`: without a total order PostgREST may return a
  // row on two pages and omit another entirely. project_id is the primary key,
  // so it is a complete order.
  const { rows: orders, truncated } = await fetchAllPaged<MasterdataRow>(
    (from, to) =>
      anyClient(supabase)
        .from("project_masterdata")
        .select(COLUMNS)
        .order("project_id", { ascending: true })
        .range(from, to),
    { maxPages: MAX_ORDER_PAGES },
  );

  type Acc = {
    customerNumber: string;
    names: Map<string, number>;
    cities: Set<string>;
    visibleOrders: number;
    liveOrders: number;
  };
  const byCustomer = new Map<string, Acc>();

  for (const r of orders) {
    const number = textOrNull(r.customer_number);
    // A row without a number belongs to no profile and is counted by the
    // profile page's own footnote, not silently folded into another customer.
    if (number === null) continue;

    let acc = byCustomer.get(number);
    if (!acc) {
      acc = { customerNumber: number, names: new Map(), cities: new Set(), visibleOrders: 0, liveOrders: 0 };
      byCustomer.set(number, acc);
    }
    acc.visibleOrders += 1;
    if (isLive(r, today)) acc.liveOrders += 1;

    // The display name the sheet gives a row can differ between orders of one
    // customer. Take the one that appears most, so a single odd row cannot
    // rename the customer, and fall back to the legal name.
    const name = textOrNull(r.customer_display_name) ?? textOrNull(r.customer_name);
    if (name !== null) acc.names.set(name, (acc.names.get(name) ?? 0) + 1);

    const city = textOrNull(r.city);
    if (city !== null) acc.cities.add(city);
  }

  const all: CustomerIndexRow[] = [...byCustomer.values()].map((a) => {
    let name: string | null = null;
    let best = 0;
    for (const [candidate, count] of a.names) {
      // Ties break on the alphabetically first candidate so the page is stable
      // across reloads rather than depending on Map insertion order.
      if (count > best || (count === best && name !== null && candidate < name)) {
        name = candidate;
        best = count;
      }
    }
    return {
      customerNumber: a.customerNumber,
      name,
      visibleOrders: a.visibleOrders,
      liveOrders: a.liveOrders,
      // One city only when the visible rows agree. Two sites is not a place,
      // and picking one of them would be a claim the data does not support.
      city: a.cities.size === 1 ? [...a.cities][0] : null,
    };
  });

  /*
   * Worst-first in the sense this page has one: the customer with the most work
   * still running is the one somebody opening this page is looking for. Ties
   * fall back to total visible orders, then to the number, so the order is
   * total and the same on every reload.
   */
  all.sort(
    (x, y) =>
      y.liveOrders - x.liveOrders ||
      y.visibleOrders - x.visibleOrders ||
      x.customerNumber.localeCompare(y.customerNumber),
  );

  const total = all.length;
  const pageCount = Math.max(1, Math.ceil(total / perPage));
  // A page number past the end shows the last page rather than an empty table,
  // which is what a stale bookmark or a shrinking list would otherwise produce.
  const page = Math.min(requestedPage, pageCount);
  const from = (page - 1) * perPage;

  return {
    rows: all.slice(from, from + perPage),
    total,
    visibleOrders: orders.length,
    page,
    perPage,
    pageCount,
    truncated,
  };
}
