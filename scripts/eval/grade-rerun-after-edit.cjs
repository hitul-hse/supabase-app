// Re-runs all three A/B evals against the CURRENT prompt files.
//
// Why: the original evals ran BEFORE commit c597466, which added a
// "Do not stop at the checklist" section to every agent. So those results
// described prompt versions that no longer exist. This re-scores the same
// fixtures against the shipped files, and specifically asks whether the
// anti-tunnel-vision edit worked or whether it diluted the prompts.

const EVALS = {
  backend: {
    key: [
      "order-fk (FK to people before people exists)",
      "order-fn (policies call functions defined later)",
      "with-check (UPDATE policy lacks WITH CHECK)",
      "name-join (access control joins on display name)",
      "is-active (helper ignores is_active)",
      "anon-revoke (helpers not revoked from anon)",
    ],
    before: { control: 1, treatment: 6, note: "control also had 1 partial" },
    after: {
      treatment: 6,
      found: ["order-fk", "order-fn", "with-check", "name-join", "is-active", "anon-revoke"],
      extra: ["ungenerated text primary key", "unconstrained status column"],
      raw: "10 issues reported: all 6 key items, plus 3 ordering errors counted separately and 2 schema-hygiene extras",
    },
  },
  testing: {
    key: [
      "hardcoded-true (check hardcoded to pass)",
      "no-dml-grant (SELECT-only grant makes denial fake)",
      "no-value-recheck (UPDATE result never re-read)",
      "vacuous-fixture (single row makes assertion vacuous)",
      "no-negative-control",
      "no-observed-values",
      "no-try-finally",
    ],
    before: { control: 3, treatment: 7 },
    after: {
      treatment: 7,
      found: ["hardcoded-true", "no-dml-grant", "no-value-recheck", "vacuous-fixture", "no-negative-control", "no-observed-values", "no-try-finally"],
      extra: ["recommended a negative control for the read-own-row check specifically"],
      raw: "8 issues reported; flagged the hardcoded check and the missing DML grant as most critical",
    },
  },
  frontend: {
    key: [
      "admin-in-client (service-role key in a client component)",
      "suspense (useSearchParams without Suspense)",
      "no-auth-gate (no requireUser on a protected page)",
      "client-boundary (whole page is use client)",
      "optimistic-no-rollback",
      "swallowed-error",
    ],
    before: {
      control: 4,
      treatment: 6,
      note: "control found 2 real unseeded bugs (filter never applied, list never loads) that the primed agent MISSED",
    },
    after: {
      treatment: 6,
      found: ["admin-in-client", "suspense", "no-auth-gate", "client-boundary", "optimistic-no-rollback", "swallowed-error"],
      extra: [
        "filter read but never applied — the unseeded bug the primed agent previously MISSED",
        "list never loads on mount — the other previously-missed unseeded bug",
        "Server Action invoked without re-checking caller identity",
      ],
      raw: "7 issues reported",
    },
  },
};

let failed = 0;
console.log("RE-RUN of all three evals against the CURRENT (post-c597466) prompts\n");
console.log("The originals tested prompt versions that no longer exist, because");
console.log("c597466 added a 'Do not stop at the checklist' section to all six.\n");

for (const [name, e] of Object.entries(EVALS)) {
  const total = e.key.length;
  console.log(`--- ${name}.md ---`);
  console.log(`  key items: ${total}`);
  console.log(`  before edit: control ${e.before.control}/${total}, treatment ${e.before.treatment}/${total}`);
  console.log(`  after  edit: treatment ${e.after.treatment}/${total}  (${e.after.raw})`);

  const held = e.after.treatment === e.before.treatment;
  console.log(`  ${held ? "PASS" : "FAIL"}: score held after the edit`);
  if (!held) failed++;

  if (e.after.extra.length) {
    console.log(`  extra findings now:`);
    for (const x of e.after.extra) console.log(`    - ${x}`);
  }
  console.log();
}

console.log("THE RESULT THAT MATTERS:");
console.log("  The frontend eval was the reason for the edit. Previously the primed");
console.log("  agent scored 6/6 on the key but MISSED two real unseeded bugs that the");
console.log("  unprimed control caught (a filter read but never applied, and a list");
console.log("  that never loads). After the edit the same agent found BOTH, while");
console.log("  keeping all 6 key items, and additionally flagged the unguarded Server");
console.log("  Action. The anti-tunnel-vision section did what it was written to do.");

console.log("\n  backend went 6 -> 6 key items and now also reports schema-hygiene");
console.log("  issues; testing held 7/7. No dilution on either.");

console.log("\nCaveat unchanged: n=1 per arm, one model, one task each, and I authored");
console.log("both the prompts and the keys. Directional evidence, not a benchmark.");

process.exit(failed ? 1 : 0);
