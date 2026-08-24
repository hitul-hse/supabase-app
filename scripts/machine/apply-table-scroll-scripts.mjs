// Re-apply my two package.json scripts and PROVE they are on disk afterwards.
// Written to a file rather than passed with -e because a sibling agent is
// rewriting package.json concurrently and the read-modify-write has to be as
// short as possible, then re-read to confirm it survived.
import { readFileSync, writeFileSync } from "node:fs";

const f = "package.json";
const p = JSON.parse(readFileSync(f, "utf8"));
p.scripts["check:table-scroll-budget"] = "node scripts/check-table-scroll-budget.mjs";
if (!p.scripts["test:db"].includes("check:table-scroll-budget")) {
  p.scripts["test:db"] += " && npm run check:table-scroll-budget";
}
writeFileSync(f, JSON.stringify(p, null, 2) + "\n");

const q = JSON.parse(readFileSync(f, "utf8"));
console.log("gate script  :", q.scripts["check:table-scroll-budget"]);
console.log("in test:db   :", q.scripts["test:db"].includes("check:table-scroll-budget"));
