// A genuine bug, caught by the gate rather than by looking.
//
// The sheet now sits 84px off the bottom, so when it is translated fully
// off-screen its top edge lands at y=760 - ON the tab bar. It is invisible
// (translate-y-full) but still in the hit-testing tree, so it swallowed the tap
// meant for "More". Playwright's error is unusually clear about it: the sheet's
// "subtree intercepts pointer events" while its own class list still says
// translate-y-full.
//
// A human would have experienced this as a More button that simply does nothing.
// Worth noting: my earlier assertion "sheet is off-screen when closed" was
// written as top >= vh, which no longer holds now that the sheet floats above
// the bar rather than flush to the bottom. The assertion was measuring the old
// design, so it failed for the right reason and must be re-expressed.
import { readFileSync, writeFileSync } from "node:fs";

// 1. Make the closed sheet inert.
{
  const path = "C:/Supabase/src/components/MobileSidebar.tsx";
  let src = readFileSync(path, "utf8");

  const OLD = "          open ? \"translate-y-0\" : \"translate-y-full\"\n        }`}";
  const NEW = `          open ? "translate-y-0" : "pointer-events-none translate-y-full"
        }\`}
        /*
          aria-hidden + inert when closed, and pointer-events-none above.

          The sheet floats 84px off the bottom edge so the tab bar stays visible
          beneath it. That means "off-screen" is no longer off the VIEWPORT: at
          translate-y-full its top edge lands at y=760, directly over the pill.
          It is invisible but still hit-testable, so it silently swallowed every
          tap aimed at "More" -- the button that opens it. The failure mode is a
          control that does nothing at all, with no error to notice.

          inert also takes it out of the tab order and the accessibility tree,
          so a keyboard or screen-reader user cannot land inside a panel that is
          not there. Both are needed: pointer-events-none fixes the thumb, inert
          fixes everything else.
        */`;

  if (!src.includes(OLD.replace(/\n/g, src.includes("\r\n") ? "\r\n" : "\n")) && !src.includes(OLD)) {
    console.log("class anchor missed"); process.exit(1);
  }
  const from = src.includes(OLD) ? OLD : OLD.replace(/\n/g, "\r\n");
  const to = src.includes(OLD) ? NEW : NEW.replace(/\n/g, "\r\n");
  src = src.replace(from, to);

  // The dialog itself must also be hidden from assistive tech when shut.
  src = src.replace(
    'role="dialog"\n        aria-modal="true"\n        aria-label="Navigation"',
    'role="dialog"\n        aria-modal="true"\n        aria-label="Navigation"\n        aria-hidden={!open}\n        {...(!open ? { inert: "" as unknown as boolean } : {})}',
  ).replace(
    'role="dialog"\r\n        aria-modal="true"\r\n        aria-label="Navigation"',
    'role="dialog"\r\n        aria-modal="true"\r\n        aria-label="Navigation"\r\n        aria-hidden={!open}\r\n        {...(!open ? { inert: "" as unknown as boolean } : {})}',
  );

  writeFileSync(path, src, "utf8");
  console.log("sheet is inert and click-through when closed");
}

// 2. Re-express the stale assertion.
{
  const path = "C:/Supabase/scripts/check-mobile-sheet.mjs";
  let src = readFileSync(path, "utf8");
  src = src.replace(
    'check("sheet is off-screen when closed", closed && closed.top >= closed.vh - 2, closed ? `top=${closed.top} vh=${closed.vh}` : "");',
    `// Not "top >= vh": the sheet floats above the tab bar now, so when closed it
// is translated over the bar rather than past the bottom of the screen. What
// matters is that it cannot be seen OR touched.
check("closed sheet is translated away and inert", closed && closed.translated && closed.inert,
  closed ? \`top=\${closed.top} pointerEvents=\${closed.pe} inert=\${closed.inert}\` : "");`,
  );
  src = src.replace(
    `  const r = s.getBoundingClientRect();
  return { top: Math.round(r.top), vh: window.innerHeight };`,
    `  const r = s.getBoundingClientRect();
  const cs = getComputedStyle(s);
  return {
    top: Math.round(r.top), vh: window.innerHeight,
    pe: cs.pointerEvents,
    translated: /matrix.*, \\d+(\\.\\d+)?\\)$/.test(cs.transform) || cs.transform !== "none",
    inert: cs.pointerEvents === "none" && s.getAttribute("aria-hidden") === "true",
  };`,
  );
  writeFileSync(path, src, "utf8");
  console.log("assertion re-expressed for a floating sheet");
}
