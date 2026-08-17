/**
 * Does test:entry-policy-equivalence actually FAIL when the policy is widened?
 *
 * The gate passes today. That alone proves nothing: a check that cannot fail is not
 * evidence, and this one guards a SECURITY boundary, so its ability to detect a
 * widening is the whole point of having it.
 *
 * The gate already carries an internal negative control (it installs
 * `using (true)` and confirms that is DETECTED as different). This goes one step
 * further and mutates the real thing the gate reads -- supabase/schema.sql -- to a
 * genuinely permissive policy, runs the gate, and confirms it fails. Then restores.
 *
 * The mutation is written to a TEMPORARY COPY of schema.sql and the original is put
 * back in a finally block, with a checksum verified afterwards, because leaving a
 * widened security policy in a repo other agents are committing from would be a far
 * worse outcome than an unverified gate.
 *
 * Run: node scripts/verify-policy-gate-fails.mjs
 */
import { readFileSync, writeFileSync, copyFileSync, unlinkSync, existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";

const SCHEMA = "supabase/schema.sql";
const BACKUP = "tmp-schema-backup.sql";

const original = readFileSync(SCHEMA);
const originalHash = createHash("sha256").update(original).digest("hex");
copyFileSync(SCHEMA, BACKUP);

let failed = false;
const check = (label, ok, detail) => {
  console.log(`${ok ? "PASS" : "FAIL"}: ${label}\n        ${detail}`);
  if (!ok) failed = true;
};

const runGate = () => {
  const r = spawnSync("node", ["scripts/check-entry-policy-equivalence.mjs"], {
    encoding: "utf8",
    shell: true,
  });
  return { status: r.status, out: (r.stdout ?? "") + (r.stderr ?? "") };
};

try {
  // 1. Baseline: the gate passes on the real schema.
  const before = runGate();
  check(
    "the gate passes on the committed schema",
    before.status === 0,
    `exit ${before.status}`,
  );

  // 2. Mutate: replace the hoisted predicate with one that lets ANY authenticated
  //    user read every entry. This is the exact regression the gate exists to stop
  //    -- a plausible-looking "simplification" that quietly removes the scoping.
  const src = original.toString();
  // Matched by REGEX, not by a literal string. schema.sql is stored with CRLF on
  // this checkout (.gitattributes normalises on commit), so a template literal
  // written with LF newlines does not appear in the file at all -- which is why the
  // first version of this verification reported "could not locate the policy" while
  // the policy was sitting right there. Whitespace-tolerant matching is the fix;
  // the anchors are still specific enough that it cannot hit anything else.
  const hoistedRe =
    /for select to authenticated using \(\s*\(select app_user_role\(\)\) = 'exec'\s*or member_id = \(select time\.current_member_id\(\)\)\s*or time\.can_view_member\(member_id\)\s*\);/;
  if (!hoistedRe.test(src)) {
    check(
      "the hoisted policy text was found in schema.sql so it can be mutated",
      false,
      "could not locate the policy to mutate -- schema.sql has changed shape; this verification is inconclusive",
    );
  } else {
    const widened = src.replace(hoistedRe, `for select to authenticated using (true);`);
    check(
      "the mutation actually changed the file",
      widened !== src && widened.includes("using (true);"),
      "schema.sql now contains a deliberately permissive entry policy, to be reverted below",
    );
    writeFileSync(SCHEMA, widened);

    const after = runGate();
    check(
      "the gate FAILS when the entry policy is widened to `using (true)`",
      after.status !== 0,
      after.status !== 0
        ? `exit ${after.status} -- the gate detected that a dept_head and an employee could suddenly read every entry`
        : "exit 0 -- the gate PASSED a policy that grants everyone access to everyone's hours, so it is not protecting anything",
    );

    // The failure must name the roles whose access changed, not just fail.
    check(
      "the failure message identifies which roles gained access",
      /dept_head|employee/i.test(after.out),
      `output mentions the affected roles: ${/dept_head|employee/i.test(after.out) ? "yes" : "no"}`,
    );
  }
} finally {
  // 3. Restore, and prove the restore worked. This matters more than the test.
  writeFileSync(SCHEMA, original);
  const restoredHash = createHash("sha256").update(readFileSync(SCHEMA)).digest("hex");
  const restored = restoredHash === originalHash;
  console.log(
    `${restored ? "PASS" : "FAIL"}: schema.sql restored byte-for-byte\n        sha256 ${restored ? "matches" : "DIFFERS -- restore from " + BACKUP + " immediately"}`,
  );
  if (!restored) failed = true;
  else if (existsSync(BACKUP)) unlinkSync(BACKUP);
}

// A last guard: the gate must pass again now that the schema is back.
const final = runGate();
check("the gate passes again after restoring the schema", final.status === 0, `exit ${final.status}`);

console.log(
  failed
    ? "\nPOLICY GATE: cannot be trusted as written\n"
    : "\nPOLICY GATE: proven to fail on a real widening, and the schema is intact\n",
);
process.exit(failed ? 1 : 0);
