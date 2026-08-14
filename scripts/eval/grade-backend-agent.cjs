// Grades the A/B eval of .claude/agents/backend.md.
//
// Design: identical model (claude-sonnet-4-6), identical task, identical
// target file. Only difference is whether the agent first read backend.md.
// The target file (scripts/eval/reports-module.sql) contains NO answer key —
// an earlier attempt embedded the defect list in a comment and both arms read
// it despite instructions not to, which invalidated that run.
//
// Answer key: 6 real defects, each one a bug this project actually shipped.

const KEY = [
  { id: "order-fk", label: "FK to people before people is created" },
  { id: "order-fn", label: "policies call functions defined later in the file" },
  { id: "with-check", label: "UPDATE policy has USING but no WITH CHECK" },
  { id: "name-join", label: "access control joins on display name, not id" },
  { id: "is-active", label: "helper does not filter on is_active" },
  { id: "anon-revoke", label: "helpers not revoked from anon/public" },
];

// Scored from the two transcripts.
const control = {
  found: ["order-fk", "with-check"],
  // "with-check" credited only partially: it was raised, then the agent talked
  // itself out of it, concluding WITH CHECK "defaults to the USING expression
  // anyway, so that might actually be fine". That is wrong for this codebase's
  // threat model and is the exact reasoning that shipped the original bug.
  partial: ["with-check"],
  extra: [
    "policy name/logic mismatch (authors can't actually update) — genuinely useful",
    "infinite recursion risk in can_view_report — plausible, ultimately reasoned as OK under Supabase ownership",
    "projects/app_user_person_id/app_user_profile not defined in this file — true but expected for a module",
    "no INSERT/DELETE policies — fair",
    "id should be uuid with default — style preference",
    "status lacks CHECK constraint — fair",
  ],
  total: 9,
};

const treatment = {
  found: ["order-fk", "order-fn", "with-check", "name-join", "is-active", "anon-revoke"],
  partial: [],
  extra: [],
  total: 6,
};

const pct = (n) => `${n}/${KEY.length} (${Math.round((n / KEY.length) * 100)}%)`;

console.log("EVAL: does .claude/agents/backend.md change behaviour?\n");
console.log("Model: claude-sonnet-4-6 (both arms) · Task: review reports-module.sql");
console.log("Only variable: whether backend.md was read first.\n");

console.log("Answer key — 6 defects, each a bug this repo actually shipped:\n");
for (const k of KEY) {
  const c = control.found.includes(k.id)
    ? control.partial.includes(k.id)
      ? "PARTIAL"
      : "found"
    : "MISSED";
  const t = treatment.found.includes(k.id) ? "found" : "MISSED";
  console.log(`  ${k.label}`);
  console.log(`    control: ${c.padEnd(8)}  treatment: ${t}`);
}

const controlSolid = control.found.filter((f) => !control.partial.includes(f)).length;

console.log(`\ncontrol   (no prompt):  ${pct(controlSolid)} solid, +1 partial, ${control.extra.length} extra findings`);
console.log(`treatment (backend.md): ${pct(treatment.found.length)}, ${treatment.extra.length} extra findings`);

console.log(`\nThe four the control missed outright are exactly the repo-specific rules:`);
for (const id of ["order-fn", "name-join", "is-active", "anon-revoke"]) {
  console.log(`  - ${KEY.find((k) => k.id === id).label}`);
}

console.log(`\nMost telling: the control RAISED the missing WITH CHECK, then reasoned`);
console.log(`itself out of it ("WITH CHECK ... defaults to the USING expression`);
console.log(`anyway, so that might actually be fine"). That is precisely the`);
console.log(`assumption that shipped the original vulnerability. backend.md states`);
console.log(`the rule explicitly, and the treatment arm kept it.`);

console.log(`\nCaveat: n=1 per arm, one model, one task, and I authored both the`);
console.log(`prompt and the key. Directional evidence, not a benchmark.`);
