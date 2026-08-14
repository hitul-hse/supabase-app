// Grades the A/B eval of .claude/agents/frontend.md.
//
// Same design as the backend and testing evals. Third data point, and the
// first where the prompt's advantage is narrow — worth recording precisely
// because it bounds the claim rather than inflating it.

const KEY = [
  {
    id: "admin-in-client",
    label: 'service-role admin client imported into a "use client" component',
    tier: "critical",
  },
  {
    id: "suspense",
    label: "useSearchParams() without a Suspense boundary",
    tier: "stack-specific",
  },
  { id: "no-auth-gate", label: "no requireUser()/requireProfile() gate on a protected page", tier: "repo-specific" },
  { id: "client-boundary", label: 'whole page is "use client" instead of a Server Component', tier: "repo-specific" },
  { id: "optimistic-no-rollback", label: "optimistic archive with void() and no rollback", tier: "stack-specific" },
  { id: "swallowed-error", label: "query error destructured away and never surfaced", tier: "stack-specific" },
];

const control = {
  found: ["admin-in-client", "suspense", "optimistic-no-rollback", "swallowed-error"],
  missed: ["no-auth-gate", "client-boundary"],
  extra: [
    "filter param read but never applied — REAL bug I did not seed",
    "createClient() called on every render — fair",
    "no useEffect, so the list never loads — REAL bug I did not seed",
    "div onClick without role or keyboard support — real a11y issue",
  ],
};

const treatment = {
  found: [
    "admin-in-client",
    "suspense",
    "no-auth-gate",
    "client-boundary",
    "optimistic-no-rollback",
    "swallowed-error",
  ],
  missed: [],
  extra: [],
};

console.log("EVAL: does .claude/agents/frontend.md change behaviour?\n");
console.log("Model: claude-sonnet-4-6 (both arms) · Task: review reports-page.tsx\n");

for (const k of KEY) {
  const c = control.found.includes(k.id) ? "found " : "MISSED";
  const t = treatment.found.includes(k.id) ? "found " : "MISSED";
  console.log(`  [${k.tier.padEnd(14)}] ${k.label}`);
  console.log(`      control: ${c}   treatment: ${t}`);
}

console.log(`\ncontrol   (no prompt):   ${control.found.length}/${KEY.length}`);
console.log(`treatment (frontend.md): ${treatment.found.length}/${KEY.length}`);

console.log(`\nThis is the WEAKEST result of the three evals, and that is the point:`);
console.log(`the control caught the critical service-role leak, the Suspense`);
console.log(`requirement, the swallowed error and the missing rollback on its own.`);
console.log(`Generic React/Next knowledge covers most of this file.`);

console.log(`\nThe prompt's margin is exactly the two repo-specific rules:`);
for (const id of control.missed) {
  console.log(`  - ${KEY.find((k) => k.id === id).label}`);
}
console.log(`The missing auth gate matters most: this codebase requires a page-level`);
console.log(`gate because middleware alone was the CVE-2025-29927 failure mode. No`);
console.log(`amount of general Next.js knowledge implies that policy.`);

console.log(`\nThe control also found 2 real bugs I had not seeded (the filter param`);
console.log(`is never applied, and nothing ever triggers the initial load), plus an`);
console.log(`a11y issue. The primed agent stayed on-spec and missed them. So the`);
console.log(`prompt narrows attention as well as sharpening it — a real trade-off,`);
console.log(`not a pure win.`);

console.log(`\nAcross all three evals: backend 6/6 vs 1/6, testing 7/7 vs 3/7,`);
console.log(`frontend 6/6 vs 4/6. The prompts consistently add the repo-specific`);
console.log(`rules; they add least where generic knowledge already suffices.`);

console.log(`\nCaveat: n=1 per arm, one model, one task each, and I authored both the`);
console.log(`prompts and the keys. Directional evidence, not a benchmark.`);
