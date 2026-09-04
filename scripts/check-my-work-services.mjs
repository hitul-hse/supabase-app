/*
 * Does /my-work's SERVICE column tell the truth about what it is showing?
 *
 * The only service signal that exists today is the TrackingTime tag on
 * time.project.service_id -- crm.framework_agreement, the table shaped for a
 * real contractual "agreed services" fact, is empty (0 rows, verified live).
 * Calling the column "agreed services" would state a commercial fact the data
 * does not support, so this gate asserts the honest label stuck and a
 * contractual-sounding one never crept back in.
 *
 * It also asserts the coverage discipline every other total on this page
 * already follows (measuredProjectCount): a project with no time.project row
 * renders n/a, never a blank cell or an invented service, and the page states
 * how many of the total are actually known rather than presenting a partial
 * list as if it were complete.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = fileURLToPath(new URL("..", import.meta.url));

let failures = 0;
const check = (l, ok, d = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}: ${l}${d ? `\n        ${d}` : ""}`);
  if (!ok) failures += 1;
};

const q = readFileSync(join(REPO, "src/lib/queries/my-work.ts"), "utf8");
const tables = readFileSync(join(REPO, "src/components/my-work/MyWorkTables.tsx"), "utf8");
const summary = readFileSync(join(REPO, "src/components/my-work/MyWorkSummary.tsx"), "utf8");
const page = readFileSync(join(REPO, "src/app/(app)/my-work/page.tsx"), "utf8");

/* ------------------------------------------------- the read is unpermissioned */

check(
  "fetchMyServices reads time.project joined to time.service, not a budget-gated table",
  /function fetchMyServices/.test(q) && /\.from\("project"\)\s*\n\s*\.select\("hub_project_id, service:service_id\(name\)"\)/.test(q),
  "both carry an `authenticated can read` RLS policy with no permission check, verified live -- this feature needs no new grant",
);

check(
  "the service fold is a DISTINCT SET per project, not a 1:1 value",
  /servicesByProject\.get\(p\.id\) \?\? new Set<string>\(\)/.test(q) || /new Map<string, Set<string>>/.test(q),
  "4 of Mathias's 54 live projects carry two time.project rows, so a project can legitimately have more than one service",
);

/* ---------------------------------------------------- honest coverage, not a lie */

check(
  "totals carry a service coverage count, the same pattern as measuredProjectCount",
  /serviceCoverage: \{ known: number; total: number \}/.test(q),
);

check(
  "coverage is counted from services actually present, not assumed for every project",
  /known: rows\.filter\(\(r\) => r\.services\.length > 0\)\.length/.test(q),
);

check(
  "the live table renders an uncovered project as n/a, never a blank cell",
  /r\.services\.length > 0 \? r\.services\.join\(" · "\) : "n\/a"/.test(tables),
);

/* --------------------------------------------------------- the label is honest */

// UPPERCASE only: every real UI label in this file is uppercase ("SERVICE",
// "SERVICES KNOWN", "MY PROJECTS"...), so this catches an actual displayed
// label without tripping on the lowercase prose in the comments that
// deliberately explain why the claim is NOT made.
const CONTRACTUAL_LABEL = /AGREED SERVICE/;

check(
  "no displayed label claims a contractual 'agreed services' fact",
  ![tables, summary].some((s) => CONTRACTUAL_LABEL.test(s)),
  "crm.framework_agreement is 0 rows live -- the data only supports a TrackingTime tag, and the UI must say so",
);

check(
  "the summary strip labels the figure by its real source (TrackingTime)",
  /TrackingTime/.test(summary),
);

check(
  "the live projects table exposes a SERVICE column",
  /header: "SERVICE"/.test(tables),
);

check(
  "the live customers table exposes a SERVICES column",
  /header: "SERVICES"/.test(tables),
);

/* --------------------------------------------- MyWorkSummary receives real data */

check(
  "the page passes the real coverage total into the summary strip, not a placeholder",
  /serviceCoverage=\{work\.totals\.serviceCoverage\}/.test(page),
);

console.log(failures === 0 ? "\nMY WORK SERVICES: OK" : `\nMY WORK SERVICES: ${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
