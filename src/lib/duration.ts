/**
 * Parsing human-typed durations into decimal hours.
 *
 * People type time in whatever notation is nearest to hand -- "1:30", "1.5",
 * "90m", "1h30m". Forcing one canonical format is the friction that makes
 * people log from memory on Friday, which is the data-quality problem the
 * live timer exists to fix.
 *
 * Bare numbers mean HOURS here, deliberately departing from Clockify, whose
 * documented rule is that 1-59 means minutes. That rule fits a duration field
 * on a single time entry; it is actively wrong in a daily timesheet cell,
 * where the ordinary values are 4, 6 and 8 and reading "8" as eight minutes
 * would cause silent, large under-logging. Minutes therefore need an explicit
 * unit ("30m") or clock notation ("0:30").
 *
 * See scripts/check-duration-parsing.mjs.
 */

/** Decimal hours, or null when the input isn't a duration at all. */
export function parseDuration(input: string): number | null {
  const text = input.trim().toLowerCase().replace(/\s+/g, "");
  if (!text) return null;

  // "1:30" -- clock notation. Minutes must be 0-59; "12:60" is a typo, not
  // thirteen hours, so it's rejected rather than silently normalised.
  const clock = /^(\d+):([0-5]\d)$/.exec(text);
  if (clock) return round(Number(clock[1]) + Number(clock[2]) / 60);

  // "1h30m" / "2h" / "90m" / "1h30" -- unit notation.
  if (/[hm]/.test(text)) {
    const unit = /^(?:(\d+(?:[.,]\d+)?)h)?(?:(\d+(?:[.,]\d+)?)m?)?$/.exec(text);
    if (unit && (unit[1] !== undefined || unit[2] !== undefined)) {
      const hours = unit[1] ? Number(unit[1].replace(",", ".")) : 0;
      const minutes = unit[2] ? Number(unit[2].replace(",", ".")) : 0;
      return round(hours + minutes / 60);
    }
    return null;
  }

  // Decimal hours. The comma form matters: this is a German company, and
  // rejecting "1,5" would be a daily annoyance.
  if (/^\d*[.,]\d+$/.test(text)) return round(Number(text.replace(",", ".")));

  if (/^\d+$/.test(text)) {
    const n = Number(text);
    // Beyond a full day in one cell is a typo, not a very long shift.
    return n <= 24 ? n : null;
  }

  return null;
}

/** Decimal hours -> "1:30", the form the timesheet grid displays. */
export function formatDuration(hours: number): string {
  if (!Number.isFinite(hours) || hours <= 0) return "0:00";
  const totalMinutes = Math.round(hours * 60);
  return `${Math.floor(totalMinutes / 60)}:${String(totalMinutes % 60).padStart(2, "0")}`;
}

/** Two decimal places, matching the numeric precision stored for `hours`. */
function round(value: number): number {
  return Math.round(value * 100) / 100;
}
