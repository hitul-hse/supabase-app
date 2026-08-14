// Full requirement-to-check traceability run over the FINAL state of the work.
//
// Every earlier check was written and run at a different point in the session,
// against a tree that has since changed (a route-group refactor, a PUBLIC_ROUTES
// change, CI, and prompt edits all landed afterwards). This runs the complete
// mapped set now, in one pass, over the whole result, and reports what each
// requirement actually did rather than what it did when first written.
//
// Each row maps: original bug -> the check that proves it -> observed result.
import { execSync, spawn } from "node:child_process";

const REQUIREMENTS = [
  {
    id: 1,
    bug: "schema.sql could not execute (11 forward references)",
    check: "npm run test:schema",
    cmd: "npm run test:schema",
    expect: /EXECUTED supabase\/schema\.sql with no errors/,
  },
  {
    id: 2,
    bug: "4 protected pages had no server-side auth gate",
    check: "scripts/check-auth-gates.mjs (needs server)",
    server: true,
    cmd: "node scripts/check-auth-gates.mjs",
    expect: /PASS \/ ->/,
  },
  {
    id: 3,
    bug: "middleware failed open on missing env / thrown error",
    check: "grep both fail-closed paths in middleware source",
    cmd: 'node -e "const s=require(\'fs\').readFileSync(\'src/utils/supabase/middleware.ts\',\'utf8\');const a=/if \\(!supabaseUrl \\|\\| !supabaseKey\\)[\\s\\S]{0,400}?redirectToLogin\\(\\)/.test(s);const b=/catch \\(err\\)[\\s\\S]{0,400}?redirectToLogin\\(\\)/.test(s);console.log(a&&b?\'BOTH_FAIL_CLOSED_PATHS_PRESENT\':\'MISSING\')"',
    expect: /BOTH_FAIL_CLOSED_PATHS_PRESENT/,
  },
  {
    id: 4,
    bug: "approvals UPDATE policy had USING but no WITH CHECK",
    check: "npm run test:rls (behavioural) + test:verify-query",
    cmd: "npm run test:rls",
    expect: /PASS: WITH CHECK rejects an invalid status value/,
  },
  {
    id: 5,
    bug: "app_user_profile had no INSERT/UPDATE/DELETE policies",
    check: "npm run test:schema (policy introspection)",
    cmd: "npm run test:schema",
    expect: /PASS: app_user_profile has an DELETE policy/,
  },
  {
    id: 6,
    bug: "can_view_project joined on project_name, leaking same-named projects",
    check: "npm run test:rls (the actual exploit)",
    cmd: "npm run test:rls",
    expect: /PASS: employee sees assigned project but NOT the same-named secret project/,
  },
  {
    id: 7,
    bug: "role helpers ignored is_active, so deactivated accounts kept permissions",
    check: "npm run test:rls",
    cmd: "npm run test:rls",
    expect: /PASS: deactivated exec sees no people/,
  },
  {
    id: 8,
    bug: "approval actions swallowed errors and always revalidated",
    check: "scripts/check-approval-error-handling.cjs",
    cmd: "node scripts/check-approval-error-handling.cjs",
    expect: /ERRORS_SURFACED_AND_ROLLED_BACK/,
  },
  {
    id: 9,
    bug: "tests could pass without being able to fail",
    check: "npm run test:rls-control (negative controls)",
    cmd: "npm run test:rls-control",
    expect: /All four regressions were detected/,
  },
  {
    id: 10,
    bug: "project_id backfill correctness",
    check: "npm run test:backfill",
    cmd: "npm run test:backfill",
    expect: /PASS: migration is idempotent/,
  },
  {
    id: 11,
    bug: "the SQL Editor verification query could itself be wrong",
    check: "npm run test:verify-query",
    cmd: "npm run test:verify-query",
    expect: /verify-policies\.sql is correct/,
  },
  {
    id: 12,
    bug: "CVE-2025-29927 middleware bypass",
    check: "scripts/check-middleware-bypass.mjs (needs server)",
    server: true,
    cmd: "node scripts/check-middleware-bypass.mjs",
    expect: /no protected content leaked/,
  },
  {
    id: 13,
    bug: "fixes must be on the pushed remote, not just local",
    check: "scripts/check-remote-state.cjs",
    cmd: "node scripts/check-remote-state.cjs",
    expect: /All 19 checks present on the pushed remote/,
  },
  {
    id: 14,
    bug: "live production RLS must deny anonymous access",
    check: "scripts/probe-live-rls.mjs (real Supabase project)",
    cmd: "node scripts/probe-live-rls.mjs",
    expect: /Live RLS denies anonymous access on every table probed/,
  },
  {
    id: 15,
    bug: "agent prompts must not state anything false about the repo",
    check: "scripts/check-agent-claims.cjs",
    cmd: "node scripts/check-agent-claims.cjs",
    expect: /All claims in \.claude\/agents\/\*\.md check out/,
  },
];

const needsServer = REQUIREMENTS.some((r) => r.server);
let server;
if (needsServer) {
  console.log("Building and starting a server for the route probes...\n");
  execSync("npm run build", { stdio: "ignore" });
  server = spawn("npm", ["run", "start"], { shell: true, stdio: "ignore" });
  // Wait for a PROTECTED route to redirect, not just for the port to answer.
  for (let i = 0; i < 60; i++) {
    try {
      const res = await fetch("http://localhost:3000/people", { redirect: "manual" });
      if (res.status >= 300 && res.status < 400) break;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
}

let failed = 0;
const results = [];

for (const req of REQUIREMENTS) {
  let out = "";
  let ok = false;
  try {
    out = execSync(req.cmd, { encoding: "utf8", stdio: "pipe" });
    ok = req.expect.test(out);
  } catch (err) {
    out = `${err.stdout || ""}${err.stderr || ""}`;
    ok = req.expect.test(out);
  }
  const observed = (out.match(req.expect) || ["(expected output not found)"])[0];
  results.push({ ...req, ok, observed });
  if (!ok) failed++;
  console.log(`${ok ? "PASS" : "FAIL"}  #${req.id} ${req.bug}`);
  console.log(`      via: ${req.check}`);
  console.log(`      observed: ${observed.slice(0, 110)}`);
}

if (server) {
  try {
    execSync(
      `for /f "tokens=5" %p in ('netstat -ano ^| findstr ":3000" ^| findstr LISTENING') do @taskkill /f /pid %p`,
      { stdio: "ignore", shell: "cmd.exe" },
    );
  } catch {
    /* already gone */
  }
  server.kill();
}

console.log(`\n${REQUIREMENTS.length - failed}/${REQUIREMENTS.length} requirements verified against the FINAL tree.`);
process.exit(failed ? 1 : 0);
