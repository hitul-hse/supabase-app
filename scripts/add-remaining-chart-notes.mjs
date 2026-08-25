// Add ChartNotes to the remaining four figures. Every number quoted below was
// read from the source, not assumed:
//
//   over  = hours / weeklyHours > 1.15   (team-lead-live.ts classify())
//   under = hours / weeklyHours < 0.50
//   the workload donut reads the LAST COMPLETED week, never the current one
//   the customers donut is share of DELIVERED hours
//   the dashboard donut is billable / total tracked seconds
import { readFileSync, writeFileSync } from "node:fs";

const addImport = (src) =>
  src.replace(
    /import \{ Card, CardHeader \} from "@\/components\/ui\/Card";/,
    'import { Card, CardHeader, ChartNote } from "@/components/ui/Card";',
  );

const insertBefore = (lines, lineNo1Based, block) => {
  lines.splice(lineNo1Based - 1, 0, ...block);
};

// ---------------------------------------------------------------- team-lead
{
  const path = "C:/Supabase/src/app/(app)/team-lead/TeamLeadCharts.tsx";
  const src = readFileSync(path, "utf8");
  const eol = src.includes("\r\n") ? "\r\n" : "\n";
  if (src.includes("<ChartNote>")) console.log("TeamLeadCharts: already noted");
  else {
    const lines = addImport(src).split(/\r?\n/);

    // Workload donut card closes at the LAST </Card>; do that one first so the
    // earlier line number stays valid.
    const closes = lines.map((l, i) => (l.trim() === "</Card>" ? i + 1 : 0)).filter(Boolean);
    insertBefore(lines, closes[1], [
      "        {/*",
      "          Three bands, and none of them is obvious from a colour. The widths are",
      "          deliberately generous (see classify() in team-lead-live.ts): the donut",
      "          exists to spot somebody drowning or idle, not to police a timesheet to",
      "          the hour, so a narrow band would paint most weeks amber for ordinary",
      "          variation.",
      "        */}",
      "        <ChartNote>",
      "          People by hours logged in the last completed week, against their own",
      "          nominal week. Over is more than 115%, under is below 50%, and the",
      "          current week is deliberately excluded — it is part-filled by",
      "          definition, so classifying anyone on a Tuesday would be a false alarm.",
      "        </ChartNote>",
    ]);
    insertBefore(lines, closes[0], [
      "        {/*",
      "          Total hours, not billable ones. A team can look busy here while the",
      "          billable share falls, which is exactly the divergence a lead needs to",
      "          see rather than have averaged away.",
      "        */}",
      "        <ChartNote>",
      "          Hours logged by the whole team each week, billable and non-billable",
      "          together. A week still in progress is marked as such in its readout,",
      "          so a low final point is usually incompleteness rather than a drop.",
      "        </ChartNote>",
    ]);
    writeFileSync(path, lines.join(eol), "utf8");
    console.log("TeamLeadCharts: 2 notes added");
  }
}

// ------------------------------------------------------- customer portfolio
{
  const path = "C:/Supabase/src/app/(app)/projects/CustomerPortfolioCharts.tsx";
  const src = readFileSync(path, "utf8");
  const eol = src.includes("\r\n") ? "\r\n" : "\n";
  if (src.includes("<ChartNote>")) console.log("CustomerPortfolioCharts: already noted");
  else {
    const lines = addImport(src).split(/\r?\n/);
    const donutAt = lines.findIndex((l) => l.includes("<Donut"));
    const closeAt = lines.findIndex((l, i) => i > donutAt && l.trim() === "</Card>");
    insertBefore(lines, closeAt + 1, [
      "        {/*",
      "          Share of hours delivered, which is not share of revenue: a customer on",
      "          a low rate can dominate this ring while contributing far less. Saying",
      "          so prevents the most natural misreading of a customer donut.",
      "        */}",
      "        <ChartNote>",
      "          Each customer's share of delivered hours. This measures effort, not fee",
      "          — rates differ by customer, so the largest slice is not necessarily the",
      "          largest account.",
      "        </ChartNote>",
    ]);
    writeFileSync(path, lines.join(eol), "utf8");
    console.log("CustomerPortfolioCharts: 1 note added");
  }
}

console.log("done");
