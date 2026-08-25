// Trace the two dead views to the screens a user actually looks at, then look
// at those screens. A zero in a database view is only a bug once somebody reads
// it as a fact.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const walk = (dir, out = []) => {
  for (const n of readdirSync(dir)) {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) { if (!/node_modules|\.next/.test(n)) walk(p, out); }
    else out.push(p);
  }
  return out;
};

const files = walk("C:/Supabase/src").filter((f) => /\.(ts|tsx)$/.test(f) && !/database\.types/.test(f));

// Follow the call chain outward from the two accessors.
const trace = (fnName) => {
  const callers = [];
  for (const f of files) {
    const s = readFileSync(f, "utf8");
    // A call, not the definition itself.
    const re = new RegExp(`\\b${fnName}\\s*\\(`, "g");
    if (!re.test(s)) continue;
    if (new RegExp(`(export\\s+)?async\\s+function\\s+${fnName}\\b`).test(s)) {
      // still record if it also calls itself elsewhere, but mark the definition
      callers.push({ file: f.replace("C:/Supabase/", ""), role: "defines" });
      continue;
    }
    callers.push({ file: f.replace("C:/Supabase/", ""), role: "calls" });
  }
  return callers;
};

for (const fn of ["getBillableValues", "getProjectBudgetStatus"]) {
  console.log(`\n=== ${fn}`);
  for (const c of trace(fn)) console.log(`   ${c.role.padEnd(8)} ${c.file}`);
}

// What do those callers render? Show the surrounding usage so we can see
// whether the number reaches a user or is only passed along.
console.log("\n=== usage in context ===");
for (const f of files) {
  const s = readFileSync(f, "utf8");
  if (!/getBillableValues|getProjectBudgetStatus|billableValue|budgetStatus/.test(s)) continue;
  const lines = s.split("\n");
  lines.forEach((l, i) => {
    if (/getBillableValues|getProjectBudgetStatus|billableValue|budgetStatus/.test(l)) {
      console.log(`   ${f.replace("C:/Supabase/", "")}:${i + 1}  ${l.trim().slice(0, 100)}`);
    }
  });
}
