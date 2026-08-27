import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";

/**
 * One masterdata ORDER, everything about it, for the detail page.
 *
 * WHY THIS IS KEYED ON THE TEXT ID, NOT THE TRACKINGTIME BIGINT
 * ------------------------------------------------------------
 * There are two project worlds. `/projects/[id]` is keyed on `time.project.id`
 * (a bigint) and validates `/^\d+$/`. But responsibility, contract hours and the
 * customer entity all live on `public.projects`, whose id is text like
 * `10110_00358_104_01`. 54 orders carrying 1,724h have no `time.project` at all,
 * so a page keyed on the bigint can never show them.
 *
 * This reads the ORDER as the primary record and treats the TrackingTime link as
 * optional enrichment, which is the only shape that covers all 231 orders.
 *
 * HOURS ARE READ LIVE, NOT FROM THE STORED SNAPSHOT
 * ------------------------------------------------
 * `projects.logged_hours` is a snapshot maintained by
 * `scripts/refresh-order-hours.mjs`, and 59 of 177 linked orders currently
 * understate it -- four of them are past contract while storing 0h
 * (`check:order-hours-freshness`). There is no `refreshed_at` column, so a page
 * showing the stored value cannot say how stale it is.
 *
 * So this returns BOTH: the stored figure and a live sum from `time.entry`, and
 * the caller can show the disagreement rather than silently picking one. A
 * detail page is exactly where someone checks a number they distrust, so hiding
 * the conflict would defeat the purpose of the page.
 *
 * The live sum is bounded at `now()`: `time.entry` holds future-dated planned
 * work out to 2026-12-31, and an unbounded sum reports planned hours as burned.
 *
 * RLS
 * ---
 * Every table read here has RLS enabled, and `project_responsibility` already
 * carries `can_view_project(project_id)`, so responsibility follows project
 * visibility without extra work. `crm.legal_entity` is deliberately NOT joined:
 * its only policy is exec-only, so including it would make the page fail for
 * everyone else rather than degrade.
 */

type SupabaseTyped = SupabaseClient<Database>;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const timeSchema = (s: SupabaseTyped) => (s as any).schema("time");

const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

export type OrderRole = {
  role: "responsible" | "replacement";
  personId: string;
  personName: string;
  /** 'masterdata' from the workbook, 'change_control' from an approved handover. */
  source: string;
};

export type OrderAssignee = {
  personId: string;
  personName: string;
  /** > 0 carries the load; 0 is the named cover. The import's convention. */
  sharePercent: number;
  sortOrder: number;
};

export type CustomerService = {
  service: string | null;
  orders: number;
  contractHours: number | null;
};

export type OrderDetail = {
  id: string;
  code: string | null;
  name: string;
  customer: string;
  status: string | null;
  department: string | null;
  contractType: string | null;
  due: string | null;

  contractHours: number | null;
  /** The stored snapshot. May be stale; compare with loggedHoursLive. */
  loggedHoursStored: number | null;
  /** Summed from time.entry, bounded at today. Null when no TrackingTime link. */
  loggedHoursLive: number | null;
  /** True when the two disagree by more than rounding, so the UI can say so. */
  hoursDisagree: boolean;

  /** From time.service via the TrackingTime bridge. Null for the 54 orphans. */
  service: string | null;
  /** projects.contract_type names the service even without a TT link. */
  serviceFallback: string | null;
  timeProjectId: number | null;

  responsible: OrderRole | null;
  replacement: OrderRole | null;
  /** Everyone on person_assignments, which is the wider set. */
  assignees: OrderAssignee[];

  /** Every service this customer buys, across all their orders. */
  customerServices: CustomerService[];

  entryCount: number;
  firstEntry: string | null;
  lastEntry: string | null;
};

export async function getOrderDetail(
  supabase: SupabaseTyped,
  orderId: string,
): Promise<OrderDetail | null> {
  const { data: order } = await supabase
    .from("projects")
    .select("id, code, name, customer, status, department, contract_type, due, contract_hours, logged_hours")
    .eq("id", orderId)
    .maybeSingle();

  // Null covers both "no such order" and "RLS says you may not see it". The
  // caller renders the same not-found either way, which is correct: telling an
  // unauthorised user the order exists is itself a leak.
  if (!order) return null;

  const o = order as Record<string, unknown>;

  // The TrackingTime link, if any. Not an inner join: the 54 orphans must survive.
  const { data: timeProjects } = await timeSchema(supabase)
    .from("project")
    .select("id, service_id")
    .eq("hub_project_id", orderId);

  const timeProjectId = timeProjects?.length ? Number(timeProjects[0].id) : null;
  const serviceIds = (timeProjects ?? []).map((t: { service_id: number | null }) => t.service_id).filter(Boolean);

  let service: string | null = null;
  if (serviceIds.length) {
    const { data: services } = await timeSchema(supabase)
      .from("service").select("id, name").in("id", serviceIds);
    service = services?.[0]?.name ?? null;
  }

  // Live hours, bounded at today. Only meaningful when a link exists.
  let loggedHoursLive: number | null = null;
  let entryCount = 0;
  let firstEntry: string | null = null;
  let lastEntry: string | null = null;

  if (timeProjects?.length) {
    const ids = timeProjects.map((t: { id: number }) => t.id);
    const nowIso = new Date().toISOString();
    let seconds = 0;
    // Paged: an order can carry hundreds of entries and PostgREST caps at 1000.
    for (const tid of ids) {
      for (let from = 0; ; from += 1000) {
        const { data } = await timeSchema(supabase)
          .from("entry")
          .select("id, duration_seconds, started_at")
          .eq("project_id", tid)
          .lte("started_at", nowIso)
          // Ordered before ranged: unordered .range() repeats and skips rows.
          .order("id", { ascending: true })
          .range(from, from + 999);
        if (!data?.length) break;
        for (const e of data as { duration_seconds: number | null; started_at: string }[]) {
          seconds += Number(e.duration_seconds) || 0;
          if (!firstEntry || e.started_at < firstEntry) firstEntry = e.started_at;
          if (!lastEntry || e.started_at > lastEntry) lastEntry = e.started_at;
        }
        entryCount += data.length;
        if (data.length < 1000) break;
      }
    }
    loggedHoursLive = Math.round((seconds / 3600) * 10) / 10;
  }

  /*
   * The roles. `project_responsibility` is the canonical table and its RLS
   * follows project visibility. It is newer than the checked-in
   * database.types.ts, so it is read through a confined cast -- same convention
   * as my-work.ts:444.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: roleRows } = await (supabase as any)
    .from("project_responsibility")
    .select("person_id, role, source")
    .eq("project_id", orderId);

  const { data: assignmentRows } = await supabase
    .from("person_assignments")
    .select("person_id, share_percent, sort_order")
    .eq("project_id", orderId)
    .order("sort_order", { ascending: true });

  // One people lookup for every id either table mentions.
  const personIds = [...new Set([
    ...((roleRows ?? []) as { person_id: string }[]).map((r) => r.person_id),
    ...((assignmentRows ?? []) as { person_id: string }[]).map((r) => r.person_id),
  ])];
  const nameById = new Map<string, string>();
  if (personIds.length) {
    const { data: people } = await supabase.from("people").select("id, name").in("id", personIds);
    for (const p of (people ?? []) as { id: string; name: string }[]) nameById.set(p.id, p.name);
  }

  const roleOf = (want: "responsible" | "replacement"): OrderRole | null => {
    const row = ((roleRows ?? []) as { person_id: string; role: string; source: string }[])
      .find((r) => r.role === want);
    if (!row) return null;
    return {
      role: want,
      personId: row.person_id,
      // An id with no people row would be a dangling reference; show the id
      // rather than an empty cell, so the breakage is visible.
      personName: nameById.get(row.person_id) ?? row.person_id,
      source: row.source,
    };
  };

  /*
   * "What kind of services is that customer asking for?" -- across every order
   * this customer holds, not just this one. Matched on projects.customer, which
   * is the same string the order carries; the canonical legal entity would be
   * better but crm.legal_entity is exec-only.
   */
  const { data: siblingOrders } = await supabase
    .from("projects")
    .select("id, contract_hours, contract_type")
    .eq("customer", String(o.customer ?? ""));

  const siblingIds = ((siblingOrders ?? []) as { id: string }[]).map((r) => r.id);
  const serviceByOrder = new Map<string, string | null>();
  if (siblingIds.length) {
    const { data: links } = await timeSchema(supabase)
      .from("project").select("hub_project_id, service_id").in("hub_project_id", siblingIds);
    const linkServiceIds = [...new Set(((links ?? []) as { service_id: number | null }[])
      .map((l) => l.service_id).filter(Boolean))];
    const serviceNameById = new Map<number, string>();
    if (linkServiceIds.length) {
      const { data: svc } = await timeSchema(supabase)
        .from("service").select("id, name").in("id", linkServiceIds);
      for (const s of (svc ?? []) as { id: number; name: string }[]) serviceNameById.set(Number(s.id), s.name);
    }
    for (const l of (links ?? []) as { hub_project_id: string; service_id: number | null }[]) {
      serviceByOrder.set(l.hub_project_id, l.service_id ? serviceNameById.get(Number(l.service_id)) ?? null : null);
    }
  }

  const byService = new Map<string, { orders: number; hours: number; anyHours: boolean }>();
  for (const s of (siblingOrders ?? []) as { id: string; contract_hours: number | null; contract_type: string | null }[]) {
    // Fall back to contract_type so an unlinked order still reports a service
    // rather than collapsing into a null bucket.
    const label = serviceByOrder.get(s.id) ?? s.contract_type ?? "Nicht zugeordnet";
    const cur = byService.get(label) ?? { orders: 0, hours: 0, anyHours: false };
    cur.orders += 1;
    const h = num(s.contract_hours);
    if (h !== null) { cur.hours += h; cur.anyHours = true; }
    byService.set(label, cur);
  }

  const customerServices: CustomerService[] = [...byService.entries()]
    .map(([service, v]) => ({
      service,
      orders: v.orders,
      // Honest null: no order in this bucket carried a contract figure.
      contractHours: v.anyHours ? Math.round(v.hours * 10) / 10 : null,
    }))
    .sort((a, b) => (b.contractHours ?? -1) - (a.contractHours ?? -1));

  const stored = num(o.logged_hours);
  const hoursDisagree =
    stored !== null && loggedHoursLive !== null && Math.abs(stored - loggedHoursLive) >= 0.05;

  return {
    id: String(o.id),
    code: (o.code as string) ?? null,
    name: String(o.name ?? ""),
    customer: String(o.customer ?? ""),
    status: (o.status as string) ?? null,
    department: (o.department as string) ?? null,
    contractType: (o.contract_type as string) ?? null,
    due: (o.due as string) ?? null,

    contractHours: num(o.contract_hours),
    loggedHoursStored: stored,
    loggedHoursLive,
    hoursDisagree,

    service,
    serviceFallback: (o.contract_type as string) ?? null,
    timeProjectId,

    responsible: roleOf("responsible"),
    replacement: roleOf("replacement"),
    assignees: ((assignmentRows ?? []) as { person_id: string; share_percent: number; sort_order: number }[])
      .map((a) => ({
        personId: a.person_id,
        personName: nameById.get(a.person_id) ?? a.person_id,
        sharePercent: num(a.share_percent) ?? 0,
        sortOrder: Number(a.sort_order),
      })),

    customerServices,
    entryCount,
    firstEntry,
    lastEntry,
  };
}
