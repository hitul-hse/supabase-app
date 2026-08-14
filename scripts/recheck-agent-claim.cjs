// Independent recheck of the claim:
//   "6 agent prompts; 3 A/B-tested; all re-verified against the shipped files"
//
// Written as a file rather than an inline -e string, because cmd.exe escaping
// silently corrupted the regex in an earlier inline attempt and made every file
// look invalid. A checker that fails for the wrong reason is worse than none.
const fs = require("node:fs");

const DIR = ".claude/agents";
const files = fs.readdirSync(DIR).filter((f) => f.endsWith(".md"));

let failed = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}: ${name}${detail ? " — " + detail : ""}`);
  if (!ok) failed++;
};

console.log(`CLAIM 1: there are 6 agent prompts\n`);
check("exactly 6 agent files", files.length === 6, files.join(", "));

console.log(`\nCLAIM 2: each is a well-formed, loadable agent\n`);
for (const f of files) {
  const s = fs.readFileSync(`${DIR}/${f}`, "utf8");
  const fm = s.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  const slug = f.replace(/\.md$/, "");
  if (!fm) {
    check(`${f} has frontmatter`, false);
    continue;
  }
  const name = (fm[1].match(/^name:\s*(.+)$/m) || [])[1]?.trim();
  const desc = (fm[1].match(/^description:\s*(.+)$/m) || [])[1]?.trim();
  const tools = (fm[1].match(/^tools:\s*(.+)$/m) || [])[1]?.trim();
  const ok = name === slug && Boolean(desc) && Boolean(tools);
  check(
    `${f.padEnd(14)} name matches filename, has description + tools`,
    ok,
    `name=${name}`,
  );
}

console.log(`\nCLAIM 3: 3 were A/B-tested (backend, testing, frontend)\n`);
const graders = {
  backend: "scripts/eval/grade-backend-agent.cjs",
  testing: "scripts/eval/grade-testing-agent.cjs",
  frontend: "scripts/eval/grade-frontend-agent.cjs",
};
for (const [agent, grader] of Object.entries(graders)) {
  check(`${agent}: grader committed at ${grader}`, fs.existsSync(grader));
}
const untested = files
  .map((f) => f.replace(/\.md$/, ""))
  .filter((a) => !Object.keys(graders).includes(a));
console.log(`  NOT A/B-tested (3, as claimed): ${untested.join(", ")}`);
check("exactly 3 agents are untested", untested.length === 3, untested.join(", "));

console.log(`\nCLAIM 4: "all re-verified against the shipped files"\n`);
console.log("  This is the part worth scrutinising. The prompt edit landed in");
console.log("  c597466. Anything whose evidence predates that commit describes a");
console.log("  file version that no longer exists.\n");

const { execFileSync } = require("node:child_process");
const editCommit = "c597466";
try {
  execFileSync("git", ["show", "-s", "--format=%cI", editCommit], { encoding: "utf8" });
} catch {
  console.log("  could not resolve the edit commit");
  process.exit(1);
}

// Which agents have a grader whose evidence was regenerated AFTER the edit?
const rerun = "scripts/eval/grade-rerun-after-edit.cjs";
const rerunExists = fs.existsSync(rerun);
check("a post-edit re-run grader exists", rerunExists, rerun);

if (rerunExists) {
  const s = fs.readFileSync(rerun, "utf8");
  for (const a of Object.keys(graders)) {
    check(`  ${a} re-scored after the edit`, s.includes(`${a}:`) || s.includes(`${a}.md`));
  }
}

// The honest limit: the other three were never behaviourally tested at all,
// before OR after the edit. "All re-verified" must not be read as "all tested".
console.log(`\n  For ${untested.join(", ")}: no A/B eval exists, before or after`);
console.log(`  the edit. What IS verified for them is that they parse, and that`);
console.log(`  every factual claim they make about the repo is true (enforced in`);
console.log(`  CI by check-agent-claims.cjs).`);

console.log(`\nCLAIM 5: factual accuracy is enforced for ALL six, not just the tested three\n`);
try {
  const out = execFileSync("node", ["scripts/check-agent-claims.cjs"], { encoding: "utf8" });
  check("check-agent-claims.cjs passes", /All claims in/.test(out));
  const n = (out.match(/PASS:/g) || []).length;
  console.log(`  ${n} factual claims verified`);
} catch (err) {
  check("check-agent-claims.cjs passes", false, (err.stdout || "").slice(0, 200));
}

console.log(
  failed
    ? `\n${failed} problem(s) with the claim.`
    : `\nClaim holds, with one wording caveat: "all re-verified" covers parsing and\nfactual accuracy for all 6, but behavioural A/B evidence exists for only 3.`,
);
process.exit(failed ? 1 : 0);
