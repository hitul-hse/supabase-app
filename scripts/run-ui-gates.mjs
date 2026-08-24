/*
 * Run every UI-facing gate that could be affected by the card migration, and
 * report a one-line verdict per gate.
 *
 * WHY A RUNNER. There are 120 check-*.mjs scripts and the migration touched
 * ~35 components. Running them by hand invites running the convenient ones;
 * this runs every gate whose subject matter overlaps the changed files and
 * prints exit codes, so a gate that DIED (module not found, as the projects one
 * did) is not mistaken for a gate that passed.
 */
import { spawnSync } from "node:child_process";

const GATES = [
  "check-design-system.mjs",
  "check-projects-module.mjs",
  "check-people-module.mjs",
  "check-people-and-filters-ui.mjs",
  "check-theme-and-figures.mjs",
  "check-time-page-render.mjs",
  "check-time-dashboard-render.mjs",
  "check-time-analytics.mjs",
  "check-charts-ui.mjs",
  "check-org-chart-view.mjs",
  "check-time-org-chart-view.mjs",
  "check-records-tabs-ui.mjs",
  "check-contract-ui.mjs",
  "check-budget-alerts.mjs",
  "check-user-management-ui.mjs",
  "check-overview-filters.mjs",
  "check-team-analysis-ui.mjs",
  "check-sidebar-collapse.mjs",
  "check-page-length.mjs",
  "check-avatar-monogram.mjs",
  "check-brand-mark.mjs",
  "check-no-mock-data.mjs",
  "check-no-mockup-people.mjs",
  "check-dashboard-tables.mjs",
  "check-task-board-parents.mjs",
];

const results = [];
for (const gate of GATES) {
  const r = spawnSync(process.execPath, [`scripts/${gate}`], {
    encoding: "utf8",
    timeout: 300_000,
  });
  const out = `${r.stdout ?? ""}${r.stderr ?? ""}`;
  const fails = (out.match(/^FAIL:.*$/gm) ?? []).map((l) => l.trim());
  // A gate that throws prints no FAIL lines at all -- distinguish it explicitly,
  // because "0 failures" on a dead gate is the most dangerous green there is.
  const died = r.status !== 0 && fails.length === 0;
  results.push({ gate, status: r.status, fails, died, out });
}

let bad = 0;
for (const r of results) {
  if (r.died) {
    bad += 1;
    const firstError = (r.out.match(/^(Error|.*Error:).*$/m) ?? ["(no message)"])[0];
    console.log(`DIED  ${r.gate} — exit ${r.status} — ${firstError.trim().slice(0, 120)}`);
  } else if (r.fails.length > 0) {
    bad += 1;
    console.log(`FAIL  ${r.gate} — ${r.fails.length} failure(s)`);
    for (const f of r.fails) console.log(`        ${f.slice(0, 150)}`);
  } else {
    console.log(`ok    ${r.gate}`);
  }
}

console.log(`\n${results.length - bad}/${results.length} gates clean`);
process.exit(bad === 0 ? 0 : 1);
