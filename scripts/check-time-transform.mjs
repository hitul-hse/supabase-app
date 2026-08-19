// Coverage for src/lib/time-transform.ts -- the TrackingTime -> time.entry
// transform.
//
// Why this gate exists: every hour figure in the platform passes through these
// functions, and a unit or timezone error here is SILENT. Nothing throws; the
// numbers are simply wrong by a factor of 60, or shifted by two hours, and they
// still look entirely plausible on a dashboard. That is the worst failure mode
// available in this codebase, and this repo already stores Factorial in minutes
// and TrackingTime in seconds, so the confusion is not hypothetical.
//
// The payload fixtures below are real shapes taken from the live account
// (docs/architecture/DISCOVERY-trackingtime.md), including the vendor's own
// typo -- "Travelltime (unpayed)" -- because matching on "unpaid" would find
// nothing and quietly bill travel that should not be billed.
//
// Run: node --experimental-strip-types scripts/check-time-transform.mjs
import {
  parseVendorTimestamp,
  resolveDurationSeconds,
  isCalendarSourced,
  toEntryDraft,
  classifyService,
  secondsToHours,
  formatSeconds,
  isoWeekStart,
  isoWeekNumber,
} from "../src/lib/time-transform.ts";

let failed = false;
const check = (label, ok, detail = "") => {
  if (!ok) failed = true;
  console.log(`${ok ? "PASS" : "FAIL"} | ${label}${!ok && detail ? `\n       ${detail}` : ""}`);
};

console.log("\n--- timestamps are read as UTC, not server-local ---------------------");

{
  // The exact shape the vendor returns: naive, space-separated, no zone.
  const got = parseVendorTimestamp("2026-08-17 07:30:00");
  check(
    "a naive vendor timestamp is read as UTC",
    got === "2026-08-17T07:30:00.000Z",
    `got ${got} -- reading it as server-local shifts every hour by the deploy's offset`
  );
}
{
  const got = parseVendorTimestamp("2026-08-17T07:30:00+02:00");
  check("an explicitly zoned timestamp is respected", got === "2026-08-17T05:30:00.000Z", `got ${got}`);
}
{
  check("null in, null out", parseVendorTimestamp(null) === null);
  check("empty string is not a timestamp", parseVendorTimestamp("   ") === null);
  check("garbage is rejected, not coerced", parseVendorTimestamp("not a date") === null);
}

console.log("\n--- duration is SECONDS and is cross-checked -------------------------");

{
  // The measured case: 07:30 -> 08:30 is 3600 seconds.
  const s = "2026-08-17T07:30:00.000Z";
  const e = "2026-08-17T08:30:00.000Z";
  check("Duration 3600 for a one-hour interval is kept", resolveDurationSeconds(3600, s, e) === 3600);
  check("a missing Duration is derived from the interval", resolveDurationSeconds(null, s, e) === 3600);
  check(
    "a Duration that contradicts its interval loses to the interval",
    resolveDurationSeconds(60, s, e) === 3600,
    "a stored duration disagreeing with start/end is exactly the bug that survives for months"
  );
  check("a negative Duration is discarded", resolveDurationSeconds(-500, s, e) === 3600);
  check("a one-second rounding difference is tolerated", resolveDurationSeconds(3601, s, e) === 3601);
}
{
  // 55 min and 11 min, both observed live.
  check(
    "3300 seconds == 55 minutes",
    resolveDurationSeconds(3300, "2026-08-17T09:00:00.000Z", "2026-08-17T09:55:00.000Z") === 3300
  );
  check(
    "660 seconds == 11 minutes",
    resolveDurationSeconds(660, "2026-08-17T09:00:00.000Z", "2026-08-17T09:11:00.000Z") === 660
  );
}
{
  check("a numeric string Duration is accepted", resolveDurationSeconds("1800", null, null) === 1800);
  check("no duration and no interval yields null", resolveDurationSeconds(null, null, null) === null);
}

console.log("\n--- seconds are never confused with hours ----------------------------");

{
  check("3600s -> 1 hour", secondsToHours(3600) === 1);
  check("5400s -> 1.5 hours", secondsToHours(5400) === 1.5);
  check("3600s formats as 1:00", formatSeconds(3600) === "1:00");
  check("5400s formats as 1:30", formatSeconds(5400) === "1:30");
  check("660s formats as 0:11", formatSeconds(660) === "0:11");
  check("zero formats as 0:00", formatSeconds(0) === "0:00");
  check(
    "a full week of seconds is not mistaken for hours",
    secondsToHours(144000) === 40,
    `got ${secondsToHours(144000)} -- 40h logged must not read as 144000`
  );
}

console.log("\n--- calendar detection needs BOTH signals ----------------------------");

{
  check(
    "the event-level custom field marks it calendar",
    isCalendarSourced({ "CALENDAR_SYNC_EVENT (Event CF)": "Google Calendar Event" })
  );
  check(
    "the task-level custom field ALSO marks it calendar",
    isCalendarSourced({ "CALENDAR_SYNC_TASK (Task CF)": "Google Calendar Task" }),
    "494 PERSONAL events carry only this one -- checking a single field mislabels hundreds of rows"
  );
  check("neither field means not calendar", isCalendarSourced({ Notes: "x" }) === false);
  check("an explicit null is not a signal", isCalendarSourced({ "CALENDAR_SYNC_EVENT (Event CF)": null }) === false);
}

console.log("\n--- a real flat event becomes a draft --------------------------------");

{
  // A tagged PERSONAL event, the 64% case.
  const draft = toEntryDraft({
    ID: 127173831,
    "User Id": 527218,
    "Task Id": 19258025,
    "Project Id": 2774382,
    "Customer Id": 773333,
    "Service Id": 156240,
    Start: "2026-08-17 07:30:00",
    End: "2026-08-17 08:30:00",
    Duration: 3600,
    "Is Billable": true,
    "Is Billed": false,
    Notes: "Site walkthrough",
    Timezone: "GMT+02:00",
    "Task Type": "PERSONAL",
  });
  check("a tagged event maps to a draft", draft !== null);
  check("ids survive as text", draft?.sourceId === "127173831" && draft?.memberSourceId === "527218");
  check("duration is 3600 seconds", draft?.durationSeconds === 3600);
  check("billable survives", draft?.isBillable === true && draft?.isBilled === false);
  check("source is trackingtime, not calendar", draft?.sourceSystem === "trackingtime" && draft?.isCalendar === false);
  check("the vendor timezone is retained", draft?.timezone === "GMT+02:00");
}
{
  // The structural GHOST case: 46% of live rows, no customer and no project.
  const draft = toEntryDraft({
    ID: 118477558,
    "User Id": 527218,
    "Task Id": 15926902,
    "Project Id": null,
    "Customer Id": null,
    "Service Id": null,
    Start: "2026-08-12 09:00:00",
    End: "2026-08-12 09:30:00",
    Duration: 1800,
    "Is Billable": false,
    "Is Billed": false,
    "CALENDAR_SYNC_EVENT (Event CF)": "Google Calendar Event",
    "Task Type": "GHOST",
  });
  check("an untagged GHOST event still maps", draft !== null, "46% of live rows look like this");
  check(
    "no project and no customer is preserved as null, not invented",
    draft?.projectSourceId === null && draft?.customerSourceId === null
  );
  check("it is flagged as calendar-sourced", draft?.isCalendar === true && draft?.sourceSystem === "calendar");
}

console.log("\n--- bad rows are skipped, not thrown ---------------------------------");

{
  check("no ID -> skipped", toEntryDraft({ "User Id": 1, Start: "2026-08-17 09:00:00", End: "2026-08-17 10:00:00" }) === null);
  check("no User Id -> skipped", toEntryDraft({ ID: 1, Start: "2026-08-17 09:00:00", End: "2026-08-17 10:00:00" }) === null);
  check("no Start -> skipped", toEntryDraft({ ID: 1, "User Id": 1, End: "2026-08-17 10:00:00" }) === null);
  check(
    "an interval running backwards -> skipped",
    toEntryDraft({
      ID: 1,
      "User Id": 1,
      Start: "2026-08-17 10:00:00",
      End: "2026-08-17 09:00:00",
      Duration: 3600,
    }) === null,
    "the DB CHECK would reject it anyway; skipping here means a counted skip, not a failed batch"
  );
}

console.log("\n--- travel classification uses the vendor's own spelling -------------");

{
  const paid = classifyService("Anfahrt & Abfahrt / Travelltime (Payed)");
  check("paid travel is travel and paid", paid.isTravel && paid.isPaidTravel);

  const unpaid = classifyService("Anfahrt & Abfahrt / Travelltime (unpayed)");
  check(
    "UNPAID travel is travel but NOT paid",
    unpaid.isTravel && !unpaid.isPaidTravel,
    'the vendor writes "unpayed" -- matching on "unpaid" bills travel that should not be billed'
  );

  const sifa = classifyService("DGUV V2: Sifa / Safety Engeineer");
  check("a normal service is neither travel nor internal", !sifa.isTravel && !sifa.isInternal);

  check("'intern' is internal", classifyService("intern").isInternal);
  check(
    "a service merely containing 'intern' is NOT internal",
    classifyService("Internal Audit Consulting").isInternal === false,
    "substring matching here would silently reclassify billable consulting as internal"
  );
}

console.log("\n--- ISO weeks start on Monday ----------------------------------------");

{
  check("a Wednesday resolves to its Monday", isoWeekStart(new Date("2026-08-19T12:00:00Z")) === "2026-08-17");
  check("a Monday resolves to itself", isoWeekStart(new Date("2026-08-17T00:00:00Z")) === "2026-08-17");
  check(
    "a SUNDAY resolves BACK to the preceding Monday",
    isoWeekStart(new Date("2026-08-23T23:59:00Z")) === "2026-08-17",
    "getUTCDay() returns 0 for Sunday; untreated, a seventh of all hours lands in the wrong week"
  );
  check("the next Monday starts a new week", isoWeekStart(new Date("2026-08-24T00:00:00Z")) === "2026-08-24");
  check("a year boundary is handled", isoWeekStart(new Date("2027-01-01T12:00:00Z")) === "2026-12-28");
}

{
  // The calendar week shown on the dashboard's trend bars. A German consultancy
  // schedules in KW, so "CW 34" is the label people already use in email; a bar
  // reading "17 Aug" has to be translated in the reader's head every time.
  //
  // ISO 8601, not "how many Mondays have passed": a week belongs to the year
  // containing its THURSDAY. That rule is the whole difficulty, and every
  // assertion below is a case where a naive count gets a different answer.
  console.log("");
  check("a mid-year Monday is its ISO week", isoWeekNumber(new Date("2026-08-17T00:00:00Z")) === 34,
    String(isoWeekNumber(new Date("2026-08-17T00:00:00Z"))));
  check("every day of that week reports the same number",
    isoWeekNumber(new Date("2026-08-23T23:59:00Z")) === 34,
    "Sunday is the last day of the ISO week, not the first of the next");

  check("1 January can be week 1", isoWeekNumber(new Date("2026-01-01T00:00:00Z")) === 1);
  check("the following Monday starts week 2", isoWeekNumber(new Date("2026-01-05T00:00:00Z")) === 2);

  check(
    "a December date can belong to WEEK 1 OF THE NEXT YEAR",
    isoWeekNumber(new Date("2025-12-29T00:00:00Z")) === 1,
    "29 Dec 2025 is a Monday whose Thursday is 1 Jan 2026 — counting weeks within the calendar year gives 53 here",
  );

  check(
    "a 53-week year reports 53, not 1",
    isoWeekNumber(new Date("2020-12-31T00:00:00Z")) === 53,
    "2020 has 53 ISO weeks; a fixed 52 wraps this to 1 and hides a week of hours",
  );
}

console.log(failed ? "\nTIME TRANSFORM: FAILURES ABOVE\n" : "\nTIME TRANSFORM: all checks passed\n");
// process.exitCode, not process.exit(). Under --experimental-strip-types,
// exiting explicitly can race the loader's own teardown and abort with
// "Assertion failed: !(handle->flags & UV_HANDLE_CLOSING)" — exit code 127 and
// every check having passed, which reads as a failing suite for a reason that
// is not in this file. The same substitution was already made in the sync
// freshness reporter for the same class of bug.
process.exitCode = failed ? 1 : 0;
