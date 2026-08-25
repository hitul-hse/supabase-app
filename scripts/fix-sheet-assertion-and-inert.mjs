// My assertion was wrong, not the component.
//
// Tailwind v4 implements translate-y-full with the standalone CSS `translate`
// property, not `transform`. getComputedStyle confirms it: transform is "none"
// while translate is "0px 100%". The sheet really is displaced by its full
// height; I was reading the property that used to carry it in v3.
//
// The right assertion is behavioural rather than mechanical: when closed, the
// sheet must not be visible in the viewport AND must not take pointer events.
// How the framework achieves the displacement is its business, and pinning the
// mechanism is how a test breaks on a dependency upgrade that changed nothing
// a user can perceive.
//
// Also worth noting: `inert` did not survive. hasInert is false, because React
// only forwards it when passed a boolean, and my spread passed a string. The
// aria-hidden did apply. Fixing that properly below.
import { readFileSync, writeFileSync } from "node:fs";

// 1. Assert behaviour, not mechanism.
{
  const path = "C:/Supabase/scripts/check-mobile-sheet.mjs";
  let src = readFileSync(path, "utf8");

  src = src.replace(
    /    translated: [^\n]*\n/,
    "    // Tailwind v4 uses the standalone `translate` property, not `transform`.\n" +
    "    // Assert the OUTCOME (off-screen, untouchable) rather than the mechanism,\n" +
    "    // so a framework that achieves it differently still passes.\n" +
    "    displaced: Math.round(r.top) >= window.innerHeight - 120,\n",
  );

  src = src.replace(
    'check("closed sheet is translated away and inert", closed && closed.translated && closed.inert,',
    'check("closed sheet is displaced and cannot be touched", closed && closed.displaced && closed.inert,',
  );
  src = src.replace(
    'closed ? `top=${closed.top} translated=${closed.translated} pointerEvents=${closed.pe} inert=${closed.inert} transform=${closed.transform}` : "");',
    'closed ? `top=${closed.top} displaced=${closed.displaced} pointerEvents=${closed.pe} ariaHidden=${closed.inert} translate=${closed.translate}` : "");',
  );
  src = src.replace(
    "    transform: cs.transform,",
    "    translate: cs.translate,",
  );

  writeFileSync(path, src, "utf8");
  console.log("assertion now measures the outcome");
}

// 2. `inert` never applied - React drops a string-valued inert. Use the boolean.
{
  const path = "C:/Supabase/src/components/MobileSidebar.tsx";
  let src = readFileSync(path, "utf8");
  src = src
    .replace('{...(!open ? { inert: "" as unknown as boolean } : {})}', "inert={!open}")
    .replace('{...(!open ? { inert: "" as unknown as boolean } : {})}\r', "inert={!open}\r");
  writeFileSync(path, src, "utf8");
  console.log(`inert now passed as a boolean: ${src.includes("inert={!open}")}`);
}
