// Requirement #8: approval actions must surface failures instead of swallowing
// them, and the client must roll back an optimistic update that failed.
// Resolved by walking the tree, because the files moved into an (app) route
// group and parenthesised paths do not survive cmd.exe quoting.
const fs = require("node:fs");
const path = require("node:path");

function walk(dir, acc = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, acc);
    else acc.push(p.split(path.sep).join("/"));
  }
  return acc;
}

const all = walk("src/app");
const actionsPath = all.find((f) => f.endsWith("team-lead/actions.ts"));
const boardPath = all.find((f) => f.endsWith("team-lead/TeamLeadBoard.tsx"));

if (!actionsPath || !boardPath) {
  console.log(`MISSING: actions=${actionsPath} board=${boardPath}`);
  process.exit(1);
}

const actions = fs.readFileSync(actionsPath, "utf8");
const board = fs.readFileSync(boardPath, "utf8");

const checks = [
  ["actions return a typed result", actions.includes("Promise<ApprovalResult>")],
  ["actions check the error", actions.includes("if (error)")],
  ["actions check affected count", actions.includes("count")],
  ["client rolls back on failure", board.includes("setDecisions(previous)")],
  ["client surfaces the error", board.includes('role="alert"')],
  ["client no longer fire-and-forgets", !/void approve/.test(board)],
];

let failed = 0;
for (const [name, ok] of checks) {
  console.log(`${ok ? "PASS" : "FAIL"}: ${name}`);
  if (!ok) failed++;
}

console.log(`\nresolved: ${actionsPath}`);
console.log(`resolved: ${boardPath}`);
console.log(failed ? `\n${failed} failed` : "\nERRORS_SURFACED_AND_ROLLED_BACK");
process.exit(failed ? 1 : 0);
