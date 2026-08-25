// Same stale expectation as before, in the dismissal check: `top >= vh` assumed
// the sheet parks below the viewport. It now parks over the tab bar at y=760,
// so a successful dismissal reports 760 and reads as a failure.
//
// Reuse the same behavioural rule the open/closed check now uses, so the two
// cannot drift apart again.
import { readFileSync, writeFileSync } from "node:fs";

const path = "C:/Supabase/scripts/check-mobile-sheet.mjs";
let src = readFileSync(path, "utf8");

src = src.replace(
  `const after = await page.evaluate(() => {
  const s = document.querySelector('[data-testid="mobile-sheet"]');
  return { top: Math.round(s.getBoundingClientRect().top), vh: window.innerHeight };
});
check("tapping the backdrop closes it", after.top >= after.vh - 2, \`top=\${after.top}\`);`,
  `const after = await page.evaluate(() => {
  const s = document.querySelector('[data-testid="mobile-sheet"]');
  const r = s.getBoundingClientRect();
  return {
    top: Math.round(r.top),
    vh: window.innerHeight,
    // Same rule as the closed-state check above: displaced out of the way and
    // no longer taking taps. Not "below the viewport" -- the sheet parks over
    // the tab bar now, so its resting top is ~760 on a 844px screen.
    displaced: Math.round(r.top) >= window.innerHeight - 120,
    untouchable: getComputedStyle(s).pointerEvents === "none",
  };
});
check("tapping the backdrop closes it", after.displaced && after.untouchable,
  \`top=\${after.top} displaced=\${after.displaced} pointerEvents=\${after.untouchable}\`);`,
);

writeFileSync(path, src, "utf8");
console.log("dismissal assertion aligned with the floating design");
