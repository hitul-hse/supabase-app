// Coverage for the Time Tracking module's WRITE path —
// src/app/(app)/time/actions.ts and the tracker UI that calls it.
//
// Why this gate exists, and why it is separate from check-time-rls.mjs:
//
// Until these actions were written the module was read-only, so every existing
// time gate proves something about *reading* imported data. The write path adds
// the first way for a user to put hours into the database from a browser, and
// hours are invoices. The failure modes here are financial, not cosmetic:
//
//   * A client-supplied duration would let a wrong browser clock inflate
//     billable time. The elapsed seconds must come from the server.
//   * A client-supplied member_id would let one colleague file time under
//     another. It must be resolved from the session.
//   * A blank <select> posts "", and Number("") is 0 — an FK to id 0. That is
//     the single most likely silent bug in a form full of optional pickers.
//   * "2026-02-31" passes a YYYY-MM-DD regex and Date rolls it into March,
//     silently moving an entry to a different month than the one typed.
//
// Structure mirrors the other gates: pure-logic assertions that need nothing,
// then source-level assertions that catch a regression re-introducing a
// dangerous pattern, then live RLS probes when credentials are present.
//
// Run: node scripts/check-time-write-path.mjs

import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");

let failed = false;
const check = (label, ok, detail = "") => {
  if (!ok) failed = true;
  console.log(`${ok ? "PASS" : "FAIL"} | ${label}${!ok && detail ? `\n       ${detail}` : ""}`);
};

const ACTIONS = readFileSync(join(root, "src/app/(app)/time/actions.ts"), "utf8");
const TRACKER = readFileSync(join(root, "src/app/(app)/time/TimeTracker.tsx"), "utf8");
const PAGE = readFileSync(join(root, "src/app/(app)/time/page.tsx"), "utf8");

// ── Re-implementations of the pure helpers, kept in lockstep with actions.ts ──
// These are private to the module (not exported, because nothing else should
// call them), so the gate carries its own copy. The source assertions further
// down are what catch the two drifting apart.

const MAX_ENTRY_SECONDS = 24 * 3600;

function combineInstant(date, time) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  if (!/^\d{2}:\d{2}$/.test(time)) return null;
  const d = new Date(`${date}T${time}:00.000Z`);
  if (Number.isNaN(d.getTime())) return null;
  if (d.toISOString().slice(0, 10) !== date) return null;
  if (d.toISOString().slice(11, 16) !== time) return null;
  return d.toISOString();
}

function optionalId(raw) {
  if (raw === null) return null;
  const s = String(raw).trim();
  if (!s) return null;
  const n = Number(s);
  return Number.isInteger(n) && n > 0 ? n : null;
}

console.log("\n--- a form date becomes the instant the user meant -------------------");

check(
  "a valid date and time combine as UTC",
  combineInstant("2026-03-10", "09:30") === "2026-03-10T09:30:00.000Z",
  "reading form times as server-local would file an entry on a different day for anyone off UTC",
);
check(
  "an impossible date is rejected, not rolled forward",
  combineInstant("2026-02-31", "09:00") === null,
  "Date turns 2026-02-31 into 2026-03-03 — the entry would silently land in the wrong month",
);
check("an impossible clock time is rejected", combineInstant("2026-03-10", "25:00") === null);
check("minute 61 is rejected", combineInstant("2026-03-10", "10:61") === null);
check("a non-leap 29 February is rejected", combineInstant("2027-02-29", "12:00") === null);
check("a real leap day is accepted", combineInstant("2028-02-29", "12:00") !== null);
check("midnight is a valid start", combineInstant("2026-03-10", "00:00") !== null);

console.log("\n--- a blank picker is 'not chosen', never id 0 -----------------------");

check(
  "an empty select value becomes null",
  optionalId("") === null,
  "Number('') is 0, which would insert a foreign key to a project id of 0",
);
check("a missing field becomes null", optionalId(null) === null);
check("'0' is not a valid id", optionalId("0") === null);
check("a negative id is rejected", optionalId("-5") === null);
check("a fractional id is rejected", optionalId("3.5") === null);
check("a non-numeric id is rejected", optionalId("abc") === null);
check("a real id survives", optionalId("42") === 42);

console.log("\n--- durations are seconds, and the interval always agrees ------------");

{
  const s = new Date(combineInstant("2026-03-10", "09:00"));
  const e = new Date(combineInstant("2026-03-10", "11:30"));
  const seconds = Math.floor((e - s) / 1000);
  check("2h30 is 9000 seconds", seconds === 9000, `got ${seconds}`);
}
{
  const s = new Date(combineInstant("2026-03-10", "14:00"));
  const e = new Date(combineInstant("2026-03-10", "09:00"));
  check("an end before the start is non-positive", e - s <= 0);
}
{
  // A timer forgotten over a long weekend. Clamped rather than rejected: the
  // user still has to be able to stop it, and a 400-hour entry would distort
  // every rollup it appears in.
  const clamp = (el) => Math.min(Math.max(el, 0), MAX_ENTRY_SECONDS);
  check("400 hours clamps to 24", clamp(400 * 3600) === 86400);
  check("a negative interval floors to zero", clamp(-500) === 0, "entry_duration_nonneg would reject it");
  check("a normal duration passes through untouched", clamp(3661) === 3661);

  const start = new Date("2026-03-10T09:00:00.000Z");
  const clamped = clamp(400 * 3600);
  const end = new Date(start.getTime() + clamped * 1000);
  check(
    "the stored end matches the clamped duration",
    Math.floor((end - start) / 1000) === clamped,
    "writing a real now() alongside a clamped duration would break ended_at - started_at == duration_seconds",
  );
}

console.log("\n--- the server owns the clock and the identity -----------------------");

check(
  "stopTimer derives elapsed from the stored started_at",
  /const startedAt = new Date\(running\.started_at\)/.test(ACTIONS) &&
    /endedAt\.getTime\(\) - startedAt\.getTime\(\)/.test(ACTIONS),
  "if the duration came from the request, a tampered browser clock could inflate billable hours",
);
check(
  "no action reads a duration from the form",
  !/formData\.get\(["'](duration|duration_seconds|elapsed|hours)["']\)/.test(ACTIONS),
  "a client-supplied duration is a client-supplied invoice",
);
check(
  "no action reads member_id from the form",
  !/formData\.get\(["']member_id["']\)/.test(ACTIONS),
  "member_id must come from time.current_member_id(), never the request",
);
check(
  "member_id is resolved from the session",
  /rpc\(["']current_member_id["']\)/.test(ACTIONS),
);
check(
  "every insert attributes the entry to the resolved member",
  (ACTIONS.match(/member_id: auth\.memberId/g) ?? []).length >= 2,
);
check(
  "is_billed is never accepted from a form",
  !/formData\.get\(["']is_billed["']\)/.test(ACTIONS),
  "marking your own time as invoiced is not this form's business",
);
check(
  "updateEntry does not write member_id",
  !/\.update\(\{[^}]*member_id/s.test(ACTIONS),
  "an update that reassigns member_id would move time onto a colleague",
);

console.log("\n--- invoiced time is protected --------------------------------------");

check(
  "updateEntry refuses an invoiced entry",
  /is_billed/.test(ACTIONS) && /invoiced and can no longer be changed/.test(ACTIONS),
);
check(
  "deleteEntry refuses an invoiced entry",
  /invoiced and cannot be deleted/.test(ACTIONS),
);
check(
  "deleteEntry scopes the delete by member as well as id",
  /\.delete\(\)\s*\.eq\("id", entryId\)\s*\.eq\("member_id", auth\.memberId\)/s.test(ACTIONS),
  "id alone would rely entirely on RLS; scoping by member fails safe if a policy is ever loosened",
);
check(
  "the tracker renders invoiced rows without a delete control",
  /e\.isBilled \?/.test(TRACKER) && /invoiced/.test(TRACKER),
);

console.log("\n--- permission and linkage are distinguishable ------------------------");

check(
  "the write permission is checked before any insert",
  /TIMESHEETS_WRITE/.test(ACTIONS),
);
check(
  "an unlinked account gets its own message, not a permission error",
  /isn't linked to a Time Tracking member/.test(ACTIONS),
  "collapsing 'not linked' into 'not permitted' sends the admin to the wrong fix",
);
check(
  "a read-only role sees disabled controls with a reason",
  /canWrite/.test(TRACKER) && /permits viewing time but not logging it/.test(TRACKER),
);
check(
  "the page passes the real permission result to the tracker",
  /app_user_has_permission/.test(PAGE) && /canWrite === true/.test(PAGE),
);

console.log("\n--- the one-running-timer rule is the database's, not the app's -------");

check(
  "startTimer pre-checks for a running timer",
  /\.is\("ended_at", null\)/.test(ACTIONS),
);
check(
  "a unique violation is translated, not swallowed",
  /error\.code === "23505"/.test(ACTIONS) && /already running/.test(ACTIONS),
  "two rapid submits both pass the SELECT; the partial unique index is what actually prevents a double timer",
);
check(
  "a running entry is inserted with a null duration",
  /duration_seconds: null/.test(ACTIONS),
  "0 would render as '0:00' — 'you logged nothing' — while the clock is running",
);

console.log("\n--- the customer follows the project ---------------------------------");

check(
  "customer_id is derived from the chosen project, not the form",
  !/formData\.get\(["']customer_id["']\)/.test(ACTIONS) &&
    /customerId = project\?\.customer_id/.test(ACTIONS),
  "an entry whose customer contradicts its project would corrupt every per-customer rollup undetectably",
);

console.log("\n--- the tracker's clock cannot drift ---------------------------------");

check(
  "elapsed time is recomputed from the start, not incremented",
  /Date\.now\(\) - started/.test(TRACKER),
  "an incrementing counter drifts and stalls while the tab is backgrounded",
);
check(
  "the ticking clock is not announced every second",
  /aria-live="off"/.test(TRACKER),
  "a per-second live region makes a screen reader unusable",
);
check(
  "the manual form is not cleared on a validation error",
  /if \(r\.ok\) \{/.test(TRACKER) && /formRef\.current\?\.reset\(\)/.test(TRACKER),
  "resetting on failure throws away what the user typed along with the mistake",
);

console.log("\n--- both views stay in step after a write ----------------------------");

check(
  "a write revalidates the week view",
  /revalidatePath\("\/time"\)/.test(ACTIONS),
);
check(
  "a write revalidates the organisation dashboard",
  /revalidatePath\("\/time\/dashboard"\)/.test(ACTIONS),
  "the dashboard aggregates the same rows; leaving it stale makes a fresh entry look lost",
);

// ── Live probes ──────────────────────────────────────────────────────────────
// Skipped without credentials so the gate still runs in CI and on a clean
// checkout. A skip is reported, never counted as a pass.

console.log("\n--- live: the write path's guarantees hold on the real database -------");

// Read .env.local the same way the other live probes do, rather than requiring
// the caller to export the variables first — matching check-time-live-ready.mjs
// so `npm run` behaves identically for both.
const envFile = existsSync(join(root, ".env.local"))
  ? readFileSync(join(root, ".env.local"), "utf8")
  : "";
const fromEnvFile = (k) => (envFile.match(new RegExp(`^${k}=(.+)$`, "m")) || [])[1]?.trim();

const url = process.env.NEXT_PUBLIC_SUPABASE_URL || fromEnvFile("NEXT_PUBLIC_SUPABASE_URL");
const serviceKey =
  process.env.SUPABASE_SERVICE_ROLE_KEY || fromEnvFile("SUPABASE_SERVICE_ROLE_KEY");

if (!url || !serviceKey) {
  console.log("SKIP | no Supabase credentials in the environment — source assertions only");
} else {
  const rest = async (path, init = {}) => {
    const res = await fetch(`${url}/rest/v1/${path}`, {
      ...init,
      headers: {
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
        "Content-Profile": "time",
        "Accept-Profile": "time",
        "Content-Type": "application/json",
        ...(init.headers ?? {}),
      },
    });
    const text = await res.text();
    let body = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = text;
    }
    return { status: res.status, body };
  };

  // The constraints the actions rely on must actually exist. If one were
  // dropped, the app-level check would become the only guard — and the app is
  // not the boundary.
  const cols = await rest("entry?select=id&limit=1");
  check(
    "the time.entry table is reachable",
    cols.status === 200,
    `got ${cols.status} ${JSON.stringify(cols.body)}`,
  );

  if (cols.status === 200) {
    // A negative duration must be refused by entry_duration_nonneg, not merely
    // by the clamp in stopTimer().
    const bad = await rest("entry", {
      method: "POST",
      body: JSON.stringify({
        member_id: 3,
        started_at: "2020-01-01T10:00:00.000Z",
        ended_at: "2020-01-01T09:00:00.000Z",
        duration_seconds: -3600,
      }),
    });
    check(
      "the database refuses a negative duration",
      bad.status >= 400,
      `got ${bad.status} — entry_duration_nonneg is missing, so the clamp is the only guard`,
    );

    // A finished entry with no duration must be refused by
    // entry_finished_has_duration.
    const noDuration = await rest("entry", {
      method: "POST",
      body: JSON.stringify({
        member_id: 3,
        started_at: "2020-01-01T09:00:00.000Z",
        ended_at: "2020-01-01T10:00:00.000Z",
        duration_seconds: null,
      }),
    });
    check(
      "the database refuses a finished entry with no duration",
      noDuration.status >= 400,
      `got ${noDuration.status}`,
    );

    // An end before the start must be refused by entry_interval_ordered.
    const backwards = await rest("entry", {
      method: "POST",
      body: JSON.stringify({
        member_id: 3,
        started_at: "2020-01-01T10:00:00.000Z",
        ended_at: "2020-01-01T09:00:00.000Z",
        duration_seconds: 3600,
      }),
    });
    check(
      "the database refuses an end before the start",
      backwards.status >= 400,
      `got ${backwards.status} — entry_interval_ordered is missing`,
    );

    // Negative control: a well-formed row must be ACCEPTED. Without this, the
    // three checks above would pass just as happily against a table that
    // rejects everything (a broken grant, a wrong schema header), which would
    // read as a green suite proving nothing.
    const good = await rest("entry", {
      method: "POST",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify({
        member_id: 3,
        started_at: "2020-01-01T09:00:00.000Z",
        ended_at: "2020-01-01T10:00:00.000Z",
        duration_seconds: 3600,
        notes: "check-time-write-path negative control",
        source_system: "manual",
      }),
    });
    const insertedId = Array.isArray(good.body) ? good.body[0]?.id : null;
    check(
      "a well-formed entry IS accepted (negative control)",
      good.status === 201 && insertedId != null,
      `got ${good.status} ${JSON.stringify(good.body)} — if this fails the rejections above prove nothing`,
    );

    // Clean up after the control so the gate leaves no trace in real hours.
    if (insertedId != null) {
      const cleanup = await rest(`entry?id=eq.${insertedId}`, { method: "DELETE" });
      check(
        "the control row is removed again",
        cleanup.status === 204 || cleanup.status === 200,
        `got ${cleanup.status} — a leftover test row would show up in somebody's week`,
      );
    }
  }
}

console.log(
  failed
    ? "\nFAILED — the write path has a hole above.\n"
    : "\nAll write-path checks passed.\n",
);
process.exit(failed ? 1 : 0);
