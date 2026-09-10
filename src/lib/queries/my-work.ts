/**
 * "My Work" — the operations view: the customers and projects that belong to
 * the person who is signed in, and nobody else's.
 *
 * WHY A NEW FILE RATHER THAN EXTENDING projects-live.ts
 * ----------------------------------------------------
 * `projects-live.ts` reads `time.project` — the 334 projects imported from
 * TrackingTime, keyed by bigint, and it answers a PORTFOLIO question ("how is
 * every project burning down"). This module reads `public.projects` and
 * `public.person_assignments`, keyed by text ids (`md-mathias`, `prj-…`),
 * because those are the two tables that record WHO a project belongs to:
 * `projects.owner_person_id` and `person_assignments.person_id`. `time.project`
 * carries no person link at all, so the portfolio module physically cannot
 * answer "mine". They are different tables answering different questions and
 * overloading one accessor would make every call site ask "which projects?".
 *
 * IDENTITY COMES FROM THE SESSION, NEVER AN ARGUMENT
 * --------------------------------------------------
 * `getMyWork()` takes no person id. It resolves the caller through
 * `auth.getUser()` → `app_user_profile.person_id`, the same path
 * `getCurrentProfile()` uses. A `personId` parameter would be an invitation for
 * a call site to pass someone else's, and the page would then render another
 * person's book of work with no error — the exact failure this module exists to
 * make impossible. RLS would still gate the ROWS, but the framing ("your
 * customers") would be a lie.
 *
 * RLS DOES THE SCOPING, THIS MODULE DOES THE ATTRIBUTION
 * -----------------------------------------------------
 * Every read here goes through the normal server client, so `can_view_project()`
 * decides what comes back. This module never widens that: it only labels what
 * survives as OWNED or ASSIGNED. Measured on live data, Mathias
 * (`md-mathias`, OPERATIONS) sees 54 projects across 43 customers, owns 6 of
 * them, and is assigned to all 54 — so "owner" and "assigned" are emphatically
 * not the same set, and a view that showed only one number would misdescribe
 * his job.
 *
 * TWO SOURCES, ONE UNION, NO DOUBLE COUNTING
 * ------------------------------------------
 * A project can reach you as owner, as assignee, or both. The union is keyed on
 * `project.id`, so the 6 Mathias both owns and is assigned to appear ONCE, with
 * role "owner" — ownership is the stronger claim and the one he is accountable
 * for. Summing the two lists instead would report 60 projects for a person who
 * has 54.
 *
 * HONEST NULLS, AS EVERYWHERE ELSE
 * --------------------------------
 * `contract_hours` of 0 means "nobody set a budget", not "a zero budget", so
 * `consumedPercent` is null rather than 0 in that case. Rendering 0% would sort
 * an unbudgeted project alongside an untouched one and bury the overruns — the
 * same rule projects-live.ts applies to `burnPercent`.
 *
 * NO AGGREGATES OVER PostgREST
 * ----------------------------
 * `db-aggregates-enabled` is off on this project, so `logged_hours.sum()` is
 * rejected outright. Every total below is summed in TypeScript over fetched
 * rows, and every paged read calls `.order()` before `.range()` so the pages
 * are a stable partition rather than an arbitrary one.
 */
import type { SupabaseTyped } from "./types";
import { fetchAllPaged, PAGE } from "./paged";
import { canReadBudgets } from "@/lib/budget-visibility";
import { getSignedInUser } from "./request-cache";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const timeSchema = (s: SupabaseTyped) => (s as any).schema("time");

/* --------------------------------------------------------------- shapes */

/**
 * How this project reached you, strongest claim first.
 *
 * FOUR LEVELS, NOT TWO. The original pair (owner/assigned) came from
 * `projects.owner_person_id` and `person_assignments`. The masterdata import
 * added `public.project_responsibility`, which records the answer to "who looks
 * after this customer" straight from the Excel workbook the business actually
 * runs on: 148 `responsible` rows and 140 `replacement` rows over 149 projects.
 *
 * That distinction is the whole job. Measured for md-mathias:
 *
 *     responsible    4 projects   (named lead in the masterdata)
 *     owner          6 projects   (projects.owner_person_id — includes all 4)
 *     replacement   36 projects   (named cover, zero overlap with ownership)
 *     assigned      54 projects   (on the assignment list)
 *
 * Being the named REPLACEMENT on 36 projects is a completely different
 * obligation from being responsible for 4, and flattening both into "assigned"
 * — as this module did before the masterdata landed — describes a person with
 * 4 real customers as one with 43 equal ones.
 *
 * The ladder is strict: a project resolves to exactly ONE level, the strongest
 * that applies, so the four counts partition the list and always sum to the
 * total.
 */
export type MyRole = "responsible" | "owner" | "replacement" | "assigned";

/** Strongest first. Used for both resolution and sort order. */
export const ROLE_ORDER: MyRole[] = ["responsible", "owner", "replacement", "assigned"];

/** Human labels, kept beside the type so the UI cannot invent its own. */
export const ROLE_LABEL: Record<MyRole, string> = {
  responsible: "RESPONSIBLE",
  owner: "OWNER",
  replacement: "REPLACEMENT",
  assigned: "ASSIGNED",
};

export type MyProject = {
  id: string;
  code: string;
  name: string;
  /**
   * Display name for the customer.
   *
   * The canonical `crm.legal_entity.legal_name` when the project is linked
   * (228 of 231 live rows), else the free-text `projects.customer`.
   */
  customer: string;
  /**
   * The free-text `projects.customer` exactly as stored on this project.
   *
   * Kept ALONGSIDE the canonical name rather than replaced by it. Without it
   * the alias list on a merged group has nothing to collect — every row would
   * report the same canonical name and the merge would be invisible, which is
   * precisely the silent fold PRODUCT.md's identity map is meant to make
   * auditable.
   */
  customerText: string;
  /**
   * Canonical customer identity, or null for the 3 unlinked projects.
   * PRODUCT.md requires joins through the identity map rather than on the
   * free-text string; this is that key.
   */
  customerEntityId: string | null;
  status: string;
  /** The single strongest claim you have on this project. */
  role: MyRole;
  /** True when you are also on the assignment list, whatever your role. */
  isAssigned: boolean;
  /** True when `projects.owner_person_id` is you. */
  isOwner: boolean;
  /** True when the masterdata names you the responsible lead. */
  isResponsible: boolean;
  /** True when the masterdata names you the replacement/cover. */
  isReplacement: boolean;
  /** Order number from the masterdata responsibility row, when there is one. */
  orderNo: string | null;
  /** Contracted hours, or null when nobody set a budget (stored as 0). */
  contractHours: number | null;
  /** Hours logged against the project by EVERYONE, from public.projects. */
  loggedHours: number | null;
  /** Hours YOUR assignment row carries, or null when you are not assigned. */
  myLoggedHours: number | null;
  /** Your share of the project per the assignment row, 0-100, or null. */
  mySharePercent: number | null;
  /** Logged over contracted, or null with no budget to burn against. */
  consumedPercent: number | null;
  dueDate: string | null;
  /**
   * Service tags from TrackingTime (`time.project.service_id`), NOT a
   * contractual "agreed services" list -- `crm.framework_agreement`, the table
   * shaped for that, is empty. Deduped: 4 of Mathias's 54 projects carry two
   * `time.project` rows, so this is a set, never a 1:1 value. Empty when the
   * project has no `time.project` row at all (9 of his 54) -- render "n/a",
   * never blank and never a guess.
   */
  services: string[];
  /**
   * Working links for this project -- the chat room, board or folder the team
   * actually opens. Imported from the masterdata workbook into
   * `public.project_link`, which is visible exactly when the project is.
   *
   * Usually EMPTY, and that is not a gap: measured on the 2026 workbook, only
   * 178 order numbers carry any link at all, and most carry one or two. An
   * absent link means nobody recorded one, which the UI shows by rendering
   * nothing -- unlike an unmeasured HOUR, there is no figure being withheld, so
   * "n/a" would overstate the case.
   */
  links: MyLink[];
  /**
   * The masterdata sheet's facts about this order -- the 27 magenta columns
   * hitul confirmed on 2026-09-10 as what an operations person sees for a
   * service (HSEHU-64) -- or null when the sheet has no row for it yet.
   *
   * Read from `public.project_masterdata`, a 1:1 table under the same
   * `can_view_project()` policy as the project itself, so it cannot widen what
   * the page shows. Rendered ONLY in the detail panel for the one selected row,
   * never as a table column: the projects table clears 1280px by a few pixels
   * and every one of these fields would cost a column.
   *
   * Contract hours are deliberately NOT here. They stay on `contractHours`
   * above, where the budget redaction already applies; a second copy on this
   * object would be a second place to forget it.
   */
  detail: MyProjectDetail | null;
  /**
   * The customer's two contact persons for this order, from
   * `public.project_contact`. Personal data of third parties: shown for the one
   * selected row, never in a list column, never in the CSV export -- every
   * `Column.csv` on the tables omits them, and check-my-work-detail.mjs pins it.
   */
  contacts: MyContact[];
};

/**
 * What the sheet knows about one service order, in the reader's terms.
 *
 * HONEST NULLS THROUGHOUT. The sheet writes "-" for "not applicable" and the
 * importer already turns that into null (scripts/lib/masterdata-sheet.mjs); a
 * null here is rendered as an absence, never as 0, "Nein" or an empty string.
 */
export type MyProjectDetail = {
  /** The name the sheet displays for the customer (Kunde Anzeigename). */
  customerDisplayName: string | null;
  /** The customer's legal name as written in the sheet. */
  customerName: string | null;
  /** 1 = Deutsch, 2 = English in the sheet; mapped here so the UI never sees a digit. */
  language: "de" | "en" | null;
  street: string | null;
  postalCode: string | null;
  city: string | null;
  /** ISO date (YYYY-MM-DD) or null. */
  contractStart: string | null;
  /** ISO date (YYYY-MM-DD) or null. Liveness is THIS, not the sheet's status column. */
  contractEnd: string | null;
  /** The named lead's name, resolved through org_chart_nodes; null when unknown or not a person. */
  responsibleName: string | null;
  /** 'person' when a colleague; 'doctor' (the company doctor) or 'other' when the sheet names no person. */
  responsibleKind: PersonKind | null;
  replacementName: string | null;
  replacementKind: PersonKind | null;
  /** The role the responsible person holds on this service (e.g. Fachkraft für Arbeitssicherheit). */
  serviceRole: string | null;
  /** Free text from the sheet ("2 Std.", "halber Tag"); never parsed into a number. */
  minOnsiteTime: string | null;
  /** Ja/Nein as a boolean; anything else the sheet wrote is kept in the text field. */
  travelFlatRate: boolean | null;
  travelFlatRateText: string | null;
  travelAsProjectTime: boolean | null;
  travelAsProjectTimeText: string | null;
  /** Where the files live, as text (the sheet's Dateiablage column). */
  fileStorage: string | null;
  /**
   * 'historical' when the last batch no longer carried this row (decision
   * 2026-09-10: never delete, mark). The panel shows a banner and says whether
   * the contract ended or the row simply vanished from the sheet.
   */
  lifecycleStatus: "active" | "historical";
  /** The sheet's own modified time of the batch that last carried this row. */
  lastSeenAt: string | null;
};

export type PersonKind = "person" | "doctor" | "other";

/** One customer contact person on an order. Slot 1 and 2 are the sheet's two columns. */
export type MyContact = {
  slot: 1 | 2;
  name: string | null;
  phone: string | null;
  email: string | null;
};

/** One outbound working link on a project. */
export type MyLink = {
  kind: "asana" | "google_chat" | "google_drive" | "microsoft_teams" | "trackingtime";
  url: string;
  label: string | null;
};

/** Short chip labels, kept beside the type so the UI cannot invent its own. */
export const LINK_LABEL: Record<MyLink["kind"], string> = {
  asana: "ASANA",
  google_chat: "CHAT",
  google_drive: "DRIVE",
  microsoft_teams: "TEAMS",
  trackingtime: "TT",
};

/**
 * The destination said in full, for the accessible name and the tooltip.
 *
 * The column renders icons, so "ASANA" is no longer a visible label -- it is
 * only ever spoken or hovered, and in that setting a four-letter code is worse
 * than the thing it stands for. "TT" in particular is unreadable aloud.
 *
 * It lives here rather than in the component for the same reason LINK_LABEL
 * does: one map, so the table, the CSV and the screen reader cannot disagree
 * about what a `kind` is called.
 */
export const LINK_DESTINATION: Record<MyLink["kind"], string> = {
  asana: "Asana board",
  google_chat: "Google Chat room",
  google_drive: "Google Drive folder",
  microsoft_teams: "Microsoft Teams link",
  trackingtime: "TrackingTime project",
};

/** Stable display order, so a row's chips do not reshuffle between requests. */
export const LINK_ORDER: MyLink["kind"][] = [
  "google_chat",
  "microsoft_teams",
  "asana",
  "trackingtime",
  "google_drive",
];

export type MyCustomer = {
  /** Canonical entity id, or null when only the text name is known. */
  entityId: string | null;
  customer: string;
  /**
   * The free-text spellings folded into this entity, when more than one.
   * Three of Mathias's customers merge two spellings each ("GEPLAHN-T" and
   * "GEPLAHN-T GmbH"; "Mirantis Inc." and "Mirantis Germany GmbH"; "RISE FX
   * GmbH" and "RISE FX GmbH Berlin"). The page shows them so the merge is
   * visible rather than a silently smaller count.
   */
  aliases: string[];
  projectCount: number;
  /** Per-role project counts. These partition `projectCount` exactly. */
  roleCounts: Record<MyRole, number>;
  /** The strongest claim held on any project for this customer. */
  topRole: MyRole;
  /**
   * Sum of contract hours across your projects for this customer, or null when
   * the caller may not see budgets. NOT 0 in that case: 0 is a real, common and
   * different state here ("nobody set a budget"), so a withheld sum that came
   * back as 0 would be indistinguishable from an unbudgeted customer.
   */
  contractHours: number | null;
  /** Sum of logged hours across your projects for this customer. */
  loggedHours: number;
  /*
   * How many of `projectCount` actually have measured hours.
   *
   * DESIGN.md rule 7: a total that omits rows states its coverage, or the reader
   * stops trusting every other number on the page. `loggedHours` sums with
   * `?? 0`, so once migration 20260826120000 nulls the 54 unmeasured orders a
   * bare total silently becomes a FLOOR. "80h over 2 of 4 projects" is honest;
   * "80h" alone invites the reader to divide by the full contract and conclude a
   * 40% burn that nobody measured.
   */
  measuredProjectCount: number;
  /** Sum of the hours YOUR assignment rows carry for this customer. */
  myLoggedHours: number;
  /** Distinct union of `services` across this customer's projects. */
  services: string[];
  projects: MyProject[];
};

export type MyWork = {
  /**
   * True when project budgets were withheld from this caller.
   *
   * /my-work has no permission gate beyond a session, so every role reaches it,
   * including the three that lost projects:contracts:read on 2026-09-03. Every
   * contractHours and consumedPercent below is null for such a caller, and the
   * table already renders null as "no budget" -- a sentence about the project
   * rather than about the reader, and a false one. The UI reads this flag to
   * say "withheld" instead, and the CSV export omits the columns rather than
   * exporting blanks that would be read as zeroes in a spreadsheet.
   */
  budgetsWithheld: boolean;
  /** The person this book of work belongs to — null when the account is unlinked. */
  personId: string | null;
  personName: string | null;
  customers: MyCustomer[];
  projects: MyProject[];
  totals: {
    customers: number;
    projects: number;
    /** Per-role project counts; these partition `projects` exactly. */
    roleCounts: Record<MyRole, number>;
    /**
     * Customers where you hold the strongest claim (responsible or owner).
     * This is the number an operations person means by "my customers".
     */
    customersLed: number;
    /** Null when budgets are withheld from the caller -- never 0. */
    contractHours: number | null;
    loggedHours: number;
    myLoggedHours: number;
    /** How many of `projects` have measured hours. See MyCustomer above. */
    measuredProjectCount: number;
    /**
     * How many of `projects` resolve at least one TrackingTime service tag.
     * Stated the same way as `measuredProjectCount`: a coverage number beside
     * the service chips, so partial coverage reads as "known for 45 of 54"
     * rather than letting the 9 uncovered projects pass as "no services".
     */
    serviceCoverage: { known: number; total: number };
  };
  /**
   * Set when the signed-in account has no `person_id` on its profile. 11 of the
   * 20 provisioned accounts are in that state, and they must be told that
   * rather than shown an empty list that reads as "you have no work".
   */
  unlinked: boolean;
  /**
   * True when this person has projects but their assignment rows carry
   * essentially no hours.
   *
   * Measured on live data: Mathias's 54 assignment rows sum to ONE hour, while
   * the same projects carry thousands of team hours. `person_assignments`
   * .logged_hours was never backfilled from the time data. The page states that
   * rather than rendering "1h" beside "4,000h" and letting someone conclude he
   * did nothing all year — a plausible wrong number is worse than a stated gap.
   */
  myHoursUnpopulated: boolean;
  /**
   * Set when a read FAILED, as distinct from returning nothing.
   *
   * These are not the same fact and must never render the same way. During
   * development the project read errored (PostgREST could not resolve an embed)
   * and the catch below turned that into an empty list — so a person with 54
   * projects was shown "no projects are assigned to you", confidently and
   * wrongly. A failure now says so.
   */
  loadFailed: boolean;
  /** True when a read hit the safety ceiling and the totals may understate. */
  truncated: boolean;
};

/* ------------------------------------------------------------- helpers */

function numOrNull(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** A stored 0 contract means "no budget set", which is not the same as zero. */
function budgetOrNull(v: unknown): number | null {
  const n = numOrNull(v);
  return n !== null && n > 0 ? n : null;
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

/**
 * `projects.due` is a TEXT column and 44 of 231 live rows store the literal
 * string "n/a". Passing that through to a date formatter yields "Invalid Date";
 * passing it through as-is prints "n/a" twice once the UI adds its own. Null
 * here means "no due date recorded" and the UI renders the absence once.
 */
function dueOrNull(v: string | null): string | null {
  if (!v) return null;
  const trimmed = v.trim();
  if (trimmed === "" || /^n\/?a$/i.test(trimmed)) return null;
  return trimmed;
}

/** Only the three values the CHECK constraint admits; anything else is treated as unknown. */
function kindOrNull(v: string | null | undefined): PersonKind | null {
  return v === "person" || v === "doctor" || v === "other" ? v : null;
}

/** Text with the sheet's blanks and "-" folded to null. The importer does this already; belt and braces. */
function textOrNull(v: string | null | undefined): string | null {
  if (v === null || v === undefined) return null;
  const t = v.trim();
  return t === "" || t === "-" ? null : t;
}

/**
 * The sheet row in the reader's terms, or null when there is no row.
 *
 * Names are resolved through the id -> name map from org_chart_nodes ONLY when
 * the kind is 'person': the sheet's DOC and OTHER sentinels carry no person id
 * (scripts/lib/masterdata-sheet.mjs personSentinel), and a name looked up for
 * them would be a fixture accident. A person id with no name in the map yields
 * null, which the panel renders as "name not available" -- true, and different
 * from "nobody is responsible".
 */
function toDetail(
  m: MasterdataRowLite | null,
  nameById: Map<string, string>,
): MyProjectDetail | null {
  if (!m) return null;
  const responsibleKind = kindOrNull(m.responsible_kind);
  const replacementKind = kindOrNull(m.replacement_kind);
  const nameFor = (kind: PersonKind | null, id: string | null) =>
    kind === "person" && id ? (nameById.get(id) ?? null) : null;
  return {
    customerDisplayName: textOrNull(m.customer_display_name),
    customerName: textOrNull(m.customer_name),
    language: m.language === 1 ? "de" : m.language === 2 ? "en" : null,
    street: textOrNull(m.street),
    postalCode: textOrNull(m.postal_code),
    city: textOrNull(m.city),
    contractStart: textOrNull(m.contract_start),
    contractEnd: textOrNull(m.contract_end),
    responsibleName: nameFor(responsibleKind, m.responsible_person_id),
    responsibleKind,
    replacementName: nameFor(replacementKind, m.replacement_person_id),
    replacementKind,
    serviceRole: textOrNull(m.service_role),
    minOnsiteTime: textOrNull(m.min_onsite_time),
    // A boolean is only ever true or false here; the sheet's free text ("nach
    // Absprache") lives in the *_text field and the boolean stays null.
    travelFlatRate: typeof m.travel_flat_rate === "boolean" ? m.travel_flat_rate : null,
    travelFlatRateText: textOrNull(m.travel_flat_rate_text),
    travelAsProjectTime:
      typeof m.travel_as_project_time === "boolean" ? m.travel_as_project_time : null,
    travelAsProjectTimeText: textOrNull(m.travel_as_project_time_text),
    fileStorage: textOrNull(m.file_storage),
    // Anything that is not the literal 'historical' is active: the column has
    // a CHECK to that effect, and an unexpected value must not raise a banner.
    lifecycleStatus: m.lifecycle_status === "historical" ? "historical" : "active",
    lastSeenAt: textOrNull(m.last_seen_at),
  };
}

type ProjectRowLite = {
  id: string;
  code: string | null;
  name: string | null;
  customer: string | null;
  status: string | null;
  contract_hours: number | null;
  logged_hours: number | null;
  owner_person_id: string | null;
  due: string | null;
  /** FK into crm.legal_entity. Null on the 3 live projects not yet mapped. */
  customer_legal_entity_id?: string | null;
  /**
   * Embedded canonical entity. NOT selected by the shipped reads (the embed
   * does not resolve — see PROJECT_COLUMNS), but kept on the type so the
   * assembly can consume it the day the schema cache and the RLS policy both
   * allow it, without another change here.
   */
  customer_legal_entity?: { id: string; legal_name: string | null } | null;
};

type AssignmentRowLite = {
  person_id: string;
  project_id: string | null;
  project_name: string | null;
  logged_hours: number | null;
  share_percent: number | null;
};

/** One row of public.project_responsibility, the masterdata answer. */
type ResponsibilityRowLite = {
  project_id: string;
  person_id: string;
  role: string | null;
  order_no: string | null;
};

/**
 * One row of time.project, read only for its service tag.
 *
 * `hub_project_id` is the FK back to `public.projects.id` (text), NOT
 * `time.project.id` (bigint) -- the join key this module already uses
 * everywhere else. `service` embeds as null when `service_id` is unset (159 of
 * 340 live `time.project` rows), which is why the fold below treats a missing
 * service as absence, never as an empty string.
 */
type ServiceRowLite = {
  hub_project_id: string | null;
  service: { name: string | null } | null;
};

/** One row of public.project_link. */
type LinkRowLite = {
  project_id: string | null;
  kind: string | null;
  url: string | null;
  label: string | null;
};

/**
 * One row of public.project_masterdata, the sheet's facts about an order.
 *
 * The COMMERCIAL columns the sheet also carries (planned / on-site / remote
 * hours) were deliberately not promoted into this table, and this select does
 * not ask for the one it does carry nothing of: contract hours stay on
 * `public.projects.contract_hours` under `canReadBudgets()`. So this read is
 * budget-blind by construction and needs no permission check.
 */
type MasterdataRowLite = {
  project_id: string;
  customer_display_name: string | null;
  customer_name: string | null;
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
  min_onsite_time: string | null;
  travel_flat_rate: boolean | null;
  travel_flat_rate_text: string | null;
  travel_as_project_time: boolean | null;
  travel_as_project_time_text: string | null;
  file_storage: string | null;
  lifecycle_status: string | null;
  last_seen_at: string | null;
};

/** One row of public.project_contact: a customer's contact person on an order. */
type ContactRowLite = {
  project_id: string;
  slot: number;
  name: string | null;
  phone: string | null;
  email: string | null;
};

/** One row of the org_chart_nodes view: identity only, which is all the panel needs. */
type PersonNameRowLite = {
  id: string;
  name: string | null;
};

const MASTERDATA_COLUMNS =
  "project_id, customer_display_name, customer_name, language, street, postal_code, city, " +
  "contract_start, contract_end, responsible_kind, replacement_kind, responsible_person_id, " +
  "replacement_person_id, service_role, min_onsite_time, travel_flat_rate, travel_flat_rate_text, " +
  "travel_as_project_time, travel_as_project_time_text, file_storage, lifecycle_status, last_seen_at";

/*
 * Canonical grouping keys on `projects.customer_legal_entity_id` and NOTHING
 * ELSE. Two measured reasons, either of which alone would be decisive:
 *
 *  1. THE EMBED DOES NOT RESOLVE. PostgREST rejects
 *     `customer_legal_entity:customer_legal_entity_id ( id, legal_name )` with
 *     "Could not find a relationship between 'projects' and
 *     'customer_legal_entity_id' in the schema cache" — the FK is newer than
 *     the running PostgREST's cached schema. That is an ERROR, not an empty
 *     column, so a select carrying it returns no rows at all and the page
 *     renders "no projects assigned to you" for a person with 54.
 *  2. THE NAME IS UNREADABLE ANYWAY. `crm.legal_entity` has RLS enabled with
 *     no policy for `authenticated`, so even once the cache refreshes the
 *     embed yields null names under a real session.
 *
 * The ID is on `projects`, is visible, and is all the grouping needs: it folds
 * the same 43 free-text spellings into the same 40 customers. The heading falls
 * back to the free-text name, and the alias line states the merge.
 *
 * REPORTED, NOT FIXED HERE (both are outside this agent's file boundary):
 *   - PostgREST needs a schema-cache reload (NOTIFY pgrst, 'reload schema')
 *     before any embed through this FK works.
 *   - crm.legal_entity needs a SELECT policy for `authenticated` before
 *     canonical legal names can be displayed.
 */
const PROJECT_COLUMNS =
  "id, code, name, customer, status, contract_hours, logged_hours, owner_person_id, due, " +
  "customer_legal_entity_id";

/**
 * `projects` reads for this module.
 *
 * `customer_legal_entity_id` is NEWER than the checked-in
 * `database.types.ts`, which this agent does not own and must not regenerate
 * (another agent owns the migrations), so the generated row type does not
 * carry it and the select does not typecheck even though it is correct at
 * runtime.
 *
 * The escape hatch is confined to this one helper and immediately re-narrowed
 * to `ProjectRowLite`, rather than sprayed across each call site. When the
 * types are regenerated this function can drop the cast and nothing else
 * changes.
 */
function projectsSelect(supabase: SupabaseTyped) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (supabase as any).from("projects").select(PROJECT_COLUMNS) as any;
}

/* --------------------------------------------------------------- reads */

/**
 * Every assignment row belonging to one person, paged past the 1000-row cap.
 *
 * Paged even though the largest book of work measured is 54 rows: the failure
 * mode of not paging is a list that quietly stops at 1000 with no error, and
 * nobody notices until a customer is missing.
 */
async function fetchMyAssignments(
  supabase: SupabaseTyped,
  personId: string,
): Promise<{ rows: AssignmentRowLite[]; truncated: boolean }> {
  const { rows, truncated } = await fetchAllPaged<AssignmentRowLite>((from, to) =>
    supabase
      .from("person_assignments")
      .select("person_id, project_id, project_name, logged_hours, share_percent")
      .eq("person_id", personId)
      .order("sort_order")
      .order("id")
      .range(from, to),
  );
  return { rows, truncated };
}

/**
 * The projects behind those assignments plus everything this person owns.
 *
 * Two reads rather than one `.or()`: the owned set is a direct column filter
 * PostgREST can index, while the assigned set is an `in` list whose length is
 * bounded by the assignment count. Combining them into one `or=` would put the
 * whole id list into the query string on every request for no gain.
 *
 * Both are still subject to `can_view_project()`. A project id present in an
 * assignment row but hidden by RLS simply does not come back, and the union
 * below drops it rather than rendering a row with no name.
 */
async function fetchMyProjects(
  supabase: SupabaseTyped,
  personId: string,
  projectIds: string[],
): Promise<{ rows: ProjectRowLite[]; truncated: boolean }> {
  // NOT wrapped in a try/catch: fetchAllPaged throws on a PostgREST error, and
  // that must propagate to getMyWork so the page can say "a load failed"
  // rather than "you have no work". Swallowing it here is what produced an
  // empty page for a person with 54 projects.
  const owned = await fetchAllPaged<ProjectRowLite>((from, to) =>
    projectsSelect(supabase)
      .eq("owner_person_id", personId)
      .order("id")
      .range(from, to),
  );

  const byId = new Map<string, ProjectRowLite>();
  for (const r of owned.rows) byId.set(r.id, r);

  let truncated = owned.truncated;

  // Chunked so a person with thousands of assignments cannot build a URL long
  // enough for PostgREST to reject — the failure would be a 414, i.e. an empty
  // page rather than a short one.
  const CHUNK = 200;
  for (let i = 0; i < projectIds.length; i += CHUNK) {
    const slice = projectIds.slice(i, i + CHUNK);
    if (slice.length === 0) continue;
    const page = await fetchAllPaged<ProjectRowLite>(
      (from, to) => projectsSelect(supabase).in("id", slice).order("id").range(from, to),
      { maxPages: Math.max(1, Math.ceil(slice.length / PAGE) + 1) },
    );
    truncated = truncated || page.truncated;
    for (const r of page.rows) byId.set(r.id, r);
  }

  return { rows: [...byId.values()], truncated };
}

/**
 * Service tags from TrackingTime for this person's projects.
 *
 * `time.project` and `time.service` both carry an `authenticated can read`
 * policy with no permission gate, so this needs no budget check and no new
 * RLS -- verified live against management-multi-service-matrix.ts:110-112,
 * the proven form this copies. Not "agreed services": that would be
 * `crm.framework_agreement`, which is empty. This is the TrackingTime tag,
 * and the UI must label it that way.
 *
 * Chunked the same way as `fetchMyProjects`, for the same reason: a long
 * `.in()` list risks a 414 that would read as "no services" rather than a
 * short list.
 */
async function fetchMyServices(
  supabase: SupabaseTyped,
  projectIds: string[],
): Promise<{ rows: ServiceRowLite[]; truncated: boolean }> {
  if (projectIds.length === 0) return { rows: [], truncated: false };

  const rows: ServiceRowLite[] = [];
  let truncated = false;
  const CHUNK = 200;
  for (let i = 0; i < projectIds.length; i += CHUNK) {
    const slice = projectIds.slice(i, i + CHUNK);
    if (slice.length === 0) continue;
    const page = await fetchAllPaged<ServiceRowLite>(
      (from, to) =>
        timeSchema(supabase)
          .from("project")
          .select("hub_project_id, service:service_id(name)")
          .in("hub_project_id", slice)
          .order("hub_project_id")
          .range(from, to),
      { maxPages: Math.max(1, Math.ceil(slice.length / PAGE) + 1) },
    );
    truncated = truncated || page.truncated;
    rows.push(...page.rows);
  }
  return { rows, truncated };
}

/**
 * Working links for this person's projects.
 *
 * `public.project_link` carries a single SELECT policy,
 * `can_view_project(project_id)` -- the same predicate that scopes the projects
 * themselves. So this read cannot widen what the page shows, and needs no
 * permission key of its own: a link is visible exactly when its project is.
 *
 * Wrapped in try/catch and degrading to NO links, because losing this table
 * costs the page a convenience and nothing else -- every project, hour and role
 * still renders. Contrast `fetchMyProjects`, whose failure is deliberately NOT
 * caught: losing that one costs the page everything.
 */
async function fetchMyLinks(
  supabase: SupabaseTyped,
  projectIds: string[],
): Promise<{ rows: LinkRowLite[]; truncated: boolean }> {
  if (projectIds.length === 0) return { rows: [], truncated: false };

  try {
    const rows: LinkRowLite[] = [];
    let truncated = false;
    const CHUNK = 200;
    for (let i = 0; i < projectIds.length; i += CHUNK) {
      const slice = projectIds.slice(i, i + CHUNK);
      if (slice.length === 0) continue;
      const page = await fetchAllPaged<LinkRowLite>(
        (from, to) =>
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (supabase as any)
            .from("project_link")
            .select("project_id, kind, url, label")
            .in("project_id", slice)
            .order("project_id")
            .order("kind")
            .range(from, to),
        { maxPages: Math.max(1, Math.ceil(slice.length / PAGE) + 1) },
      );
      truncated = truncated || page.truncated;
      rows.push(...page.rows);
    }
    return { rows, truncated };
  } catch {
    return { rows: [], truncated: false };
  }
}

/**
 * The sheet's facts about this person's projects, from public.project_masterdata.
 *
 * Same shape and same reasoning as `fetchMyLinks`: the table carries a single
 * SELECT policy, `can_view_project(project_id)`, so the read cannot widen what
 * the page shows; chunked so a long `.in()` list cannot 414; `.order()` before
 * `.range()` so the pages partition stably; wrapped in try/catch and degrading
 * to NOTHING, because losing this table costs the detail panel and nothing
 * else -- every project, role and link still renders. Contrast
 * `fetchMyProjects`, whose failure is deliberately NOT caught.
 *
 * Until the first promote runs, this table is empty on the live project and
 * the panel says "no masterdata for this order yet" for every row. That is the
 * honest state, not a failure, and it is distinct from the catch below.
 */
async function fetchMyMasterdata(
  supabase: SupabaseTyped,
  projectIds: string[],
): Promise<{ rows: MasterdataRowLite[]; truncated: boolean }> {
  if (projectIds.length === 0) return { rows: [], truncated: false };

  try {
    const rows: MasterdataRowLite[] = [];
    let truncated = false;
    const CHUNK = 200;
    for (let i = 0; i < projectIds.length; i += CHUNK) {
      const slice = projectIds.slice(i, i + CHUNK);
      if (slice.length === 0) continue;
      const page = await fetchAllPaged<MasterdataRowLite>(
        (from, to) =>
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (supabase as any)
            .from("project_masterdata")
            .select(MASTERDATA_COLUMNS)
            .in("project_id", slice)
            .order("project_id")
            .range(from, to),
        { maxPages: Math.max(1, Math.ceil(slice.length / PAGE) + 1) },
      );
      truncated = truncated || page.truncated;
      rows.push(...page.rows);
    }
    return { rows, truncated };
  } catch {
    return { rows: [], truncated: false };
  }
}

/**
 * The customer contacts on this person's projects, from public.project_contact.
 *
 * Personal data of third parties, under the same `can_view_project(project_id)`
 * policy as everything else here. It is read for the whole book of work in one
 * round rather than per selection because the page is server-rendered and
 * has no per-row endpoint; what keeps it out of the LIST is the UI contract
 * (never a column, never a CSV field), pinned by check-my-work-detail.mjs.
 * Degrades to no contacts, for the same reason `fetchMyLinks` does.
 */
async function fetchMyContacts(
  supabase: SupabaseTyped,
  projectIds: string[],
): Promise<{ rows: ContactRowLite[]; truncated: boolean }> {
  if (projectIds.length === 0) return { rows: [], truncated: false };

  try {
    const rows: ContactRowLite[] = [];
    let truncated = false;
    const CHUNK = 200;
    for (let i = 0; i < projectIds.length; i += CHUNK) {
      const slice = projectIds.slice(i, i + CHUNK);
      if (slice.length === 0) continue;
      const page = await fetchAllPaged<ContactRowLite>(
        (from, to) =>
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (supabase as any)
            .from("project_contact")
            .select("project_id, slot, name, phone, email")
            .in("project_id", slice)
            .order("project_id")
            .order("slot")
            .range(from, to),
        { maxPages: Math.max(1, Math.ceil(slice.length / PAGE) + 1) },
      );
      truncated = truncated || page.truncated;
      rows.push(...page.rows);
    }
    return { rows, truncated };
  } catch {
    return { rows: [], truncated: false };
  }
}

/**
 * Names for the responsible and replacement person ids the sheet resolved.
 *
 * Through `org_chart_nodes`, NOT `public.people`: `people` is hidden from a
 * non-exec caller by `can_view_person()`, so an operations person reading a
 * colleague's row would get nothing back and the panel would print an id. The
 * view projects identity only -- id, name, role, department, manager_id -- and
 * is deliberately not security_invoker for exactly this reason (an org chart
 * that shows you only yourself is not an org chart; see
 * 20260903090000_contract_status_view_must_not_bypass_rls.sql). Nothing
 * commercial or HR-sensitive can leak through it.
 *
 * Degrades to no names: the panel then says the name is not available beside
 * the kind, which is true, rather than inventing one.
 */
async function fetchPersonNames(
  supabase: SupabaseTyped,
  personIds: string[],
): Promise<{ rows: PersonNameRowLite[]; truncated: boolean }> {
  if (personIds.length === 0) return { rows: [], truncated: false };

  try {
    const rows: PersonNameRowLite[] = [];
    let truncated = false;
    const CHUNK = 200;
    for (let i = 0; i < personIds.length; i += CHUNK) {
      const slice = personIds.slice(i, i + CHUNK);
      if (slice.length === 0) continue;
      const page = await fetchAllPaged<PersonNameRowLite>(
        (from, to) =>
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (supabase as any)
            .from("org_chart_nodes")
            .select("id, name")
            .in("id", slice)
            .order("id")
            .range(from, to),
        { maxPages: Math.max(1, Math.ceil(slice.length / PAGE) + 1) },
      );
      truncated = truncated || page.truncated;
      rows.push(...page.rows);
    }
    return { rows, truncated };
  } catch {
    return { rows: [], truncated: false };
  }
}

/**
 * Every masterdata responsibility row naming this person.
 *
 * READ-ONLY, and gated by the table's own `can_view_project(project_id)`
 * policy — the same predicate that scopes the projects themselves, so this
 * read cannot widen what the page shows. It only labels it.
 *
 * `.select()` is untyped through a cast because `project_responsibility` is
 * newer than the checked-in `database.types.ts`, which this agent does not own
 * and must not regenerate. The row shape is narrowed to
 * `ResponsibilityRowLite` immediately, so the cast is confined to one line.
 */
async function fetchMyResponsibilities(
  supabase: SupabaseTyped,
  personId: string,
): Promise<{ rows: ResponsibilityRowLite[]; truncated: boolean }> {
  try {
    const { rows, truncated } = await fetchAllPaged<ResponsibilityRowLite>((from, to) =>
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (supabase as any)
        .from("project_responsibility")
        .select("project_id, person_id, role, order_no")
        .eq("person_id", personId)
        .order("project_id")
        .range(from, to),
    );
    return { rows, truncated };
  } catch {
    /*
     * Degrading to the owner/assignee view is CORRECT here and only here,
     * because losing this table costs the page two rungs of the ladder but
     * still shows every project: `fetchMyProjects` reads ownership and the
     * assignment ids independently, so all 54 rows survive.
     *
     * Contrast `fetchMyProjects`, whose failure is NOT caught: losing that one
     * costs the page everything, and pretending otherwise is what rendered
     * "no projects are assigned to you" to a person with 54.
     */
    return { rows: [], truncated: false };
  }
}

/* ----------------------------------------------------------- assembly */

/**
 * Fold projects, assignments and masterdata responsibilities into the grouped
 * shape the page renders.
 *
 * Exported separately from the reads so it can be exercised without a database:
 * the ladder rule (one row resolves to exactly one role, strongest wins) is the
 * part most likely to regress into double counting.
 */
export function assembleMyWork(
  personId: string,
  personName: string | null,
  projects: ProjectRowLite[],
  assignments: AssignmentRowLite[],
  responsibilities: ResponsibilityRowLite[] = [],
  services: ServiceRowLite[] = [],
  links: LinkRowLite[] = [],
  truncated = false,
  /*
   * Defaults to TRUE so that this stays a pure function with its existing
   * behaviour for every caller that does not pass it (the unit tests exercise
   * the role ladder, not the permission). The one production caller,
   * getMyWork(), always passes the real answer. A default of `false` would be
   * the safer-looking choice but would silently blank budgets in those tests
   * and hide a regression in the ladder behind an unrelated change.
   */
  canSeeBudgets = true,
  /*
   * ONE trailing options object for the sheet's fields, rather than three more
   * positional parameters: check-my-work-scoping.mjs exercises this function
   * with four arguments and must keep type-checking, and a tenth positional
   * `[]` after a boolean is the kind of call nobody can read back. Everything
   * in here defaults to empty, which yields `detail: null` and no contacts --
   * the same result as a project the sheet does not know.
   */
  options: {
    masterdata?: MasterdataRowLite[];
    contacts?: ContactRowLite[];
    personNames?: PersonNameRowLite[];
  } = {},
): MyWork {
  const assignmentByProject = new Map<string, AssignmentRowLite>();
  for (const a of assignments) {
    if (!a.project_id) continue;
    const prev = assignmentByProject.get(a.project_id);
    // Duplicate assignment rows for one project would otherwise double the
    // person's own hours for that project. Keep the larger, and never sum.
    if (!prev || (numOrNull(a.logged_hours) ?? 0) > (numOrNull(prev.logged_hours) ?? 0)) {
      assignmentByProject.set(a.project_id, a);
    }
  }

  // Masterdata roles, narrowed to this person and to the two roles the column
  // actually stores. An unrecognised role string is IGNORED rather than
  // guessed at: inventing a rung would misstate accountability.
  const responsibleOn = new Map<string, ResponsibilityRowLite>();
  const replacementOn = new Map<string, ResponsibilityRowLite>();
  for (const r of responsibilities) {
    if (r.person_id !== personId || !r.project_id) continue;
    if (r.role === "responsible") responsibleOn.set(r.project_id, r);
    else if (r.role === "replacement") replacementOn.set(r.project_id, r);
  }

  // A project can carry more than one time.project row (4 of Mathias's 54 do),
  // so this folds to a SET per project, not a 1:1 value.
  const servicesByProject = new Map<string, Set<string>>();
  for (const s of services) {
    if (!s.hub_project_id || !s.service?.name) continue;
    const set = servicesByProject.get(s.hub_project_id) ?? new Set<string>();
    set.add(s.service.name);
    servicesByProject.set(s.hub_project_id, set);
  }

  // Links per project, in the declared display order so a row's chips do not
  // reshuffle between requests. An unknown kind from the database is DROPPED
  // rather than rendered: the check constraint should make it impossible, and a
  // chip with no label is worse than no chip.
  const linksByProject = new Map<string, MyLink[]>();
  for (const l of links) {
    if (!l.project_id || !l.url || !l.kind) continue;
    if (!(l.kind in LINK_LABEL)) continue;
    const kind = l.kind as MyLink["kind"];
    const list = linksByProject.get(l.project_id) ?? [];
    list.push({ kind, url: l.url, label: l.label });
    linksByProject.set(l.project_id, list);
  }
  for (const list of linksByProject.values()) {
    list.sort((a, b) => LINK_ORDER.indexOf(a.kind) - LINK_ORDER.indexOf(b.kind));
  }

  // The sheet's row per project (1:1 by primary key, so a Map is exact), the
  // names its person ids resolve to, and the contacts folded per project in
  // slot order. A contact row with a slot outside {1, 2} is dropped rather than
  // rendered: the check constraint should make it impossible, and a third
  // "contact" the sheet has no column for is a fixture error, not a fact.
  const masterdataByProject = new Map<string, MasterdataRowLite>();
  for (const m of options.masterdata ?? []) {
    if (m.project_id) masterdataByProject.set(m.project_id, m);
  }
  const nameById = new Map<string, string>();
  for (const p of options.personNames ?? []) {
    if (p.id && p.name) nameById.set(p.id, p.name);
  }
  const contactsByProject = new Map<string, MyContact[]>();
  for (const c of options.contacts ?? []) {
    if (!c.project_id || (c.slot !== 1 && c.slot !== 2)) continue;
    // A slot with nothing in it is the sheet's empty column, not a contact.
    if (!c.name && !c.phone && !c.email) continue;
    const list = contactsByProject.get(c.project_id) ?? [];
    list.push({ slot: c.slot, name: c.name, phone: c.phone, email: c.email });
    contactsByProject.set(c.project_id, list);
  }
  for (const list of contactsByProject.values()) list.sort((a, b) => a.slot - b.slot);

  const rows: MyProject[] = [];
  for (const p of projects) {
    const isOwner = p.owner_person_id === personId;
    const assignment = assignmentByProject.get(p.id) ?? null;
    const isAssigned = assignment !== null;
    const responsibleRow = responsibleOn.get(p.id) ?? null;
    const replacementRow = replacementOn.get(p.id) ?? null;
    const isResponsible = responsibleRow !== null;
    const isReplacement = replacementRow !== null;

    // Belt and braces: RLS may legitimately show a project this person has no
    // claim on at all (a department-wide policy, say). It is not THEIR work, so
    // it does not belong on this page.
    if (!isOwner && !isAssigned && !isResponsible && !isReplacement) continue;

    // The ladder, applied once. Exactly one rung, strongest first.
    const role: MyRole = isResponsible
      ? "responsible"
      : isOwner
        ? "owner"
        : isReplacement
          ? "replacement"
          : "assigned";

    // Redacted here, at the single point where the column becomes a field, so
    // no downstream sum, percentage or CSV column can reconstruct it.
    const contractHours = canSeeBudgets ? budgetOrNull(p.contract_hours) : null;
    const loggedHours = numOrNull(p.logged_hours);

    // Canonical identity when it exists, free text when it does not. The
    // fallback is required: 3 of 231 live projects carry no entity link, and
    // dropping them would silently shrink somebody's customer list.
    const entity = p.customer_legal_entity ?? null;
    const entityId = entity?.id ?? p.customer_legal_entity_id ?? null;
    const canonicalName = entity?.legal_name ?? null;
    const projectServices = [...(servicesByProject.get(p.id) ?? [])].sort();
    const projectLinks = linksByProject.get(p.id) ?? [];

    rows.push({
      id: p.id,
      code: p.code ?? p.id,
      name: p.name ?? "Untitled",
      customer: canonicalName ?? p.customer ?? "No customer recorded",
      customerText: p.customer ?? "No customer recorded",
      customerEntityId: entityId,
      status: p.status ?? "unknown",
      role,
      isOwner,
      isAssigned,
      isResponsible,
      isReplacement,
      orderNo: responsibleRow?.order_no ?? replacementRow?.order_no ?? null,
      contractHours,
      loggedHours,
      myLoggedHours: assignment ? numOrNull(assignment.logged_hours) : null,
      mySharePercent: assignment ? numOrNull(assignment.share_percent) : null,
      consumedPercent:
        contractHours !== null && loggedHours !== null
          ? round1((loggedHours / contractHours) * 100)
          : null,
      dueDate: dueOrNull(p.due),
      services: projectServices,
      links: projectLinks,
      detail: toDetail(masterdataByProject.get(p.id) ?? null, nameById),
      contacts: contactsByProject.get(p.id) ?? [],
    });
  }

  const rank = (r: MyRole) => ROLE_ORDER.indexOf(r);

  // Strongest claim first, then the heaviest projects — an operations person
  // opens this page to find the thing that needs them, not to read an alphabet.
  rows.sort((a, b) => {
    if (a.role !== b.role) return rank(a.role) - rank(b.role);
    const ah = a.loggedHours ?? 0;
    const bh = b.loggedHours ?? 0;
    if (ah !== bh) return bh - ah;
    return a.name.localeCompare(b.name);
  });

  const emptyCounts = (): Record<MyRole, number> => ({
    responsible: 0,
    owner: 0,
    replacement: 0,
    assigned: 0,
  });

  /*
   * Grouped on the CANONICAL entity id, falling back to the text name only
   * when there is no link. That fold is not cosmetic: it merges "GEPLAHN-T"
   * with "GEPLAHN-T GmbH", "Mirantis Inc." with "Mirantis Germany GmbH", and
   * "RISE FX GmbH" with "RISE FX GmbH Berlin" — three pairs that are one
   * customer each and were counted as six. Grouping on the free-text string
   * would show Mathias 43 customers when he has 40.
   */
  const byCustomer = new Map<string, MyCustomer & { aliasSet: Set<string>; serviceSet: Set<string> }>();
  for (const r of rows) {
    const key = r.customerEntityId ?? `text:${r.customer}`;
    let c = byCustomer.get(key);
    if (!c) {
      c = {
        entityId: r.customerEntityId,
        /*
         * Seeded with the CANONICAL name only, i.e. empty when the only thing
         * available is a free-text spelling. Seeding with the text would pin
         * the heading to whichever project happened to be first in the page,
         * so the same customer could be titled "GEPLAHN-T" or "GEPLAHN-T GmbH"
         * between requests. The deterministic fallback is applied below.
         */
        customer: r.customer !== r.customerText ? r.customer : "",
        aliases: [],
        aliasSet: new Set<string>(),
        projectCount: 0,
        roleCounts: emptyCounts(),
        topRole: "assigned",
        contractHours: canSeeBudgets ? 0 : null,
        loggedHours: 0,
        myLoggedHours: 0,
        measuredProjectCount: 0,
        services: [],
        serviceSet: new Set<string>(),
        projects: [],
      };
      byCustomer.set(key, c);
    }
    // The free-text spelling, NOT the canonical name: collecting the latter
    // would add the same string 54 times and never reveal a merge.
    c.aliasSet.add(r.customerText);
    c.projectCount += 1;
    c.roleCounts[r.role] += 1;
    if (rank(r.role) < rank(c.topRole)) c.topRole = r.role;
    c.contractHours = canSeeBudgets ? (c.contractHours ?? 0) + (r.contractHours ?? 0) : null;
    c.loggedHours += r.loggedHours ?? 0;
    // Counted from loggedHours, not contractHours: "measured" means we know what
    // was worked, which is exactly what the sum above is claiming.
    if (r.loggedHours !== null) c.measuredProjectCount += 1;
    c.myLoggedHours += r.myLoggedHours ?? 0;
    for (const s of r.services) c.serviceSet.add(s);
    c.projects.push(r);
  }

  const customers: MyCustomer[] = [...byCustomer.values()].map(({ aliasSet, serviceSet, ...c }) => {
    const aliases = [...aliasSet].sort();
    return {
      ...c,
      services: [...serviceSet].sort(),
      /*
       * Display name.
       *
       * MEASURED, AND THE REASON THIS IS NOT SIMPLY `legal_name`:
       * `crm.legal_entity` has RLS enabled with no policy granting the
       * `authenticated` role SELECT, so under a real session the embed returns
       * ZERO rows and every canonical name is null. The grouping is unaffected
       * because it keys on `customer_legal_entity_id`, which lives on
       * `projects` and IS visible — 40 groups either way — but the heading has
       * to come from somewhere.
       *
       * So: the canonical name when it is actually readable, else the
       * alphabetically first free-text spelling. Sorted rather than
       * "whichever row arrived first", so the heading is deterministic instead
       * of depending on page order.
       *
       * REPORTED, NOT FIXED HERE: crm.legal_entity needs a SELECT policy for
       * authenticated before canonical names can render. Until then the merge
       * still happens and the aliases below state it.
       */
      customer: c.customer || aliases[0] || "No customer recorded",
      // Only surfaced when the merge actually collapsed distinct spellings —
      // a single-alias list would just repeat the heading.
      aliases: aliasSet.size > 1 ? aliases : [],
      contractHours: c.contractHours === null ? null : round1(c.contractHours),
      loggedHours: round1(c.loggedHours),
      myLoggedHours: round1(c.myLoggedHours),
    };
  });

  // Customers you LEAD come first: those are the ones where a question lands
  // on your desk rather than someone else's.
  customers.sort((a, b) => {
    if (a.topRole !== b.topRole) return rank(a.topRole) - rank(b.topRole);
    if (a.loggedHours !== b.loggedHours) return b.loggedHours - a.loggedHours;
    return a.customer.localeCompare(b.customer);
  });

  const roleCounts = emptyCounts();
  for (const r of rows) roleCounts[r.role] += 1;

  return {
    personId,
    personName,
    customers,
    projects: rows,
    budgetsWithheld: !canSeeBudgets,
    totals: {
      customers: customers.length,
      projects: rows.length,
      roleCounts,
      customersLed: customers.filter(
        (c) => c.topRole === "responsible" || c.topRole === "owner",
      ).length,
      contractHours: canSeeBudgets
        ? round1(rows.reduce((s, r) => s + (r.contractHours ?? 0), 0))
        : null,
      loggedHours: round1(rows.reduce((s, r) => s + (r.loggedHours ?? 0), 0)),
      myLoggedHours: round1(rows.reduce((s, r) => s + (r.myLoggedHours ?? 0), 0)),
      measuredProjectCount: rows.filter((r) => r.loggedHours !== null).length,
      serviceCoverage: {
        known: rows.filter((r) => r.services.length > 0).length,
        total: rows.length,
      },
    },
    unlinked: false,
    // One hour spread across 54 projects is not a workload, it is an unfilled
    // column. The threshold is deliberately generous: any real book of work
    // clears 2h, and a genuinely new joiner has no projects to trigger it.
    myHoursUnpopulated:
      rows.length > 0 && rows.reduce((s, r) => s + (r.myLoggedHours ?? 0), 0) < 2,
    loadFailed: false,
    truncated,
  };
}

/** The shape returned when there is nothing to show, for whatever reason. */
function emptyWork(
  personId: string | null,
  personName: string | null,
  unlinked: boolean,
  loadFailed = false,
): MyWork {
  return {
    // An empty book of work has no budgets to withhold, so this is honestly
    // false rather than inherited: the reason there is nothing here is stated
    // by `unlinked` / `loadFailed`, not by the budget permission.
    budgetsWithheld: false,
    personId,
    personName,
    customers: [],
    projects: [],
    totals: {
      customers: 0,
      projects: 0,
      roleCounts: { responsible: 0, owner: 0, replacement: 0, assigned: 0 },
      customersLed: 0,
      contractHours: 0,
      loggedHours: 0,
      myLoggedHours: 0,
      // Zero projects means zero measured projects; no rows are being omitted.
      measuredProjectCount: 0,
      serviceCoverage: { known: 0, total: 0 },
    },
    unlinked,
    myHoursUnpopulated: false,
    loadFailed,
    truncated: false,
  };
}

/* ---------------------------------------------------------- entry point */

/**
 * Everything the My Work page renders, for the CURRENTLY SIGNED-IN user.
 *
 * Takes no person id on purpose (see the header). Returns `unlinked: true`
 * rather than throwing when the account has no `person_id`: that is a real and
 * common state — 11 of 20 provisioned accounts — and the page says so.
 */
export async function getMyWork(supabase: SupabaseTyped): Promise<MyWork> {
  // getSignedInUser(), not supabase.auth.getUser(): the shared app shell has
  // already verified this same session two or three times in this very render
  // (see request-cache.ts), and each raw call is a ~50ms network round trip to
  // the auth server for an answer that cannot change mid-render.
  const user = await getSignedInUser(supabase);

  if (!user) return emptyWork(null, null, true);

  const { data: profile } = await supabase
    .from("app_user_profile")
    .select("person_id, people(name)")
    .eq("user_id", user.id)
    .eq("is_active", true)
    .maybeSingle();

  const personId = profile?.person_id ?? null;
  const personName = profile?.people?.name ?? null;

  if (!personId) return emptyWork(null, personName, true);

  try {
    /*
     * Assignments and responsibilities in ONE round of parallel requests:
     * neither depends on the other, and awaiting the first before asking for
     * the second would serialise two RLS-evaluated reads for no reason (the
     * same correction people-live.ts made after measuring /people).
     *
     * The project read must follow, because its id list is the union of both.
     */
    const [assignments, responsibilities, canSeeBudgets] = await Promise.all([
      fetchMyAssignments(supabase, personId),
      fetchMyResponsibilities(supabase, personId),
      // Asked in the same round trip as the reads it governs, not after them.
      canReadBudgets(supabase),
    ]);

    // The union of every id this person has ANY claim on. Responsibility rows
    // are included even though all 40 of Mathias's happen to fall inside his 54
    // assignments: the masterdata and the assignment table are maintained
    // separately, so a project can be led by someone who was never assigned to
    // it, and dropping it would hide the customer they are responsible for.
    const projectIds = [
      ...new Set([
        ...assignments.rows.map((a) => a.project_id),
        ...responsibilities.rows.map((r) => r.project_id),
      ].filter((id): id is string => !!id)),
    ];
    // Neither depends on the other -- same round-trip reasoning as the
    // assignments/responsibilities pair above.
    const [projects, services, links, masterdata, contacts] = await Promise.all([
      fetchMyProjects(supabase, personId, projectIds),
      fetchMyServices(supabase, projectIds),
      fetchMyLinks(supabase, projectIds),
      fetchMyMasterdata(supabase, projectIds),
      fetchMyContacts(supabase, projectIds),
    ]);

    /*
     * A THIRD, usually tiny, round: the names behind the sheet's responsible
     * and replacement ids. It cannot join the second round because the ids
     * come out of it, and it is not an embed on the masterdata select because
     * `people` is hidden from a non-exec caller (see fetchPersonNames). Only
     * ids of kind 'person' are asked for; DOC/OTHER carry none.
     */
    const personIds = [
      ...new Set(
        masterdata.rows
          .flatMap((m) => [
            m.responsible_kind === "person" ? m.responsible_person_id : null,
            m.replacement_kind === "person" ? m.replacement_person_id : null,
          ])
          .filter((id): id is string => !!id),
      ),
    ];
    const personNames = await fetchPersonNames(supabase, personIds);

    return assembleMyWork(
      personId,
      personName,
      projects.rows,
      assignments.rows,
      responsibilities.rows,
      services.rows,
      links.rows,
      assignments.truncated || projects.truncated || responsibilities.truncated || services.truncated,
      canSeeBudgets,
      // Panel data only. Its truncation is not folded into `truncated` above:
      // that flag warns that the LIST and the TOTALS may understate, and a
      // clipped detail read cannot move either.
      { masterdata: masterdata.rows, contacts: contacts.rows, personNames: personNames.rows },
    );
  } catch {
    // A failed read must NOT render as "you have no work": that is the same
    // class of lie as a plausible 0, and it is exactly what happened when the
    // project select carried an embed PostgREST could not resolve. The page
    // distinguishes the two and says a load failed.
    return emptyWork(personId, personName, false, true);
  }
}
