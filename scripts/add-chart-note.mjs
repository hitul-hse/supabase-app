// Add a ChartNote primitive to Card.tsx: the one-line "how this is computed"
// caption that sits under a figure. Appended rather than edited in place, and
// CRLF-safe.
import { readFileSync, writeFileSync } from "node:fs";

const path = "C:/Supabase/src/components/ui/Card.tsx";
const src = readFileSync(path, "utf8");
const eol = src.includes("\r\n") ? "\r\n" : "\n";

if (src.includes("export function ChartNote")) { console.log("already present"); process.exit(0); }

const block = `
/**
 * The one line under a figure that says how it was computed.
 *
 * WHY THIS EXISTS. Every chart in the Hub already carries a text alternative
 * for screen readers -- \`Charts.tsx\` turns each caller's \`label\` into
 * \`role="img" aria-label\`, and all nine chart instances pass one. What none of
 * them had was an explanation a SIGHTED reader can see. "Billable share 63%" is
 * a number without a definition: share of tracked hours, or of contracted ones?
 * Utilisation against a 40-hour week, or against the 1,304 planned hours a year
 * the management page uses? Two readers reach different conclusions from the
 * same pixel, and neither can tell they disagree.
 *
 * A derived figure that does not state its own basis is not self-describing, it
 * is merely confident. This is the smallest honest fix: one muted line, in the
 * card, next to the thing it describes.
 *
 * WHY NOT A TOOLTIP. A definition hidden behind hover is unavailable on a phone,
 * unavailable to keyboard users who do not know to look, and absent from a
 * screenshot pasted into a board pack -- which is exactly where a misread number
 * does its damage. The cost is one line of 10px muted text.
 *
 * WHY NOT IN THE QUALIFIER. \`CardHeader\`'s qualifier states scope ("LAST 12
 * WEEKS - TRACKINGTIME"), which answers "over what period, from where". This
 * answers "counting what, over what denominator". Different questions, and
 * cramming both into one line beside the title makes the heading unreadable.
 */
export function ChartNote({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <p className={\`px-4 pb-3 text-[10px] leading-[1.45] text-[var(--text-faint)] \${className}\`}>
      {children}
    </p>
  );
}
`;

writeFileSync(path, src.replace(/\r?\n$/, "") + eol + block.replace(/\n/g, eol), "utf8");
console.log("ChartNote added to Card.tsx");
