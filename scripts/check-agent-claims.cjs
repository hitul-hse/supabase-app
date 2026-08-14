// Verifies that the factual claims embedded in .claude/agents/*.md are actually
// true of this repo. A subagent prompt that cites a script or npm task that
// doesn't exist will send the agent down a dead end, so these claims need the
// same standard of evidence as code.
const fs = require("node:fs");

const pkg = JSON.parse(fs.readFileSync("package.json", "utf8"));
const schema = fs.readFileSync("supabase/schema.sql", "utf8");

let failed = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}: ${name}${detail ? " — " + detail : ""}`);
  if (!ok) failed++;
};

// Claims about npm scripts (cited in testing.md, backend.md, frontend.md, pipeline.md)
for (const s of ["test:db", "test:schema", "test:rls", "test:rls-control", "test:backfill", "build", "lint"]) {
  check(`npm script "${s}" exists`, Boolean(pkg.scripts[s]));
}

// Claims about scripts referenced by name
for (const f of [
  "scripts/check-rls-negative-control.mjs",
  "scripts/verify-anon-write.mjs",
  "scripts/check-auth-gates.mjs",
  "scripts/check-middleware-bypass.mjs",
  "scripts/probe-live-rls.mjs",
  "scripts/check-remote-state.cjs",
  "scripts/inspect-live-db.mjs",
  "scripts/audit-live-db.mjs",
]) {
  check(`${f} exists`, fs.existsSync(f));
}

// Claims about source files
for (const f of [
  "src/utils/supabase/require-user.ts",
  "src/utils/supabase/require-profile.ts",
  "src/utils/supabase/admin.ts",
  "src/utils/supabase/middleware.ts",
  "src/lib/queries/hse.ts",
  "src/app/globals.css",
]) {
  check(`${f} exists`, fs.existsSync(f));
}

// Claim: schema.sql is ordered tables -> functions -> policies -> seeds
const firstFn = schema.indexOf("create or replace function app_user_role");
const firstRolePolicy = schema.indexOf('create policy "role-scoped read on projects"');
check("schema.sql defines helpers before role-scoped policies", firstFn > 0 && firstFn < firstRolePolicy);

// Claim: the four roles
for (const r of ["exec", "dept_head", "project_manager", "employee"]) {
  check(`role "${r}" is seeded`, schema.includes(`('${r}'`));
}

// Claim: helpers filter on is_active
check(
  "role helpers filter on is_active",
  (schema.match(/where user_id = auth\.uid\(\) and is_active/g) || []).length === 3,
);

// Claim (pipeline.md): CI exists and runs the suite on push/PR.
check("CI workflow exists", fs.existsSync(".github/workflows/checks.yml"));

// Claim: .env* is gitignored
check(".env* is gitignored", fs.readFileSync(".gitignore", "utf8").includes(".env*"));

// Claim: TeamLeadBoard rolls back optimistic updates
const board = fs
  .readdirSync("src/app", { recursive: true })
  .map(String)
  .find((f) => f.endsWith("TeamLeadBoard.tsx"));
check(
  "TeamLeadBoard rolls back on failure",
  Boolean(board) && fs.readFileSync(`src/app/${board}`, "utf8").includes("setDecisions(previous)"),
  board ? `found at src/app/${board}` : "not found",
);

console.log(
  failed
    ? `\n${failed} claim(s) in the agent prompts are WRONG — fix the prompts.`
    : `\nAll claims in .claude/agents/*.md check out against the repo.`,
);
process.exit(failed ? 1 : 0);
