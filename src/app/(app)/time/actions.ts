"use server";

/**
 * Write path for the Time Tracking module — the timer and manual entry actions
 * behind /time?view=track.
 *
 * Until this file existed the module could only *read* imported TrackingTime
 * data: `getRunningEntry()` and `getTimeLookups()` were written for a tracker UI
 * that did not exist yet. These actions are that UI's server half.
 *
 * Four rules govern everything below, and each one is here because the obvious
 * implementation is wrong:
 *
 * 1. **The clock is the server's, never the client's.** Elapsed time is computed
 *    from the stored `started_at` against `now()` on this side. A browser clock
 *    that is merely wrong (or deliberately set forward) must not be able to
 *    inflate billable hours — that is an invoice, not a cosmetic bug.
 *
 * 2. **`member_id` is never taken from the request.** It is resolved from the
 *    session via `time.current_member_id()`. RLS pins it again in the policy's
 *    WITH CHECK, so filing time under a colleague fails twice, but the app must
 *    not be the layer that tries.
 *
 * 3. **RLS is the boundary; these checks are for the error message.** Every
 *    validation here has a matching database guarantee (the partial unique index
 *    for one running timer, `entry_interval_ordered`, the `is_billed` clause in
 *    the update/delete policies). We check first only so the user gets a sentence
 *    instead of a raw Postgres error code.
 *
 * 4. **Durations are SECONDS.** `time.entry.duration_seconds` is seconds, while
 *    `public.timesheet_entries.hours` is hours and Factorial is minutes. Every
 *    conversion in this file is explicit and rounds once, at the edge.
 */

import { revalidatePath } from "next/cache";
import { getTranslations } from "next-intl/server";
import { createClient } from "@/utils/supabase/server";
import { PERMISSIONS } from "@/lib/permissions";
import {
  evaluateBudget,
  refusalMessage,
  warningMessage,
  type BudgetDecision,
  type ContractPeriodInput,
} from "@/lib/budget-guard";
import { notifyOverbooking } from "@/lib/overbooking-notify";
import { canReadBudgets } from "@/lib/budget-visibility";

/**
 * What every action returns.
 *
 * A discriminated result rather than a thrown error: these are called from
 * forms, and a rejected promise in a Server Action surfaces to the user as an
 * opaque "something went wrong" digest with the real reason only in the server
 * log. `ok: false` with a sentence is the difference between a usable app and a
 * support ticket.
 */
export type TimeActionResult = {
  ok: boolean;
  message?: string;
  /**
   * A note about a write that SUCCEEDED -- "you are at 85% of this contract",
   * "this date is outside any contract period". Separate from `message` so the
   * UI can style it as a caution rather than a failure, and so a warning can
   * never be mistaken for a refusal (which would block honest work).
   */
  warning?: string;
};

/** Longest a single entry may be: 24h in seconds. */
const MAX_ENTRY_SECONDS = 24 * 3600;

/** How far back a manual entry may be backdated, in days. */
const MAX_BACKDATE_DAYS = 90;

type Client = Awaited<ReturnType<typeof createClient>>;

/**
 * The `time` schema handle.
 *
 * `database.types.ts` is generated from `public` only, so the typed client
 * rejects `.schema("time")` outright. Narrowed here once rather than casting at
 * every call site — the same approach `@/lib/queries/time` takes, and for the
 * same reason.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const timeSchema = (s: Client) => (s as any).schema("time");

/**
 * One refusal sentence, in the caller's language.
 *
 * Every message resolved here is USER-FACING -- the tracker renders it verbatim
 * in its inline feedback -- so it follows the request locale, the pattern
 * projects/project-drilldown.ts established. Postgres's own `error.message` is
 * deliberately NOT routed through here: those are operator text, and inventing a
 * German rendering of a constraint failure would hide which constraint fired.
 */
const msg = async (
  key: string,
  values?: Record<string, string | number>,
): Promise<string> => (await getTranslations("time.actions"))(key, values);

/**
 * Everything an action needs before it may write: an authenticated session, the
 * `timesheets:write` permission, and a `time.member` row to attribute the entry
 * to.
 *
 * Returns a `TimeActionResult` on failure so each action can bail with one line.
 * The three failure modes are deliberately worded differently — "not signed in",
 * "not permitted" and "not linked" send the user to three different places, and
 * collapsing them into one message is how a linking problem gets misreported as
 * a permissions problem for a week.
 */
async function authorise(
  supabase: Client,
): Promise<{ memberId: number } | { error: TimeActionResult }> {
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { error: { ok: false, message: await msg("notSignedIn") } };
  }

  // Checked in the app as well as in RLS. The policy would reject the insert
  // anyway, but as a bare 42501 with no indication of which permission is
  // missing.
  const { data: canWrite } = await supabase.rpc("app_user_has_permission", {
    p_key: PERMISSIONS.TIMESHEETS_WRITE,
  });

  if (canWrite !== true) {
    return {
      error: { ok: false, message: await msg("notPermitted") },
    };
  }

  const { data: memberId } = await timeSchema(supabase).rpc("current_member_id");

  // Null is an ordinary state, not a fault: a colleague with no TrackingTime
  // account has no member row. It is also what `npm run link:time-members`
  // fixes, so the message names the actual remedy.
  if (memberId === null || memberId === undefined) {
    return {
      error: {
        ok: false,
        message:
          await msg("noMemberRow"),
      },
    };
  }

  return { memberId: Number(memberId) };
}

/** Both /time views read the same rows, so both must be refreshed after a write. */
function revalidateTime(): void {
  revalidatePath("/time");
  revalidatePath("/time/dashboard");
}

/**
 * A positive integer from a form field, or null.
 *
 * `Number("")` is 0 and `Number(null)` is 0, so a blank optional picker would
 * become id 0 and fail an FK lookup with a confusing error. Anything that is not
 * a positive integer becomes null — "not chosen" — rather than a bad id.
 */
function optionalId(raw: FormDataEntryValue | null): number | null {
  if (raw === null) return null;
  const s = String(raw).trim();
  if (!s) return null;
  const n = Number(s);
  return Number.isInteger(n) && n > 0 ? n : null;
}

/** A trimmed string, or null when blank. */
function optionalText(raw: FormDataEntryValue | null): string | null {
  if (raw === null) return null;
  const s = String(raw).trim();
  return s.length ? s : null;
}

/**
 * Combine a `YYYY-MM-DD` date and an `HH:MM` time into an ISO instant.
 *
 * Read as **UTC**, deliberately and consistently with the rest of the module:
 * the importer stores vendor timestamps as UTC, `getEntriesForWeek()` filters on
 * half-open UTC bounds, and `TimeEntryList` renders with `timeZone: "UTC"`. A
 * local-time reading here would place a manual entry in a different day than the
 * list shows it in — visible only to users off UTC, and only near midnight.
 *
 * Returns null on anything malformed, including a date that matches the shape
 * but does not exist ("2026-02-31", which `Date` would roll into March).
 */
function combineInstant(date: string, time: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  if (!/^\d{2}:\d{2}$/.test(time)) return null;

  const iso = `${date}T${time}:00.000Z`;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  // Round-trip check catches both an impossible date and an impossible clock
  // time ("25:00"), which the regex above happily allows.
  if (d.toISOString().slice(0, 10) !== date) return null;
  if (d.toISOString().slice(11, 16) !== time) return null;

  return d.toISOString();
}

/**
 * Would these hours push the project past its budget?
 *
 * Reads the CONTRACT PERIOD covering the entry's own date, sums the hours logged
 * inside that period's window, then asks the pure rule in budget-guard.ts to
 * decide. Returns null when the booking may proceed silently, a refusal message
 * when it may not, or a warning when it proceeds but somebody should know.
 *
 * WHY THE PERIOD, AND WHY BY THE ENTRY'S DATE. A budget belongs to a contract
 * term, so "how much is left?" only means something inside that term. Summing
 * every hour ever logged on the project would make a renewal pointless: last
 * year's hours would immediately eat this year's budget. Using the ENTRY's date
 * rather than today's also means correcting an old timesheet is judged against
 * the contract that was actually in force then.
 *
 * The fallback chain is deliberate: contract period -> the vendor's
 * estimated_hours -> nothing. Projects with no contract recorded keep behaving
 * exactly as they did before this feature, so nothing regresses on day one.
 *
 * WHY THE READS USE THE CALLER'S CLIENT. The user can already see this project's
 * hours (the guard only fires on a project they are booking against), so no
 * privilege is added here. If RLS hides some entries from them, the sum is the
 * one THEY can see -- which is the honest basis for a message shown to them, and
 * the alert row records the same figures so a reviewer sees exactly what the
 * user was told.
 *
 * `excludeEntryId` matters for edits: when changing an existing entry's hours,
 * its OWN current hours must not be counted as "already logged", or every edit
 * would appear to double-book.
 */
async function checkBudget(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  {
    projectId,
    requestedSeconds,
    excludeEntryId,
    memberId,
    entryDate,
    source,
  }: {
    projectId: number | null;
    requestedSeconds: number;
    excludeEntryId?: number | null;
    memberId: number;
    entryDate?: string | null;
    source: "create_entry" | "update_entry" | "start_timer" | "stop_timer";
  },
): Promise<{ refusal: string | null; warning: string | null }> {
  const proceed = { refusal: null, warning: null };
  // No project means no budget to breach: unattributed time is a separate
  // problem (40% of live entries carry no project) and not this guard's job.
  if (projectId === null) return proceed;

  const { data: project, error: projectError } = await timeSchema(supabase)
    .from("project")
    .select("id, name, estimated_hours")
    .eq("id", projectId)
    .maybeSingle();

  // A read failure must not block a booking: failing closed here would stop
  // people logging real work because of an unrelated outage.
  if (projectError || !project) return proceed;

  const fallbackBudget =
    project.estimated_hours === null ? null : Number(project.estimated_hours);

  /*
   * The contract periods on this project. Read ALL of them rather than asking
   * the database for the one covering the date, because the answer needs two
   * facts, not one: which period applies, and whether the project has any
   * contract at all. Without the second, "no contract recorded" and "the
   * contract lapsed and nobody renewed it" are indistinguishable -- and the
   * second is the case worth warning about.
   *
   * The row count here is tiny (one per contract term), so a single read is
   * cheaper than two round trips.
   */
  const { data: periodRows } = await timeSchema(supabase)
    .from("project_contract_period")
    .select("id, period_no, budget_hours, starts_on, ends_on, warn_at_percent, contract_reference")
    .eq("project_id", projectId)
    // Ordered because it is paged-adjacent and because the newest period is the
    // one a human reading a log wants first.
    .order("period_no", { ascending: false });

  const periods = periodRows ?? [];
  // The entry's own date decides which contract judges it. Falls back to today
  // for a timer being started now.
  const onDate = (entryDate ?? new Date().toISOString()).slice(0, 10);

  const active = periods.find(
    (p: { starts_on: string; ends_on: string }) =>
      p.starts_on <= onDate && onDate <= p.ends_on,
  );

  const period: ContractPeriodInput | null = active
    ? {
        id: Number(active.id),
        periodNo: Number(active.period_no),
        budgetHours: Number(active.budget_hours),
        startsOn: active.starts_on,
        endsOn: active.ends_on,
        warnAtPercent:
          active.warn_at_percent === null ? null : Number(active.warn_at_percent),
        contractReference: active.contract_reference ?? null,
        daysRemaining: daysBetween(onDate, active.ends_on),
      }
    : null;

  /*
   * Cheap exit before summing thousands of rows. Only safe when there is
   * genuinely nothing to say: a project with no contract AND no estimate can
   * neither refuse nor warn, so the scan would be wasted. A project whose
   * contract has lapsed must NOT take this path -- that is the outside_contract
   * warning, and skipping the scan would swallow it.
   */
  const preflight = evaluateBudget({
    budgetHours: fallbackBudget,
    loggedHours: 0,
    requestedHours: 0,
    period,
    hasAnyPeriod: periods.length > 0,
  });
  if (preflight.level === "unbudgeted" && !preflight.warn) return proceed;

  // Sum what is already logged. Paged because PostgREST truncates at 1000 rows
  // silently, which on a busy project would understate the total and let an
  // overbooking through.
  let loggedSeconds = 0;
  for (let page = 0; page < 20; page += 1) {
    let q = timeSchema(supabase)
      .from("entry")
      .select("id, duration_seconds")
      .eq("project_id", projectId)
      .not("duration_seconds", "is", null)
      // Ordered: this sum decides whether a booking is REFUSED, so a paging
      // race that under-counts would let an overbooking through (and one that
      // over-counts would block honest work).
      .order("id", { ascending: true })
      .range(page * 1000, page * 1000 + 999);
    /*
     * Scope the sum to the contract period's window. This is what makes a
     * renewal mean anything: without it, period 2's budget would be spent the
     * moment it started because period 1's hours are still on the project.
     *
     * The window is compared on started_at as an instant. The database's own
     * view (time.contract_period_status) compares the Europe/Berlin calendar
     * date; the two agree except for entries within a couple of hours of
     * midnight on a boundary day, and the bound here is deliberately
     * inclusive-exclusive on the day after so no hour is dropped.
     */
    if (period) {
      q = q
        .gte("started_at", `${period.startsOn}T00:00:00+00:00`)
        .lt("started_at", `${addDays(period.endsOn, 1)}T00:00:00+00:00`);
    }
    const { data, error } = await q;
    if (error || !data) break;
    for (const row of data as { id: number; duration_seconds: number | null }[]) {
      if (excludeEntryId != null && Number(row.id) === Number(excludeEntryId)) continue;
      loggedSeconds += Number(row.duration_seconds) || 0;
    }
    if (data.length < 1000) break;
  }

  const decision: BudgetDecision = evaluateBudget({
    budgetHours: fallbackBudget,
    loggedHours: loggedSeconds / 3600,
    requestedHours: requestedSeconds / 3600,
    period,
    hasAnyPeriod: periods.length > 0,
  });

  // Nothing to say: the overwhelmingly common path, and it costs nothing.
  if (decision.allowed && !decision.warn) return proceed;

  const projectName = project.name ?? `Project ${projectId}`;

  // Record + notify. Deliberately awaited: a fire-and-forget promise in a Server
  // Action can be cut off when the response is sent, which would lose exactly
  // the alert the feature exists to produce.
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { data: memberRow } = await timeSchema(supabase)
    .from("member")
    .select("display_name")
    .eq("id", memberId)
    .maybeSingle();

  /*
   * Resolved HERE, before the alert is written, not at the refusal message
   * below. The row is stamped with this user's auth uid and the read policy on
   * public.overbooking_alert admits them on that alone, so the permission
   * decides what gets PERSISTED, not merely what gets displayed. Resolving it
   * after the insert -- which is what happened until 2026-09-03 -- is how the
   * redacted message ended up sitting next to an un-redacted copy of itself.
   */
  const actorCanSeeBudgets = await canReadBudgets(supabase);

  await notifyOverbooking({
    actorUserId: user?.id ?? null,
    actorMemberId: memberId,
    actorName: memberRow?.display_name ?? user?.email ?? `Member ${memberId}`,
    projectId,
    projectName,
    decision,
    source,
    actorCanSeeBudgets,
  });

  /*
   * An allowed-but-warned booking returns a WARNING, not a refusal. Keeping the
   * two apart in the return type is deliberate: a caller that treated a warning
   * as a refusal would block honest work, and one that dropped it would restore
   * the silence this feature exists to end.
   */
  /*
   * Whether this reader may be TOLD the figures.
   *
   * The guard's behaviour does not depend on this -- the booking is blocked or
   * allowed identically either way. Only the wording changes: without
   * projects:contracts:read the message names no budget, no logged total and no
   * overrun. Otherwise an employee could enumerate the whole portfolio's
   * commercial terms by attempting a one-hour booking against each project and
   * reading the refusals, which is a permission check answering the question it
   * was meant to refuse.
   *
   * Resolved here rather than inside the message helpers so those stay pure and
   * unit-testable.
   */
  const budgetsVisible = await canReadBudgets(supabase);

  if (decision.allowed) {
    return { refusal: null, warning: warningMessage(decision, projectName, budgetsVisible) };
  }

  return { refusal: refusalMessage(decision, projectName, budgetsVisible), warning: null };
}

/** Whole days from one ISO date to another; negative once the end has passed. */
function daysBetween(from: string, to: string): number {
  const a = Date.parse(`${from}T00:00:00Z`);
  const b = Date.parse(`${to}T00:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b)) return 0;
  return Math.round((b - a) / 86_400_000);
}

/** An ISO date shifted by whole days, used for an exclusive upper bound. */
function addDays(date: string, days: number): string {
  const t = Date.parse(`${date}T00:00:00Z`);
  if (Number.isNaN(t)) return date;
  return new Date(t + days * 86_400_000).toISOString().slice(0, 10);
}

// ─── Timer ───────────────────────────────────────────────────────────────────

/**
 * Start a timer: an entry with `started_at` set and `ended_at` still null.
 *
 * "At most one running timer per member" is enforced by the partial unique index
 * `time_entry_one_running_per_member`, not by the pre-check below. That ordering
 * matters: two rapid submissions can both pass a SELECT and then both INSERT, so
 * the index is what actually prevents a second timer silently double-counting an
 * afternoon. The pre-check exists only to turn 23505 into a sentence.
 *
 * `duration_seconds` is left null while running rather than set to 0. The check
 * constraint `entry_finished_has_duration` permits null only while `ended_at` is
 * null, and the UI renders null as "—" instead of "0:00", which would read as
 * "you logged nothing" while the clock is going.
 */
export async function startTimer(formData: FormData): Promise<TimeActionResult> {
  const supabase = await createClient();
  const auth = await authorise(supabase);
  if ("error" in auth) return auth.error;

  const projectId = optionalId(formData.get("project_id"));
  const taskId = optionalId(formData.get("task_id"));
  const serviceId = optionalId(formData.get("service_id"));
  const notes = optionalText(formData.get("notes"));
  const isBillable = formData.get("is_billable") === "on";

  // A timer with no project and no task is untraceable after the fact: it lands
  // in the week as an unattributed block nobody can attribute later. Requiring
  // one of the two is the lightest possible guard that keeps the data useful.
  if (projectId === null && taskId === null) {
    return { ok: false, message: await msg("pickProjectOrTaskTimer") };
  }

  const { data: existing } = await timeSchema(supabase)
    .from("entry")
    .select("id")
    .eq("member_id", auth.memberId)
    .is("ended_at", null)
    .limit(1)
    .maybeSingle();

  if (existing) {
    return { ok: false, message: await msg("timerAlreadyRunning") };
  }

  /*
   * Budget guard, BEFORE the work starts.
   *
   * A timer has no duration yet, so there are no hours to add -- this asks the
   * narrower question "is the budget already spent?". Catching it here is the
   * kind thing to do: the alternative is letting somebody track four hours and
   * only telling them the project was full when they try to stop.
   *
   * stopTimer deliberately does NOT check. Refusing to stop a running timer
   * would trap the user with a timer they cannot close and work they cannot
   * save, which is worse than recording an overrun we can see and report.
   */
  // Set by the budget guard when the write is allowed but worth flagging.
  let startWarning: string | null | undefined;
  {
    const { refusal, warning } = await checkBudget(supabase, {
      projectId,
      requestedSeconds: 0,
      memberId: auth.memberId,
      source: "start_timer",
    });
    if (refusal) return { ok: false, message: refusal };
    // Carried to the end of the action: the timer still has to start, and the
    // caution belongs on the successful result rather than replacing it.
    startWarning = warning;
  }

  // customer_id is derived from the chosen project rather than accepted from the
  // form: an entry whose customer contradicts its project's customer would
  // corrupt every per-customer rollup, and time.customer_summary has no way to
  // detect it.
  let customerId: number | null = null;
  if (projectId !== null) {
    const { data: project } = await timeSchema(supabase)
      .from("project")
      .select("customer_id")
      .eq("id", projectId)
      .maybeSingle();
    customerId = project?.customer_id ?? null;
  }

  const { error } = await timeSchema(supabase)
    .from("entry")
    .insert({
      member_id: auth.memberId,
      project_id: projectId,
      task_id: taskId,
      customer_id: customerId,
      service_id: serviceId,
      started_at: new Date().toISOString(),
      ended_at: null,
      duration_seconds: null,
      is_billable: isBillable,
      is_billed: false,
      notes,
      // 'timer' distinguishes live-tracked time from 'manual' backfill and from
      // 'trackingtime' imports, so the dashboard can tell them apart later.
      source_system: "timer",
      is_calendar: false,
    });

  if (error) {
    if (error.code === "23505") {
      return { ok: false, message: await msg("timerAlreadyRunning") };
    }
    return { ok: false, message: error.message };
  }

  revalidateTime();
  return startWarning ? { ok: true, warning: startWarning } : { ok: true };
}

/**
 * Stop the running timer and write its elapsed duration.
 *
 * The duration is `now() - started_at` measured here, from the value already in
 * the database. Nothing about the length of the entry comes from the client
 * (see rule 1 in the file header).
 *
 * A timer left running overnight is clamped to 24h rather than rejected: the
 * person still needs to be able to stop it, and a 400-hour entry from a forgotten
 * tab would distort every rollup it appears in. The clamp is reported so the
 * correction is visible rather than silent.
 */
export async function stopTimer(): Promise<TimeActionResult> {
  const supabase = await createClient();
  const auth = await authorise(supabase);
  if ("error" in auth) return auth.error;

  const { data: running } = await timeSchema(supabase)
    .from("entry")
    .select("id, started_at")
    .eq("member_id", auth.memberId)
    .is("ended_at", null)
    .limit(1)
    .maybeSingle();

  if (!running) return { ok: false, message: await msg("noTimerRunning") };

  const endedAt = new Date();
  const startedAt = new Date(running.started_at);
  const elapsed = Math.floor((endedAt.getTime() - startedAt.getTime()) / 1000);

  // Clock skew or a corrected server time can produce a negative interval.
  // `entry_duration_nonneg` would reject it, so floor at zero here to give the
  // user a stopped timer instead of a constraint violation.
  const clamped = Math.min(Math.max(elapsed, 0), MAX_ENTRY_SECONDS);
  const wasClamped = elapsed > MAX_ENTRY_SECONDS;

  // ended_at is derived from the clamped duration, not from `now()`, so the
  // stored interval and the stored duration always agree. Writing the real
  // `now()` alongside a clamped duration would violate the arithmetic every
  // report assumes (ended_at - started_at == duration_seconds).
  const consistentEnd = new Date(startedAt.getTime() + clamped * 1000);

  const { error } = await timeSchema(supabase)
    .from("entry")
    .update({
      ended_at: consistentEnd.toISOString(),
      duration_seconds: clamped,
      updated_at: new Date().toISOString(),
    })
    .eq("id", running.id);

  if (error) return { ok: false, message: error.message };

  revalidateTime();
  return {
    ok: true,
    message: wasClamped
      ? await msg("clampedAtDay")
      : undefined,
  };
}

/** Abandon the running timer, logging nothing. */
export async function discardTimer(): Promise<TimeActionResult> {
  const supabase = await createClient();
  const auth = await authorise(supabase);
  if ("error" in auth) return auth.error;

  const { error } = await timeSchema(supabase)
    .from("entry")
    .delete()
    .eq("member_id", auth.memberId)
    .is("ended_at", null);

  if (error) return { ok: false, message: error.message };

  revalidateTime();
  return { ok: true };
}

// ─── Manual entries ──────────────────────────────────────────────────────────

/**
 * Log a completed entry after the fact — the common case, since most people
 * reconstruct their day rather than run a timer all of it.
 *
 * Both ends are explicit rather than start-plus-duration. It matches how people
 * actually remember work ("9 to 11", not "two hours starting at 9"), and it means
 * `ended_at - started_at == duration_seconds` holds by construction rather than
 * by a second calculation that can disagree.
 */
export async function createEntry(formData: FormData): Promise<TimeActionResult> {
  const supabase = await createClient();
  const auth = await authorise(supabase);
  if ("error" in auth) return auth.error;

  const date = String(formData.get("date") || "").trim();
  const startTime = String(formData.get("start_time") || "").trim();
  const endTime = String(formData.get("end_time") || "").trim();

  const startedAt = combineInstant(date, startTime);
  const endedAt = combineInstant(date, endTime);

  if (!startedAt || !endedAt) {
    return { ok: false, message: await msg("invalidDateTime") };
  }

  const startMs = new Date(startedAt).getTime();
  const endMs = new Date(endedAt).getTime();

  // Both times are on the same calendar date by construction, so an end before
  // the start is a typo, not a shift crossing midnight. Telling the user to
  // split it is more honest than silently adding a day and inventing an
  // overnight shift they did not work.
  if (endMs <= startMs) {
    return {
      ok: false,
      message: await msg("endBeforeStartSplit"),
    };
  }

  const durationSeconds = Math.floor((endMs - startMs) / 1000);
  if (durationSeconds > MAX_ENTRY_SECONDS) {
    return { ok: false, message: await msg("tooLong") };
  }

  // Guard rails on the date, in both directions. Far-future time is not
  // trackable work, and unbounded backdating would let somebody rewrite an
  // already-invoiced month.
  const now = Date.now();
  if (startMs > now + 86_400_000) {
    return { ok: false, message: await msg("future") };
  }
  if (startMs < now - MAX_BACKDATE_DAYS * 86_400_000) {
    return {
      ok: false,
      message: await msg("tooFarBack", { days: MAX_BACKDATE_DAYS }),
    };
  }

  const projectId = optionalId(formData.get("project_id"));
  const taskId = optionalId(formData.get("task_id"));
  const serviceId = optionalId(formData.get("service_id"));
  const notes = optionalText(formData.get("notes"));
  const isBillable = formData.get("is_billable") === "on";

  if (projectId === null && taskId === null) {
    return { ok: false, message: await msg("pickProjectOrTaskEntry") };
  }

  // Budget guard: this path knows exactly how many hours are being added, so it
  // asks the full question and refuses the booking if it would breach.
  // Set by the budget guard when the write is allowed but worth flagging.
  let createWarning: string | null | undefined;
  {
    const { refusal, warning } = await checkBudget(supabase, {
      projectId,
      requestedSeconds: durationSeconds,
      memberId: auth.memberId,
      // The entry's OWN date picks the contract period, so backdating a
      // timesheet is judged against the contract in force then, not today's.
      entryDate: startedAt.slice(0, 10),
      source: "create_entry",
    });
    if (refusal) return { ok: false, message: refusal };
    createWarning = warning;
  }

  // Same reasoning as startTimer: the customer follows the project so no rollup
  // can be fed a contradictory pair.
  let customerId: number | null = null;
  if (projectId !== null) {
    const { data: project } = await timeSchema(supabase)
      .from("project")
      .select("customer_id")
      .eq("id", projectId)
      .maybeSingle();
    customerId = project?.customer_id ?? null;
  }

  const { error } = await timeSchema(supabase)
    .from("entry")
    .insert({
      member_id: auth.memberId,
      project_id: projectId,
      task_id: taskId,
      customer_id: customerId,
      service_id: serviceId,
      started_at: startedAt,
      ended_at: endedAt,
      duration_seconds: durationSeconds,
      is_billable: isBillable,
      is_billed: false,
      notes,
      source_system: "manual",
      is_calendar: false,
    });

  if (error) return { ok: false, message: error.message };

  revalidateTime();
  return createWarning ? { ok: true, warning: createWarning } : { ok: true };
}

/**
 * Change an entry's times, notes or billable flag.
 *
 * Deliberately does NOT accept `member_id` or `is_billed`. Reassigning an entry
 * to a colleague and marking your own time as invoiced are both things this form
 * has no business doing, and the RLS update policy pins `member_id` to the caller
 * in its WITH CHECK anyway. Omitting them from the update payload means a crafted
 * request cannot even attempt it.
 */
export async function updateEntry(formData: FormData): Promise<TimeActionResult> {
  const supabase = await createClient();
  const auth = await authorise(supabase);
  if ("error" in auth) return auth.error;

  const entryId = optionalId(formData.get("entry_id"));
  if (entryId === null) return { ok: false, message: await msg("noEntrySpecified") };

  // Fetch first so we can distinguish "does not exist or not yours" (RLS returns
  // no row) from "invoiced, so locked". Both would otherwise surface as an
  // update that silently affected zero rows and looked like success.
  const { data: existing } = await timeSchema(supabase)
    .from("entry")
    .select("id, member_id, is_billed, started_at, project_id")
    .eq("id", entryId)
    .maybeSingle();

  if (!existing) {
    return { ok: false, message: await msg("entryGoneEdit") };
  }
  if (existing.member_id !== auth.memberId) {
    return { ok: false, message: await msg("onlyOwnEdit") };
  }
  if (existing.is_billed) {
    return {
      ok: false,
      message: await msg("invoicedNoEdit"),
    };
  }

  const date = String(formData.get("date") || "").trim();
  const startTime = String(formData.get("start_time") || "").trim();
  const endTime = String(formData.get("end_time") || "").trim();

  const startedAt = combineInstant(date, startTime);
  const endedAt = combineInstant(date, endTime);

  if (!startedAt || !endedAt) {
    return { ok: false, message: await msg("invalidDateTime") };
  }

  const startMs = new Date(startedAt).getTime();
  const endMs = new Date(endedAt).getTime();

  if (endMs <= startMs) {
    return { ok: false, message: await msg("endBeforeStart") };
  }

  const durationSeconds = Math.floor((endMs - startMs) / 1000);
  if (durationSeconds > MAX_ENTRY_SECONDS) {
    return { ok: false, message: await msg("tooLong") };
  }

  const notes = optionalText(formData.get("notes"));
  const isBillable = formData.get("is_billable") === "on";

  /*
   * Budget guard on the EDIT, excluding this entry's own current hours.
   *
   * Without excludeEntryId a one-hour edit on a full project would compare
   * "everything logged (including this entry) + the new hours" against the
   * budget and refuse a change that actually REDUCES the total. The exclusion is
   * what makes shrinking an entry on an over-budget project possible, which is
   * exactly how somebody fixes an overrun.
   */
  // Set by the budget guard when the write is allowed but worth flagging.
  let updateWarning: string | null | undefined;
  {
    const { refusal, warning } = await checkBudget(supabase, {
      projectId: existing.project_id === null ? null : Number(existing.project_id),
      requestedSeconds: durationSeconds,
      excludeEntryId: entryId,
      memberId: auth.memberId,
      entryDate: startedAt.slice(0, 10),
      source: "update_entry",
    });
    if (refusal) return { ok: false, message: refusal };
    updateWarning = warning;
  }

  const { error } = await timeSchema(supabase)
    .from("entry")
    .update({
      started_at: startedAt,
      ended_at: endedAt,
      duration_seconds: durationSeconds,
      is_billable: isBillable,
      notes,
      updated_at: new Date().toISOString(),
    })
    .eq("id", entryId);

  if (error) return { ok: false, message: error.message };

  revalidateTime();
  return updateWarning ? { ok: true, warning: updateWarning } : { ok: true };
}

/**
 * Delete an entry.
 *
 * Scoped by `member_id` as well as `id` so a guessed id cannot delete somebody
 * else's row even if the RLS delete policy were ever loosened. The `is_billed`
 * check mirrors the policy: an invoiced entry is not the owner's to remove,
 * because the invoice already went out against it.
 */
export async function deleteEntry(formData: FormData): Promise<TimeActionResult> {
  const supabase = await createClient();
  const auth = await authorise(supabase);
  if ("error" in auth) return auth.error;

  const entryId = optionalId(formData.get("entry_id"));
  if (entryId === null) return { ok: false, message: await msg("noEntrySpecified") };

  const { data: existing } = await timeSchema(supabase)
    .from("entry")
    .select("id, member_id, is_billed")
    .eq("id", entryId)
    .maybeSingle();

  if (!existing) {
    return { ok: false, message: await msg("entryGoneDelete") };
  }
  if (existing.member_id !== auth.memberId) {
    return { ok: false, message: await msg("onlyOwnDelete") };
  }
  if (existing.is_billed) {
    return { ok: false, message: await msg("invoicedNoDelete") };
  }

  const { error } = await timeSchema(supabase)
    .from("entry")
    .delete()
    .eq("id", entryId)
    .eq("member_id", auth.memberId);

  if (error) return { ok: false, message: error.message };

  revalidateTime();
  return { ok: true };
}
