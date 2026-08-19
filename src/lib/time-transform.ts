/**
 * Turning a TrackingTime `events/flat` row into a `time.entry`.
 *
 * Kept as pure functions, separate from the import runner, for one reason: this
 * is where the money is. Every hour figure in the platform flows through here,
 * and a unit error is silent — nothing throws, the numbers are just wrong by a
 * factor of 60 or 3600. Pure functions can be exercised against real payload
 * shapes in a test without a database or a network call, which is what
 * scripts/check-time-transform.mjs does.
 *
 * The rules below are not from vendor documentation. They come from measuring
 * 4,189 live events (docs/architecture/DISCOVERY-trackingtime.md).
 */

/** A row exactly as `events/flat` returns it — space-separated Title Case keys. */
export type FlatEvent = Record<string, unknown>;

/** The shape the importer upserts into `time.entry`. */
export type EntryDraft = {
  sourceId: string;
  memberSourceId: string;
  taskSourceId: string | null;
  projectSourceId: string | null;
  customerSourceId: string | null;
  serviceSourceId: string | null;
  startedAt: string;
  endedAt: string;
  durationSeconds: number;
  isBillable: boolean;
  isBilled: boolean;
  notes: string | null;
  timezone: string | null;
  sourceSystem: "trackingtime" | "calendar";
  isCalendar: boolean;
};

function str(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s.length ? s : null;
}

function bool(v: unknown): boolean {
  return v === true || v === "true" || v === 1 || v === "1";
}

/**
 * TrackingTime returns `"2026-08-17 07:30:00"` with no zone marker, and carries
 * the zone separately in a `Timezone` field. Treating the naive string as local
 * server time would shift every hour by the deployment's offset — a bug that
 * only shows up in production, and only for some users.
 *
 * The timestamps are UTC (verified: `Duration` equals End − Start exactly when
 * both are read as UTC, 800/800 sampled rows). `Timezone` is kept alongside so
 * the original wall-clock can be reconstructed for display.
 */
export function parseVendorTimestamp(raw: unknown): string | null {
  const s = str(raw);
  if (!s) return null;
  // Already zoned — trust it.
  if (/[zZ]$|[+-]\d{2}:?\d{2}$/.test(s)) {
    const d = new Date(s);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  }
  const d = new Date(s.replace(" ", "T") + "Z");
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/**
 * Seconds, never hours.
 *
 * `Duration` is authoritative and was verified arithmetically against
 * End − Start on every sampled row. It is still recomputed here when absent or
 * inconsistent, because a stored duration that disagrees with its own interval
 * is the kind of thing that survives for months: both numbers look plausible in
 * isolation and only a cross-check catches it.
 */
export function resolveDurationSeconds(
  rawDuration: unknown,
  startedAt: string | null,
  endedAt: string | null,
): number | null {
  const derived =
    startedAt && endedAt
      ? Math.round((new Date(endedAt).getTime() - new Date(startedAt).getTime()) / 1000)
      : null;

  const stated =
    typeof rawDuration === "number"
      ? rawDuration
      : typeof rawDuration === "string" && /^-?\d+$/.test(rawDuration.trim())
        ? Number(rawDuration)
        : null;

  if (stated === null) return derived !== null && derived >= 0 ? derived : null;
  if (stated < 0) return derived !== null && derived >= 0 ? derived : null;

  // Both present and they disagree by more than a rounding second: trust the
  // interval, because start/end are what a human can actually verify.
  if (derived !== null && derived >= 0 && Math.abs(derived - stated) > 1) return derived;

  return stated;
}

/**
 * Is this row calendar-sourced?
 *
 * Two independent signals, and they disagree often enough to matter: 96.5% of
 * GHOST events carry a CALENDAR_SYNC_* custom field, but 52 do not, and 494
 * PERSONAL events *do*. Either signal alone mislabels hundreds of rows, so both
 * are used.
 */
export function isCalendarSourced(e: FlatEvent): boolean {
  if (str(e["CALENDAR_SYNC_EVENT (Event CF)"])) return true;
  if (str(e["CALENDAR_SYNC_TASK (Task CF)"])) return true;
  return false;
}

/**
 * One flat event → one entry draft, or null when the row cannot be trusted.
 *
 * Returning null rather than throwing is deliberate: a single malformed row in
 * a 4,000-row import should be skipped and counted, not abort the run and leave
 * the table half-populated.
 */
export function toEntryDraft(e: FlatEvent): EntryDraft | null {
  const sourceId = str(e["ID"]);
  const memberSourceId = str(e["User Id"]);
  const startedAt = parseVendorTimestamp(e["Start"]);
  const endedAt = parseVendorTimestamp(e["End"]);

  // Without these four the row is not a time entry in any useful sense.
  if (!sourceId || !memberSourceId || !startedAt || !endedAt) return null;

  const durationSeconds = resolveDurationSeconds(e["Duration"], startedAt, endedAt);
  if (durationSeconds === null) return null;

  // An interval running backwards is corrupt, not merely odd. The DB CHECK
  // would reject it anyway; catching it here means a counted skip rather than a
  // failed batch.
  if (new Date(endedAt).getTime() < new Date(startedAt).getTime()) return null;

  const calendar = isCalendarSourced(e);

  return {
    sourceId,
    memberSourceId,
    taskSourceId: str(e["Task Id"]),
    projectSourceId: str(e["Project Id"]),
    customerSourceId: str(e["Customer Id"]),
    serviceSourceId: str(e["Service Id"]),
    startedAt,
    endedAt,
    durationSeconds,
    isBillable: bool(e["Is Billable"]),
    isBilled: bool(e["Is Billed"]),
    notes: str(e["Notes"]),
    timezone: str(e["Timezone"]),
    sourceSystem: calendar ? "calendar" : "trackingtime",
    isCalendar: calendar,
  };
}

/**
 * Travel classification, derived from the service name.
 *
 * The vendor encodes a real commercial distinction inside a free-text label:
 * "Anfahrt & Abfahrt / Travelltime (Payed)" vs "(unpayed)". Note the typo in
 * their own data — matching on "paid" would find nothing. Promoting this to
 * boolean columns at import means no downstream report has to repeat the match
 * and get it subtly wrong.
 */
export function classifyService(name: string): {
  isTravel: boolean;
  isPaidTravel: boolean;
  isInternal: boolean;
} {
  const n = name.toLowerCase();
  const isTravel = n.includes("travel") || n.includes("anfahrt") || n.includes("fahrtzeit");
  // Their spelling, not ours: "Payed"/"unpayed".
  const unpaid = /\bunpay?ed\b|\bunpaid\b/.test(n);
  return {
    isTravel,
    isPaidTravel: isTravel && !unpaid,
    isInternal: n === "intern" || n === "internal",
  };
}

/** Seconds → decimal hours, for display only. Never store the result. */
export function secondsToHours(seconds: number): number {
  return Math.round((seconds / 3600) * 100) / 100;
}

/** Seconds → "1:30", matching how the rest of the app shows durations. */
export function formatSeconds(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return "0:00";
  const total = Math.round(seconds / 60);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

/**
 * The Monday of the ISO week containing `date`, as YYYY-MM-DD.
 *
 * `getUTCDay()` returns 0 for Sunday, which under an ISO week (Monday-first)
 * belongs to the *previous* week. Getting that wrong moves a seventh of all
 * hours into the wrong week, and only on Sundays — which is exactly the sort of
 * bug that survives a demo.
 */
export function isoWeekStart(date: Date): string {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const dow = d.getUTCDay();
  d.setUTCDate(d.getUTCDate() - (dow === 0 ? 6 : dow - 1));
  return d.toISOString().slice(0, 10);
}

/** The Thursday of the ISO week containing `date`, in UTC. */
function thursdayOf(date: Date): Date {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  // (day + 6) % 7 maps Monday to 0 … Sunday to 6, so Sunday moves BACK to its
  // own Thursday rather than forward into the next week.
  d.setUTCDate(d.getUTCDate() + 3 - ((d.getUTCDay() + 6) % 7));
  return d;
}

/**
 * The ISO 8601 calendar week number — "KW"/"CW" as this business already
 * schedules in.
 *
 * A week belongs to the year containing its THURSDAY, which is the whole
 * difficulty and the reason this is not "how many Mondays have passed". Two
 * consequences a naive count gets wrong:
 *
 *   - 29 Dec 2025 is a Monday whose Thursday is 1 Jan 2026, so it is week 1 of
 *     2026, not week 53 of 2025.
 *   - 2020 has 53 ISO weeks. Anything that assumes 52 wraps the last one to 1
 *     and quietly folds a week of hours into the wrong bar.
 *
 * Anchoring on 4 January is the standard trick: it is the earliest date that is
 * always in week 1, so the Thursday of its week is week 1's Thursday.
 */
export function isoWeekNumber(date: Date): number {
  const thursday = thursdayOf(date);
  const jan4 = new Date(Date.UTC(thursday.getUTCFullYear(), 0, 4));
  const firstThursday = thursdayOf(jan4);
  return 1 + Math.round((thursday.getTime() - firstThursday.getTime()) / 604_800_000);
}
