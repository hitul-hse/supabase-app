// For each rendered chart, extract what the reader is told: the title, any
// hint/subtitle, the aria label passed to the primitive, and the footnote. This
// is the raw material for writing accurate descriptions - and shows exactly
// which figures currently say nothing about what they mean.
import { readFileSync } from "node:fs";

const FILES = [
  "src/app/(app)/page.tsx",
  "src/app/(app)/projects/PortfolioCharts.tsx",
  "src/app/(app)/projects/CustomerPortfolioCharts.tsx",
  "src/app/(app)/team-lead/TeamAnalysisSection.tsx",
  "src/app/(app)/team-lead/TeamLeadCharts.tsx",
  "src/app/(app)/time/dashboard/BillableDonut.tsx",
  "src/app/(app)/time/dashboard/page.tsx",
  "src/app/(app)/time/dashboard/TrendChart.tsx",
];

for (const rel of FILES) {
  const s = readFileSync(`C:/Supabase/${rel}`, "utf8");
  const lines = s.split("\n");
  console.log(`\n${"=".repeat(78)}\n${rel}`);

  lines.forEach((l, i) => {
    const t = l.trim();
    // The chart call sites and everything that labels them.
    if (/<(AreaTrend|Donut|Gauge|TrendChart)\b/.test(t)
      || /^label=|^\s*label=/.test(t)
      || /title=|hint=|caption=/.test(t)
      || /aria-label=/.test(t)) {
      console.log(`  ${String(i + 1).padStart(4)}  ${t.slice(0, 116)}`);
    }
  });
}
