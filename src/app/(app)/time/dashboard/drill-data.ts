/**
 * What sits behind each headline figure on the TrackingTime dashboard, folded
 * from the SAME filtered entries the totals strip is summarised from.
 *
 * Pure functions, run on the server once per page render and handed to the
 * client as plain data. That is the whole point: a popup that re-fetched would
 * be a second query with its own chance of disagreeing with the tile it opened
 * from (a different bound, a filter not carried over, a running timer counted
 * once but not twice). Folding the entries already in hand makes disagreement
 * impossible by construction — the tile and the popup are two projections of
 * one array.
 *
 * Everything stays in SECONDS. Rounding to hours happens once, at render, per
 * row, so the rows add up to the total exactly rather than drifting by a tenth
 * per rounded row.
 */
import type { ReportEntry } from "@/lib/queries/trackingtime-report";

export type DrillDatum = {
  id: number | null;
  /** null = unattributed; the caller labels it in the reader's language. */
  name: string | null;
  sub: string | null;
  seconds: number;
  billableSeconds: number;
  entries: number;
};

export type TimeTileDrillData = {
  /** Every project in the selection, the no-project bucket included. */
  byProject: DrillDatum[];
  byMember: DrillDatum[];
  /** One row per calendar day with at least one entry — summarise()'s activeDays. */
  byDay: { day: string; seconds: number; entries: number }[];
};

type Acc = Map<string, DrillDatum>;

function add(
  acc: Acc,
  key: string,
  seed: Pick<DrillDatum, "id" | "name" | "sub">,
  e: ReportEntry,
): void {
  let row = acc.get(key);
  if (!row) {
    row = { ...seed, seconds: 0, billableSeconds: 0, entries: 0 };
    acc.set(key, row);
  }
  row.seconds += e.durationSeconds;
  if (e.isBillable) row.billableSeconds += e.durationSeconds;
  row.entries += 1;
}

const ranked = (acc: Acc): DrillDatum[] => [...acc.values()].sort((a, b) => b.seconds - a.seconds);

/** Keys match groupBy(): the id when there is one, the label otherwise. */
const projectKey = (e: ReportEntry) =>
  e.projectId !== null ? `id:${e.projectId}` : `label:${e.projectName ?? ""}`;

export function tileDrillData(entries: ReportEntry[]): TimeTileDrillData {
  const byProject: Acc = new Map();
  const byMember: Acc = new Map();
  const byDay = new Map<string, { day: string; seconds: number; entries: number }>();

  for (const e of entries) {
    add(byProject, projectKey(e), { id: e.projectId, name: e.projectName, sub: e.customerName }, e);
    add(byMember, `m:${e.memberId}`, { id: e.memberId, name: e.memberName, sub: null }, e);
    // The same slice summarise() counts activeDays on, so the two agree.
    const day = e.startedAt.slice(0, 10);
    const d = byDay.get(day) ?? { day, seconds: 0, entries: 0 };
    d.seconds += e.durationSeconds;
    d.entries += 1;
    byDay.set(day, d);
  }

  return {
    byProject: ranked(byProject),
    byMember: ranked(byMember),
    byDay: [...byDay.values()].sort((a, b) => b.seconds - a.seconds),
  };
}

/** Each person's hours by project, keyed by member id (a string, as JSON keys are). */
export function projectsByMember(entries: ReportEntry[]): Record<string, DrillDatum[]> {
  const perMember = new Map<string, Acc>();
  for (const e of entries) {
    const key = String(e.memberId);
    let acc = perMember.get(key);
    if (!acc) {
      acc = new Map();
      perMember.set(key, acc);
    }
    add(acc, projectKey(e), { id: e.projectId, name: e.projectName, sub: e.customerName }, e);
  }
  return Object.fromEntries([...perMember.entries()].map(([k, acc]) => [k, ranked(acc)]));
}

/**
 * The label the customer-concentration panel uses for unattributed time.
 * Shared so the popup's keys match the waffle's legend character for character.
 */
export const NO_CUSTOMER_LABEL = "(no customer)";

export type CustomerDrillData = {
  /** Every customer in the selection, biggest first. */
  byCustomer: DrillDatum[];
  /** Each customer's hours by project, keyed by the customer's display label. */
  projectsByCustomer: Record<string, DrillDatum[]>;
};

export function customerDrillData(entries: ReportEntry[]): CustomerDrillData {
  const byCustomer: Acc = new Map();
  const perCustomer = new Map<string, Acc>();
  for (const e of entries) {
    const label = e.customerName ?? NO_CUSTOMER_LABEL;
    add(byCustomer, label, { id: e.customerId, name: label, sub: null }, e);
    let acc = perCustomer.get(label);
    if (!acc) {
      acc = new Map();
      perCustomer.set(label, acc);
    }
    add(acc, projectKey(e), { id: e.projectId, name: e.projectName, sub: null }, e);
  }
  return {
    byCustomer: ranked(byCustomer),
    projectsByCustomer: Object.fromEntries(
      [...perCustomer.entries()].map(([k, acc]) => [k, ranked(acc)]),
    ),
  };
}
