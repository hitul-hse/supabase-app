/*
 * Does .page-shell actually reach the browser?
 *
 * This check exists because of a defect this codebase already suffered:
 * `shadow-[var(--shadow-card)]` compiled and shipped while rendering NOTHING
 * (Tailwind 4 emitted no rule), so every card had an invisible shadow and the
 * token claimed otherwise. A hand-written class in globals.css can fail the
 * same way if the CSS layer drops it -- so assert it in the BUILT stylesheet,
 * not in the source file.
 */
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";

let failed = 0;
const check = (name, ok, detail = "") => {
  if (!ok) failed += 1;
  console.log(`${ok ? "PASS" : "FAIL"}: ${name}${detail ? ` — ${detail}` : ""}`);
};

// Source-level facts first.
const css = readFileSync("src/app/globals.css", "utf8");
check("--content-max is declared", /--content-max:\s*\d+px/.test(css));
const cap = /--content-max:\s*(\d+)px/.exec(css)?.[1];
check(
  "the cap is wider than the widest scrolling table (980px) so nothing clips",
  Number(cap) > 980,
  `${cap}px`,
);
check(
  ".page-shell uses the token, not a hardcoded width",
  /\.page-shell\s*\{[^}]*max-width:\s*var\(--content-max\)/.test(css),
);
check(
  ".page-shell centres itself (margin-inline auto)",
  /\.page-shell\s*\{[^}]*margin-inline:\s*auto/.test(css),
);

// Every page container uses it, and none reintroduces its own padding.
const walk = (d) =>
  readdirSync(d, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(join(d, e.name)) : [join(d, e.name)]
  );
const appFiles = walk("src/app/(app)").filter((f) => f.endsWith(".tsx"));
const shellUsers = appFiles.filter((f) => readFileSync(f, "utf8").includes("page-shell"));
check("page containers use page-shell", shellUsers.length >= 17, `${shellUsers.length} files`);

const stragglers = appFiles.filter((f) => {
  const s = readFileSync(f, "utf8");
  // A page-level container still spelling out its own padding pair.
  return /className="[^"]*\bflex flex-col\b[^"]*\bp-4 sm:p-6\b[^"]*"/.test(s);
});
check(
  "no page container still hand-rolls the padding pair",
  stragglers.length === 0,
  stragglers.map((f) => f.replace(/\\/g, "/")).join(", "),
);

// The BUILT stylesheet: the rule must survive compilation.
const cssDir = ".next/static/chunks";
if (existsSync(cssDir)) {
  const sheets = walk(cssDir).filter((f) => f.endsWith(".css"));
  const built = sheets.map((f) => readFileSync(f, "utf8")).join("\n");
  check("a built stylesheet was found", sheets.length > 0, `${sheets.length} file(s)`);
  check(
    ".page-shell survives the CSS build (the class exists in shipped CSS)",
    /\.page-shell\s*\{/.test(built),
    "Tailwind 4 has silently dropped hand-written rules before",
  );
  check(
    "the built rule carries the max-width",
    /\.page-shell\s*\{[^}]*max-width/.test(built),
  );
} else {
  console.log("SKIP: no .next build present — run `npx next build` first to check shipped CSS");
}

console.log(failed === 0 ? "\nCONTENT WIDTH: OK" : `\nCONTENT WIDTH: ${failed} FAILURES`);
process.exit(failed === 0 ? 0 : 1);
