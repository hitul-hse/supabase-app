// Insert the two Overview ChartNotes by line number, which avoids fighting the
// file's indentation with literal-string matching. CRLF-safe.
import { readFileSync, writeFileSync } from "node:fs";

const path = "C:/Supabase/src/app/(app)/page.tsx";
const src = readFileSync(path, "utf8");
const eol = src.includes("\r\n") ? "\r\n" : "\n";
const lines = src.split(/\r?\n/);

if (src.includes("<ChartNote>")) { console.log("notes already present"); process.exit(0); }

const billableNote = [
  "        {/*",
  '          "Billable share" is ambiguous without a denominator: share of tracked',
  "          hours, or share of contracted capacity? The two give very different",
  "          numbers from the same week. Stating which one stops a reader taking",
  "          63% of logged time as 63% of their working week.",
  "        */}",
  "        <ChartNote>",
  "          Billable hours as a share of all tracked hours in this period. The",
  "          denominator is time actually logged, not contracted capacity —",
  "          utilisation, in the card beside this one, answers that instead.",
  "        </ChartNote>",
];

const gaugeNote = [
  "        {/*",
  "          The 40h nominal is the assumption most likely to be misread, and it is",
  "          not the only one in the app: the management page reckons capacity as",
  "          1,304 planned hours a year at 75% billable. A reader comparing the two",
  "          figures needs to know they rest on different bases.",
  "        */}",
  "        <ChartNote>",
  "          Tracked hours against a nominal 40-hour week, averaged over people who",
  "          logged time in the period. People with no hours are left out rather",
  "          than counted as zero, so this is the average of those working.",
  "        </ChartNote>",
];

// Anchors, found by reading the file: line 486 closes the billable-split Card,
// and the Utilisation card's </Card> follows its Gauge block.
const idxBillable = lines.findIndex((l, i) => i > 480 && i < 492 && l.trim() === "</Card>");
if (idxBillable < 0) { console.log("billable anchor not found"); process.exit(1); }

lines.splice(idxBillable, 0, ...billableNote);

// After the splice the gauge card's </Card> has moved; find the next one that
// follows the Gauge element.
const gaugeAt = lines.findIndex((l) => l.includes("<Gauge"));
const idxGauge = lines.findIndex((l, i) => i > gaugeAt && l.trim() === "</Card>");
if (idxGauge < 0) { console.log("gauge anchor not found"); process.exit(1); }
lines.splice(idxGauge, 0, ...gaugeNote);

writeFileSync(path, lines.join(eol), "utf8");
console.log(`inserted billable note at ~${idxBillable + 1}, gauge note at ~${idxGauge + 1}`);
