/**
 * One customer, as the person in front of the screen is allowed to see them.
 *
 * WHAT THIS ANSWERS, AND WHY IT IS A NEW MODULE
 * ---------------------------------------------
 * Until now, clicking a customer anywhere in the Hub only FILTERED a project
 * list. `my-work.ts` groups a person's own book of work BY customer, and
 * `management-customer-portfolio.ts` rolls the whole portfolio up for an exec;
 * neither can answer "who is this customer" from a URL. This module does, for
 * one five-digit Lexware number, and nothing else.
 *
 * THE KEY IS THE FIVE-DIGIT LEXWARE NUMBER, NEVER A NAME (ADR-001)
 * ----------------------------------------------------------------
 * `public.project_masterdata.customer_number` is the identity. Measured on the
 * live data (2026-09-10): `crm.lexware_customer` holds 119 rows and 119
 * distinct customer numbers with ZERO numbers shared between two legal
 * entities, while 4 entities carry more than one number — one Lexware account
 * per billing relationship. So number -> entity is a function and entity ->
 * number is not, and keying the page on `projects.customer_legal_entity_id`
 * would merge accounts Lexware bills separately.
 *
 * The number is also the only key a NON-EXEC can use. `project_masterdata` sits
 * under `can_view_project()`; every `crm.*` table carries the exec-only policy
 * "customer master exec access". Keying on the number therefore needs no new
 * grant, where keying on the entity would need one.
 *
 * The cost is stated rather than hidden: 20 of 242 orders carry no masterdata
 * row and so no number, 10 of them under a legal entity that also carries
 * numbered orders. They belong to no profile. They are COUNTED in
 * `siblingUnnumberedOrders` and named in a footnote, and they are never folded
 * into a figure.
 *
 * WHAT AN OPERATIONS COLLEAGUE ACTUALLY SEES
 * ------------------------------------------
 * `can_view_project()` is per-reader: exec sees every order, `dept_head` its
 * department, everybody else only the orders they own, lead, cover or are
 * assigned to. Measured over every (person, account) pair with any visibility,
 * 80.8% of the time the reader is looking at PART of the account, median half
 * of it. Every figure below is therefore "of the orders you can see", and the
 * page says so in those words. This module does not try to widen that — a
 * `security definer` count function that returned totals without rows is a
 * migration and a separate ticket.
 *
 * HOURS COME FROM THE STORED SNAPSHOT, NEVER FROM time.entry
 * ----------------------------------------------------------
 * `time.entry`'s SELECT policy is `exec OR own member OR can_view_member(...)`,
 * so a non-exec summing it gets THEIR OWN hours and no error at all — a page
 * that would show two colleagues two different totals. `time.project_summary`
 * and `time.customer_summary` are `security_invoker = true` views over the same
 * table and inherit the problem. So hours are `public.projects.logged_hours`,
 * written by scripts/refresh-order-hours.mjs under a service role and visible
 * exactly when the order is, stamped with `logged_hours_as_of`.
 *
 * `logged_hours` is NULL, not 0, on the orders with no TrackingTime link (65 of
 * 242 measured today; `has_tt=false -> logged_null=65, logged_zero=0`). The
 * schema already tells "unknown" apart from "measured zero" and this module
 * preserves that all the way to the tile: a sum over zero measured orders is
 * `null`, never `0`.
 *
 * `projects.status` IS DELIBERATELY NOT SELECTED
 * ----------------------------------------------
 * refresh-order-hours.mjs derives it as `consumed >= 95 -> CRITICAL, >= 80 ->
 * WARNING, else NORMAL`, i.e. it is `contract_hours` in disguise, and it is NOT
 * in BUDGET_COLUMNS. Beside a visible `logged_hours` it is a two-sided bound on
 * a number the reader's role was denied. Liveness on this page is
 * `contract_end`, which is a fact about the contract rather than about the
 * budget, so the status column is simply not asked for.
 *
 * WHAT FAILS, AND WHAT THAT COSTS
 * -------------------------------
 * The masterdata read and the projects read are NOT caught: losing either costs
 * the page everything, and the page must say "this failed to load" rather than
 * render an empty list that reads as "no orders" (the exact lie /my-work shipped
 * once). Every other read is wrapped and degrades to its own empty section.
 *
 * A DEGRADED SIDE READ IS NOT AN ABSENCE, AND EVERY SIDE READ SAYS WHICH
 * ---------------------------------------------------------------------
 * `{ rows: [] }` from a caught error and `{ rows: [] }` from a customer with no
 * contacts are the same value and OPPOSITE facts, and the section above renders
 * them as one sentence unless the failure travels with the rows. So every
 * degrading read carries `failed`, and the two counts DERIVED from those rows —
 * `figures.ordersWithoutResponsible` and `siblingUnnumberedOrders` — are
 * `number | null`, null meaning "could not be checked". They are never
 * recomputed over an empty set, which would turn a failed read into the
 * categorical claim "nobody is responsible for any of these orders": the exact
 * substitution budget-visibility.ts forbids ("DERIVED COUNTS MUST BE ABSENT, NOT
 * RECOMPUTED"), and the same class of lie as the empty list above.
 *
 * Every degradation ALSO sets `truncated`, so the table's "the figures are
 * floors" footnote fires whether a read was cut short or lost outright.
 *
 * NO AGGREGATES OVER PostgREST, AND `.order()` BEFORE `.range()`
 * -------------------------------------------------------------
 * `db-aggregates-enabled` is off on this project, so every total below is summed
 * in TypeScript over fetched rows, and every paged read orders before it ranges
 * so the pages are a stable partition rather than an arbitrary one.
 */
import type { SupabaseTyped } from "./types";
import { fetchAllPaged, PAGE } from "./paged";
import { canReadBudgets, budgetAwareColumns } from "@/lib/budget-visibility";
import { PERMISSIONS } from "@/lib/permissions";
import { todayInBerlin } from "@/lib/date-display";
import { LINK_LABEL, LINK_ORDER, type MyLink, type PersonKind } from "./my-work";

/* --------------------------------------------------------------- the key */

/**
 * The five-digit Lexware customer number, and nothing else.
 *
 * This is the table's OWN check constraint (`customer_number ~ '^[0-9]{5}$'`,
 * 20260910120000_masterdata_sheet_warehouse.sql), which is what makes the route
 * guard provable rather than a guess: a segment that fails this is not a
 * customer number, so the page can 404 without a round trip. Exported so the
 * route and the query cannot drift into two different ideas of the key.
 *
 * No `g` flag: a global regex carries `lastIndex` between `.test()` calls and
 * would return false every other time it is asked the same question.
 */
export const CUSTOMER_NUMBER_PATTERN = /^\d{5}$/;

/* --------------------------------------------------------------- shapes */

/** Where an order's contract sits relative to today, decided ON THE SERVER. */
export type TermState = "running" | "ended" | "unknownEnd";

/** One service order of this customer that the reader may see. */
export type CustomerOrder = {
  /** `public.projects.id` — the masterdata order key, and the /orders/[id] key. */
  id: string;
  /** The order code as displayed. Equal to `id` on all 242 live orders. */
  code: string;
  /** The order's own name, searched but not shown as a column of its own. */
  name: string;
  serviceNumber: number | null;
  /** The sheet's service name AS WRITTEN — never bucketed, never normalised. */
  serviceName: string | null;
  subprojectNumber: number | null;
  contractStart: string | null;
  contractEnd: string | null;
  /** Decided here so the table renders the same state on the server and client. */
  termState: TermState;
  /**
   * Contracted hours, or null when nobody set any — AND null when the reader
   * may not see budgets. The two are told apart by `CustomerProfile.
   * budgetsWithheld`, never by looking at this value (budget-visibility.ts).
   */
  contractHours: number | null;
  /** Hours logged by EVERYONE, or null when the order has no TrackingTime link. */
  loggedHours: number | null;
  /** 'historical' when the sheet stopped carrying the row; never deleted. */
  lifecycleStatus: "active" | "historical";
  responsibleKind: PersonKind | null;
  responsibleName: string | null;
  replacementKind: PersonKind | null;
  replacementName: string | null;
  serviceRole: string | null;
};

/** One distinct postal address, and the orders delivered there. */
export type CustomerLocation = {
  street: string | null;
  postalCode: string | null;
  city: string | null;
  /** Order codes using this address. Rendered only when the customer has several. */
  orderCodes: string[];
};

/** One contact PERSON at the customer, folded across the orders naming them. */
export type CustomerContact = {
  name: string | null;
  phone: string | null;
  email: string | null;
  orderCodes: string[];
};

/** One colleague who looks after this customer, and on which orders. */
export type CustomerCarer = {
  /** null for a `doctor`/`other` sentinel: the sheet names no person there. */
  personId: string | null;
  name: string | null;
  kind: PersonKind;
  role: "responsible" | "replacement";
  serviceRole: string | null;
  orderCodes: string[];
};

/** One outbound destination, deduped on the URL across the customer's orders. */
export type CustomerLink = MyLink & { orderCodes: string[] };

/** The figures the page renders. Computed here, never in a component. */
export type CustomerFigures = {
  /** Orders visible to this reader. Never null; always stated with its scope. */
  orders: number;
  /** `contract_end >= today` in Berlin. */
  runningContracts: number;
  /** `contract_end < today`. */
  endedContracts: number;
  /** No end date recorded at all — its own count, never folded into "running". */
  unknownEnd: number;
  /** The latest end date across the visible orders, for the "all ended" banner. */
  lastContractEnd: string | null;
  /** Orders the sheet stopped carrying. */
  historicalOrders: number;
  /**
   * Sum of contracted hours over the orders that carry any, or null.
   *
   * Null means either "nobody recorded contracted hours on ANY visible order"
   * or "withheld from this reader"; `budgetsWithheld` says which. It is never 0.
   */
  contractHours: number | null;
  /** How many orders carry contracted hours. 0 and meaningless when withheld. */
  contractHoursOrders: number;
  /**
   * Sum of logged hours, or null when NOT ONE visible order is measured.
   *
   * 13 of 101 accounts are in that state. Rendering 0 h there reads as a
   * customer we have abandoned; the truth is that nobody linked the orders.
   */
  loggedHours: number | null;
  /** How many orders carry a measured figure. The sum's coverage, never optional. */
  loggedMeasuredOrders: number;
  /** The refresh instant behind `loggedHours`; every moving figure is stamped. */
  loggedHoursAsOf: string | null;
  /**
   * Visible orders with no `responsible` row in `public.project_responsibility`,
   * or NULL when that read FAILED and the question could not be answered.
   *
   * Defined on the ROLE TABLE, not on `project_masterdata.responsible_person_id`:
   * 64 masterdata rows record `responsible_kind = 'doctor'` with a null person
   * id, and an external occupational physician is not a missing person. The role
   * table still names an internal holder for 62 of those 64, so reading the
   * masterdata column would report 92 gaps where there are 23 (re-measured
   * against production on 2026-09-10: 23 numbered, 34 overall, against 92).
   *
   * NULL RATHER THAN A RECOMPUTED COUNT. Over an empty row set this count equals
   * `orders.length`, which the Betreuung card renders as "nobody is named
   * responsible on ANY of these orders" — a categorical claim manufactured out
   * of a failed read, printed directly beneath the carers the card has just
   * listed by name. The absent case gets its own sentence instead.
   */
  ordersWithoutResponsible: number | null;
};

/** The canonical Lexware record. Exec only; see `masterState` for the rest. */
export type CustomerMasterRecord = {
  displayNameSource: string | null;
  billingName: string | null;
  billingAddress: string | null;
  vatId: string | null;
  legalName: string | null;
  legalForm: string | null;
  countryCode: string | null;
  lifecycleStatus: string | null;
  reviewStatus: string | null;
  locations: string[];
  aliases: string[];
};

/**
 * Why the master record is or is not on the page. FOUR distinct states that
 * must never render alike:
 *
 *  - `withheld`    the reader is not exec. A fact about the READER, and the
 *                  copy also refuses to say whether such a record exists.
 *  - `none`        exec, and crm holds no row for this number.
 *  - `unavailable` exec, and the read FAILED. A failure, not a restriction.
 *  - `present`     exec, and the record is below.
 */
export type MasterRecordState = "withheld" | "none" | "unavailable" | "present";

export type CustomerProfile = {
  customerNumber: string;
  /** The sheet's display name, or the free-text `projects.customer`, or null. */
  displayName: string | null;
  /** Sheet legal names that differ from the display name (11 of 222 rows). */
  legalNames: string[];
  /** Other display spellings folded into this number — the merge, stated. */
  spellings: string[];
  corporateGroups: string[];
  languages: ("de" | "en")[];
  /** True for an exec: the page then says it is showing ALL orders. */
  isExec: boolean;
  /** True when `projects:contracts:read` is absent. Carried, never inferred. */
  budgetsWithheld: boolean;
  /** True when the reader holds `projects:read_all`, so /orders/[id] will open. */
  canOpenOrder: boolean;
  orders: CustomerOrder[];
  figures: CustomerFigures;
  locations: CustomerLocation[];
  contacts: CustomerContact[];
  /**
   * True when the `project_contact` read FAILED. Without it an empty list renders
   * as "Kein Ansprechpartner hinterlegt" — a positive claim about the customer
   * built out of a failed read.
   */
  contactsUnavailable: boolean;
  care: CustomerCarer[];
  links: CustomerLink[];
  /** True when the `project_link` read FAILED. Same argument as `contacts`. */
  linksUnavailable: boolean;
  /** Sheet `Dateiablage` values — paths, not URLs, so never rendered as links. */
  fileStorages: string[];
  master: CustomerMasterRecord | null;
  masterState: MasterRecordState;
  /**
   * Orders of the SAME legal entity that carry no customer number, counted from
   * the exact uuid key and never from name similarity. Counted only: they are
   * never folded into a figure and never given a profile.
   *
   * NULL when the sibling read failed. Over an empty masterdata sub-read this
   * count becomes EVERY sibling order, so the footnote would state that N orders
   * of this legal entity carry no customer number on the strength of a read that
   * returned nothing at all.
   */
  siblingUnnumberedOrders: number | null;
  /** Other customer numbers under the same legal entity. Separate customers. */
  siblingCustomerNumbers: string[];
  /** The sheet batch behind this data, for the provenance line. */
  lastSeenAt: string | null;
  /** Set when the masterdata or projects read THREW. Never an empty list. */
  loadFailed: boolean;
  /**
   * Set when a paged read hit its ceiling OR a side read was lost outright: the
   * figures are then floors and the table's footnote says so. Both are "part of
   * the data could not be read in full", which is what that footnote claims.
   */
  truncated: boolean;
};

/* -------------------------------------------------------------- row types */

type MasterdataRow = {
  project_id: string;
  customer_number: string | null;
  customer_display_name: string | null;
  customer_name: string | null;
  corporate_group: string | null;
  service_number: number | null;
  service_name: string | null;
  subproject_number: number | null;
  language: number | null;
  street: string | null;
  postal_code: string | null;
  city: string | null;
  contract_start: string | null;
  contract_end: string | null;
  responsible_kind: string | null;
  replacement_kind: string | null;
  responsible_person_id: string | null;
  replacement_person_id: string | null;
  service_role: string | null;
  file_storage: string | null;
  lifecycle_status: string | null;
  last_seen_at: string | null;
};

type ProjectRow = {
  id: string;
  code: string | null;
  name: string | null;
  customer: string | null;
  contract_hours?: number | null;
  logged_hours: number | null;
  logged_hours_as_of: string | null;
  customer_legal_entity_id: string | null;
};

type ContactRow = { project_id: string; slot: number; name: string | null; phone: string | null; email: string | null };
type LinkRow = { project_id: string | null; kind: string | null; url: string | null; label: string | null };
type ResponsibilityRow = { project_id: string; person_id: string; role: string | null };
type PersonNameRow = { id: string; name: string | null };
type SiblingProjectRow = { id: string; customer_legal_entity_id: string | null };
type SiblingMasterdataRow = { project_id: string; customer_number: string | null };

type LexwareRow = {
  customer_number: string;
  legal_entity_id: string | null;
  display_name_source: string | null;
  billing_name: string | null;
  billing_street: string | null;
  billing_house_number: string | null;
  billing_postal_code: string | null;
  billing_city: string | null;
  vat_id_source: string | null;
  lifecycle_status: string | null;
  review_status: string | null;
};
type LegalEntityRow = {
  id: string;
  legal_name: string | null;
  legal_form: string | null;
  vat_id: string | null;
  country_code: string | null;
  lifecycle_status: string | null;
  review_status: string | null;
};
type LocationRow = { legal_entity_id: string; location_name: string | null; street: string | null; postal_code: string | null; city: string | null };
type AliasRow = { legal_entity_id: string; alias_text: string | null };

/* ------------------------------------------------------------- selects */

const MASTERDATA_COLUMNS =
  "project_id, customer_number, customer_display_name, customer_name, corporate_group, " +
  "service_number, service_name, subproject_number, language, street, postal_code, city, " +
  "contract_start, contract_end, responsible_kind, replacement_kind, responsible_person_id, " +
  "replacement_person_id, service_role, file_storage, lifecycle_status, last_seen_at";

/**
 * The `projects` columns this page needs.
 *
 * `status` is absent on purpose (see the header): it is a pure function of
 * `contract_hours` and would hand a two-sided bound on the withheld budget to
 * every reader. `contract_hours` is stripped by `budgetAwareColumns()` for a
 * reader without `projects:contracts:read`, so the number never enters the
 * payload at all rather than being blanked after the fetch.
 */
const PROJECT_COLUMNS =
  "id, code, name, customer, contract_hours, logged_hours, logged_hours_as_of, customer_legal_entity_id";

/*
 * `customer_legal_entity_id` and `logged_hours_as_of` are newer than the
 * checked-in `database.types.ts`, which this module does not own and must not
 * regenerate, so a literal `.select()` of them does not typecheck even though
 * it is correct at runtime. The escape hatch is confined to these two helpers
 * and every row is re-narrowed immediately, the same shape my-work.ts uses.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const anyClient = (supabase: SupabaseTyped) => supabase as any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const crmSchema = (supabase: SupabaseTyped) => (supabase as any).schema("crm");

/* ------------------------------------------------------------- helpers */

function numOrNull(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** A stored 0 contract means "nobody set one", which is not a zero budget. */
function budgetOrNull(v: unknown): number | null {
  const n = numOrNull(v);
  return n !== null && n > 0 ? n : null;
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

/**
 * The sheet's own "not applicable" markers, the set the importer
 * (scripts/lib/masterdata-sheet.mjs) folds to null for the fields it parses as
 * n/a-able. Contact cells are NOT folded by the importer — a name is text to
 * it, and "-" is a legal name as far as a text parser knows — so this is the
 * only place a "-" contact becomes the absence it means. Written as escapes so
 * this source stays ASCII.
 */
const SHEET_NA = new Set(["-", "\u2013", "\u2014", "n/a", "na", "k.a.", "keine"]);

function textOrNull(v: string | null | undefined): string | null {
  if (v === null || v === undefined) return null;
  const t = v.trim();
  return t === "" || SHEET_NA.has(t.toLowerCase()) ? null : t;
}

/** Only the three values the CHECK constraint admits; anything else is unknown. */
function kindOrNull(v: string | null | undefined): PersonKind | null {
  return v === "person" || v === "doctor" || v === "other" ? v : null;
}

/** Most orders first, then alphabetically — deterministic between requests. */
function byCountThenName(a: { name: string; orders: number }, b: { name: string; orders: number }) {
  return b.orders - a.orders || a.name.localeCompare(b.name);
}

/* --------------------------------------------------------------- reads */

/**
 * Every masterdata row carrying THIS customer number.
 *
 * `.eq("customer_number", ...)` — an exact match on the five-digit key. Never a
 * name, never a `LIKE`, never the legal entity id (ADR-001). The read runs on
 * the caller's own session, so `can_view_project()` scopes it; this module has
 * no way to widen that and does not try.
 *
 * NOT wrapped in try/catch. `fetchAllPaged` throws on a PostgREST error and that
 * must reach the caller, so the page can say "this failed to load" instead of
 * rendering an empty list that reads as "no orders for this customer".
 */
async function fetchRoster(supabase: SupabaseTyped, customerNumber: string) {
  return fetchAllPaged<MasterdataRow>((from, to) =>
    anyClient(supabase)
      .from("project_masterdata")
      .select(MASTERDATA_COLUMNS)
      .eq("customer_number", customerNumber)
      .order("project_id")
      .range(from, to),
  );
}

/**
 * The projects behind those masterdata rows.
 *
 * Chunked so a long `.in()` list cannot build a URL PostgREST rejects with a
 * 414 — a failure that would read as "no orders" rather than as an error. Also
 * NOT caught, for the same reason as the roster.
 */
async function fetchRosterProjects(
  supabase: SupabaseTyped,
  projectIds: string[],
  canSeeBudgets: boolean,
) {
  if (projectIds.length === 0) return { rows: [] as ProjectRow[], truncated: false };
  const columns = budgetAwareColumns(PROJECT_COLUMNS, canSeeBudgets);
  const rows: ProjectRow[] = [];
  let truncated = false;
  const CHUNK = 200;
  for (let i = 0; i < projectIds.length; i += CHUNK) {
    const slice = projectIds.slice(i, i + CHUNK);
    if (slice.length === 0) continue;
    const page = await fetchAllPaged<ProjectRow>(
      (from, to) =>
        anyClient(supabase).from("projects").select(columns).in("id", slice).order("id").range(from, to),
      { maxPages: Math.max(1, Math.ceil(slice.length / PAGE) + 1) },
    );
    truncated = truncated || page.truncated;
    rows.push(...page.rows);
  }
  return { rows, truncated };
}

/**
 * One paged, chunked, ordered read of a side table keyed on `project_id`.
 *
 * Every one of these degrades to NO ROWS on error: losing a side table costs
 * the page one section and nothing else. That is the opposite of the two reads
 * above, and the difference is deliberate.
 *
 * `failed` TRAVELS WITH THE ROWS, because the rows cannot carry it. An empty
 * result from a caught error and an empty result from a customer with no
 * contacts are the same value and opposite facts, and every caller here renders
 * a SENTENCE about that emptiness — "Kein Ansprechpartner hinterlegt", "Auf
 * keinem dieser Aufträge ist jemand als verantwortlich benannt". Without this
 * flag each of those becomes a confident claim manufactured out of a failed
 * read, which is the class of lie this module exists to refuse.
 */
async function fetchByProjectIds<Row>(
  supabase: SupabaseTyped,
  table: string,
  columns: string,
  projectIds: string[],
  orderBy: string[],
): Promise<{ rows: Row[]; truncated: boolean; failed: boolean }> {
  // Nothing to ask for is not a failure: there are no orders to have rows.
  if (projectIds.length === 0) return { rows: [], truncated: false, failed: false };
  try {
    const rows: Row[] = [];
    let truncated = false;
    const CHUNK = 200;
    for (let i = 0; i < projectIds.length; i += CHUNK) {
      const slice = projectIds.slice(i, i + CHUNK);
      if (slice.length === 0) continue;
      const page = await fetchAllPaged<Row>(
        (from, to) => {
          let q = anyClient(supabase).from(table).select(columns).in("project_id", slice);
          // .order() BEFORE .range(), always: an unordered paged read returns an
          // arbitrary partition rather than a stable one.
          for (const col of orderBy) q = q.order(col);
          return q.range(from, to);
        },
        { maxPages: Math.max(1, Math.ceil(slice.length / PAGE) + 1) },
      );
      truncated = truncated || page.truncated;
      rows.push(...page.rows);
    }
    return { rows, truncated, failed: false };
  } catch {
    return { rows: [], truncated: false, failed: true };
  }
}

/**
 * Colleague names, through `public.org_chart_nodes` and NEVER `public.people`.
 *
 * `can_view_person()` hides `people` from a non-exec caller, so a colleague's
 * row would come back empty and the page would print an id. The view projects
 * identity only (id, name, role, department, manager_id) and is deliberately
 * not security_invoker for exactly this reason. Degrades to no names, which the
 * page renders as "name not available" — true, and different from "nobody".
 */
async function fetchPersonNames(supabase: SupabaseTyped, personIds: string[]) {
  if (personIds.length === 0) return { rows: [] as PersonNameRow[], truncated: false };
  try {
    const rows: PersonNameRow[] = [];
    const CHUNK = 200;
    for (let i = 0; i < personIds.length; i += CHUNK) {
      const slice = personIds.slice(i, i + CHUNK);
      if (slice.length === 0) continue;
      const page = await fetchAllPaged<PersonNameRow>(
        (from, to) =>
          anyClient(supabase).from("org_chart_nodes").select("id, name").in("id", slice).order("id").range(from, to),
        { maxPages: Math.max(1, Math.ceil(slice.length / PAGE) + 1) },
      );
      rows.push(...page.rows);
    }
    return { rows, truncated: false };
  } catch {
    return { rows: [] as PersonNameRow[], truncated: false };
  }
}

/**
 * The orders that share a legal entity with this customer but are not on the
 * roster: the ones carrying no number at all, and the ones carrying a DIFFERENT
 * number.
 *
 * Keyed on `projects.customer_legal_entity_id`, an exact uuid readable under
 * `can_view_project()` — not on a name and not on a fuzzy match. Both results
 * are COUNTS and a list of numbers in a footnote; neither is ever folded into a
 * figure, because they belong to other customers or to no customer at all.
 *
 * Degrades to nothing: losing this costs two footnotes. `unnumbered` is then
 * NULL and not 0, because 0 is a claim and the derivation is worse than wrong:
 * `otherIds.filter((id) => !numberById.has(id))` over a failed masterdata
 * sub-read counts EVERY sibling order as unnumbered, so the footnote would say
 * that N orders of this legal entity carry no customer number on the strength of
 * a read that returned nothing at all.
 */
async function fetchSiblings(
  supabase: SupabaseTyped,
  entityIds: string[],
  rosterIds: Set<string>,
  customerNumber: string,
): Promise<{ unnumbered: number | null; numbers: string[]; truncated: boolean; failed: boolean }> {
  if (entityIds.length === 0) return { unnumbered: 0, numbers: [], truncated: false, failed: false };
  try {
    const projects: SiblingProjectRow[] = [];
    let truncated = false;
    const CHUNK = 100;
    for (let i = 0; i < entityIds.length; i += CHUNK) {
      const slice = entityIds.slice(i, i + CHUNK);
      const page = await fetchAllPaged<SiblingProjectRow>(
        (from, to) =>
          anyClient(supabase)
            .from("projects")
            .select("id, customer_legal_entity_id")
            .in("customer_legal_entity_id", slice)
            .order("id")
            .range(from, to),
        { maxPages: 4 },
      );
      truncated = truncated || page.truncated;
      projects.push(...page.rows);
    }
    const otherIds = projects.map((p) => p.id).filter((id) => !rosterIds.has(id));
    if (otherIds.length === 0) return { unnumbered: 0, numbers: [], truncated, failed: false };

    const md = await fetchByProjectIds<SiblingMasterdataRow>(
      supabase,
      "project_masterdata",
      "project_id, customer_number",
      otherIds,
      ["project_id"],
    );
    // The sub-read decides both answers, so ITS failure is the whole result's
    // failure rather than an empty half of it.
    if (md.failed) return { unnumbered: null, numbers: [], truncated: true, failed: true };
    const numberById = new Map<string, string>();
    for (const r of md.rows) if (r.customer_number) numberById.set(r.project_id, r.customer_number);

    const unnumbered = otherIds.filter((id) => !numberById.has(id)).length;
    const numbers = [...new Set([...numberById.values()])].filter((n) => n !== customerNumber).sort();
    return { unnumbered, numbers, truncated: truncated || md.truncated, failed: false };
  } catch {
    return { unnumbered: null, numbers: [], truncated: false, failed: true };
  }
}

/**
 * The canonical Lexware record, for an exec only.
 *
 * Read through `supabase.schema("crm")` on the READER'S OWN SESSION. The
 * exec-only policy "customer master exec access" is the enforcement; there is
 * no service-role key on this path and there must never be one.
 *
 * MEASURED 2026-09-10, and this is why the "unavailable" state is not
 * hypothetical: the `crm` schema is NOT in this project's PostgREST
 * exposed-schema list. A probe returns
 *
 *     406 PGRST106 "Only the following schemas are exposed:
 *                   public, graphql_public, raw, time"
 *
 * so today this read fails for an exec too, and the card says "could not be
 * read — a failure, not a restriction" rather than "no record". Exposing `crm`
 * is a Supabase project setting, not a migration, and is out of this ticket's
 * boundary; the code below is correct the day it is turned on.
 *
 * Returns `undefined` for a FAILED read and `null` for "no such row". Those are
 * different sentences on the page and must not collapse into one here.
 */
async function fetchMasterRecord(
  supabase: SupabaseTyped,
  customerNumber: string,
): Promise<CustomerMasterRecord | null | undefined> {
  try {
    const lexware = await fetchAllPaged<LexwareRow>((from, to) =>
      crmSchema(supabase)
        .from("lexware_customer")
        .select(
          "customer_number, legal_entity_id, display_name_source, billing_name, billing_street, " +
            "billing_house_number, billing_postal_code, billing_city, vat_id_source, lifecycle_status, review_status",
        )
        .eq("customer_number", customerNumber)
        .order("customer_number")
        .range(from, to),
    );
    const row = lexware.rows[0] ?? null;
    if (!row) return null;

    let entity: LegalEntityRow | null = null;
    let locations: string[] = [];
    let aliases: string[] = [];
    if (row.legal_entity_id) {
      const entityId = row.legal_entity_id;
      const entities = await fetchAllPaged<LegalEntityRow>((from, to) =>
        crmSchema(supabase)
          .from("legal_entity")
          .select("id, legal_name, legal_form, vat_id, country_code, lifecycle_status, review_status")
          .eq("id", entityId)
          .order("id")
          .range(from, to),
      );
      entity = entities.rows[0] ?? null;

      const locationRows = await fetchAllPaged<LocationRow>((from, to) =>
        crmSchema(supabase)
          .from("location")
          .select("legal_entity_id, location_name, street, postal_code, city")
          .eq("legal_entity_id", entityId)
          .order("id")
          .range(from, to),
      );
      locations = locationRows.rows
        .map((l) =>
          [textOrNull(l.location_name), textOrNull(l.street), [textOrNull(l.postal_code), textOrNull(l.city)].filter(Boolean).join(" ")]
            .filter(Boolean)
            .join(", "),
        )
        .filter((s) => s.length > 0);

      const aliasRows = await fetchAllPaged<AliasRow>((from, to) =>
        crmSchema(supabase)
          .from("legal_entity_alias")
          .select("legal_entity_id, alias_text")
          .eq("legal_entity_id", entityId)
          .order("id")
          .range(from, to),
      );
      aliases = [...new Set(aliasRows.rows.map((a) => textOrNull(a.alias_text)).filter((s): s is string => !!s))].sort();
    }

    const billingAddress =
      [
        [textOrNull(row.billing_street), textOrNull(row.billing_house_number)].filter(Boolean).join(" "),
        [textOrNull(row.billing_postal_code), textOrNull(row.billing_city)].filter(Boolean).join(" "),
      ]
        .filter((s) => s.length > 0)
        .join(", ") || null;

    return {
      displayNameSource: textOrNull(row.display_name_source),
      billingName: textOrNull(row.billing_name),
      billingAddress,
      // The Lexware import's own VAT column first, the entity's second: both are
      // usually empty (0 of 119 / 14 of 121 measured), and the em dash that
      // results is the actionable fact about how well the master is maintained.
      vatId: textOrNull(row.vat_id_source) ?? textOrNull(entity?.vat_id),
      legalName: textOrNull(entity?.legal_name),
      legalForm: textOrNull(entity?.legal_form),
      countryCode: textOrNull(entity?.country_code),
      lifecycleStatus: textOrNull(entity?.lifecycle_status) ?? textOrNull(row.lifecycle_status),
      reviewStatus: textOrNull(entity?.review_status) ?? textOrNull(row.review_status),
      locations,
      aliases,
    };
  } catch {
    // A FAILED read, not an absent record. The page says so in different words.
    return undefined;
  }
}

/** Does the caller hold `projects:read_all`, i.e. will /orders/[id] open? */
async function canOpenOrderDetail(supabase: SupabaseTyped): Promise<boolean> {
  try {
    const { data } = await anyClient(supabase).rpc("app_user_has_permission", {
      p_key: PERMISSIONS.PROJECTS_READ_ALL,
    });
    return data === true;
  } catch {
    // Fail closed: a link that lands on a refusal panel is worse than no link.
    return false;
  }
}

/* ------------------------------------------------------------ assembly */

/** Digits only, so "+49 30 1234" and "030/1234" are one phone number. */
function phoneKey(phone: string | null): string {
  return (phone ?? "").replace(/[^\d]/g, "");
}

/**
 * The 263 contact rows collapse to 121 distinct PEOPLE; within one customer, up
 * to 3 people are spread over up to 9 rows. Shown once each, with the orders
 * they are named on, so the same person is not listed nine times.
 */
function foldContacts(rows: ContactRow[], codeById: Map<string, string>): CustomerContact[] {
  const byPerson = new Map<string, CustomerContact>();
  for (const r of rows) {
    if (r.slot !== 1 && r.slot !== 2) continue;
    // Fold the sheet's "-" BEFORE the empty-slot test: unfolded, a "-" name is a
    // contact called "-" with a dead tel: link and a "mailto:-".
    const name = textOrNull(r.name);
    const phone = textOrNull(r.phone);
    const email = textOrNull(r.email);
    if (!name && !phone && !email) continue;
    const key = `${(name ?? "").toLowerCase()}|${(email ?? "").toLowerCase()}|${phoneKey(phone)}`;
    const code = codeById.get(r.project_id);
    const existing = byPerson.get(key);
    if (existing) {
      if (code && !existing.orderCodes.includes(code)) existing.orderCodes.push(code);
      continue;
    }
    byPerson.set(key, { name, phone, email, orderCodes: code ? [code] : [] });
  }
  const out = [...byPerson.values()];
  for (const c of out) c.orderCodes.sort();
  out.sort((a, b) => (a.name ?? "").localeCompare(b.name ?? "") || (a.email ?? "").localeCompare(b.email ?? ""));
  return out;
}

/**
 * Each DESTINATION once, keyed on the URL.
 *
 * Measured: 341 link rows carry only 340 distinct (project, kind) pairs, and 29
 * URLs are shared by several orders of one customer — so keying on (project,
 * kind) would render the same chat room up to nine times.
 */
function foldLinks(rows: LinkRow[], codeById: Map<string, string>): CustomerLink[] {
  const byUrl = new Map<string, CustomerLink>();
  for (const l of rows) {
    if (!l.project_id || !l.url || !l.kind) continue;
    // An unknown kind from the database is DROPPED rather than rendered: the
    // check constraint should make it impossible and a link with no name is
    // worse than no link.
    if (!(l.kind in LINK_LABEL)) continue;
    const kind = l.kind as MyLink["kind"];
    const code = codeById.get(l.project_id);
    const existing = byUrl.get(l.url);
    if (existing) {
      if (code && !existing.orderCodes.includes(code)) existing.orderCodes.push(code);
      // A label is better than none, whichever order carried it.
      existing.label = existing.label ?? textOrNull(l.label);
      continue;
    }
    byUrl.set(l.url, { kind, url: l.url, label: textOrNull(l.label), orderCodes: code ? [code] : [] });
  }
  const out = [...byUrl.values()];
  for (const l of out) l.orderCodes.sort();
  out.sort((a, b) => LINK_ORDER.indexOf(a.kind) - LINK_ORDER.indexOf(b.kind) || a.url.localeCompare(b.url));
  return out;
}

/**
 * One distinct postal address per block, with the orders delivered there.
 *
 * Addresses belong to ORDERS, not to the customer: 18 of 101 customers have
 * more than one distinct address across their orders, up to seven. There is
 * therefore no single "the address", and the header must not pretend there is.
 */
function foldLocations(rows: MasterdataRow[], codeById: Map<string, string>): CustomerLocation[] {
  const byKey = new Map<string, CustomerLocation>();
  for (const m of rows) {
    const street = textOrNull(m.street);
    const postalCode = textOrNull(m.postal_code);
    const city = textOrNull(m.city);
    const key = `${(street ?? "").toLowerCase()}|${postalCode ?? ""}|${(city ?? "").toLowerCase()}`;
    const code = codeById.get(m.project_id);
    const existing = byKey.get(key);
    if (existing) {
      if (code && !existing.orderCodes.includes(code)) existing.orderCodes.push(code);
      continue;
    }
    byKey.set(key, { street, postalCode, city, orderCodes: code ? [code] : [] });
  }
  const out = [...byKey.values()];
  for (const l of out) l.orderCodes.sort();
  out.sort((a, b) => b.orderCodes.length - a.orderCodes.length || (a.postalCode ?? "").localeCompare(b.postalCode ?? ""));
  return out;
}

/**
 * Who looks after this customer: one block per distinct colleague and rung.
 *
 * `doctor` and `other` are the sheet's sentinels for "no colleague named" (the
 * external occupational physician, say). They carry no person id, so they are
 * folded per KIND rather than per person, and they are not a missing person.
 */
function foldCare(
  rows: MasterdataRow[],
  nameById: Map<string, string>,
  codeById: Map<string, string>,
): CustomerCarer[] {
  const byKey = new Map<string, CustomerCarer>();
  const add = (
    role: "responsible" | "replacement",
    kind: PersonKind | null,
    personId: string | null,
    serviceRole: string | null,
    projectId: string,
  ) => {
    if (kind === null) return;
    const id = kind === "person" ? personId : null;
    if (kind === "person" && !id) return;
    const key = `${role}|${kind}|${id ?? ""}`;
    const code = codeById.get(projectId);
    const existing = byKey.get(key);
    if (existing) {
      if (code && !existing.orderCodes.includes(code)) existing.orderCodes.push(code);
      existing.serviceRole = existing.serviceRole ?? serviceRole;
      return;
    }
    byKey.set(key, {
      personId: id,
      name: id ? (nameById.get(id) ?? null) : null,
      kind,
      role,
      serviceRole,
      orderCodes: code ? [code] : [],
    });
  };
  for (const m of rows) {
    const serviceRole = textOrNull(m.service_role);
    add("responsible", kindOrNull(m.responsible_kind), m.responsible_person_id, serviceRole, m.project_id);
    add("replacement", kindOrNull(m.replacement_kind), m.replacement_person_id, serviceRole, m.project_id);
  }
  const out = [...byKey.values()];
  for (const c of out) c.orderCodes.sort();
  out.sort(
    (a, b) =>
      (a.role === b.role ? 0 : a.role === "responsible" ? -1 : 1) ||
      b.orderCodes.length - a.orderCodes.length ||
      (a.name ?? "").localeCompare(b.name ?? ""),
  );
  return out;
}

/** Distinct, sorted, blanks folded away. */
function distinctText(values: (string | null | undefined)[]): string[] {
  return [...new Set(values.map((v) => textOrNull(v)).filter((v): v is string => !!v))].sort();
}

/** The shape returned when there is nothing to show, for whatever reason. */
function emptyProfile(
  customerNumber: string,
  isExec: boolean,
  budgetsWithheld: boolean,
  masterState: MasterRecordState,
  loadFailed: boolean,
): CustomerProfile {
  return {
    customerNumber,
    displayName: null,
    legalNames: [],
    spellings: [],
    corporateGroups: [],
    languages: [],
    isExec,
    budgetsWithheld,
    canOpenOrder: false,
    orders: [],
    figures: {
      orders: 0,
      runningContracts: 0,
      endedContracts: 0,
      unknownEnd: 0,
      lastContractEnd: null,
      historicalOrders: 0,
      // No orders means no contracted hours to sum, and that is an ABSENCE,
      // not a zero — the same rule the tiles apply to a partial roster.
      contractHours: null,
      contractHoursOrders: 0,
      loggedHours: null,
      loggedMeasuredOrders: 0,
      loggedHoursAsOf: null,
      ordersWithoutResponsible: 0,
    },
    locations: [],
    contacts: [],
    contactsUnavailable: false,
    care: [],
    links: [],
    linksUnavailable: false,
    fileStorages: [],
    master: null,
    masterState,
    siblingUnnumberedOrders: 0,
    siblingCustomerNumbers: [],
    lastSeenAt: null,
    loadFailed,
    truncated: false,
  };
}

/* ---------------------------------------------------------- entry point */

/**
 * Everything the customer profile renders, for the CURRENTLY SIGNED-IN reader.
 *
 * `isExec` is passed in rather than re-read: `requireProfile()` has already
 * resolved the role for this render, and asking again would be a second round
 * trip for an answer that cannot change mid-request. It only decides whether
 * the crm section is ATTEMPTED — the exec-only RLS policy is the enforcement,
 * not this flag.
 */
export async function getCustomerProfile(
  supabase: SupabaseTyped,
  customerNumber: string,
  { isExec }: { isExec: boolean },
): Promise<CustomerProfile> {
  // Belt and braces behind the route guard. A caller that reached here with a
  // non-key must not turn it into a PostgREST filter.
  if (!CUSTOMER_NUMBER_PATTERN.test(customerNumber)) {
    return emptyProfile(customerNumber, isExec, false, isExec ? "none" : "withheld", false);
  }

  // Asked in the same round as the reads they govern, not after them.
  const [canSeeBudgets, canOpenOrder] = await Promise.all([
    canReadBudgets(supabase),
    canOpenOrderDetail(supabase),
  ]);
  const budgetsWithheld = !canSeeBudgets;

  // The crm read does not depend on the roster and is started alongside it, so
  // an exec pays one round trip rather than two. Withheld for everybody else —
  // and never attempted, so there is nothing to leak through a caught error.
  const masterPromise: Promise<CustomerMasterRecord | null | undefined> = isExec
    ? fetchMasterRecord(supabase, customerNumber)
    : Promise.resolve(null);

  let roster: { rows: MasterdataRow[]; truncated: boolean };
  let projects: { rows: ProjectRow[]; truncated: boolean };
  try {
    roster = await fetchRoster(supabase, customerNumber);
    projects = await fetchRosterProjects(
      supabase,
      roster.rows.map((r) => r.project_id),
      canSeeBudgets,
    );
  } catch {
    /*
     * A FAILED READ IS NOT AN EMPTY CUSTOMER. Rendering an empty list here would
     * tell a reader with nine orders that they may see none of them, confidently
     * and wrongly — the same class of lie /my-work shipped once. The crm promise
     * is still awaited so it cannot become an unhandled rejection.
     */
    const master = await masterPromise;
    return emptyProfile(
      customerNumber,
      isExec,
      budgetsWithheld,
      !isExec ? "withheld" : master === undefined ? "unavailable" : master === null ? "none" : "present",
      true,
    );
  }

  const projectById = new Map(projects.rows.map((p) => [p.id, p]));
  // A masterdata row whose project RLS hides is dropped rather than rendered as
  // a row with no code: the two tables carry the same policy, so this can only
  // happen if they disagree, and a half-row is worse than none.
  const rosterRows = roster.rows.filter((m) => projectById.has(m.project_id));
  const projectIds = rosterRows.map((m) => m.project_id);
  const codeById = new Map(
    rosterRows.map((m) => [m.project_id, projectById.get(m.project_id)?.code ?? m.project_id]),
  );

  const personIds = [
    ...new Set(
      rosterRows
        .flatMap((m) => [
          m.responsible_kind === "person" ? m.responsible_person_id : null,
          m.replacement_kind === "person" ? m.replacement_person_id : null,
        ])
        .filter((id): id is string => !!id),
    ),
  ];
  const entityIds = [
    ...new Set(
      projects.rows.map((p) => p.customer_legal_entity_id).filter((id): id is string => !!id),
    ),
  ];

  // Five independent reads in one round. None depends on another, and awaiting
  // them in turn would serialise five RLS-evaluated queries for no reason.
  const [contacts, links, responsibilities, personNames, siblings, master] = await Promise.all([
    fetchByProjectIds<ContactRow>(supabase, "project_contact", "project_id, slot, name, phone, email", projectIds, ["project_id", "slot"]),
    fetchByProjectIds<LinkRow>(supabase, "project_link", "project_id, kind, url, label", projectIds, ["project_id", "kind"]),
    fetchByProjectIds<ResponsibilityRow>(supabase, "project_responsibility", "project_id, person_id, role", projectIds, ["project_id", "person_id"]),
    fetchPersonNames(supabase, personIds),
    fetchSiblings(supabase, entityIds, new Set(projectIds), customerNumber),
    masterPromise,
  ]);

  const nameById = new Map<string, string>();
  for (const p of personNames.rows) if (p.id && p.name) nameById.set(p.id, p.name);

  const today = todayInBerlin();

  const orders: CustomerOrder[] = rosterRows.flatMap((m) => {
    const p = projectById.get(m.project_id);
    // Unreachable: rosterRows was filtered on this very map a few lines above.
    // Written as a guard rather than a `!` so a future edit to that filter
    // cannot turn a dropped row into a crash on every render of the page.
    if (!p) return [];
    const contractEnd = textOrNull(m.contract_end);
    const responsibleKind = kindOrNull(m.responsible_kind);
    const replacementKind = kindOrNull(m.replacement_kind);
    const nameFor = (kind: PersonKind | null, id: string | null) =>
      kind === "person" && id ? (nameById.get(id) ?? null) : null;
    return {
      id: p.id,
      code: p.code ?? m.project_id,
      name: p.name ?? m.project_id,
      serviceNumber: numOrNull(m.service_number),
      serviceName: textOrNull(m.service_name),
      subprojectNumber: numOrNull(m.subproject_number),
      contractStart: textOrNull(m.contract_start),
      contractEnd,
      /*
       * Decided on the SERVER against the Berlin date. Deriving it inside the
       * table component would compare against the viewer's clock, so two
       * colleagues in two zones could read the same contract as running and
       * ended — and the server render and the client render could disagree
       * with each other on one machine.
       */
      termState: contractEnd === null ? "unknownEnd" : contractEnd < today ? "ended" : "running",
      // Redacted at the single point where the column becomes a field, so no
      // downstream sum, CSV column or component can reconstruct it.
      contractHours: canSeeBudgets ? budgetOrNull(p.contract_hours) : null,
      loggedHours: numOrNull(p.logged_hours),
      lifecycleStatus: m.lifecycle_status === "historical" ? "historical" : "active",
      responsibleKind,
      responsibleName: nameFor(responsibleKind, m.responsible_person_id),
      replacementKind,
      replacementName: nameFor(replacementKind, m.replacement_person_id),
      serviceRole: textOrNull(m.service_role),
    };
  });

  /*
   * Sorted the way the table opens: furthest-future contract end first, ended
   * contracts after it, orders with no end date pinned last. One rule a header
   * tooltip can state in a sentence — and a sort a reader cannot predict is a
   * sort they stop trusting.
   */
  orders.sort((a, b) => {
    if ((a.contractEnd === null) !== (b.contractEnd === null)) return a.contractEnd === null ? 1 : -1;
    if (a.contractEnd !== b.contractEnd) return (b.contractEnd ?? "").localeCompare(a.contractEnd ?? "");
    return a.code.localeCompare(b.code);
  });

  const responsibleProjectIds = new Set(
    responsibilities.rows.filter((r) => r.role === "responsible").map((r) => r.project_id),
  );

  const measured = orders.filter((o) => o.loggedHours !== null);
  const budgeted = orders.filter((o) => o.contractHours !== null);
  const contractSum = budgeted.reduce((s, o) => s + (o.contractHours ?? 0), 0);

  const figures: CustomerFigures = {
    orders: orders.length,
    runningContracts: orders.filter((o) => o.termState === "running").length,
    endedContracts: orders.filter((o) => o.termState === "ended").length,
    unknownEnd: orders.filter((o) => o.termState === "unknownEnd").length,
    lastContractEnd: orders.reduce<string | null>(
      (best, o) => (o.contractEnd !== null && (best === null || o.contractEnd > best) ? o.contractEnd : best),
      null,
    ),
    historicalOrders: orders.filter((o) => o.lifecycleStatus === "historical").length,
    // Null, never 0, when nothing is budgeted: "nobody recorded contracted
    // hours" is a real state on 11 orders and 2 whole accounts.
    contractHours: budgeted.length === 0 ? null : round1(contractSum),
    contractHoursOrders: budgeted.length,
    // Null, never 0, when NOT ONE order is measured. One live account holds 6
    // orders and 250 contracted hours with 0 of 6 measured; "0 h logged" there
    // reads as a customer we abandoned, and the truth is an unlinked order.
    loggedHours: measured.length === 0 ? null : round1(measured.reduce((s, o) => s + (o.loggedHours ?? 0), 0)),
    loggedMeasuredOrders: measured.length,
    loggedHoursAsOf: projects.rows.reduce<string | null>(
      (best, p) => (p.logged_hours_as_of && (best === null || p.logged_hours_as_of > best) ? p.logged_hours_as_of : best),
      null,
    ),
    /*
     * ABSENT, NOT RECOMPUTED, WHEN THE ROLE TABLE COULD NOT BE READ.
     *
     * `responsibleProjectIds` over a failed read is empty, and this filter over
     * an empty set returns EVERY order — which the Betreuung card renders as
     * "nobody is named responsible on any of these orders", printed directly
     * beneath the carers it has just listed by name. A count is only meaningful
     * when the rows behind it were actually read.
     */
    ordersWithoutResponsible: responsibilities.failed
      ? null
      : orders.filter((o) => !responsibleProjectIds.has(o.id)).length,
  };

  /*
   * The display name. The sheet's own display field, most-used spelling first
   * and alphabetical to break a tie, so the heading is deterministic instead of
   * depending on which page a row arrived in. 10 customers carry more than one
   * spelling; the rest are collected as `spellings` and stated on the card,
   * because a merge nobody can see is a customer count nobody can reconcile.
   */
  const displayCounts = new Map<string, number>();
  for (const m of rosterRows) {
    const name = textOrNull(m.customer_display_name);
    if (name) displayCounts.set(name, (displayCounts.get(name) ?? 0) + 1);
  }
  const ranked = [...displayCounts.entries()].map(([name, n]) => ({ name, orders: n })).sort(byCountThenName);
  const displayName =
    ranked[0]?.name ?? distinctText(projects.rows.map((p) => p.customer))[0] ?? null;
  const legalNames = distinctText(rosterRows.map((m) => m.customer_name));

  return {
    customerNumber,
    displayName,
    // Only the ones that say something the display name does not: the same
    // string twice is furniture, and MyWorkDetail makes the same call.
    legalNames: legalNames.filter((n) => n !== displayName),
    spellings: ranked.slice(1).map((r) => r.name),
    corporateGroups: distinctText(rosterRows.map((m) => m.corporate_group)),
    languages: [
      ...new Set(
        rosterRows
          .map((m) => (m.language === 1 ? "de" : m.language === 2 ? "en" : null))
          .filter((l): l is "de" | "en" => l !== null),
      ),
    ].sort(),
    isExec,
    budgetsWithheld,
    canOpenOrder,
    orders,
    figures,
    locations: foldLocations(rosterRows, codeById),
    contacts: foldContacts(contacts.rows, codeById),
    contactsUnavailable: contacts.failed,
    care: foldCare(rosterRows, nameById, codeById),
    links: foldLinks(links.rows, codeById),
    linksUnavailable: links.failed,
    fileStorages: distinctText(rosterRows.map((m) => m.file_storage)),
    master: master ?? null,
    /*
     * Four states, four sentences. `withheld` is about the READER; `unavailable`
     * is a failure; `none` is an absence; `present` is a record. Collapsing any
     * two of them would let a reader conclude something the page cannot know —
     * which, for a non-exec, includes whether the record exists at all.
     */
    masterState: !isExec ? "withheld" : master === undefined ? "unavailable" : master === null ? "none" : "present",
    siblingUnnumberedOrders: siblings.unnumbered,
    siblingCustomerNumbers: siblings.numbers,
    lastSeenAt: rosterRows.reduce<string | null>(
      (best, m) => (m.last_seen_at && (best === null || m.last_seen_at > best) ? m.last_seen_at : best),
      null,
    ),
    loadFailed: false,
    /*
     * EVERY degraded read, not only the two that page. A read cut short and a
     * read lost outright are the same fact to a reader — "part of the data
     * could not be read in full; the figures are floors" — and the earlier
     * expression named four of the ten, so a failed side table left the footnote
     * silent while its own section quietly claimed an absence.
     */
    truncated:
      roster.truncated ||
      projects.truncated ||
      contacts.truncated ||
      contacts.failed ||
      links.truncated ||
      links.failed ||
      responsibilities.truncated ||
      responsibilities.failed ||
      siblings.truncated ||
      siblings.failed,
  };
}
