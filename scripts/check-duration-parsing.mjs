// Duration parsing: turning what a person types into decimal hours.
//
// People type time in whatever notation is nearest to hand -- "1:30", "1.5",
// "90m", "1h30m". Forcing one canonical format is the friction that makes
// people log from memory on Friday, which is the data-quality problem the
// timer exists to fix.
//
// Bare numbers mean HOURS, deliberately NOT Clockify's rule (where 1-59 means
// minutes). That convention suits a duration field on one time entry; in a
// daily timesheet cell the ordinary values are 4, 6 and 8, and reading "8" as
// eight minutes would silently under-log most of a working day. Minutes need
// an explicit unit or clock notation. These cases are pinned because a first
// pass at this file did copy Clockify and was wrong for exactly this reason.
import { parseDuration, formatDuration } from "../src/lib/duration.ts";

let failed = false;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}: ${name}${detail ? " — " + detail : ""}`);
  if (!ok) failed = true;
};

const eq = (input, expected) => {
  const actual = parseDuration(input);
  check(`"${input}" -> ${expected}`, actual === expected, `got ${actual}`);
};

// Clock notation
eq("1:30", 1.5);
eq("0:45", 0.75);
eq("8:00", 8);
eq("12:15", 12.25);

// Decimal hours. Comma matters: this is a German company and "1,5" is how
// half past one o'clock's worth of work gets typed here.
eq("1.5", 1.5);
eq("1,5", 1.5);
eq("0.25", 0.25);
eq(".5", 0.5);

// Unit notation
eq("90m", 1.5);
eq("30m", 0.5);
eq("2h", 2);
eq("1h30m", 1.5);
eq("1h30", 1.5);

// Bare numbers are hours -- the single most common case in a daily grid.
eq("8", 8);
eq("6", 6);
eq("4", 4);
eq("1", 1);
eq("24", 24);
// Minutes require saying so.
eq("30m", 0.5);
eq("0:30", 0.5);
// Beyond a day in one cell is a typo, not a very long shift.
eq("25", null);
eq("99", null);
eq("1234", null);

// Whitespace and case are not the user's problem
eq(" 1:30 ", 1.5);
eq("1H30M", 1.5);

// Rejections -- these must be null, not a silently wrong number
const rejects = ["", "   ", "abc", "1:99", "--", "1:2:3", "12:60"];
for (const bad of rejects) {
  const actual = parseDuration(bad);
  check(`"${bad}" is rejected`, actual === null, `got ${actual}`);
}

// Formatting back out
const fmt = (hours, expected) =>
  check(`format ${hours} -> "${expected}"`, formatDuration(hours) === expected, `got "${formatDuration(hours)}"`);

fmt(1.5, "1:30");
fmt(0.75, "0:45");
fmt(8, "8:00");
fmt(0, "0:00");
fmt(-1, "0:00");

// Round-trip: whatever we display must parse back to the same value, or the
// grid silently mutates numbers every time someone tabs through a cell.
for (const hours of [0.25, 0.5, 1, 1.5, 2.25, 7.75, 8]) {
  const roundTripped = parseDuration(formatDuration(hours));
  check(`round-trip ${hours}`, roundTripped === hours, `got ${roundTripped}`);
}

console.log(failed ? "\nduration parsing has gaps." : "\nduration parsing holds.");
process.exit(failed ? 1 : 0);
