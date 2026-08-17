// Reports how fresh the TrackingTime data actually is, against the LIVE
// project — the operational counterpart to the dashboard's freshness banner.
//
// Two callers, deliberately:
//   * the sync workflow, as a post-run summary (`if: always()`), so a failed
//     sync says how old the data now is rather than only that it failed;
//   * a human asking "is the dashboard current?" without opening the app.
//
// Exits 0 when the last successful run is recent, 1 when the data is stale or
// no successful run has ever been recorded. The workflow calls it with `|| true`
// because it is a report, not a gate: a stale read should not turn a green sync
// red, it should be visible.
//
// Skips cleanly with exit 0 when there are no credentials, so it can sit in a
// pipeline that also runs on forks and pull requests without failing them.
import { readFileSync, existsSync } from "node:fs";

const STALE_AFTER_HOURS = 24;
const MISSING_AFTER_HOURS = 24 * 7;

const env = { ...process.env };
if (existsSync(".env.local")) {
  for (const line of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (m && !env[m[1]]) env[m[1]] = m[2].trim();
  }
}

const url = env.NEXT_PUBLIC_SUPABASE_URL;
const key = env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !key) {
  console.log("SYNC FRESHNESS: skipped — no live credentials");
  process.exit(0);
}

const headers = {
  apikey: key,
  Authorization: `Bearer ${key}`,
  "Accept-Profile": "raw",
};

const res = await fetch(
  `${url}/rest/v1/sync_run?select=id,entity,started_at,finished_at,status,record_count,cursor_ref` +
    `&source=eq.trackingtime&order=started_at.desc&limit=10`,
  { headers },
);

if (res.status !== 200) {
  console.error(`SYNC FRESHNESS: cannot read raw.sync_run (${res.status})`);
  process.exit(1);
}

const runs = await res.json();

if (runs.length === 0) {
  console.log("SYNC FRESHNESS: no sync has ever been recorded");
  process.exit(1);
}

console.log("recent runs:");
for (const r of runs.slice(0, 5)) {
  const started = r.started_at ? new Date(r.started_at) : null;
  const finished = r.finished_at ? new Date(r.finished_at) : null;

  // A negative duration is not cosmetic: it means started_at/finished_at do not
  // bracket the work, which is exactly the bug the importer had (started_at
  // defaulted to now() at INSERT, i.e. after finished_at had been computed).
  // Surfaced rather than formatted away, so a regression is visible here first.
  const secs = started && finished ? (finished.getTime() - started.getTime()) / 1000 : null;
  const duration =
    secs === null ? "unfinished" : secs < 0 ? `${secs.toFixed(1)}s (INVALID)` : `${secs.toFixed(1)}s`;

  console.log(
    `  #${String(r.id).padStart(3)} ${r.status.padEnd(7)} ${r.entity.padEnd(12)} ` +
      `${(r.started_at ?? "").slice(0, 19).replace("T", " ")}  ${duration.padStart(16)}  ` +
      `${r.record_count ?? "—"} rows${r.cursor_ref ? `  (${r.cursor_ref})` : ""}`,
  );
}

const lastOk = runs.find((r) => r.status === "ok" && r.finished_at);

if (!lastOk) {
  console.log("\nSYNC FRESHNESS: no SUCCESSFUL run on record — the dashboard is a manual snapshot");
  process.exit(1);
}

const hours = Math.floor((Date.now() - new Date(lastOk.finished_at).getTime()) / 3_600_000);
const failedSince = runs.filter(
  (r) => r.status === "failed" && new Date(r.started_at) > new Date(lastOk.finished_at),
).length;

const label = hours >= MISSING_AFTER_HOURS ? "MISSING" : hours >= STALE_AFTER_HOURS ? "STALE" : "OK";

console.log(
  `\nlast success: ${lastOk.finished_at.slice(0, 19).replace("T", " ")} ` +
    `(${hours}h ago, ${lastOk.record_count ?? "?"} rows)`,
);
if (failedSince > 0) {
  console.log(`WARNING: ${failedSince} failed run(s) since — the data is correct but not updating`);
}
console.log(`\nSYNC FRESHNESS: ${label}`);

// process.exitCode, NOT process.exit(). On Windows, process.exit() while the
// fetch keep-alive socket is still closing trips a libuv assertion
// (`!(handle->flags & UV_HANDLE_CLOSING)`) and the process dies with
// 0xC0000409 instead of the status set here -- observed on this exact script.
// Setting the code and letting the loop drain reports the real result.
process.exitCode = label === "OK" && failedSince === 0 ? 0 : 1;
