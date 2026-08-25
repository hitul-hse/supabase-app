// Last chart note: the per-team analysis block, which puts a weekly area and a
// utilisation gauge in one card. The gauge's basis is the subtle part - the
// source comment at line 76 says "counting only the weeks each person actually
// logged", which is a meaningfully different denominator from "every week in
// the window" and changes the number substantially for part-time or new staff.
import { readFileSync, writeFileSync } from "node:fs";

const path = "C:/Supabase/src/app/(app)/team-lead/TeamAnalysisSection.tsx";
const src = readFileSync(path, "utf8");
const eol = src.includes("\r\n") ? "\r\n" : "\n";

if (src.includes("<ChartNote>")) { console.log("already noted"); process.exit(0); }

const lines = src
  .replace(
    'import { Card, CardHeader } from "@/components/ui/Card";',
    'import { Card, CardHeader, ChartNote } from "@/components/ui/Card";',
  )
  .split(/\r?\n/);

// The block card's closing </Card> is the first one after the Gauge.
const gaugeAt = lines.findIndex((l) => l.includes("<Gauge"));
const closeAt = lines.findIndex((l, i) => i > gaugeAt && l.trim() === "</Card>");
if (closeAt < 0) { console.log("anchor not found"); process.exit(1); }

lines.splice(closeAt, 0, ...[
  "      {/*",
  "        The denominator is the part worth stating. Utilisation counts only the",
  "        weeks a person actually logged (see the computation above), not every",
  "        week in the window -- otherwise somebody who joined halfway through, or",
  "        who works part-time, reads as chronically under-used when they are not.",
  "      */}",
  "      <ChartNote>",
  "        Left: hours logged per week by this team, billable and non-billable.",
  "        Right: tracked hours against nominal capacity, counting only the weeks",
  "        each person logged, so part-time and mid-window starters are not shown",
  "        as under-used. The legend counts the last completed week only.",
  "      </ChartNote>",
]);

writeFileSync(path, lines.join(eol), "utf8");
console.log(`note inserted before line ${closeAt + 1}`);
