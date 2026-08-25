// The assertion reports pointerEvents=none and inert=true yet still fails, so
// one of the three terms is falsy for a reason the message does not print.
// `translated` is not in the message. Print all three.
import { readFileSync, writeFileSync } from "node:fs";

const path = "C:/Supabase/scripts/check-mobile-sheet.mjs";
let src = readFileSync(path, "utf8");

src = src.replace(
  'closed ? `top=${closed.top} pointerEvents=${closed.pe} inert=${closed.inert}` : "");',
  'closed ? `top=${closed.top} translated=${closed.translated} pointerEvents=${closed.pe} inert=${closed.inert} transform=${closed.transform}` : "");',
);

// Capture the raw transform so the regex can be judged rather than trusted.
src = src.replace(
  "    inert: cs.pointerEvents === \"none\" && s.getAttribute(\"aria-hidden\") === \"true\",",
  "    inert: cs.pointerEvents === \"none\" && s.getAttribute(\"aria-hidden\") === \"true\",\n    transform: cs.transform,",
);

writeFileSync(path, src, "utf8");
console.log("diagnostics added");
