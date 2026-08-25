// Wire the new gate into package.json next to its siblings, and into test:db.
import { readFileSync, writeFileSync } from "node:fs";

const path = "C:/Supabase/package.json";
const raw = readFileSync(path, "utf8");
const pkg = JSON.parse(raw);

if (pkg.scripts["check:views-admit-unknown"]) {
  console.log("already wired");
} else {
  // Rebuild scripts in order so the new entry lands beside the related checks
  // rather than at the end of a 200-line object.
  const out = {};
  for (const [k, v] of Object.entries(pkg.scripts)) {
    out[k] = v;
    if (k === "check:project-budget-rls" || (k === "test:project-budget-rls" && !out["check:views-admit-unknown"])) {
      out["check:views-admit-unknown"] = "node scripts/check-views-admit-unknown.mjs";
      out["test:views-admit-unknown"] = "node scripts/check-views-admit-unknown.mjs";
    }
  }
  if (!out["check:views-admit-unknown"]) {
    out["check:views-admit-unknown"] = "node scripts/check-views-admit-unknown.mjs";
    out["test:views-admit-unknown"] = "node scripts/check-views-admit-unknown.mjs";
  }
  pkg.scripts = out;
}

if (!pkg.scripts["test:db"].includes("test:views-admit-unknown")) {
  pkg.scripts["test:db"] = pkg.scripts["test:db"].replace(
    "npm run test:project-budget-rls",
    "npm run test:project-budget-rls && npm run test:views-admit-unknown",
  );
}

const eol = raw.includes("\r\n") ? "\r\n" : "\n";
writeFileSync(path, JSON.stringify(pkg, null, 2).replace(/\n/g, eol) + eol, "utf8");

console.log(`check:views-admit-unknown -> ${pkg.scripts["check:views-admit-unknown"]}`);
console.log(`in test:db -> ${pkg.scripts["test:db"].includes("test:views-admit-unknown")}`);
