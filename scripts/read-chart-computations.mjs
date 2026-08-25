// A description is only worth adding if it is TRUE, so establish what each
// figure is actually computed from before writing any prose. The traps here are
// specific and already known from earlier work on this codebase:
//
//   - "billable share" could mean billable/total hours, or billable/contracted
//   - utilisation is measured against a NOMINAL week, and which nominal matters
//     (the management page uses 1,304 planned hours a year at 75% capacity)
//   - portfolio health thresholds (over budget / at risk) are arbitrary numbers
//     someone chose, and the reader deserves to know them
//   - only 1,465 of 5,351 entries reach a hub project, so anything joined
//     through hub_project_id silently omits hours
import { readFileSync } from "node:fs";

const show = (rel, patterns, span = 3) => {
  const s = readFileSync(`C:/Supabase/${rel}`, "utf8");
  const lines = s.split("\n");
  console.log(`\n${"=".repeat(76)}\n${rel}`);
  lines.forEach((l, i) => {
    if (patterns.some((p) => p.test(l))) {
      const from = Math.max(0, i - 1), to = Math.min(lines.length - 1, i + span);
      for (let j = from; j <= to; j++) console.log(`  ${String(j + 1).padStart(4)}  ${lines[j].slice(0, 112)}`);
      console.log("       ---");
    }
  });
};

// How is billable share computed on the Overview?
show("src/app/(app)/page.tsx", [/billablePercent|billableShare|const billable/i], 4);

// Portfolio health thresholds.
show("src/app/(app)/projects/PortfolioCharts.tsx", [/const over|const risk|const health|burnPercent >/], 3);

// Utilisation: against what nominal?
show("src/app/(app)/team-lead/TeamAnalysisSection.tsx", [/utilisation|nominal/i], 3);
