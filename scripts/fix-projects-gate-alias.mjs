// Same fix, done by line number so CRLF does not defeat the literal match.
import { readFileSync, writeFileSync } from "node:fs";

const path = "C:/Supabase/scripts/check-projects-module.mjs";
const src = readFileSync(path, "utf8");
const eol = src.includes("\r\n") ? "\r\n" : "\n";

if (src.includes("MobileDisclosure")) { console.log("already mapped"); process.exit(0); }

const lines = src.split(/\r?\n/);

// 1. Map the alias inside the ProjectsExplorer compile call.
const explorerAt = lines.findIndex((l) => l.includes('"ProjectsExplorer.cjs"'));
if (explorerAt < 0) { console.log("explorer not found"); process.exit(1); }
const closeAt = lines.findIndex((l, i) => i > explorerAt && l.trim() === "}),");
if (closeAt < 0) { console.log("close not found"); process.exit(1); }
lines.splice(closeAt, 0, '      "@/components/MobileDisclosure": posix(mobileDisclosureFile),');

// 2. Compile it, just after Button (which is already compiled the same way).
const buttonAt = lines.findIndex((l) => l.includes('"Button.cjs"'));
if (buttonAt < 0) { console.log("button not found"); process.exit(1); }
lines.splice(buttonAt + 1, 0,
  "  // Added when the mobile work wrapped the explorer's panels in a disclosure.",
  "  // Compiled rather than stubbed: it is small and dependency-free, and a stub",
  "  // would keep this gate green if the real component started throwing.",
  '  const mobileDisclosureFile = await compile("src/components/MobileDisclosure.tsx", "MobileDisclosure.cjs", {});',
);

writeFileSync(path, lines.join(eol), "utf8");
console.log("MobileDisclosure compiled and mapped");
