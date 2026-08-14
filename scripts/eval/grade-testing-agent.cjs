// Grades the A/B eval of .claude/agents/testing.md.
//
// Same setup as the backend eval: same model, same task, same file, the only
// variable being whether the agent read testing.md first. The fixture
// (scripts/eval/reports-tests.mjs) is a test suite seeded with defects that
// make it unable to catch real bugs. No answer key in the file.
//
// Both arms happened to report 8 problems, so raw count says nothing. What
// matters is WHICH problems, and specifically the ones that require knowing
// this stack's silent-failure traps.

const KEY = [
  {
    id: "hardcoded-true",
    label: "check('employee cannot approve', true) is hardcoded to pass",
    tier: "generic",
  },
  {
    id: "no-dml-grant",
    label: "only SELECT granted, so the write test fails on a missing GRANT, not RLS",
    tier: "stack-specific",
  },
  {
    id: "no-value-recheck",
    label: "UPDATE result never re-read, so a silently-filtered write is invisible",
    tier: "stack-specific",
  },
  {
    id: "vacuous-fixture",
    label: "single people row makes the isolation assertion vacuous",
    tier: "subtle",
  },
  {
    id: "no-negative-control",
    label: "no negative control proving the suite can go red",
    tier: "stack-specific",
  },
  {
    id: "no-observed-values",
    label: "check() prints no observed values, so failures are undiagnosable",
    tier: "subtle",
  },
  {
    id: "no-try-finally",
    label: "as() lacks try/finally, so an error leaves the role switched",
    tier: "generic",
  },
];

const control = {
  found: ["hardcoded-true", "no-value-recheck", "vacuous-fixture"],
  // Control's other 5 findings were reasonable but weaker: missing exec-can-read
  // symmetry, no exec write tests, transaction isolation, jwt claim not reset,
  // and grant ordering (which it framed as sequencing, not as the denial
  // passing for the wrong reason).
  notes: [
    "raised jwt-claim-not-reset — real, and the treatment arm missed it",
    "raised grant ordering but NOT that it makes the denial pass for the wrong reason",
    "suggested more coverage (exec symmetry, exec writes) — useful but not the trap",
  ],
};

const treatment = {
  found: [
    "hardcoded-true",
    "no-dml-grant",
    "no-value-recheck",
    "vacuous-fixture",
    "no-negative-control",
    "no-observed-values",
    "no-try-finally",
  ],
  notes: ["also flagged the missing anon role in the preamble"],
};

let failed = 0;
console.log("EVAL: does .claude/agents/testing.md change behaviour?\n");
console.log("Model: claude-sonnet-4-6 (both arms) · Task: review reports-tests.mjs");
console.log("Both arms reported 8 problems, so the count alone is uninformative.\n");

for (const k of KEY) {
  const c = control.found.includes(k.id) ? "found " : "MISSED";
  const t = treatment.found.includes(k.id) ? "found " : "MISSED";
  console.log(`  [${k.tier.padEnd(15)}] ${k.label}`);
  console.log(`      control: ${c}   treatment: ${t}`);
}

const cN = control.found.length;
const tN = treatment.found.length;
console.log(`\ncontrol   (no prompt):  ${cN}/${KEY.length}`);
console.log(`treatment (testing.md): ${tN}/${KEY.length}`);

const missedByControl = KEY.filter((k) => !control.found.includes(k.id));
console.log(`\nThe control missed:`);
for (const k of missedByControl) console.log(`  - ${k.label}`);

console.log(`\nThe decisive one is the GRANT. Both arms noticed the grants, but only`);
console.log(`the primed agent identified WHY it matters: with SELECT-only grants the`);
console.log(`write test fails on a missing privilege rather than on RLS, so the`);
console.log(`denial "passes" even with no write policy at all. The control treated`);
console.log(`it as statement ordering. That distinction is written into testing.md`);
console.log(`because this project hit it for real.`);

console.log(`\nThe control did find one thing the treatment missed (jwt claim not`);
console.log(`reset between as() calls), so the prompt is not strictly dominant.`);

console.log(`\nCaveat: n=1 per arm, one model, one task, and I wrote both the prompt`);
console.log(`and the key. Directional evidence, not a benchmark.`);

process.exit(failed);
