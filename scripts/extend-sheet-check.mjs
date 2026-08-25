// Two more assertions, from flaws the eye caught that the first pass did not:
// the sheet must not cover the tab bar that opened it, and it must not leave a
// blank slab below its own content.
import { readFileSync, writeFileSync } from "node:fs";

const path = "C:/Supabase/scripts/check-mobile-sheet.mjs";
let src = readFileSync(path, "utf8");

if (src.includes("does not cover the tab bar")) { console.log("already extended"); process.exit(0); }

const ANCHOR = 'check("every nav route is still reachable", open.links >= 6, `${open.links} links`);';

const EXTRA = `check("every nav route is still reachable", open.links >= 6, \`\${open.links} links\`);

// The two the screenshot caught and the geometry did not.
const layering = await page.evaluate(() => {
  const s = document.querySelector('[data-testid="mobile-sheet"]');
  const bar = document.querySelector('[data-testid="mobile-tab-bar"]');
  const rs = s.getBoundingClientRect(), rb = bar.getBoundingClientRect();
  // Blank space between the last thing in the sheet and the sheet's own bottom.
  const kids = [...s.querySelectorAll("*")].map((e) => e.getBoundingClientRect().bottom);
  const lastInk = kids.length ? Math.max(...kids.filter((b) => b <= rs.bottom + 1)) : rs.bottom;
  return {
    sheetBottom: Math.round(rs.bottom),
    barTop: Math.round(rb.top),
    overlap: Math.round(rs.bottom - rb.top),
    deadSpace: Math.round(rs.bottom - lastInk),
  };
});

check("sheet does not cover the tab bar it opened from", layering.overlap <= 0,
  \`sheet bottom \${layering.sheetBottom} vs bar top \${layering.barTop} (overlap \${layering.overlap}px)\`);
check("sheet has no dead space below its content", layering.deadSpace <= 24,
  \`\${layering.deadSpace}px of blank sheet below the last element\`);`;

src = src.replace(ANCHOR, EXTRA);
writeFileSync(path, src, "utf8");
console.log("two assertions added");
